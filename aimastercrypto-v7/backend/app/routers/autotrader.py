"""
AutoTrader router — Bybit + MEXC  |  Spot / Futuros separados
=============================================================

Modos suportados:
  SPOT     — ordens a mercado simples, sem leverage, sem TP/SL nativo
  FUTURES  — perpetuals lineares (USDT), com leverage + TP/SL nativos

Exchanges: Bybit V5 · MEXC V3

Segurança:
  - API secrets encriptadas com Fernet (AES-128-CBC + HMAC-SHA256)
  - Chave Fernet derivada da env ENCRYPTION_KEY (obrigatória em produção)
  - Nunca devolve a secret ao cliente

Auto-execute:
  Quando auto_execute=True numa AutoTradeConfig, o signal_service chama
  trigger_auto_trades() depois de gerar um sinal com bias LONG/SHORT.
"""
from __future__ import annotations

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

SUPPORTED_EXCHANGES = ["bybit", "mexc"]
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
# Usa ENCRYPTION_KEY do env (base64url de 32 bytes = Fernet key válida).
# Se não estiver definido, gera uma chave efémera — NÃO usar em produção
# porque as secrets existentes ficam ilegíveis após restart.

def _get_fernet() -> Fernet:
    raw = os.environ.get("ENCRYPTION_KEY", "")
    if not raw:
        # Avisa e usa chave derivada do SECRET_KEY para não quebrar testes locais
        from app.core.config import settings
        import base64
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
    except (InvalidToken, Exception) as e:
        # Compatibilidade retroativa: tenta o antigo XOR
        try:
            return _xor_decrypt_legacy(token)
        except Exception:
            raise HTTPException(status_code=500, detail="Não foi possível decifrar a API secret. Reconecta a exchange.")


def _xor_decrypt_legacy(hex_text: str) -> str:
    """Mantido apenas para migrar keys antigas. Remover após migração."""
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
    pair:            Optional[str] = None  # None = modo automático (AI escolhe o melhor par)
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
    side:            str   # Buy | Sell  (spot)  /  Buy | Sell (futures = Long | Short)
    order_size_usdt: float = Field(..., ge=1)
    leverage:        int   = Field(default=1, ge=1, le=125)
    order_type:      str   = "Market"
    limit_price:     Optional[float] = None
    take_profit:     Optional[float] = None   # só futures
    stop_loss:       Optional[float] = None   # só futures


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

    data = resp.json()
    if data.get("retCode", 0) != 0:
        raise HTTPException(400, f"Bybit: {data.get('retMsg', 'Unknown error')}")
    return data


async def _bybit_get_balance(
    api_key: str, api_secret: str, testnet: bool,
    trade_mode: str = "spot",
) -> list:
    """
    Bybit V5:
    - Spot / UNIFIED account: accountType=UNIFIED (mostra todos os assets do unified wallet)
    - Futuros: accountType=CONTRACT (mostra USDT, USDC e coins da contract wallet)
    Quando a conta usa Unified Trading Account (UTA), spot e futuros estão no mesmo
    UNIFIED wallet, mas o CONTRACT account mostra a margem disponível para futuros.
    Tentamos CONTRACT para futuros, UNIFIED para spot.
    """
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
        # Fallback para UNIFIED se CONTRACT falhar (conta clássica)
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
    """
    Spot Bybit V5 — sem leverage, sem TP/SL (não suportado em spot).
    Usa accountType=UNIFIED, category=spot.
    """
    symbol = pair.replace("/", "")

    # Preço atual
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
        "side":        side,          # Buy | Sell
        "orderType":   order_type,    # Market | Limit
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
    """
    Futuros Bybit V5 — linear USDT-margined perpetuals.
    category=linear, suporta leverage + TP/SL nativos.
    """
    symbol = pair.replace("/", "")
    if not symbol.endswith("USDT"):
        symbol = symbol + "USDT" if not symbol.endswith("PERP") else symbol

    # Definir leverage antes da ordem
    await _bybit_request(
        "POST", "/v5/position/set-leverage",
        api_key=api_key, api_secret=api_secret, testnet=testnet,
        body={"category": "linear", "symbol": symbol,
              "buyLeverage": str(leverage), "sellLeverage": str(leverage)},
    )

    # Preço atual
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
        "side":        side,       # Buy (Long) | Sell (Short)
        "orderType":   order_type,
        "qty":         str(qty),
        "timeInForce": "IOC" if order_type == "Market" else "GTC",
        "positionIdx": 0,          # one-way mode
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
# MEXC V3
# ══════════════════════════════════════════════════════════════════════════════

