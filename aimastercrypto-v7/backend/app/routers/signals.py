from fastapi import APIRouter, HTTPException, Depends, Query, Request
from pydantic import BaseModel
from typing import Optional, List
from slowapi import Limiter
from app.core.security_middleware import rate_limit_key   # ← user-ID based
from app.services.signal_service import (
    run_signal, run_scan, score_quality,
    get_signal_history, get_performance_stats,
)
from app.services.ta_engine import backtest_rule_engine
from app.services.data_fetcher import fetch_candles, ALL_PAIRS
from app.services.ta_engine import compute_indicators
from app.core.auth import get_current_user_optional, require_admin, require_verified
from app.core.cache import cache_response, TTL_SCANNER, TTL_INDICATORS
from app.core import audit
import logging

logger = logging.getLogger("tradeia.router.signals")
router = APIRouter(prefix="/signals", tags=["signals"])

# Use user-ID-based rate limit key instead of raw IP
limiter = Limiter(key_func=rate_limit_key)


class SignalRequest(BaseModel):
    pair: str
    timeframe: str
    use_mtf: Optional[bool] = True
    use_ai: Optional[bool] = True


class ScanRequest(BaseModel):
    timeframe: str
    pairs: Optional[List[str]] = None
    use_mtf: Optional[bool] = True


class BacktestRequest(BaseModel):
    pair: str
    timeframe: str
    candles: Optional[int] = 500


@router.post("/analyze")
@limiter.limit("30/minute")
async def analyze(req: SignalRequest, request: Request, current_user=Depends(require_verified)):
    try:
        uid = current_user.get("uid")
        user_email = current_user.get("sub", str(uid))
        audit.signal_requested(request, user_email, req.pair, req.timeframe)
        return await run_signal(req.pair, req.timeframe, req.use_mtf, req.use_ai or True, user_id=uid)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Signal error: {e}")


@router.post("/scan")
@limiter.limit("10/minute")
async def scan(req: ScanRequest, request: Request, current_user=Depends(require_verified)):
    try:
        pairs = req.pairs or ALL_PAIRS
        user_email = current_user.get("sub", "unknown")
        audit.scan_requested(request, user_email, req.timeframe, len(pairs))
        return await run_scan(pairs, req.timeframe, req.use_mtf or True)
    except Exception as e:
        raise HTTPException(502, f"Scan error: {e}")


@router.post("/backtest")
@limiter.limit("5/minute")
async def backtest(req: BacktestRequest, request: Request, admin=Depends(require_admin)):
    try:
        user_email = admin.get("sub", "unknown")
        audit.admin_action(request, user_email, f"backtest {req.pair}/{req.timeframe}")
        limit = min(max(req.candles or 500, 100), 500)
        candles = await fetch_candles(req.pair, req.timeframe, limit=limit)
        result = backtest_rule_engine(candles, timeframe=req.timeframe)
        result["pair"] = req.pair
        result["timeframe"] = req.timeframe
        result["candles_tested"] = len(candles)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Backtest error: {e}")


@router.get("/indicators/{pair}/{tf}")
@limiter.limit("60/minute")
@cache_response(ttl=TTL_INDICATORS, key_prefix="signals:indicators")
async def get_indicators(pair: str, tf: str, request: Request, current_user=Depends(require_verified)):
    try:
        candles = await fetch_candles(pair.replace("-", "/"), tf)
        ind = compute_indicators(candles)
        ind["data_source"] = "hyperliquid"
        return ind
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/history")
@limiter.limit("30/minute")
async def signal_history(
    request: Request,
    pair: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user=Depends(require_verified),
):
    try:
        return await get_signal_history(pair=pair, limit=limit, source=source)
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/performance")
@limiter.limit("20/minute")
@cache_response(ttl=60, key_prefix="signals:performance")
async def signal_performance(
    request: Request,
    pair: Optional[str] = Query(None),
    current_user=Depends(require_verified),
):
    try:
        return await get_performance_stats(pair=pair)
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/pairs")
async def list_pairs():
    return {"pairs": ALL_PAIRS, "total": len(ALL_PAIRS)}
