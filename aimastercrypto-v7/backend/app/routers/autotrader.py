"""
AutoTrader router — allows users to connect their Bybit account via API key
and execute orders directly from the platform.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
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

# ── Models ───────────────────────────────────────────────────────────────────

class ExchangeKey(Base):
    __tablename__ = "exchange_keys"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exchange = Column(String(30), default="bybit")  # bybit only for now
    api_key = Column(String(255), nullable=False)
    api_secret_encrypted = Column(String(512), nullable=False)  # stored encrypted
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
    risk_profile = Column(String(20), default="balanced")  # conservative | balanced | aggressive
    tp_multiplier = Column(Numeric(4, 2), default=1.0)   # multiply signal TP by this
    sl_multiplier = Column(Numeric(4, 2), default=1.0)
    max_open_trades = Column(Integer, default=3)
    auto_execute = Column(Boolean, default=False)  # false = confirm first
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TradeLog(Base):
    __tablename__ = "trade_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exchange_key_id = Column(Integer, ForeignKey("exchange_keys.id"))
    exchange = Column(String(30), default="bybit")
    pair = Column(String(20))
    side = Column(String(10))  # Buy | Sell
    order_type = Column(String(20))  # Market | Limit
    qty = Column(Numeric(20, 8))
    price = Column(Numeric(20, 8))
    take_profit = Column(Numeric(20, 8))
    stop_loss = Column(Numeric(20, 8))
    leverage = Column(Integer, default=1)
    order_id = Column(String(100))
    status = Column(String(20), default="pending")  # pending | filled | failed | cancelled
    error_msg = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class ConnectKeyRequest(BaseModel):
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
    risk_profile: str = "balanced"   # conservative | balanced | aggressive
    tp_multiplier: float = Field(default=1.0, ge=0.5, le=5.0)
    sl_multiplier: float = Field(default=1.0, ge=0.5, le=5.0)
    max_open_trades: int = Field(default=3, ge=1, le=20)
    auto_execute: bool = False


class ExecuteOrderRequest(BaseModel):
    exchange_key_id: int
    pair: str
    side: str  # Buy | Sell
    order_size_usdt: float = Field(..., ge=1)
    take_profit: Optional[float] = None
    stop_loss: Optional[float] = None
    leverage: int = Field(default=1, ge=1, le=100)
    order_type: str = "Market"  # Market | Limit
    limit_price: Optional[float] = None


# ── Simple XOR encryption for API secret (replace with proper encryption in prod) ──

_ENCRYPT_KEY = "aitradexx-secret-v1"

def _xor_encrypt(text: str) -> str:
    key = _ENCRYPT_KEY
    return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(text)).encode("utf-8").hex()

def _xor_decrypt(hex_text: str) -> str:
    key = _ENCRYPT_KEY
    text = bytes.fromhex(hex_text).decode("utf-8")
    return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(text))


# ── Bybit V5 API helpers ─────────────────────────────────────────────────────

BYBIT_MAINNET = "https://api.bybit.com"
BYBIT_TESTNET = "https://api-testnet.bybit.com"

def _bybit_sign(api_secret: str, timestamp: str, api_key: str, recv_window: str, payload: str) -> str:
    param_str = f"{timestamp}{api_key}{recv_window}{payload}"
    return hmac.new(api_secret.encode("utf-8"), param_str.encode("utf-8"), hashlib.sha256).hexdigest()


async def _bybit_request(
    method: str,
    endpoint: str,
    api_key: str,
    api_secret: str,
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
        if method.upper() == "GET":
            resp = await client.get(url, params=params, headers=headers)
        else:
            resp = await client.post(url, json=body, headers=headers)

    data = resp.json()
    if data.get("retCode", 0) != 0:
        raise HTTPException(status_code=400, detail=f"Bybit error: {data.get('retMsg', 'Unknown error')}")
    return data


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/connect")
async def connect_exchange_key(
    req: ConnectKeyRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save Bybit API key for the user. Validates the key first."""
    # Test the key by fetching account info
    try:
        data = await _bybit_request(
            "GET", "/v5/account/wallet-balance",
            api_key=req.api_key, api_secret=req.api_secret,
            testnet=req.testnet,
            params={"accountType": "UNIFIED"},
        )
    except HTTPException as e:
        raise HTTPException(status_code=400, detail=f"Chave inválida: {e.detail}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Não foi possível conectar à Bybit: {str(e)}")

    encrypted_secret = _xor_encrypt(req.api_secret)

    key_obj = ExchangeKey(
        user_id=user.id,
        api_key=req.api_key,
        api_secret_encrypted=encrypted_secret,
        label=req.label,
        testnet=req.testnet,
    )
    db.add(key_obj)
    await db.commit()
    await db.refresh(key_obj)

    return {"id": key_obj.id, "label": key_obj.label, "exchange": "bybit", "testnet": req.testnet, "connected": True}