MEXC_BASE = "https://api.mexc.com"


def _mexc_sign(api_secret: str, params: dict) -> str:
    query = urllib.parse.urlencode(sorted(params.items()))
    return hmaclib.new(api_secret.encode(), query.encode(), hashlib.sha256).hexdigest()


async def _mexc_request(
    method: str, endpoint: str,
    api_key: str, api_secret: str,
    params: dict | None = None,
    body: dict | None = None,
) -> dict:
    """MEXC V3 Spot REST — assina params + body fields juntos."""
    url = f"{MEXC_BASE}{endpoint}"
    ts  = str(int(time.time() * 1000))
    p   = dict(params or {})
    # MEXC V3: para POST, os campos do body entram no query-string para efeitos de assinatura
    if body:
        p.update(body)
    p["timestamp"]  = ts
    p["signature"]  = _mexc_sign(api_secret, p)
    headers = {"X-MEXC-APIKEY": api_key, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=10) as client:
        if method.upper() == "GET":
            resp = await client.get(url, params=p, headers=headers)
        else:
            # Enviar como query params (com assinatura) e body vazio — MEXC V3 aceita ambos
            resp = await client.post(url, params=p, headers=headers)

    # Raise on HTTP errors first so we always get a meaningful exception
    try:
        data = resp.json()
    except Exception:
        resp.raise_for_status()
        raise HTTPException(500, "MEXC: resposta inválida")
    if resp.status_code >= 400 or (isinstance(data, dict) and data.get("code") not in (None, 0, 200)):
        err_msg = data.get("msg") or data.get("message") or str(data)
        logger.error(f"MEXC API error {resp.status_code}: {err_msg} | body={data}")
        raise HTTPException(400, f"MEXC: {err_msg}")
    return data


MEXC_FUTURES_BASE = "https://contract.mexc.com"


def _mexc_futures_sign(api_key: str, api_secret: str, ts: str, body_str: str) -> str:
    """MEXC Futures: HMAC-SHA256(apiKey + timestamp + body_json)"""
    msg = api_key + ts + body_str
    return hmaclib.new(api_secret.encode(), msg.encode(), hashlib.sha256).hexdigest()


