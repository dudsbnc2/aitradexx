from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional, List
from app.services.signal_service import run_signal, run_scan, score_quality
from app.services.ta_engine import backtest_rule_engine
from app.services.data_fetcher import fetch_candles, compute_indicators as _ci
from app.services.ta_engine import compute_indicators
from app.core.auth import get_current_user_optional
import logging

logger = logging.getLogger("tradeia.router.signals")
router = APIRouter(prefix="/signals", tags=["signals"])


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
async def analyze(req: SignalRequest, user=Depends(get_current_user_optional)):
    try:
        return await run_signal(req.pair, req.timeframe, req.use_mtf, req.use_ai or True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Signal error: {e}")


@router.post("/scan")
async def scan(req: ScanRequest, user=Depends(get_current_user_optional)):
    try:
        return await run_scan(req.pairs, req.timeframe, req.use_mtf or True)
    except Exception as e:
        raise HTTPException(502, f"Scan error: {e}")


@router.post("/backtest")
async def backtest(req: BacktestRequest):
    try:
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
async def get_indicators(pair: str, tf: str):
    try:
        candles = await fetch_candles(pair.replace("-", "/"), tf)
        ind = compute_indicators(candles)
        ind["data_source"] = "hyperliquid"
        return ind
    except Exception as e:
        raise HTTPException(502, str(e))