@router.get("/keys")
async def list_keys(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """List user's connected exchange keys."""
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
    """Fetch live balance from Bybit for the given key."""
    result = await db.execute(select(ExchangeKey).where(ExchangeKey.id == key_id, ExchangeKey.user_id == user.id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="Key not found")

    secret = _xor_decrypt(key.api_secret_encrypted)
    data = await _bybit_request(
        "GET", "/v5/account/wallet-balance",
        api_key=key.api_key, api_secret=secret,
        testnet=key.testnet,
        params={"accountType": "UNIFIED"},
    )
    wallets = data.get("result", {}).get("list", [])
    coins = []
    for w in wallets:
        for c in w.get("coin", []):
            if float(c.get("walletBalance", 0)) > 0:
                coins.append({
                    "coin": c["coin"],
                    "balance": c["walletBalance"],
                    "available": c["availableToWithdraw"],
                    "usd_value": c.get("usdValue", "0"),
                })
    return {"coins": coins}


@router.post("/config")
async def save_config(
    req: TradeConfigRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save/update an autotrading config for a pair."""
    # Check key belongs to user
    result = await db.execute(select(ExchangeKey).where(ExchangeKey.id == req.exchange_key_id, ExchangeKey.user_id == user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Key not found")

    # Upsert config
    existing = await db.execute(
        select(AutoTradeConfig).where(
            AutoTradeConfig.user_id == user.id,
            AutoTradeConfig.pair == req.pair,
            AutoTradeConfig.exchange_key_id == req.exchange_key_id,
        )
    )
    cfg = existing.scalar_one_or_none()
    if cfg:
        cfg.timeframe = req.timeframe
        cfg.order_size_usdt = req.order_size_usdt
        cfg.leverage = req.leverage
        cfg.risk_profile = req.risk_profile
        cfg.tp_multiplier = req.tp_multiplier
        cfg.sl_multiplier = req.sl_multiplier
        cfg.max_open_trades = req.max_open_trades
        cfg.auto_execute = req.auto_execute
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
    cfgs = result.scalars().all()
    return [
        {
            "id": c.id, "pair": c.pair, "timeframe": c.timeframe,
            "order_size_usdt": float(c.order_size_usdt), "leverage": c.leverage,
            "risk_profile": c.risk_profile, "tp_multiplier": float(c.tp_multiplier),
            "sl_multiplier": float(c.sl_multiplier), "max_open_trades": c.max_open_trades,
            "auto_execute": c.auto_execute, "exchange_key_id": c.exchange_key_id,
        }
        for c in cfgs
    ]


@router.post("/execute")
async def execute_order(
    req: ExecuteOrderRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a market or limit order on Bybit."""
    result = await db.execute(select(ExchangeKey).where(ExchangeKey.id == req.exchange_key_id, ExchangeKey.user_id == user.id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=403, detail="Key not found")

    secret = _xor_decrypt(key.api_secret_encrypted)

    # Get current price to calculate qty
    ticker_data = await _bybit_request(
        "GET", "/v5/market/tickers",
        api_key=key.api_key, api_secret=secret,
        testnet=key.testnet,
        params={"category": "spot", "symbol": req.pair.replace("/", "")},
    )
    tickers = ticker_data.get("result", {}).get("list", [])
    if not tickers:
        raise HTTPException(status_code=400, detail=f"Par {req.pair} não encontrado na Bybit")

    last_price = float(tickers[0]["lastPrice"])
    qty = round(req.order_size_usdt / last_price, 6)

    order_body: dict = {
        "category": "spot",
        "symbol": req.pair.replace("/", ""),
        "side": req.side,  # Buy | Sell
        "orderType": req.order_type,
        "qty": str(qty),
        "timeInForce": "IOC" if req.order_type == "Market" else "GTC",
    }

    if req.order_type == "Limit" and req.limit_price:
        order_body["price"] = str(req.limit_price)
    if req.take_profit:
        order_body["takeProfit"] = str(req.take_profit)
    if req.stop_loss:
        order_body["stopLoss"] = str(req.stop_loss)

    log = TradeLog(
        user_id=user.id,
        exchange_key_id=req.exchange_key_id,
        pair=req.pair,
        side=req.side,
        order_type=req.order_type,
        qty=qty,
        price=last_price,
        take_profit=req.take_profit,
        stop_loss=req.stop_loss,
        leverage=req.leverage,
        status="pending",
    )
    db.add(log)
    await db.flush()

    try:
        order_resp = await _bybit_request(
            "POST", "/v5/order/create",
            api_key=key.api_key, api_secret=secret,
            testnet=key.testnet,
            body=order_body,
        )
        order_id = order_resp.get("result", {}).get("orderId", "")
        log.order_id = order_id
        log.status = "filled"
        await db.commit()
        return {"success": True, "order_id": order_id, "qty": qty, "price": last_price, "side": req.side}
    except HTTPException as e:
        log.status = "failed"
        log.error_msg = e.detail
        await db.commit()
        raise


@router.get("/trades")
async def list_trades(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Get user's trade history from our DB."""
    result = await db.execute(
        select(TradeLog).where(TradeLog.user_id == user.id).order_by(TradeLog.created_at.desc()).limit(50)
    )
    trades = result.scalars().all()
    return [
        {
            "id": t.id, "pair": t.pair, "side": t.side,
            "order_type": t.order_type, "qty": float(t.qty or 0),
            "price": float(t.price or 0), "take_profit": float(t.take_profit or 0),
            "stop_loss": float(t.stop_loss or 0), "leverage": t.leverage,
            "order_id": t.order_id, "status": t.status, "error_msg": t.error_msg,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in trades
    ]