async def _mexc_futures_request(
    method: str, endpoint: str,
    api_key: str, api_secret: str,
    params: dict | None = None,
    body: dict | None = None,
) -> dict:
    """MEXC Futures REST (contract.mexc.com) com autenticação correcta."""
    url = f"{MEXC_FUTURES_BASE}{endpoint}"
    ts  = str(int(time.time() * 1000))
    body_str = json.dumps(body, separators=(",", ":")) if body else ""
    sig = _mexc_futures_sign(api_key, api_secret, ts, body_str)
    headers = {
        "ApiKey":       api_key,
        "Request-Time": ts,
        "Signature":    sig,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        if method.upper() == "GET":
            resp = await client.get(url, params=params or {}, headers=headers)
        else:
            resp = await client.post(url, params=params or {}, content=body_str, headers=headers)

    data = resp.json()
    if isinstance(data, dict) and data.get("code") not in (None, 0, 200):
        raise HTTPException(400, f"MEXC Futuros: {data.get('message', data.get('msg', 'Unknown error'))}")
    return data


async def _mexc_get_balance(
    api_key: str, api_secret: str,
    trade_mode: str = "spot",
) -> list:
    """
    MEXC:
    - Spot: /api/v3/account  (REST v3)
    - Futuros: /api/v1/private/account/assets  (Futures API)
    """
    if trade_mode == "futures":
        # MEXC Futures API — usa _mexc_futures_request (contract.mexc.com)
        try:
            data = await _mexc_futures_request(
                "GET", "/api/v1/private/account/assets",
                api_key=api_key, api_secret=api_secret,
            )
            coins = []
            for a in data.get("data", []):
                bal = float(a.get("equity", 0) or a.get("walletBalance", 0) or 0)
                if bal > 0:
                    coins.append({
                        "coin":      a.get("currency", "USDT"),
                        "balance":   str(bal),
                        "available": str(a.get("availableBalance", bal)),
                        "usd_value": str(bal) if a.get("currency","").upper() == "USDT" else "0",
                    })
            return coins
        except Exception:
            pass  # Fallback para spot se futures falhar

    # Spot
    data = await _mexc_request("GET", "/api/v3/account", api_key=api_key, api_secret=api_secret)
    coins = []
    for b in data.get("balances", []):
        total = float(b.get("free", 0)) + float(b.get("locked", 0))
        if total > 0:
            coins.append({
                "coin":      b["asset"],
                "balance":   str(total),
                "available": b.get("free", "0"),
                "usd_value": "0",
            })
    return coins




def _format_mexc_quantity(quantity: float, step_size: str = "0.00001") -> str:
    """
    Formata a quantidade como string conforme o stepSize do par MEXC.
    Usa FLOOR (nunca arredonda para cima) para evitar rejeição por quantidade inválida.
    Retorna string sem trailing zeros e sem ponto decimal desnecessário.
    """
    import math
    try:
        step = float(step_size)
        if step <= 0:
            return str(round(quantity, 6))
        # Floor para o múltiplo de step mais próximo por baixo
        floored = math.floor(quantity / step) * step
        # Número de casas decimais do stepSize
        if "." in step_size:
            decimal_places = len(step_size.rstrip("0").split(".")[1])
        else:
            decimal_places = 0
        if decimal_places == 0:
            # Quantidade inteira — enviar sem ponto decimal
            return str(int(round(floored)))
        else:
            return f"{floored:.{decimal_places}f}"
    except Exception:
        return str(round(quantity, 6))


async def _mexc_get_step_size(pair: str, api_key: str) -> str:
    """Obtém o stepSize do par da MEXC (cache simples em memória)."""
    symbol = pair.replace("/", "")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{MEXC_BASE}/api/v3/exchangeInfo",
                params={"symbol": symbol},
                headers={"X-MEXC-APIKEY": api_key},
            )
        data = r.json()
        for sym in data.get("symbols", []):
            for f in sym.get("filters", []):
                if f.get("filterType") == "LOT_SIZE":
                    return f.get("stepSize", "0.00001")
    except Exception:
        pass
    return "0.00001"  # fallback conservador

async def _mexc_execute_spot(
    api_key: str, api_secret: str,
    pair: str, side: str, order_type: str,
    order_size_usdt: float, limit_price: Optional[float],
) -> dict:
    symbol = pair.replace("/", "")

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{MEXC_BASE}/api/v3/ticker/price", params={"symbol": symbol})
    price_data = r.json()
    if "price" not in price_data:
        raise HTTPException(400, f"Par {pair} não encontrado na MEXC")
    price    = float(price_data["price"])
    step     = await _mexc_get_step_size(pair, api_key)
    qty      = _format_mexc_quantity(order_size_usdt / price, step)

    body: dict = {
        "symbol":   symbol,
        "side":     side.upper(),       # BUY | SELL
        "type":     order_type.upper(), # MARKET | LIMIT
        "quantity": qty,                # already a formatted string
    }
    if order_type.upper() == "LIMIT" and limit_price:
        body["price"]       = str(limit_price)
        body["timeInForce"] = "GTC"

    resp     = await _mexc_request("POST", "/api/v3/order", api_key=api_key,
                                    api_secret=api_secret, body=body)
    order_id = str(resp.get("orderId", ""))
    return {"order_id": order_id, "price": price, "qty": qty}


