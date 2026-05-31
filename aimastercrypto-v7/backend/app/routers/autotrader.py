"""
AutoTrader router — Bybit + MEXC support
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.parse
from typing import Optional

import httpx
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

# ── DB Models ─────────────────────────────────────────────────────────────────

class ExchangeKey(Base):
    __tablename__ = "exchange_keys"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exchange = Column(String(30), default="bybit")
    api_key = Column(String(255), nullable=False)
    api_secret_encrypted = Column(String(512), nullable=False)
    label = Column(String(100), default="Main Account")
    testnet = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AutoTradeConfig(Base):
    __tablename__ = "auto_trade_configs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exchange_key_id = Column(Integer, ForeignKey("exchange_keys.id"), nullable=False)
    pair = Column(String(20), nullable=False)
    timeframe = Column(String(5), default="1H")
    order_size_usdt = Column(Numeric(12, 2), default=10)
    leverage = Column(Integer, default=1)
    risk_profile = Column(String(20), default="balanced")
    tp_multiplier = Column(Numeric(4, 2), default=1.0)
    sl_multiplier = Column(Numeric(4, 2), default=1.0)
    max_open_trades = Column(Integer, default=3)
    auto_execute = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TradeLog(Base):
    __tablename__ = "trade_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exchange_key_id = Column(Integer, ForeignKey("exchange_keys.id"))
    exchange = Column(String(30), default="bybit")
    pair = Column(String(20))
    side = Column(String(10))
    order_type = Column(String(20))
    qty = Column(Numeric(20, 8))
    price = Column(Numeric(20, 8))
    take_profit = Column(Numeric(20, 8))
    stop_loss = Column(Numeric(20, 8))
    leverage = Column(Integer, default=1)
    order_id = Column(String(100))
    status = Column(String(20), default="pending")
    error_msg = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Pydantic ──────────────────────────────────────────────────────────────────

class ConnectKeyRequest(BaseModel):
    exchange: str = "bybit"
    api_key: str = Field(..., min_length=10)
    api_secret: str = Field(..., min_length=10)
    label: str = "Main Account"
    testnet: bool = False


class TradeConfigRequest(BaseModel):
    exchange_key_id: int
    pair: str
    timeframe: str = "1H"
    order_size_usdt: float = Field(default=10, ge=1, le=100000)
    leverage: int = Field(default=1, ge=1, le=100)
    risk_profile: str = "balanced"
    tp_multiplier: float = Field(default=1.0, ge=0.5, le=5.0)
    sl_multiplier: float = Field(default=1.0, ge=0.5, le=5.0)
    max_open_trades: int = Field(default=3, ge=1, le=20)
    auto_execute: bool = False


class ExecuteOrderRequest(BaseModel):
    exchange_key_id: int
    pair: str
    side: str
    order_size_usdt: float = Field(..., ge=1)
    take_profit: Optional[float] = None
    stop_loss: Optional[float] = None
    leverage: int = Field(default=1, ge=1, le=100)
    order_type: str = "Market"
    limit_price: Optional[float] = None


# ── Encryption (simple XOR — replace with Fernet in production) ───────────────

_ENCRYPT_KEY = "aitradexx-secret-v1"

def _xor_encrypt(text: str) -> str:
    key = _ENCRYPT_KEY
    return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(text)).encode("utf-8").hex()

def _xor_decrypt(hex_text: str) -> str:
    key = _ENCRYPT_KEY
    text = bytes.fromhex(hex_text).decode("utf-8")
    return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(text))


# ══════════════════════════════════════════════════════════════════════════════
# BYBIT V5
# ══════════════════════════════════════════════════════════════════════════════

BYBIT_MAINNET = "https://api.bybit.com"
BYBIT_TESTNET = "https://api-testnet.bybit.com"


def _bybit_sign(api_secret: str, timestamp: str, api_key: str, recv_window: str, payload: str) -> str:
    param_str = f"{timestamp}{api_key}{recv_window}{payload}"
    return hmac.new(api_secret.encode("utf-8"), param_str.encode("utf-8"), hashlib.sha256).hexdigest()


async def _bybit_request(
    method: str, endpoint: str,
    api_key: str, api_secret: str,
    testnet: bool = False,
    params: dict | None = None,
    body: dict | None = None,
) -> dict:
    base = BYBIT_TESTNET if testnet else BYBIT_MAINNET
    url = f"{base}{endpoint}"
    ts = str(int(time.time() * 1000))
    recv_window = "5000"

    if method.upper() == "GET":
        payload = "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
    else:
        payload = json.dumps(body or {})

    signature = _bybit_sign(api_secret, ts, api_key, recv_window, payload)
    headers = {
        "X-BAPI-API-KEY": api_key,
        "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-SIGN": signature,
        "X-BAPI-RECV-WINDOW": recv_window,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, params=params, headers=headers) if method.upper() == "GET" \
            else await client.post(url, json=body, headers=headers)

    data = resp.json()
    if data.get("retCode", 0) != 0:
        raise HTTPException(status_code=400, detail=f"Bybit: {data.get('retMsg', 'Unknown error')}")
    return data


async def _bybit_get_balance(api_key: str, api_secret: str, testnet: bool) -> list:
    data = await _bybit_request(
        "GET", "/v5/account/wallet-balance",
        api_key=api_key, api_secret=api_secret, testnet=testnet,
        params={"accountType": "UNIFIED"},
    )
    coins = []
    for w in data.get("result", {}).get("list", []):
        for c in w.get("coin", []):
            if float(c.get("walletBalance", 0)) > 0:
                coins.append({
                    "coin": c["coin"],
                    "balance": c["walletBalance"],
                    "available": c.get("availableToWithdraw", "0"),
                    "usd_value": c.get("usdValue", "0"),
                })
    return coins


async def _bybit_execute(
    api_key: str, api_secret: str, testnet: bool,
    pair: str, side: str, order_type: str,
    order_size_usdt: float, leverage: int,
    take_profit: Optional[float], stop_loss: Optional[float],
    limit_price: Optional[float],
) -> dict:
    # Get price
    ticker = await _bybit_request(
        "GET", "/v5/market/tickers", api_key=api_key, api_secret=api_secret,
        testnet=testnet, params={"category": "spot", "symbol": pair.replace("/", "")},
    )
    tickers = ticker.get("result", {}).get("list", [])
    if not tickers:
        raise HTTPException(status_code=400, detail=f"Par {pair} não encontrado na Bybit")
    price = float(tickers[0]["lastPrice"])
    qty = round(order_size_usdt / price, 6)

    body: dict = {
        "category": "spot",
        "symbol": pair.replace("/", ""),
        "side": side,
        "orderType": order_type,
        "qty": str(qty),
        "timeInForce": "IOC" if order_type == "Market" else "GTC",
    }
    if order_type == "Limit" and limit_price:
        body["price"] = str(limit_price)
    if take_profit:
        body["takeProfit"] = str(take_profit)
    if stop_loss:
        body["stopLoss"] = str(stop_loss)

    resp = await _bybit_request("POST", "/v5/order/create", api_key=api_key, api_secret=api_secret, testnet=testnet, body=body)
    order_id = resp.get("result", {}).get("orderId", "")
    return {"order_id": order_id, "price": price, "qty": qty}


# ══════════════════════════════════════════════════════════════════════════════
# MEXC V3
# ══════════════════════════════════════════════════════════════════════════════

MEXC_BASE = "https://api.mexc.com"


def _mexc_sign(api_secret: str, params: dict) -> str:
    query = urllib.parse.urlencode(sorted(params.items()))
    return hmac.new(api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()


async def _mexc_request(
    method: str, endpoint: str,
    api_key: str, api_secret: str,
    params: dict | None = None,
    body: dict | None = None,
) -> dict:
    url = f"{MEXC_BASE}{endpoint}"
    ts = str(int(time.time() * 1000))
    p = dict(params or {})
    p["timestamp"] = ts

    signature = _mexc_sign(api_secret, p)
    p["signature"] = signature

    headers = {
        "X-MEXC-APIKEY": api_key,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        if method.upper() == "GET":
            resp = await client.get(url, params=p, headers=headers)
        else:
            # For POST, signature goes in query string, body is separate
            resp = await client.post(url, params=p, json=body or {}, headers=headers)

    data = resp.json()
    # MEXC returns code 0 for success or no code field
    if isinstance(data, dict) and data.get("code") not in (None, 0, 200):
        raise HTTPException(status_code=400, detail=f"MEXC: {data.get('msg', data.get('message', 'Unknown error'))}")
    return data


async def _mexc_get_balance(api_key: str, api_secret: str) -> list:
    data = await _mexc_request("GET", "/api/v3/account", api_key=api_key, api_secret=api_secret)
    coins = []
    for b in data.get("balances", []):
        total = float(b.get("free", 0)) + float(b.get("locked", 0))
        if total > 0:
            coins.append({
                "coin": b["asset"],
                "balance": str(total),
                "available": b.get("free", "0"),
                "usd_value": "0",  # MEXC doesn't return USD value directly
            })
    return coins


async def _mexc_execute(
    api_key: str, api_secret: str,
    pair: str, side: str, order_type: str,
    order_size_usdt: float,
    take_profit: Optional[float], stop_loss: Optional[float],
    limit_price: Optional[float],
) -> dict:
    symbol = pair.replace("/", "")

    # Get price first
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{MEXC_BASE}/api/v3/ticker/price", params={"symbol": symbol})
    price_data = r.json()
    if "price" not in price_data:
        raise HTTPException(status_code=400, detail=f"Par {pair} não encontrado na MEXC")
    price = float(price_data["price"])
    qty = round(order_size_usdt / price, 6)

    body: dict = {
        "symbol": symbol,
        "side": side.upper(),  # BUY | SELL
        "type": order_type.upper(),  # MARKET | LIMIT
        "quantity": str(qty),
    }
    if order_type.upper() == "LIMIT" and limit_price:
        body["price"] = str(limit_price)
        body["timeInForce"] = "GTC"

    resp = await _mexc_request("POST", "/api/v3/order", api_key=api_key, api_secret=api_secret, body=body)
    order_id = str(resp.get("orderId", ""))
    return {"order_id": order_id, "price": price, "qty": qty}


# ══════════════════════════════════════════════════════════════════════════════
# UNIFIED DISPATCHER
# ══════════════════════════════════════════════════════════════════════════════

async def _validate_connection(exchange: str, api_key: str, api_secret: str, testnet: bool) -> None:
    """Test the API key by fetching balance."""
    try:
        if exchange == "bybit":
            await _bybit_get_balance(api_key, api_secret, testnet)
        elif exchange == "mexc":
            await _mexc_get_balance(api_key, api_secret)
        else:
            raise HTTPException(status_code=400, detail=f"Exchange '{exchange}' não suportada")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Não foi possível conectar: {str(e)}")


async def _get_balance(key: ExchangeKey) -> list:
    secret = _xor_decrypt(key.api_secret_encrypted)
    if key.exchange == "bybit":
        return await _bybit_get_balance(key.api_key, secret, key.testnet)
    elif key.exchange == "mexc":
        return await _mexc_get_balance(key.api_key, secret)
    return []


async def _execute_order(key: ExchangeKey, req: ExecuteOrderRequest) -> dict:
    secret = _xor_decrypt(key.api_secret_encrypted)
    if key.exchange == "bybit":
        return await _bybit_execute(
            key.api_key, secret, key.testnet,
            req.pair, req.side, req.order_type,
            req.order_size_usdt, req.leverage,
            req.take_profit, req.stop_loss, req.limit_price,
        )
    elif key.exchange == "mexc":
        return await _mexc_execute(
            key.api_key, secret,
            req.pair, req.side, req.order_type,
            req.order_size_usdt,
            req.take_profit, req.stop_loss, req.limit_price,
        )
    raise HTTPException(status_code=400, detail="Exchange não suportada")


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
        raise HTTPException(status_code=400, detail=f"Exchange não suportada. Use: {SUPPORTED_EXCHANGES}")

    await _validate_connection(req.exchange, req.api_key, req.api_secret, req.testnet)

    key_obj = ExchangeKey(
        user_id=user.id,
        exchange=req.exchange,
        api_key=req.api_key,
        api_secret_encrypted=_xor_encrypt(req.api_secret),
        label=req.label,
        testnet=req.testnet,
    )
    db.add(key_obj)
    await db.commit()
    await db.refresh(key_obj)
    return {"id": key_obj.id, "label": key_obj.label, "exchange": req.exchange, "testnet": req.testnet, "connected": True}


@router.get("/keys")
async def list_keys(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExchangeKey).where(ExchangeKey.user_id == user.id, ExchangeKey.is_active == True)
    )
    keys = result.scalars().all()
    return [{"id": k.id, "exchange": k.exchange, "label": k.label, "testnet": k.testnet, "api_key_preview": k.api_key[:8] + "****"} for k in keys]


@router.delete("/keys/{key_id}")
async def delete_key(key_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExchangeKey).where(ExchangeKey.id == key_id, ExchangeKey.user_id == user.id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="Key not found")
    key.is_active = False
    await db.commit()
    return {"deleted": True}


@router.get("/balance/{key_id}")
async def get_balance(key_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExchangeKey).where(ExchangeKey.id == key_id, ExchangeKey.user_id == user.id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="Key not found")
    coins = await _get_balance(key)
    return {"coins": coins}


@router.post("/config")
async def save_config(
    req: TradeConfigRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ExchangeKey).where(ExchangeKey.id == req.exchange_key_id, ExchangeKey.user_id == user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Key not found")

    existing = await db.execute(
        select(AutoTradeConfig).where(
            AutoTradeConfig.user_id == user.id,
            AutoTradeConfig.pair == req.pair,
            AutoTradeConfig.exchange_key_id == req.exchange_key_id,
        )
    )
    cfg = existing.scalar_one_or_none()
    if cfg:
        for field in ["timeframe", "order_size_usdt", "leverage", "risk_profile", "tp_multiplier", "sl_multiplier", "max_open_trades", "auto_execute"]:
            setattr(cfg, field, getattr(req, field))
    else:
        cfg = AutoTradeConfig(user_id=user.id, **req.model_dump())
        db.add(cfg)

    await db.commit()
    await db.refresh(cfg)
    return {"id": cfg.id, "pair": cfg.pair, "saved": True}


@router.get("/config")
async def list_configs(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AutoTradeConfig).where(AutoTradeConfig.user_id == user.id, AutoTradeConfig.is_active == True)
    )
    return [
        {
            "id": c.id, "pair": c.pair, "timeframe": c.timeframe,
            "order_size_usdt": float(c.order_size_usdt), "leverage": c.leverage,
            "risk_profile": c.risk_profile, "tp_multiplier": float(c.tp_multiplier),
            "sl_multiplier": float(c.sl_multiplier), "max_open_trades": c.max_open_trades,
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
    result = await db.execute(select(ExchangeKey).where(ExchangeKey.id == req.exchange_key_id, ExchangeKey.user_id == user.id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=403, detail="Key not found")

    log = TradeLog(
        user_id=user.id, exchange_key_id=req.exchange_key_id,
        exchange=key.exchange, pair=req.pair, side=req.side,
        order_type=req.order_type, take_profit=req.take_profit,
        stop_loss=req.stop_loss, leverage=req.leverage, status="pending",
    )
    db.add(log)
    await db.flush()

    try:
        result_data = await _execute_order(key, req)
        log.order_id = result_data["order_id"]
        log.qty = result_data["qty"]
        log.price = result_data["price"]
        log.status = "filled"
        await db.commit()
        return {
            "success": True,
            "order_id": result_data["order_id"],
            "qty": result_data["qty"],
            "price": result_data["price"],
            "side": req.side,
            "exchange": key.exchange,
        }
    except HTTPException as e:
        log.status = "failed"
        log.error_msg = e.detail
        await db.commit()
        raise


@router.get("/trades")
async def list_trades(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TradeLog).where(TradeLog.user_id == user.id).order_by(TradeLog.created_at.desc()).limit(50)
    )
    return [
        {
            "id": t.id, "pair": t.pair, "side": t.side, "exchange": t.exchange,
            "order_type": t.order_type, "qty": float(t.qty or 0),
            "price": float(t.price or 0), "take_profit": float(t.take_profit or 0),
            "stop_loss": float(t.stop_loss or 0), "leverage": t.leverage,
            "order_id": t.order_id, "status": t.status, "error_msg": t.error_msg,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in result.scalars().all()
    ]
