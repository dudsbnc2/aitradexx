"""
AutoTrader router — Bybit + OKX + Hyperliquid  |  Spot / Futuros separados
============================================================================

Modos suportados:
  SPOT     — ordens a mercado simples, sem leverage, sem TP/SL nativo
  FUTURES  — perpetuals lineares (USDT), com leverage + TP/SL nativos

Exchanges: Bybit V5 · OKX V5 · Hyperliquid

Segurança:
  - API secrets encriptadas com Fernet (AES-128-CBC + HMAC-SHA256)
  - Chave Fernet derivada da env ENCRYPTION_KEY (obrigatória em produção)
  - Nunca devolve a secret ao cliente

Auto-execute:
  Quando auto_execute=True numa AutoTradeConfig, o signal_service chama
  trigger_auto_trades() depois de gerar um sinal com bias LONG/SHORT.
"""
from __future__ import annotations

import base64
import hashlib
import hmac as hmaclib
import json
import os
import time
import urllib.parse
from typing import Optional, Literal

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey, Numeric
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.sql import func

from app.core.auth import get_current_user
from app.core.database import Base, get_db
from app.core.logging_config import get_logger

logger = get_logger("tradeia.autotrader")
router = APIRouter(prefix="/api/autotrader", tags=["autotrader"])

SUPPORTED_EXCHANGES = ["bybit", "okx", "hyperliquid"]
TRADE_MODES = ["spot", "futures"]   # futures = perpetuals USDT-margined

# ── Timeframes válidos por modo ────────────────────────────────────────────────
SPOT_TIMEFRAMES    = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"]
FUTURES_TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "1W"]

# ── DB Models ──────────────────────────────────────────────────────────────────

class ExchangeKey(Base):
    __tablename__ = "exchange_keys"
    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)
    exchange      = Column(String(30), default="bybit")
    api_key       = Column(String(255), nullable=False)
    api_secret_encrypted = Column(String(512), nullable=False)
    label         = Column(String(100), default="Main Account")
    testnet       = Column(Boolean, default=False)
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())


class AutoTradeConfig(Base):
    __tablename__ = "auto_trade_configs"
    id               = Column(Integer, primary_key=True, index=True)
    user_id          = Column(Integer, ForeignKey("users.id"), nullable=False)
    exchange_key_id  = Column(Integer, ForeignKey("exchange_keys.id"), nullable=False)
    trade_mode       = Column(String(10), default="spot")   # spot | futures
    pair             = Column(String(20), nullable=True)  # NULL = modo automático (AI escolhe)
    timeframe        = Column(String(5), default="1H")
    order_size_usdt  = Column(Numeric(12, 2), default=10)
    leverage         = Column(Integer, default=1)           # sempre 1 para spot
    risk_profile     = Column(String(20), default="balanced")
    tp_multiplier    = Column(Numeric(4, 2), default=1.0)
    sl_multiplier    = Column(Numeric(4, 2), default=1.0)
    max_open_trades  = Column(Integer, default=3)
    min_confidence   = Column(Integer, default=70)          # threshold para auto_execute
    auto_execute     = Column(Boolean, default=False)
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())


class TradeLog(Base):
    __tablename__ = "trade_logs"
    id               = Column(Integer, primary_key=True, index=True)
    user_id          = Column(Integer, ForeignKey("users.id"), nullable=False)
    exchange_key_id  = Column(Integer, ForeignKey("exchange_keys.id"))
    exchange         = Column(String(30), default="bybit")
    trade_mode       = Column(String(10), default="spot")   # spot | futures
    pair             = Column(String(20))
    side             = Column(String(10))
    order_type       = Column(String(20))
    qty              = Column(Numeric(20, 8))
    price            = Column(Numeric(20, 8))
    take_profit      = Column(Numeric(20, 8))
    stop_loss        = Column(Numeric(20, 8))
    leverage         = Column(Integer, default=1)
    order_id         = Column(String(100))
    status           = Column(String(20), default="pending")
    error_msg        = Column(Text)
    triggered_by     = Column(String(20), default="manual") # manual | auto_signal
    signal_id        = Column(Integer, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())


# ── Encriptação Fernet ─────────────────────────────────────────────────────────

def _get_fernet() -> Fernet:
    raw = os.environ.get("ENCRYPTION_KEY", "")
    if not raw:
        from app.core.config import settings
        derived = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
        raw = base64.urlsafe_b64encode(derived).decode()
        logger.warning(
            "ENCRYPTION_KEY não definida — usando chave derivada de SECRET_KEY. "
            "Define ENCRYPTION_KEY em produção!"
        )
    return Fernet(raw.encode())


def _encrypt_secret(secret: str) -> str:
    return _get_fernet().encrypt(secret.encode()).decode()


def _decrypt_secret(token: str) -> str:
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except (InvalidToken, Exception):
        try:
            return _xor_decrypt_legacy(token)
        except Exception:
            raise HTTPException(status_code=500, detail="Não foi possível decifrar a API secret. Reconecta a exchange.")


def _xor_decrypt_legacy(hex_text: str) -> str:
    """Mantido apenas para migrar keys antigas."""
    key = "aitradexx-secret-v1"
    text = bytes.fromhex(hex_text).decode("utf-8")
    return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(text))


# ── Pydantic Schemas ───────────────────────────────────────────────────────────

class ConnectKeyRequest(BaseModel):
    exchange:   str  = "bybit"
    api_key:    str  = Field(..., min_length=10)
    api_secret: str  = Field(..., min_length=10)
    label:      str  = "Main Account"
    testnet:    bool = False


class TradeConfigRequest(BaseModel):
    exchange_key_id: int
    trade_mode:      Literal["spot", "futures"] = "spot"
    pair:            Optional[str] = None
    timeframe:       str = "1H"
    order_size_usdt: float = Field(default=10, ge=1, le=100000)
    leverage:        int   = Field(default=1, ge=1, le=125)
    risk_profile:    str   = "balanced"
    tp_multiplier:   float = Field(default=1.0, ge=0.5, le=5.0)
    sl_multiplier:   float = Field(default=1.0, ge=0.5, le=5.0)
    max_open_trades: int   = Field(default=3, ge=1, le=20)
    min_confidence:  int   = Field(default=70, ge=50, le=100)
    auto_execute:    bool  = False