async def _mexc_execute_futures(
    api_key: str, api_secret: str,
    pair: str, side: str, order_type: str,
    order_size_usdt: float, leverage: int,
    take_profit: Optional[float], stop_loss: Optional[float],
    limit_price: Optional[float],
) -> dict:
    """
    MEXC Futures (contrato USDT-M).
    side: OpenLong | OpenShort | CloseLong | CloseShort
    """
    # MEXC Futures usa BTC_USDT (underscore simples)
    # pair pode ser 'BTC/USDT', 'ETH-USDT', 'BTCUSDT' ou 'BTC_USDT'
    _clean = pair.upper().replace("/", "").replace("-", "").replace("_", "")
    if _clean.endswith("USDT"):
        _clean = _clean[:-4]
    symbol = f"{_clean}_USDT"
    logger.info(f"MEXC FUTURES ORDER => symbol={symbol} pair_original={pair}")

    # Definir leverage
    await _mexc_futures_request(
        "POST", "/api/v1/private/position/change_leverage",
        api_key=api_key, api_secret=api_secret,
        body={"symbol": symbol, "leverage": leverage, "openType": 1},
    )

    # Preço atual
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{MEXC_FUTURES_BASE}/api/v1/contract/ticker",
                             params={"symbol": symbol})
    ticker_data = r.json()
    price = float(ticker_data.get("data", {}).get("lastPrice", 0))
    if not price:
        raise HTTPException(400, f"Par {pair} não encontrado na MEXC Futuros")

    qty = max(1, int((order_size_usdt * leverage) / price))

    # OpenLong = Buy, OpenShort = Sell
    open_type = 1 if side.lower() in ("buy", "long", "openlong") else 2

    use_market = not limit_price  # se não há preço limite, usar Market
    body: dict = {
        "symbol":   symbol,
        "vol":      str(qty),
        "side":     open_type,   # 1=OpenLong 2=OpenShort 3=CloseLong 4=CloseShort
        "type":     5 if use_market else 1,  # 5=Market 1=Limit
        "openType": 1,           # 1=isolated 2=cross
        "leverage": leverage,
    }
    if not use_market:
        body["price"] = str(limit_price)
    if take_profit:
        body["takeProfitPrice"] = str(take_profit)
    if stop_loss:
        body["stopLossPrice"]   = str(stop_loss)

    resp     = await _mexc_futures_request("POST", "/api/v1/private/order/submit",
                                            api_key=api_key, api_secret=api_secret, body=body)
    order_id = str(resp.get("data", ""))
    return {"order_id": order_id, "price": price, "qty": qty}


# ══════════════════════════════════════════════════════════════════════════════
# DISPATCHER UNIFICADO
# ══════════════════════════════════════════════════════════════════════════════

async def _validate_connection(exchange: str, api_key: str, api_secret: str, testnet: bool) -> None:
    try:
        if exchange == "bybit":
            await _bybit_get_balance(api_key, api_secret, testnet)
        elif exchange == "mexc":
            await _mexc_get_balance(api_key, api_secret)
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
    elif key.exchange == "mexc":
        return await _mexc_get_balance(key.api_key, secret, trade_mode)
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
        else:  # futures
            return await _bybit_execute_futures(
                key.api_key, secret, key.testnet,
                req.pair, req.side, req.order_type,
                req.order_size_usdt, req.leverage,
                req.take_profit, req.stop_loss, req.limit_price,
            )

    elif key.exchange == "mexc":
        if mode == "spot":
            return await _mexc_execute_spot(
                key.api_key, secret,
                req.pair, req.side, req.order_type,
                req.order_size_usdt, req.limit_price,
            )
        else:  # futures
            return await _mexc_execute_futures(
                key.api_key, secret,
                req.pair, req.side, req.order_type,
                req.order_size_usdt, req.leverage,
                req.take_profit, req.stop_loss, req.limit_price,
            )

    raise HTTPException(400, "Exchange não suportada")


# ══════════════════════════════════════════════════════════════════════════════
# AUTO-EXECUTE  (chamado pelo signal_service após gerar sinal)
# ══════════════════════════════════════════════════════════════════════════════

