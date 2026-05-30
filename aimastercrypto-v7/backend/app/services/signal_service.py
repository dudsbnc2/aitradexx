"""
Signal Orchestrator
Combines: data → TA → MTF confluence → AI → quality scoring → DB → Telegram
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional

from app.core.config import settings
from app.services.data_fetcher import fetch_candles, get_current_price, ALL_PAIRS, SCAN_PAIRS
from app.services.ta_engine import compute_indicators, rule_engine, backtest_rule_engine
from app.services.ai_service import get_ai_signal

logger = logging.getLogger("tradeia.signals")

# Semaphore to limit concurrent AI calls during scan (avoids 429 rate limits)
_SCAN_SEMAPHORE = asyncio.Semaphore(5)

# How many candles to look ahead when checking outcome (per timeframe)
OUTCOME_LOOKAHEAD_CANDLES = {
    "1m": 60, "5m": 48, "15m": 32, "1H": 24, "4H": 12, "1D": 7,
}
# Approx minutes per candle — used to schedule the outcome check
TF_MINUTES = {
    "1m": 1, "5m": 5, "15m": 15, "1H": 60, "4H": 240, "1D": 1440,
}

MTF_MAP = {
    "1m":  ["1m", "5m", "15m"],
    "5m":  ["5m", "15m", "1H"],
    "15m": ["15m", "1H", "4H"],
    "1H":  ["1H", "4H", "1D"],
    "4H":  ["4H", "1D"],
    "1D":  ["1D"],
}


async def mtf_confluence(pair: str, tf: str) -> dict:
    tfs = list(dict.fromkeys(MTF_MAP.get(tf, ["1H", "4H", "1D"])))
    scores = []

    for t in tfs:
        try:
            c = await fetch_candles(pair, t, limit=120)  # min 100 for EMA50 convergence
            ind = compute_indicators(c)
            s = 0
            if ind["ema_signal"] == "BULLISH":       s += 2
            elif ind["ema_signal"] == "BEARISH":     s -= 2
            if ind["macd_signal_dir"] == "BULLISH":  s += 1
            elif ind["macd_signal_dir"] == "BEARISH": s -= 1
            if ind["rsi"] < 45:   s += 1
            elif ind["rsi"] > 55: s -= 1
            if ind["structure"] == "BOS":    s += 2
            elif ind["structure"] == "CHOCH": s -= 2
            if ind["volume"] == "HIGH":  s += 1
            elif ind["volume"] == "LOW": s -= 1
            scores.append(s)
        except Exception as e:
            logger.warning(f"MTF {pair} {t}: {e}")
            scores.append(0)

    n = len(scores)
    total = sum(scores)
    bull = sum(1 for s in scores if s > 0)
    bear = sum(1 for s in scores if s < 0)

    if bull >= max(2, n - 1) and total > 3:
        confluence = "BULLISH"
    elif bear >= max(2, n - 1) and total < -3:
        confluence = "BEARISH"
    else:
        confluence = "MIXED"

    return {
        "bull_tfs": bull, "bear_tfs": bear, "total_tfs": n,
        "scores": scores, "tfs": tfs,
        "total_score": total, "confluence": confluence,
    }


def score_quality(signal: dict, min_confidence: int = 60) -> dict:
    bias = signal.get("bias", "WAIT")
    confidence = signal.get("confidence", 0)
    analysis = signal.get("analysis", "")
    tags = signal.get("tags", [])
    ind = signal.get("indicators", {})
    rr_str = signal.get("rr", "1:1")
    mtf = signal.get("mtf")

    lower = analysis.lower()
    is_rule_engine = signal.get("source") == "rule-engine"

    # Specificity
    spec = 1.0
    if bias in ("LONG", "SHORT"): spec += 2.0
    if signal.get("entry", 0) > 0:      spec += 1.0
    if signal.get("stopLoss", 0) > 0:   spec += 0.5
    if signal.get("takeProfit", 0) > 0: spec += 0.5
    if len(tags) >= 3:                  spec += 0.5
    spec = min(spec, 5.0) * 2

    # Evidence
    ev_words = ["ema", "rsi", "macd", "vwap", "atr", "bos", "choch", "fvg", "liquidity",
                "volume", "support", "resistance", "structure", "confluence", "momentum", "trend"]
    evidence_raw = min(sum(1 for w in ev_words if w in lower) / len(ev_words) * 10, 10.0)
    # Rule engine auto-inserts these keywords — cap its evidence so it can't reach grade A/B
    evidence = min(evidence_raw, 4.0) if is_rule_engine else evidence_raw

    # Confidence quality
    if 60 <= confidence <= 85:   conf_q = 10.0
    elif 50 <= confidence < 60:  conf_q = 7.0
    elif confidence > 85:        conf_q = 5.0
    else:                        conf_q = 3.0

    # RR
    try:
        rr_val = float(rr_str.split(":")[-1])
        rr_q = 10.0 if rr_val >= 2.0 else (7.0 if rr_val >= 1.5 else 4.0)
    except Exception:
        rr_q = 3.0

    # MTF bonus
    mtf_bonus = 0.0
    if mtf:
        bull = mtf.get("bull_tfs", 0); bear = mtf.get("bear_tfs", 0); n = mtf.get("total_tfs", 3)
        if (bias == "LONG" and bull >= n - 1) or (bias == "SHORT" and bear >= n - 1):
            mtf_bonus = 10.0
        elif (bias == "LONG" and bull >= 1) or (bias == "SHORT" and bear >= 1):
            mtf_bonus = 5.0

    # Indicator alignment
    ema_d = ind.get("ema", "NEUTRAL")
    macd_d = ind.get("macd", "NEUTRAL")
    rsi_v = ind.get("rsi", 50)
    struct = ind.get("structure", "RANGE")
    ind_score = 0.0
    if bias == "LONG":
        if ema_d == "BULLISH":   ind_score += 2
        if macd_d == "BULLISH":  ind_score += 2
        if rsi_v < 65:           ind_score += 1
        if struct == "BOS":      ind_score += 2
    elif bias == "SHORT":
        if ema_d == "BEARISH":   ind_score += 2
        if macd_d == "BEARISH":  ind_score += 2
        if rsi_v > 35:           ind_score += 1
        if struct == "CHOCH":    ind_score += 2
    ind_score = min(ind_score / 7 * 10, 10.0)

    overall = (spec * 0.20 + evidence * 0.20 + conf_q * 0.15 +
               rr_q * 0.15 + mtf_bonus * 0.15 + ind_score * 0.15)
    grade = "A" if overall >= 8 else "B" if overall >= 6 else "C" if overall >= 4 else "D"

    return {
        "overall": round(overall, 1),
        "grade": grade,
        "specificity": round(spec, 1),
        "evidence": round(evidence, 1),
        "confidence_q": round(conf_q, 1),
        "rr_quality": round(rr_q, 1),
        "mtf_bonus": round(mtf_bonus, 1),
        "ind_alignment": round(ind_score, 1),
        "send_telegram": bias in ("LONG", "SHORT") and overall >= 6.0 and confidence >= min_confidence,
    }


async def send_telegram_alert(signal: dict, pair: str, tf: str, quality: Optional[dict] = None):
    if not settings.TELEGRAM_TOKEN or not settings.TELEGRAM_CHAT_ID:
        return
    try:
        from telegram import Bot
        bias = signal.get("bias", "?")
        conf = signal.get("confidence", 0)
        entry = signal.get("entry", 0)
        sl = signal.get("stopLoss", 0)
        tp = signal.get("takeProfit", 0)
        rr = signal.get("rr", "?")
        src = signal.get("source", "?")
        ind = signal.get("indicators", {})
        emoji = "🟢" if bias == "LONG" else "🔴" if bias == "SHORT" else "⚪"
        mtf = signal.get("mtf")
        mtf_str = f"\n🔀 MTF: {mtf['confluence']} ({mtf['bull_tfs']}/{mtf['total_tfs']} bull)" if mtf else ""
        q_str = f"\n⭐ Quality: {quality['overall']}/10 (Grade {quality['grade']})" if quality else ""
        msg = (
            f"{emoji} *{bias} — {pair} {tf}*\n\n"
            f"💰 Entry: `{entry}`\n🛑 SL: `{sl}`\n🎯 TP: `{tp}`\n"
            f"📊 RR: `{rr}` | Conf: `{conf}%`{q_str}{mtf_str}\n\n"
            f"📈 EMA: {ind.get('ema','?')} | RSI: {ind.get('rsi','?')} | MACD: {ind.get('macd','?')}\n"
            f"🏗 Structure: {ind.get('structure','?')} | VWAP: {ind.get('vwap','?')}\n\n"
            f"📝 _{signal.get('analysis','')}_\n\n🤖 {src} · AIMasterCrypto"
        )
        bot = Bot(token=settings.TELEGRAM_TOKEN)
        await bot.send_message(chat_id=settings.TELEGRAM_CHAT_ID, text=msg, parse_mode="Markdown")
    except Exception as e:
        logger.warning(f"Telegram: {e}")


async def save_signal_to_db(signal: dict, pair: str, timeframe: str, user_id: Optional[int] = None) -> Optional[int]:
    """Persist a signal to the signals table. Returns the new row id or None if DB unavailable."""
    try:
        from app.core.database import AsyncSessionLocal, Signal as SignalModel
        if AsyncSessionLocal is None:
            return None
        quality = signal.get("quality", {})
        async with AsyncSessionLocal() as session:
            row = SignalModel(
                user_id=user_id,
                pair=pair,
                timeframe=timeframe,
                bias=signal.get("bias"),
                confidence=signal.get("confidence"),
                entry=signal.get("entry"),
                stop_loss=signal.get("stopLoss"),
                take_profit=signal.get("takeProfit"),
                rr=signal.get("rr"),
                analysis=signal.get("analysis"),
                indicators=signal.get("indicators"),
                tags=signal.get("tags"),
                source=signal.get("source", "rule-engine"),
                quality_score=quality.get("overall"),
                quality_grade=quality.get("grade"),
                result="OPEN",
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            logger.info(f"Signal saved: id={row.id} {pair} {timeframe} {signal.get('bias')}")
            return row.id
    except Exception as e:
        logger.warning(f"save_signal_to_db failed: {e}")
        return None


async def _check_outcome(signal_id: int, pair: str, timeframe: str,
                          bias: str, entry: float, stop_loss: float, take_profit: float):
    """
    Called after a delay. Fetches fresh candles and checks whether TP or SL was hit.
    Updates the signal row with result, close_price, pnl_pct, and closed_at.
    """
    try:
        from app.core.database import AsyncSessionLocal, Signal as SignalModel
        from sqlalchemy import select
        if AsyncSessionLocal is None:
            return

        lookahead = OUTCOME_LOOKAHEAD_CANDLES.get(timeframe, 24)
        candles = await fetch_candles(pair, timeframe, limit=lookahead + 5)

        result = "TIMEOUT"
        close_price = candles[-1]["c"]

        for c in candles[-(lookahead):]:
            hi, lo = c["h"], c["l"]
            if bias == "LONG":
                if lo <= stop_loss:
                    result = "LOSS"; close_price = stop_loss; break
                if hi >= take_profit:
                    result = "WIN";  close_price = take_profit; break
            else:  # SHORT
                if hi >= stop_loss:
                    result = "LOSS"; close_price = stop_loss; break
                if lo <= take_profit:
                    result = "WIN";  close_price = take_profit; break

        if result == "TIMEOUT":
            # Mark as expired — didn't hit either level
            result = "EXPIRED"

        pnl = 0.0
        if entry and entry != 0:
            if bias == "LONG":
                pnl = round((close_price - entry) / entry * 100, 3)
            else:
                pnl = round((entry - close_price) / entry * 100, 3)

        async with AsyncSessionLocal() as session:
            row = await session.get(SignalModel, signal_id)
            if row and row.result == "OPEN":
                row.result = result
                row.close_price = close_price
                row.pnl_pct = pnl
                row.closed_at = datetime.now(timezone.utc)
                await session.commit()
                logger.info(f"Outcome updated: signal_id={signal_id} {result} pnl={pnl}%")
    except Exception as e:
        logger.warning(f"_check_outcome failed signal_id={signal_id}: {e}")


def schedule_outcome_check(signal_id: int, pair: str, timeframe: str,
                             bias: str, entry: float, stop_loss: float, take_profit: float):
    """Schedule outcome check after the lookahead window expires."""
    delay_minutes = TF_MINUTES.get(timeframe, 60) * OUTCOME_LOOKAHEAD_CANDLES.get(timeframe, 24)
    delay_seconds = delay_minutes * 60

    async def _delayed():
        await asyncio.sleep(delay_seconds)
        await _check_outcome(signal_id, pair, timeframe, bias, entry, stop_loss, take_profit)

    asyncio.create_task(_delayed())
    logger.info(f"Outcome check scheduled: signal_id={signal_id} in {delay_minutes}min")


async def get_signal_history(pair: Optional[str] = None, limit: int = 50,
                              source: Optional[str] = None) -> list:
    """Return recent signals from DB, optionally filtered by pair/source."""
    try:
        from app.core.database import AsyncSessionLocal, Signal as SignalModel
        from sqlalchemy import select, desc
        if AsyncSessionLocal is None:
            return []
        async with AsyncSessionLocal() as session:
            q = select(SignalModel).order_by(desc(SignalModel.created_at)).limit(limit)
            if pair:
                q = q.where(SignalModel.pair == pair)
            if source:
                q = q.where(SignalModel.source == source)
            rows = (await session.execute(q)).scalars().all()
            from app.services.signal_staleness import compute_signal_staleness
            signals = [
                {
                    "id": r.id,
                    "pair": r.pair,
                    "timeframe": r.timeframe,
                    "bias": r.bias,
                    "confidence": r.confidence,
                    "entry": float(r.entry or 0),
                    "stopLoss": float(r.stop_loss or 0),
                    "takeProfit": float(r.take_profit or 0),
                    "rr": r.rr,
                    "source": r.source,
                    "quality_score": float(r.quality_score or 0),
                    "quality_grade": r.quality_grade,
                    "result": r.result,
                    "close_price": float(r.close_price or 0) if r.close_price else None,
                    "pnl_pct": float(r.pnl_pct or 0) if r.pnl_pct else None,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "closed_at": r.closed_at.isoformat() if r.closed_at else None,
                    "staleness": compute_signal_staleness(
                        r.created_at.isoformat() if r.created_at else None,
                        r.timeframe or "1H"
                    ),
                }
                for r in rows
            ]
            return signals
    except Exception as e:
        logger.warning(f"get_signal_history failed: {e}")
        return []


async def get_performance_stats(pair: Optional[str] = None) -> dict:
    """Aggregate win rate, avg pnl, and breakdown by source from closed signals."""
    try:
        from app.core.database import AsyncSessionLocal, Signal as SignalModel
        from sqlalchemy import select, func
        if AsyncSessionLocal is None:
            return {}
        async with AsyncSessionLocal() as session:
            base = select(SignalModel).where(SignalModel.result.in_(["WIN", "LOSS"]))
            if pair:
                base = base.where(SignalModel.pair == pair)
            rows = (await session.execute(base)).scalars().all()

        if not rows:
            return {"total": 0, "wins": 0, "losses": 0, "win_rate": 0, "avg_pnl": 0, "by_source": {}}

        wins = [r for r in rows if r.result == "WIN"]
        losses = [r for r in rows if r.result == "LOSS"]
        pnls = [float(r.pnl_pct) for r in rows if r.pnl_pct is not None]
        avg_pnl = round(sum(pnls) / len(pnls), 2) if pnls else 0

        # Breakdown by source (rule-engine vs each AI)
        by_source: dict = {}
        for r in rows:
            src = r.source or "unknown"
            if src not in by_source:
                by_source[src] = {"total": 0, "wins": 0, "win_rate": 0}
            by_source[src]["total"] += 1
            if r.result == "WIN":
                by_source[src]["wins"] += 1
        for src, d in by_source.items():
            d["win_rate"] = round(d["wins"] / d["total"] * 100, 1) if d["total"] else 0

        return {
            "total": len(rows),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / len(rows) * 100, 1),
            "avg_pnl": avg_pnl,
            "by_source": by_source,
        }
    except Exception as e:
        logger.warning(f"get_performance_stats failed: {e}")
        return {}



async def run_signal(pair: str, timeframe: str, use_mtf: bool = True, use_ai: bool = True,
                     user_id: Optional[int] = None) -> dict:
    candles = await fetch_candles(pair, timeframe)
    ind = compute_indicators(candles)
    mtf = None

    if use_mtf:
        try:
            mtf = await mtf_confluence(pair, timeframe)
        except Exception as e:
            logger.warning(f"MTF failed {pair}/{timeframe}: {e}")

    if use_ai:
        signal, source = await get_ai_signal(pair, timeframe, ind, mtf)
        signal["source"] = source
    else:
        signal = rule_engine(ind)

    if mtf:
        signal["mtf"] = mtf

    # ── Quant Engine V7 ────────────────────────────────────────────────────
    try:
        from app.services.quant_engine import quant_signal, quant_to_dict
        quant = quant_signal(ind, price=ind.get("price", 0), atr_val=ind.get("atr", 0))
        signal["quant"] = quant_to_dict(quant)

        # Override: se quant diz WAIT e AI tem baixa confiança, forçar WAIT
        if quant.bias == "WAIT" and signal.get("confidence", 0) < 60:
            original_bias = signal.get("bias")
            signal["bias"] = "WAIT"
            signal["analysis"] = (
                signal.get("analysis", "") +
                f" [Quant override: regime={quant.regime}, edge={quant.edge_score}/100 — setup não recomendado]"
            )
            logger.info(f"Quant override: {pair}/{timeframe} {original_bias}→WAIT edge={quant.edge_score}")
    except Exception as e:
        logger.warning(f"Quant engine failed {pair}/{timeframe}: {e}")
    # ──────────────────────────────────────────────────────────────────────

    quality = score_quality(signal, settings.MIN_CONFIDENCE_ALERT)
    signal["quality"] = quality
    signal["data_source"] = "hyperliquid"

    if signal.get("bias") in ("LONG", "SHORT"):
        # ── Persist to DB ───────────────────────────────────────────────
        signal_id = await save_signal_to_db(signal, pair, timeframe, user_id)
        if signal_id:
            signal["signal_id"] = signal_id
            # Schedule outcome check after the lookahead window
            schedule_outcome_check(
                signal_id=signal_id,
                pair=pair,
                timeframe=timeframe,
                bias=signal["bias"],
                entry=float(signal.get("entry") or 0),
                stop_loss=float(signal.get("stopLoss") or 0),
                take_profit=float(signal.get("takeProfit") or 0),
            )
        # ── Telegram alert ──────────────────────────────────────────────
        if quality.get("send_telegram"):
            asyncio.create_task(send_telegram_alert(signal, pair, timeframe, quality))

    return signal




async def run_scan(pairs: Optional[list] = None, timeframe: str = "1H", use_mtf: bool = True) -> dict:
    pairs = pairs or SCAN_PAIRS

    async def _safe_signal(p: str):
        async with _SCAN_SEMAPHORE:  # max 5 concurrent AI calls — prevents 429
            try:
                s = await run_signal(p, timeframe, use_mtf=use_mtf)
                s["scanned_pair"] = p
                s["pair"] = p  # ensure pair is always set
                return s
            except Exception as e:
                logger.warning(f"Scan {p}: {e}")
                return {"scanned_pair": p, "pair": p, "error": str(e), "bias": "WAIT", "confidence": 0}

    results = await asyncio.gather(*[_safe_signal(p) for p in pairs])
    actionable = sorted(
        [r for r in results if r.get("bias") in ("LONG", "SHORT") and not r.get("error")],
        key=lambda x: (x.get("quality", {}).get("overall", 0), x.get("confidence", 0)),
        reverse=True,
    )
    waits = [r for r in results if r.get("bias") == "WAIT" and not r.get("error")]
    errors = [r for r in results if r.get("error")]

    return {
        "best": actionable[0] if actionable else (waits[0] if waits else None),
        "ranked": actionable + waits,
        "scanned": len(pairs),
        "actionable": len(actionable),
        "errors": len(errors),
        "timeframe": timeframe,
    }