class ExecuteOrderRequest(BaseModel):
    exchange_key_id: int
    trade_mode:      Literal["spot", "futures"] = "spot"
    pair:            str
    side:            str
    order_size_usdt: float = Field(..., ge=1)
    leverage:        int   = Field(default=1, ge=1, le=125)
    order_type:      str   = "Market"
    limit_price:     Optional[float] = None
    take_profit:     Optional[float] = None
    stop_loss:       Optional[float] = None


# ══════════════════════════════════════════════════════════════════════════════
# BYBIT V5
# ══════════════════════════════════════════════════════════════════════════════

BYBIT_MAINNET = "https://api.bybit.com"
BYBIT_TESTNET = "https://api-testnet.bybit.com"


def _bybit_sign(api_secret: str, ts: str, api_key: str, recv_window: str, payload: str) -> str:
    param_str = f"{ts}{api_key}{recv_window}{payload}"
    return hmaclib.new(api_secret.encode(), param_str.encode(), hashlib.sha256).hexdigest()


async def _bybit_request(
    method: str, endpoint: str,
    api_key: str, api_secret: str,
    testnet: bool = False,
    params: dict | None = None,
    body: dict | None = None,
) -> dict:
    base = BYBIT_TESTNET if testnet else BYBIT_MAINNET
    url  = f"{base}{endpoint}"
    ts   = str(int(time.time() * 1000))
    recv = "5000"

    payload = ("&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
               if method.upper() == "GET" else json.dumps(body or {}))

    sig = _bybit_sign(api_secret, ts, api_key, recv, payload)
    headers = {
        "X-BAPI-API-KEY":     api_key,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-SIGN":        sig,
        "X-BAPI-RECV-WINDOW": recv,
        "Content-Type":       "application/json",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = (await client.get(url, params=params, headers=headers)
                if method.upper() == "GET"
                else await client.post(url, json=body, headers=headers))

    try:
        data = resp.json()
    except Exception:
        raw = getattr(resp, 'text', '')
        logger.error(f"Bybit resposta não-JSON {resp.status_code}: {raw[:200]}")
        raise HTTPException(502, f"Bybit: resposta inválida (HTTP {resp.status_code})")
    if data.get("retCode", 0) != 0:
        raise HTTPException(400, f"Bybit: {data.get('retMsg', 'Unknown error')}")
    return data


async def _bybit_get_balance(
    api_key: str, api_secret: str, testnet: bool,
    trade_mode: str = "spot",
) -> list:
    account_type = "CONTRACT" if trade_mode == "futures" else "UNIFIED"
    coins = []

    try:
        data = await _bybit_request(
            "GET", "/v5/account/wallet-balance",
            api_key=api_key, api_secret=api_secret, testnet=testnet,
            params={"accountType": account_type},
        )
        for w in data.get("result", {}).get("list", []):
            for c in w.get("coin", []):
                bal = float(c.get("walletBalance", 0))
                if bal > 0:
                    coins.append({
                        "coin":      c["coin"],
                        "balance":   c["walletBalance"],
                        "available": c.get("availableToWithdraw", c.get("availableToBorrow", "0")),
                        "usd_value": c.get("usdValue", "0"),
                    })
    except Exception:
        try:
            data = await _bybit_request(
                "GET", "/v5/account/wallet-balance",
                api_key=api_key, api_secret=api_secret, testnet=testnet,
                params={"accountType": "UNIFIED"},
            )
            for w in data.get("result", {}).get("list", []):
                for c in w.get("coin", []):
                    if float(c.get("walletBalance", 0)) > 0:
                        coins.append({
                            "coin":      c["coin"],
                            "balance":   c["walletBalance"],
                            "available": c.get("availableToWithdraw", "0"),
                            "usd_value": c.get("usdValue", "0"),
                        })
        except Exception:
            pass

    return coins


async def _bybit_execute_spot(
    api_key: str, api_secret: str, testnet: bool,
    pair: str, side: str, order_type: str,
    order_size_usdt: float, limit_price: Optional[float],
) -> dict:
    symbol = pair.replace("/", "")

    ticker = await _bybit_request(
        "GET", "/v5/market/tickers", api_key=api_key, api_secret=api_secret,
        testnet=testnet, params={"category": "spot", "symbol": symbol},
    )
    tickers = ticker.get("result", {}).get("list", [])
    if not tickers:
        raise HTTPException(400, f"Par {pair} não encontrado no Bybit Spot")
    price = float(tickers[0]["lastPrice"])
    qty   = round(order_size_usdt / price, 6)

    body: dict = {
        "category":    "spot",
        "symbol":      symbol,
        "side":        side,
        "orderType":   order_type,
        "qty":         str(qty),
        "timeInForce": "IOC" if order_type == "Market" else "GTC",
    }
    if order_type == "Limit" and limit_price:
        body["price"] = str(limit_price)

    resp     = await _bybit_request("POST", "/v5/order/create", api_key=api_key,
                                     api_secret=api_secret, testnet=testnet, body=body)
    order_id = resp.get("result", {}).get("orderId", "")
    return {"order_id": order_id, "price": price, "qty": qty}


async def _bybit_execute_futures(
    api_key: str, api_secret: str, testnet: bool,
    pair: str, side: str, order_type: str,
    order_size_usdt: float, leverage: int,
    take_profit: Optional[float], stop_loss: Optional[float],
    limit_price: Optional[float],
) -> dict:
    symbol = pair.replace("/", "")
    if not symbol.endswith("USDT"):
        symbol = symbol + "USDT" if not symbol.endswith("PERP") else symbol

    await _bybit_request(
        "POST", "/v5/position/set-leverage",
        api_key=api_key, api_secret=api_secret, testnet=testnet,
        body={"category": "linear", "symbol": symbol,
              "buyLeverage": str(leverage), "sellLeverage": str(leverage)},
    )

    ticker = await _bybit_request(
        "GET", "/v5/market/tickers", api_key=api_key, api_secret=api_secret,
        testnet=testnet, params={"category": "linear", "symbol": symbol},
    )
    tickers = ticker.get("result", {}).get("list", [])
    if not tickers:
        raise HTTPException(400, f"Par {pair} não encontrado no Bybit Futures")
    price = float(tickers[0]["lastPrice"])
    qty   = round((order_size_usdt * leverage) / price, 3)

    body: dict = {
        "category":    "linear",
        "symbol":      symbol,
        "side":        side,
        "orderType":   order_type,
        "qty":         str(qty),
        "timeInForce": "IOC" if order_type == "Market" else "GTC",
        "positionIdx": 0,
    }
    if order_type == "Limit" and limit_price:
        body["price"] = str(limit_price)
    if take_profit:
        body["takeProfit"]    = str(take_profit)
        body["tpTriggerBy"]   = "MarkPrice"
    if stop_loss:
        body["stopLoss"]      = str(stop_loss)
        body["slTriggerBy"]   = "MarkPrice"

    resp     = await _bybit_request("POST", "/v5/order/create", api_key=api_key,
                                     api_secret=api_secret, testnet=testnet, body=body)
    order_id = resp.get("result", {}).get("orderId", "")
    return {"order_id": order_id, "price": price, "qty": qty}


# ══════════════════════════════════════════════════════════════════════════════
# OKX V5
# ══════════════════════════════════════════════════════════════════════════════

OKX_BASE    = "https://www.okx.com"
OKX_TESTNET = "https://www.okx.com"  # OKX usa header x-simulated-trading: 1


def _okx_sign(api_secret: str, timestamp: str, method: str, path: str, body_str: str) -> str:
    msg = f"{timestamp}{method.upper()}{path}{body_str}"
    return base64.b64encode(
        hmaclib.new(api_secret.encode(), msg.encode(), hashlib.sha256).digest()
    ).decode()


async def _okx_request(
    method: str, endpoint: str,
    api_key: str, api_secret: str, passphrase: str,
    testnet: bool = False,
    params: dict | None = None,
    body: dict | None = None,
) -> dict:
    """
    OKX V5 REST.
    passphrase = api_secret field split: 'secret::passphrase' — ou passphrase em separado.
    Para compatibilidade, o campo api_secret pode ser 'SECRET::PASSPHRASE'.
    """
    # Separar secret e passphrase se vierem juntos
    if "::" in api_secret:
        actual_secret, actual_passphrase = api_secret.split("::", 1)
    else:
        actual_secret, actual_passphrase = api_secret, passphrase

    timestamp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    body_str  = json.dumps(body, separators=(",", ":")) if body else ""
    path      = endpoint + ("?" + urllib.parse.urlencode(params) if params and method.upper() == "GET" else "")

    sig = _okx_sign(actual_secret, timestamp, method, path, body_str)

    headers = {
        "OK-ACCESS-KEY":        api_key,
        "OK-ACCESS-SIGN":       sig,
        "OK-ACCESS-TIMESTAMP":  timestamp,
        "OK-ACCESS-PASSPHRASE": actual_passphrase,
        "Content-Type":         "application/json",
    }
    if testnet:
        headers["x-simulated-trading"] = "1"

    url = f"{OKX_BASE}{endpoint}"
    async with httpx.AsyncClient(timeout=10) as client:
        if method.upper() == "GET":
            resp = await client.get(url, params=params, headers=headers)
        else:
            resp = await client.post(url, content=body_str, headers=headers)

    try:
        data = resp.json()
    except Exception:
        raw = getattr(resp, "text", "")
        logger.error(f"OKX resposta não-JSON {resp.status_code}: {raw[:200]}")
        raise HTTPException(502, f"OKX: resposta inválida (HTTP {resp.status_code})")
    if data.get("code") not in ("0", 0):
        err = data.get("msg") or str(data)
        raise HTTPException(400, f"OKX: {err}")
    return data


async def _okx_get_balance(
    api_key: str, api_secret: str,
    trade_mode: str = "spot",
) -> list:
    """OKX: /api/v5/account/balance — devolve todos os assets."""
    try:
        data = await _okx_request(
            "GET", "/api/v5/account/balance",
            api_key=api_key, api_secret=api_secret, passphrase="",
        )
        coins = []
        for detail in data.get("data", [{}])[0].get("details", []):
            bal = float(detail.get("cashBal", 0) or 0)
            if bal > 0:
                coins.append({
                    "coin":      detail.get("ccy", ""),
                    "balance":   str(bal),
                    "available": str(detail.get("availBal", bal)),
                    "usd_value": str(detail.get("eqUsd", 0)),
                })
        return coins
    except Exception as e:
        logger.warning(f"OKX balance error: {e}")
        return []


async def _okx_execute_spot(
    api_key: str, api_secret: str,
    pair: str, side: str, order_type: str,
    order_size_usdt: float, limit_price: Optional[float],
) -> dict:
    """OKX Spot — instId como BTC-USDT."""
    inst_id = pair.replace("/", "-")

    # Preço actual
    ticker_data = await _okx_request(
        "GET", "/api/v5/market/ticker",
        api_key=api_key, api_secret=api_secret, passphrase="",
        params={"instId": inst_id},
    )
    price = float(ticker_data["data"][0]["last"])
    qty   = round(order_size_usdt / price, 6)

    body: dict = {
        "instId":  inst_id,
        "tdMode":  "cash",
        "side":    side.lower(),    # buy | sell
        "ordType": "market" if order_type == "Market" else "limit",
        "sz":      str(qty),
    }
    if order_type != "Market" and limit_price:
        body["px"] = str(limit_price)

    resp = await _okx_request(
        "POST", "/api/v5/trade/order",
        api_key=api_key, api_secret=api_secret, passphrase="",
        body=body,
    )
    order_id = resp.get("data", [{}])[0].get("ordId", "")
    return {"order_id": order_id, "price": price, "qty": qty}


async def _okx_execute_futures(
    api_key: str, api_secret: str,
    pair: str, side: str, order_type: str,
    order_size_usdt: float, leverage: int,
    take_profit: Optional[float], stop_loss: Optional[float],
    limit_price: Optional[float],
) -> dict:
    """OKX SWAP (perpetuals USDT-margined) — instId como BTC-USDT-SWAP."""
    base    = pair.replace("/", "").replace("USDT", "")
    inst_id = f"{base}-USDT-SWAP"

    # Set leverage
    try:
        await _okx_request(
            "POST", "/api/v5/account/set-leverage",
            api_key=api_key, api_secret=api_secret, passphrase="",
            body={"instId": inst_id, "lever": str(leverage), "mgnMode": "isolated"},
        )
    except Exception as e:
        logger.warning(f"OKX set-leverage ignorado: {e}")

    # Preço actual
    ticker_data = await _okx_request(
        "GET", "/api/v5/market/ticker",
        api_key=api_key, api_secret=api_secret, passphrase="",
        params={"instId": inst_id},
    )
    price = float(ticker_data["data"][0]["last"])
    qty   = round((order_size_usdt * leverage) / price, 4)

    okx_side     = "buy"  if side.lower() in ("buy", "long")  else "sell"
    pos_side     = "long" if okx_side == "buy"                else "short"

    body: dict = {
        "instId":   inst_id,
        "tdMode":   "isolated",
        "side":     okx_side,
        "posSide":  pos_side,
        "ordType":  "market" if order_type == "Market" else "limit",
        "sz":       str(qty),
    }
    if order_type != "Market" and limit_price:
        body["px"] = str(limit_price)

    # TP/SL como attachAlgoOrds
    if take_profit or stop_loss:
        algo = {}
        if take_profit:
            algo["tpTriggerPx"] = str(take_profit)
            algo["tpOrdPx"]     = "-1"
        if stop_loss:
            algo["slTriggerPx"] = str(stop_loss)
            algo["slOrdPx"]     = "-1"
        body["attachAlgoOrds"] = [algo]

    resp = await _okx_request(
        "POST", "/api/v5/trade/order",
        api_key=api_key, api_secret=api_secret, passphrase="",
        body=body,
    )
    order_id = resp.get("data", [{}])[0].get("ordId", "")
    return {"order_id": order_id, "price": price, "qty": qty}


# ══════════════════════════════════════════════════════════════════════════════
# HYPERLIQUID
# ══════════════════════════════════════════════════════════════════════════════
# Hyperliquid não usa API key/secret tradicional — usa uma Ethereum wallet.
# api_key  = endereço público da wallet (0x...)
# api_secret = chave privada (0x... ou hex sem 0x)
# Suporta apenas Futuros (perpetuals). Spot não é suportado via esta interface.

HL_BASE = "https://api.hyperliquid.xyz"


def _hl_sign_action(private_key_hex: str, action: dict, nonce: int, vault_address: Optional[str] = None) -> dict:
    """Assina uma acção Hyperliquid com a chave privada Ethereum."""
    import struct

    # Hyperliquid usa EIP-712 simplificado
    action_str = json.dumps(action, separators=(",", ":"), sort_keys=True)
    nonce_bytes = nonce.to_bytes(8, "big")
    vault_bytes = bytes.fromhex(vault_address[2:] if vault_address else "00" * 20)
    # msg = keccak256(action_str + nonce + vault)
    msg = hashlib.sha256(action_str.encode() + nonce_bytes + vault_bytes).digest()

    # Assinar com chave privada — requer coincurve ou eth_account
    try:
        from eth_account import Account
        from eth_account._utils.signing import sign_message_hash
        pk = private_key_hex if private_key_hex.startswith("0x") else "0x" + private_key_hex
        signed = Account.sign_message(
            {"version": "0x01", "hashStruct": msg.hex()},
            private_key=pk,
        )
        return {"r": hex(signed.r), "s": hex(signed.s), "v": signed.v}
    except Exception:
        # Fallback sem biblioteca eth: usa HMAC como pseudo-assinatura
        # (para validação de conta, a HL pode rejeitar — avisa o user)
        pseudo = hmaclib.new(private_key_hex.encode(), msg, hashlib.sha256).hexdigest()
        return {"r": "0x" + pseudo[:64], "s": "0x" + pseudo[:64], "v": 27}


async def _hl_info(body: dict) -> dict:
    """Endpoint público de informação Hyperliquid."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{HL_BASE}/info", json=body)
    return resp.json()


async def _hl_exchange(wallet_address: str, private_key: str, action: dict) -> dict:
    """Endpoint de execução Hyperliquid (requer assinatura)."""
    nonce = int(time.time() * 1000)
    sig   = _hl_sign_action(private_key, action, nonce)
    body  = {
        "action":       action,
        "nonce":        nonce,
        "signature":    sig,
        "vaultAddress": None,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{HL_BASE}/exchange", json=body)
    try:
        data = resp.json()
    except Exception:
        raise HTTPException(502, f"Hyperliquid: resposta inválida (HTTP {resp.status_code})")
    if isinstance(data, dict) and data.get("status") == "err":
        raise HTTPException(400, f"Hyperliquid: {data.get('response', 'Unknown error')}")
    return data


async def _hl_get_balance(wallet_address: str) -> list:
    """Retorna saldo da conta Hyperliquid (apenas USDC/USDT)."""
    try:
        data = await _hl_info({
            "type": "clearinghouseState",
            "user": wallet_address,
        })
        margin = data.get("marginSummary", {})
        usdc_bal = float(margin.get("accountValue", 0))
        if usdc_bal > 0:
            return [{
                "coin":      "USDC",
                "balance":   str(usdc_bal),
                "available": str(float(margin.get("withdrawable", usdc_bal))),
                "usd_value": str(usdc_bal),
            }]
        return []
    except Exception as e:
        logger.warning(f"Hyperliquid balance error: {e}")
        return []


async def _hl_execute_futures(
    wallet_address: str, private_key: str,
    pair: str, side: str,
    order_size_usdt: float, leverage: int,
    take_profit: Optional[float], stop_loss: Optional[float],
) -> dict:
    """
    Hyperliquid perpetual futures.
    pair: BTC/USDT → coin = BTC
    """
    coin = pair.replace("/USDT", "").replace("/USD", "").replace("/", "")

    # Obter preço actual e coin index
    meta = await _hl_info({"type": "meta"})
    universe = meta.get("universe", [])
    coin_idx  = next((i for i, u in enumerate(universe) if u.get("name") == coin), None)
    if coin_idx is None:
        raise HTTPException(400, f"Par {coin} não encontrado no Hyperliquid")

    # Mid price
    ticker_data = await _hl_info({"type": "allMids"})
    price = float(ticker_data.get(coin, 0))
    if not price:
        raise HTTPException(400, f"Preço de {coin} não disponível no Hyperliquid")

    qty = round((order_size_usdt * leverage) / price, 4)

    is_buy = side.lower() in ("buy", "long")

    # Set leverage
    lev_action = {
        "type":     "updateLeverage",
        "asset":    coin_idx,
        "isCross":  False,
        "leverage": leverage,
    }
    try:
        await _hl_exchange(wallet_address, private_key, lev_action)
    except Exception as e:
        logger.warning(f"HL set leverage ignorado: {e}")

    # Ordem de mercado
    order_action = {
        "type":   "order",
        "orders": [{
            "a":    coin_idx,
            "b":    is_buy,
            "p":    "0",      # market order: preço 0
            "s":    str(qty),
            "r":    False,    # não é reduce-only
            "t":    {"limit": {"tif": "Ioc"}},
        }],
        "grouping": "na",
    }

    resp = await _hl_exchange(wallet_address, private_key, order_action)
    order_id = str(resp.get("response", {}).get("data", {}).get("statuses", [{}])[0].get("resting", {}).get("oid", "hl_market"))

    # TP/SL como ordens separadas (post-order)
    if take_profit or stop_loss:
        try:
            tp_sl_orders = []
            if take_profit:
                tp_sl_orders.append({
                    "a": coin_idx, "b": not is_buy,
                    "p": str(take_profit), "s": str(qty), "r": True,
                    "t": {"trigger": {"isMarket": True, "triggerPx": str(take_profit), "tpsl": "tp"}},
                })
            if stop_loss:
                tp_sl_orders.append({
                    "a": coin_idx, "b": not is_buy,
                    "p": str(stop_loss), "s": str(qty), "r": True,
                    "t": {"trigger": {"isMarket": True, "triggerPx": str(stop_loss), "tpsl": "sl"}},
                })
            await _hl_exchange(wallet_address, private_key, {
                "type": "order", "orders": tp_sl_orders, "grouping": "positionTpsl",
            })
        except Exception as e:
            logger.warning(f"HL TP/SL ignorado: {e}")

    return {"order_id": order_id, "price": price, "qty": qty}


# ══════════════════════════════════════════════════════════════════════════════
# DISPATCHER UNIFICADO
# ══════════════════════════════════════════════════════════════════════════════

async def _validate_connection(exchange: str, api_key: str, api_secret: str, testnet: bool) -> None:
    try:
        if exchange == "bybit":
            await _bybit_get_balance(api_key, api_secret, testnet)
        elif exchange == "okx":
            await _okx_get_balance(api_key, api_secret)
        elif exchange == "hyperliquid":
            # Hyperliquid: api_key = endereço wallet
            if not api_key.startswith("0x") or len(api_key) < 40:
                raise HTTPException(400, "Hyperliquid: api_key deve ser o endereço da wallet (0x...)")
            await _hl_get_balance(api_key)
        else:
            raise HTTPException(400, f"Exchange '{exchange}' não suportada")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Não foi possível conectar: {str(e)}")


async def _get_balance(key: ExchangeKey, trade_mode: str = "spot") -> list:
    secret = _decrypt_secret(key.api_secret_encrypted)
    if key.exchange == "bybit":
        return await _bybit_get_balance(key.api_key, secret, key.testnet, trade_mode)
    elif key.exchange == "okx":
        return await _okx_get_balance(key.api_key, secret)
    elif key.exchange == "hyperliquid":
        return await _hl_get_balance(key.api_key)
    return []


async def _execute_order(key: ExchangeKey, req: ExecuteOrderRequest) -> dict:
    secret = _decrypt_secret(key.api_secret_encrypted)
    mode   = req.trade_mode

    if key.exchange == "bybit":
        if mode == "spot":
            return await _bybit_execute_spot(
                key.api_key, secret, key.testnet,
                req.pair, req.side, req.order_type,
                req.order_size_usdt, req.limit_price,
            )
        else:
            return await _bybit_execute_futures(
                key.api_key, secret, key.testnet,
                req.pair, req.side, req.order_type,
                req.order_size_usdt, req.leverage,
                req.take_profit, req.stop_loss, req.limit_price,
            )

    elif key.exchange == "okx":
        if mode == "spot":
            return await _okx_execute_spot(
                key.api_key, secret,
                req.pair, req.side, req.order_type,
                req.order_size_usdt, req.limit_price,
            )
        else:
            return await _okx_execute_futures(
                key.api_key, secret,
                req.pair, req.side, req.order_type,
                req.order_size_usdt, req.leverage,
                req.take_profit, req.stop_loss, req.limit_price,
            )

    elif key.exchange == "hyperliquid":
        if mode == "spot":
            raise HTTPException(400, "Hyperliquid suporta apenas Futuros (perpetuals). Usa modo Futures.")
        return await _hl_execute_futures(
            key.api_key, secret,
            req.pair, req.side,
            req.order_size_usdt, req.leverage,
            req.take_profit, req.stop_loss,
        )

    raise HTTPException(400, "Exchange não suportada")


# ══════════════════════════════════════════════════════════════════════════════
# AUTO-EXECUTE  (chamado pelo signal_service após gerar sinal)
# ══════════════════════════════════════════════════════════════════════════════

async def trigger_auto_trades(
    pair: str,
    timeframe: str,
    bias: str,
    confidence: int,
    take_profit: float,
    stop_loss: float,
    signal_id: Optional[int] = None,
) -> None:
    if bias not in ("LONG", "SHORT"):
        return

    try:
        from app.core.database import AsyncSessionLocal
        from sqlalchemy import or_
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AutoTradeConfig, ExchangeKey)
                .join(ExchangeKey, AutoTradeConfig.exchange_key_id == ExchangeKey.id)
                .where(
                    or_(AutoTradeConfig.pair == pair, AutoTradeConfig.pair == None),
                    AutoTradeConfig.timeframe  == timeframe,
                    AutoTradeConfig.auto_execute == True,
                    AutoTradeConfig.is_active  == True,
                    ExchangeKey.is_active      == True,
                )
            )
            rows = result.all()

        for cfg, key in rows:
            if confidence < cfg.min_confidence:
                logger.info(f"Auto-execute skip {pair}: confidence {confidence} < {cfg.min_confidence}")
                continue

            async with AsyncSessionLocal() as db:
                open_count_res = await db.execute(
                    select(func.count(TradeLog.id)).where(
                        TradeLog.user_id  == cfg.user_id,
                        TradeLog.pair     == pair,
                        TradeLog.status   == "filled",
                    )
                )
                open_count = open_count_res.scalar() or 0

            if open_count >= cfg.max_open_trades:
                continue

            adj_tp = round(take_profit * float(cfg.tp_multiplier), 6) if take_profit else None
            adj_sl = round(stop_loss  * float(cfg.sl_multiplier), 6) if stop_loss  else None
            mode   = cfg.trade_mode or "spot"
            side   = "Buy" if bias == "LONG" else "Sell"

            # Hyperliquid só suporta futuros
            if key.exchange == "hyperliquid" and mode == "spot":
                mode = "futures"

            req = ExecuteOrderRequest(
                exchange_key_id = key.id,
                trade_mode      = mode,
                pair            = pair,
                side            = side,
                order_size_usdt = float(cfg.order_size_usdt),
                leverage        = cfg.leverage if mode == "futures" else 1,
                order_type      = "Market",
                take_profit     = adj_tp if mode == "futures" else None,
                stop_loss       = adj_sl if mode == "futures" else None,
            )

            async with AsyncSessionLocal() as db:
                log = TradeLog(
                    user_id         = cfg.user_id,
                    exchange_key_id = key.id,
                    exchange        = key.exchange,
                    trade_mode      = mode,
                    pair            = pair,
                    side            = side,
                    order_type      = "Market",
                    take_profit     = adj_tp,
                    stop_loss       = adj_sl,
                    leverage        = req.leverage,
                    status          = "pending",
                    triggered_by    = "auto_signal",
                    signal_id       = signal_id,
                )
                db.add(log)
                await db.flush()

                try:
                    result_data = await _execute_order(key, req)
                    log.order_id = result_data["order_id"]
                    log.qty      = result_data["qty"]
                    log.price    = result_data["price"]
                    log.status   = "filled"
                    logger.info(f"Auto-execute OK: {pair} {side} {mode} user={cfg.user_id}")
                except Exception as e:
                    log.status    = "failed"
                    log.error_msg = str(e)
                    logger.error(f"Auto-execute FAILED {pair} user={cfg.user_id}: {e}")

                await db.commit()

            try:
                await _notify_auto_trade(cfg.user_id, key.exchange, mode, pair, side,
                                          float(cfg.order_size_usdt), adj_tp, adj_sl, log.status)
            except Exception as e:
                logger.warning(f"Telegram notify failed: {e}")

    except Exception as e:
        logger.error(f"trigger_auto_trades error {pair}: {e}")


async def _notify_auto_trade(
    user_id: int, exchange: str, mode: str, pair: str,
    side: str, size: float, tp: Optional[float], sl: Optional[float], status: str,
) -> None:
    from app.core.config import settings
    from app.core.database import AsyncSessionLocal, User
    if not settings.TELEGRAM_TOKEN:
        return

    async with AsyncSessionLocal() as db:
        user_res = await db.execute(select(User).where(User.id == user_id))
        user     = user_res.scalar_one_or_none()
        chat_id  = user.telegram_chat_id if user else None

    if not chat_id:
        return

    emoji  = "🟢" if side == "Buy" else "🔴"
    status_emoji = "✅" if status == "filled" else "❌"
    text = (
        f"{status_emoji} *Auto-Trade {status.upper()}*\n"
        f"{emoji} {side.upper()} {pair} ({mode.upper()})\n"
        f"💰 Tamanho: ${size} USDT\n"
        f"Exchange: {exchange.upper()}\n"
        + (f"TP: {tp}\n" if tp else "")
        + (f"SL: {sl}\n" if sl else "")
    )

    async with httpx.AsyncClient(timeout=8) as client:
        await client.post(
            f"https://api.telegram.org/bot{settings.TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
        )


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/connect")
async def connect_exchange_key(
    req: ConnectKeyRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Exchange não suportada. Use: {SUPPORTED_EXCHANGES}")
    await _validate_connection(req.exchange, req.api_key, req.api_secret, req.testnet)
    key_obj = ExchangeKey(
        user_id              = user["uid"],
        exchange             = req.exchange,
        api_key              = req.api_key,
        api_secret_encrypted = _encrypt_secret(req.api_secret),
        label                = req.label,
        testnet              = req.testnet,
    )
    db.add(key_obj)
    await db.commit()
    await db.refresh(key_obj)
    return {"id": key_obj.id, "label": key_obj.label, "exchange": req.exchange,
            "testnet": req.testnet, "connected": True}


@router.get("/keys")
async def list_keys(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExchangeKey).where(ExchangeKey.user_id == user["uid"], ExchangeKey.is_active == True)
    )
    return [{"id": k.id, "exchange": k.exchange, "label": k.label,
             "testnet": k.testnet, "api_key_preview": k.api_key[:8] + "****"}
            for k in result.scalars().all()]


@router.delete("/keys/{key_id}")
async def delete_key(key_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExchangeKey).where(ExchangeKey.id == key_id, ExchangeKey.user_id == user["uid"])
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "Key not found")
    key.is_active = False
    await db.commit()
    return {"deleted": True}


@router.get("/balance/{key_id}")
async def get_balance(
    key_id: int,
    mode: str = "spot",
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ExchangeKey).where(ExchangeKey.id == key_id, ExchangeKey.user_id == user["uid"])
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "Key not found")
    return {"coins": await _get_balance(key, trade_mode=mode), "mode": mode}


@router.get("/timeframes")
async def get_timeframes(mode: str = "spot"):
    return {
        "mode":       mode,
        "timeframes": FUTURES_TIMEFRAMES if mode == "futures" else SPOT_TIMEFRAMES,
    }


@router.post("/config")
async def save_config(
    req: TradeConfigRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    valid_tfs = FUTURES_TIMEFRAMES if req.trade_mode == "futures" else SPOT_TIMEFRAMES
    if req.timeframe not in valid_tfs:
        raise HTTPException(400, f"Timeframe '{req.timeframe}' inválido para modo {req.trade_mode}. "
                                  f"Válidos: {valid_tfs}")

    if req.trade_mode == "spot" and req.leverage > 1:
        raise HTTPException(400, "Spot não suporta leverage. Define leverage=1 ou muda para futures.")

    result = await db.execute(
        select(ExchangeKey).where(ExchangeKey.id == req.exchange_key_id, ExchangeKey.user_id == user["uid"])
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "Key not found")

    existing = await db.execute(
        select(AutoTradeConfig).where(
            AutoTradeConfig.user_id         == user["uid"],
            AutoTradeConfig.pair            == req.pair,
            AutoTradeConfig.exchange_key_id == req.exchange_key_id,
            AutoTradeConfig.trade_mode      == req.trade_mode,
        )
    )
    cfg = existing.scalar_one_or_none()
    fields = ["timeframe", "order_size_usdt", "leverage", "risk_profile",
              "tp_multiplier", "sl_multiplier", "max_open_trades",
              "min_confidence", "auto_execute", "trade_mode"]
    if cfg:
        for f in fields:
            setattr(cfg, f, getattr(req, f))
    else:
        cfg = AutoTradeConfig(user_id=user["uid"], **req.model_dump())
        db.add(cfg)

    await db.commit()
    await db.refresh(cfg)
    return {"id": cfg.id, "pair": cfg.pair, "trade_mode": cfg.trade_mode, "saved": True}


@router.get("/config")
async def list_configs(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AutoTradeConfig).where(AutoTradeConfig.user_id == user["uid"],
                                       AutoTradeConfig.is_active == True)
    )
    return [
        {
            "id": c.id, "pair": c.pair, "trade_mode": c.trade_mode,
            "timeframe": c.timeframe, "order_size_usdt": float(c.order_size_usdt),
            "leverage": c.leverage, "risk_profile": c.risk_profile,
            "tp_multiplier": float(c.tp_multiplier), "sl_multiplier": float(c.sl_multiplier),
            "max_open_trades": c.max_open_trades, "min_confidence": c.min_confidence,
            "auto_execute": c.auto_execute, "exchange_key_id": c.exchange_key_id,
        }
        for c in result.scalars().all()
    ]


@router.post("/execute")
async def execute_order(
    req: ExecuteOrderRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.trade_mode == "spot" and req.leverage > 1:
        raise HTTPException(400, "Spot não suporta leverage.")
    if req.trade_mode == "spot" and (req.take_profit or req.stop_loss):
        raise HTTPException(400, "Spot não suporta TP/SL nativos. Usa modo Futures para TP/SL automático.")

    result = await db.execute(
        select(ExchangeKey).where(ExchangeKey.id == req.exchange_key_id,
                                   ExchangeKey.user_id == user["uid"])
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(403, "Key not found")

    # Hyperliquid só suporta futuros
    if key.exchange == "hyperliquid" and req.trade_mode == "spot":
        raise HTTPException(400, "Hyperliquid suporta apenas Futuros. Muda para modo Futures.")

    cfg_res = await db.execute(
        select(AutoTradeConfig).where(
            AutoTradeConfig.user_id         == user["uid"],
            AutoTradeConfig.pair            == req.pair,
            AutoTradeConfig.exchange_key_id == req.exchange_key_id,
            AutoTradeConfig.trade_mode      == req.trade_mode,
            AutoTradeConfig.is_active       == True,
        )
    )
    cfg = cfg_res.scalar_one_or_none()
    if cfg:
        open_res = await db.execute(
            select(func.count(TradeLog.id)).where(
                TradeLog.user_id == user["uid"],
                TradeLog.pair    == req.pair,
                TradeLog.status  == "filled",
            )
        )
        open_count = open_res.scalar() or 0
        if open_count >= cfg.max_open_trades:
            raise HTTPException(400,
                f"Limite de {cfg.max_open_trades} ordens abertas atingido para {req.pair}.")

    log = TradeLog(
        user_id         = user["uid"],
        exchange_key_id = req.exchange_key_id,
        exchange        = key.exchange,
        trade_mode      = req.trade_mode,
        pair            = req.pair,
        side            = req.side,
        order_type      = req.order_type,
        take_profit     = req.take_profit,
        stop_loss       = req.stop_loss,
        leverage        = req.leverage,
        status          = "pending",
        triggered_by    = "manual",
    )
    db.add(log)
    await db.flush()

    try:
        result_data  = await _execute_order(key, req)
        log.order_id = result_data["order_id"]
        log.qty      = result_data["qty"]
        log.price    = result_data["price"]
        log.status   = "filled"
        await db.commit()
        return {
            "success":   True,
            "order_id":  result_data["order_id"],
            "qty":       result_data["qty"],
            "price":     result_data["price"],
            "side":      req.side,
            "mode":      req.trade_mode,
            "exchange":  key.exchange,
        }
    except HTTPException as e:
        log.status    = "failed"
        log.error_msg = e.detail
        await db.commit()
        raise


@router.get("/trades")
async def list_trades(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TradeLog).where(TradeLog.user_id == user["uid"])
        .order_by(TradeLog.created_at.desc()).limit(100)
    )
    return [
        {
            "id":           t.id,
            "pair":         t.pair,
            "side":         t.side,
            "trade_mode":   t.trade_mode,
            "exchange":     t.exchange,
            "order_type":   t.order_type,
            "qty":          float(t.qty or 0),
            "price":        float(t.price or 0),
            "take_profit":  float(t.take_profit or 0),
            "stop_loss":    float(t.stop_loss or 0),
            "leverage":     t.leverage,
            "order_id":     t.order_id,
            "status":       t.status,
            "triggered_by": t.triggered_by,
            "signal_id":    t.signal_id,
            "error_msg":    t.error_msg,
            "created_at":   t.created_at.isoformat() if t.created_at else None,
        }
        for t in result.scalars().all()
    ]


class AIRunRequest(BaseModel):
    exchange_key_id: int
    trade_mode:      Literal["spot", "futures"] = "spot"
    pair:            Optional[str]   = None
    timeframe:       str             = "1H"
    order_size_usdt: float           = Field(10.0, gt=0)
    leverage:        int             = Field(1, ge=1, le=125)
    risk_profile:    str             = "balanced"
    min_confidence:  int             = Field(55, ge=0, le=100)


@router.post("/ai-run")
async def ai_run(
    req: AIRunRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.signal_service import run_signal, run_scan
    from app.services.data_fetcher import SCAN_PAIRS

    if req.trade_mode == "spot" and req.leverage > 1:
        raise HTTPException(400, "Spot não suporta leverage.")

    valid_tfs = FUTURES_TIMEFRAMES if req.trade_mode == "futures" else SPOT_TIMEFRAMES
    if req.timeframe not in valid_tfs:
        raise HTTPException(400, f"Timeframe '{req.timeframe}' inválido para modo {req.trade_mode}.")

    key_res = await db.execute(
        select(ExchangeKey).where(
            ExchangeKey.id      == req.exchange_key_id,
            ExchangeKey.user_id == user["uid"],
            ExchangeKey.is_active == True,
        )
    )
    key = key_res.scalar_one_or_none()
    if not key:
        raise HTTPException(403, "Exchange key não encontrada ou inativa.")

    # Hyperliquid só suporta futuros
    if key.exchange == "hyperliquid" and req.trade_mode == "spot":
        raise HTTPException(400, "Hyperliquid suporta apenas Futuros. Muda para modo Futures.")

    if req.trade_mode == "spot" and not req.pair:
        raise HTTPException(400, "Modo Spot requer um par específico.")

    try:
        if req.pair:
            signal = await run_signal(req.pair, req.timeframe, use_mtf=True, user_id=user["uid"])
            signal.setdefault("pair", req.pair)
            scanned = 1
        else:
            scan = await run_scan(SCAN_PAIRS, timeframe=req.timeframe, use_mtf=True)
            scanned = scan.get("scanned", len(SCAN_PAIRS))
            best = scan.get("best")
            if not best or best.get("bias") not in ("LONG", "SHORT"):
                return {
                    "executed":   False,
                    "reason":     "Nenhum sinal adequado encontrado neste momento.",
                    "scanned":    scanned,
                    "timeframe":  req.timeframe,
                    "trade_mode": req.trade_mode,
                }
            signal = best
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ai-run signal error user={user['uid']}: {e}")
        raise HTTPException(500, f"Erro ao obter sinal de IA: {e}")

    bias       = signal.get("bias", "WAIT")
    confidence = int(signal.get("confidence", 0))
    pair       = signal.get("pair") or req.pair or ""
    take_profit = float(signal.get("takeProfit") or signal.get("take_profit") or 0) or None
    stop_loss   = float(signal.get("stopLoss")   or signal.get("stop_loss")   or 0) or None

    if bias not in ("LONG", "SHORT"):
        return {
            "executed": False, "bias": bias, "confidence": confidence, "pair": pair,
            "reason": f"Sinal WAIT — sem setup adequado (confiança: {confidence}%).",
            "scanned": scanned if not req.pair else 1, "signal": signal,
            "timeframe": req.timeframe, "trade_mode": req.trade_mode,
        }

    if confidence < req.min_confidence:
        return {
            "executed": False, "bias": bias, "confidence": confidence, "pair": pair,
            "reason": f"Confiança {confidence}% abaixo do mínimo {req.min_confidence}%.",
            "scanned": scanned if not req.pair else 1, "signal": signal,
            "timeframe": req.timeframe, "trade_mode": req.trade_mode,
        }

    if req.trade_mode == "spot" and bias == "SHORT":
        return {
            "executed": False, "bias": bias, "confidence": confidence, "pair": pair,
            "reason": f"Sinal SHORT identificado mas Spot não suporta venda a descoberto. Usa Futures.",
            "scanned": 1, "signal": signal, "timeframe": req.timeframe, "trade_mode": req.trade_mode,
        }

    side = "Buy" if bias == "LONG" else "Sell"
    execute_req = ExecuteOrderRequest(
        exchange_key_id = req.exchange_key_id,
        trade_mode      = req.trade_mode,
        pair            = pair,
        side            = side,
        order_size_usdt = req.order_size_usdt,
        leverage        = req.leverage if req.trade_mode == "futures" else 1,
        order_type      = "Market",
        take_profit     = take_profit if req.trade_mode == "futures" else None,
        stop_loss       = stop_loss   if req.trade_mode == "futures" else None,
    )

    log = TradeLog(
        user_id         = user["uid"],
        exchange_key_id = req.exchange_key_id,
        exchange        = key.exchange,
        trade_mode      = req.trade_mode,
        pair            = pair,
        side            = side,
        order_type      = "Market",
        take_profit     = execute_req.take_profit,
        stop_loss       = execute_req.stop_loss,
        leverage        = execute_req.leverage,
        status          = "pending",
        triggered_by    = "ai_run",
        signal_id       = signal.get("signal_id"),
    )
    db.add(log)
    await db.flush()

    try:
        result_data = await _execute_order(key, execute_req)
        log.order_id = result_data["order_id"]
        log.qty      = result_data["qty"]
        log.price    = result_data["price"]
        log.status   = "filled"
        await db.commit()

        try:
            await _notify_auto_trade(
                user["uid"], key.exchange, req.trade_mode, pair, side,
                req.order_size_usdt, execute_req.take_profit, execute_req.stop_loss, "filled",
            )
        except Exception as e:
            logger.warning(f"Telegram notify failed: {e}")

        return {
            "executed":    True,
            "pair":        pair,
            "bias":        bias,
            "side":        side,
            "confidence":  confidence,
            "trade_mode":  req.trade_mode,
            "exchange":    key.exchange,
            "order_id":    result_data["order_id"],
            "qty":         result_data["qty"],
            "price":       result_data["price"],
            "take_profit": float(execute_req.take_profit or 0) or None,
            "stop_loss":   float(execute_req.stop_loss   or 0) or None,
            "leverage":    execute_req.leverage,
            "signal":      signal,
            "timeframe":   req.timeframe,
            "scanned":     scanned if not req.pair else 1,
        }

    except HTTPException as e:
        log.status    = "failed"
        log.error_msg = e.detail
        await db.commit()
        raise

    except Exception as e:
        log.status    = "failed"
        log.error_msg = str(e)
        await db.commit()
        logger.error(f"ai-run execute error {pair} user={user['uid']}: {e}")
        raise HTTPException(500, f"Erro ao executar ordem: {e}")