async def trigger_auto_trades(
    pair: str,
    timeframe: str,
    bias: str,         # "LONG" | "SHORT"
    confidence: int,
    take_profit: float,
    stop_loss: float,
    signal_id: Optional[int] = None,
) -> None:
    """
    Verifica AutoTradeConfigs com auto_execute=True.
    Configs com pair=NULL entram em modo AI automático (aceita qualquer par).
    Executa a ordem se confiança >= min_confidence e open_trades < max_open_trades.
    Chamada assíncrona — erros são logados, nunca propagados.
    """
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
                    # Corresponde se par específico OU modo automático (pair=None)
                    or_(AutoTradeConfig.pair == pair, AutoTradeConfig.pair == None),
                    AutoTradeConfig.timeframe  == timeframe,
                    AutoTradeConfig.auto_execute == True,
                    AutoTradeConfig.is_active  == True,
                    ExchangeKey.is_active      == True,
                )
            )
            rows = result.all()

        for cfg, key in rows:
            # Verificar confiança mínima
            if confidence < cfg.min_confidence:
                logger.info(f"Auto-execute skip {pair}: confidence {confidence} < {cfg.min_confidence}")
                continue

            # Verificar max_open_trades
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
                logger.info(f"Auto-execute skip {pair}: {open_count} >= max {cfg.max_open_trades}")
                continue

            # Calcular TP/SL com multiplicadores do config
            adj_tp = round(take_profit * float(cfg.tp_multiplier), 6) if take_profit else None
            adj_sl = round(stop_loss  * float(cfg.sl_multiplier), 6) if stop_loss  else None
            mode   = cfg.trade_mode or "spot"
            side   = "Buy" if bias == "LONG" else "Sell"

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

            # Registo antes de executar
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
                log_id = log.id

                try:
                    result_data = await _execute_order(key, req)
                    log.order_id = result_data["order_id"]
                    log.qty      = result_data["qty"]
                    log.price    = result_data["price"]
                    log.status   = "filled"
                    logger.info(
                        f"Auto-execute OK: {pair} {side} {mode} "
                        f"qty={result_data['qty']} price={result_data['price']} "
                        f"order={result_data['order_id']} user={cfg.user_id}"
                    )
                except Exception as e:
                    log.status    = "failed"
                    log.error_msg = str(e)
                    logger.error(f"Auto-execute FAILED {pair} user={cfg.user_id}: {e}")

                await db.commit()

            # Notificação Telegram
            try:
                await _notify_auto_trade(cfg.user_id, key.exchange, mode, pair, side,
                                          req.order_size_usdt, adj_tp, adj_sl, log.status)
            except Exception as e:
                logger.warning(f"Telegram notify failed: {e}")

    except Exception as e:
        logger.error(f"trigger_auto_trades error {pair}: {e}")


async def _notify_auto_trade(
    user_id: int, exchange: str, mode: str, pair: str,
    side: str, size: float, tp: Optional[float], sl: Optional[float], status: str,
) -> None:
    """Envia notificação Telegram ao user quando uma ordem automática é executada."""
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
    mode: str = "spot",   # "spot" | "futures"
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Retorna o saldo da wallet correcta:
    - mode=spot    → Spot wallet (UNIFIED no Bybit, /api/v3/account no MEXC)
    - mode=futures → Contract/Futures wallet (CONTRACT no Bybit, futures API no MEXC)
    """
    result = await db.execute(
        select(ExchangeKey).where(ExchangeKey.id == key_id, ExchangeKey.user_id == user["uid"])
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "Key not found")
    return {"coins": await _get_balance(key, trade_mode=mode), "mode": mode}


@router.get("/timeframes")
async def get_timeframes(mode: str = "spot"):
    """Retorna os timeframes válidos para o modo (spot | futures)."""
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
    # Validar timeframe para o modo
    valid_tfs = FUTURES_TIMEFRAMES if req.trade_mode == "futures" else SPOT_TIMEFRAMES
    if req.timeframe not in valid_tfs:
        raise HTTPException(400, f"Timeframe '{req.timeframe}' inválido para modo {req.trade_mode}. "
                                  f"Válidos: {valid_tfs}")

    # Spot não pode ter leverage > 1
    if req.trade_mode == "spot" and req.leverage > 1:
        raise HTTPException(400, "Spot não suporta leverage. Define leverage=1 ou muda para futures.")

    # Verificar que a key pertence ao user
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
    # Validações de modo
    if req.trade_mode == "spot" and req.leverage > 1:
        raise HTTPException(400, "Spot não suporta leverage.")
    if req.trade_mode == "spot" and (req.take_profit or req.stop_loss):
        raise HTTPException(400, "Spot não suporta TP/SL nativos. "
                                  "Usa modo Futures para TP/SL automático.")

    result = await db.execute(
        select(ExchangeKey).where(ExchangeKey.id == req.exchange_key_id,
                                   ExchangeKey.user_id == user["uid"])
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(403, "Key not found")

    # Verificar max_open_trades (se existir config para este par/modo)
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


# ── Pydantic model for /ai-run ─────────────────────────────────────────────

class AIRunRequest(BaseModel):
    exchange_key_id: int
    trade_mode:      Literal["spot", "futures"] = "spot"
    pair:            Optional[str]   = None          # None = AI escolhe o melhor par
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
    """
    Analisa o mercado com IA e executa uma ordem se o sinal for suficientemente forte.

    Fluxo:
    1. Valida a exchange key do utilizador.
    2. Se `pair` for fornecido → analisa apenas esse par.
       Se `pair` for omitido  → faz scan dos top pares e escolhe o melhor sinal.
    3. Se bias=LONG|SHORT e confidence >= min_confidence → executa a ordem.
    4. Devolve o resultado ao frontend (executed, pair, bias, confidence, price, …).
    """
    from app.services.signal_service import run_signal, run_scan
    from app.services.data_fetcher import SCAN_PAIRS

    # Spot não suporta leverage
    if req.trade_mode == "spot" and req.leverage > 1:
        raise HTTPException(400, "Spot não suporta leverage. Define leverage=1 ou usa modo futures.")

    # Validar timeframe
    valid_tfs = FUTURES_TIMEFRAMES if req.trade_mode == "futures" else SPOT_TIMEFRAMES
    if req.timeframe not in valid_tfs:
        raise HTTPException(
            400,
            f"Timeframe '{req.timeframe}' inválido para modo {req.trade_mode}. Válidos: {valid_tfs}",
        )

    # Verificar que a key pertence ao utilizador
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

    # ── 1. Obter sinal de IA ───────────────────────────────────────────────
    # Spot: o utilizador deve sempre indicar o par — scan automático só em futures
    if req.trade_mode == "spot" and not req.pair:
        raise HTTPException(
            400,
            "Modo Spot requer um par específico (ex: BTC/USDT). "
            "O scan automático de pares só está disponível em modo Futures."
        )

    try:
        if req.pair:
            # Sinal para par específico (obrigatório em spot, opcional em futures)
            signal = await run_signal(req.pair, req.timeframe, use_mtf=True, user_id=user["uid"])
            signal.setdefault("pair", req.pair)
            scanned = 1
        else:
            # Scan automático — apenas futures, escolhe o melhor par LONG/SHORT
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

    # ── 2. Verificar se o sinal é suficientemente forte ───────────────────
    if bias not in ("LONG", "SHORT"):
        return {
            "executed":   False,
            "bias":       bias,
            "confidence": confidence,
            "pair":       pair,
            "reason":     f"Sinal WAIT — sem setup adequado (confiança: {confidence}%).",
            "scanned":    scanned if not req.pair else 1,
            "signal":     signal,
            "timeframe":  req.timeframe,
            "trade_mode": req.trade_mode,
        }

    if confidence < req.min_confidence:
        return {
            "executed":   False,
            "bias":       bias,
            "confidence": confidence,
            "pair":       pair,
            "reason":     f"Confiança {confidence}% abaixo do mínimo {req.min_confidence}%.",
            "scanned":    scanned if not req.pair else 1,
            "signal":     signal,
            "timeframe":  req.timeframe,
            "trade_mode": req.trade_mode,
        }

    # Spot não suporta SHORT — informa o utilizador e devolve o sinal sem executar
    if req.trade_mode == "spot" and bias == "SHORT":
        return {
            "executed":   False,
            "bias":       bias,
            "confidence": confidence,
            "pair":       pair,
            "reason":     (
                f"A IA identificou sinal SHORT em {pair} (confiança: {confidence}%) mas Spot não suporta "                "venda a descoberto. Muda para modo Futures para executar SHORTs."
            ),
            "scanned":    1,
            "signal":     signal,
            "timeframe":  req.timeframe,
            "trade_mode": req.trade_mode,
        }

    # ── 3. Executar a ordem ───────────────────────────────────────────────
    side = "Buy" if bias == "LONG" else "Sell"
    execute_req = ExecuteOrderRequest(
        exchange_key_id = req.exchange_key_id,
        trade_mode      = req.trade_mode,
        pair            = pair,
        side            = side,
        order_size_usdt = req.order_size_usdt,
        leverage        = req.leverage if req.trade_mode == "futures" else 1,
        order_type      = "Market",
        # TP/SL apenas em futures
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

        logger.info(
            f"ai-run OK: {pair} {side} {req.trade_mode} "
            f"qty={result_data['qty']} price={result_data['price']} "
            f"user={user['uid']} confidence={confidence}"
        )

        # Notificação Telegram (não bloqueante)
        try:
            await _notify_auto_trade(
                user["uid"], key.exchange, req.trade_mode, pair, side,
                req.order_size_usdt, execute_req.take_profit, execute_req.stop_loss,
                "filled",
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
