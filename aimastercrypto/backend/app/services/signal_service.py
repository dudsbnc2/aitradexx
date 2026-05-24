"""
Signal Orchestrator
Combines: data → TA → MTF confluence → AI → quality scoring → DB → Telegram
"""
import asyncio
import logging
from typing import Optional
from app.core.config import settings
from app.services.data_fetcher import fetch_candles, get_current_price, ALL_PAIRS
from app.services.ta_engine import compute_indicators, rule_engine, backtest_rule_engine
from app.services.ai_service import get_ai_signal

logger = logging.getLogger("tradeia.signals")

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
            c = await fetch_candles(pair, t, limit=80)
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
    evidence = min(sum(1 for w in ev_words if w in lower) / len(ev_words) * 10, 10.0)

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


async def run_signal(pair: str, timeframe: str, use_mtf: bool = True, use_ai: bool = True) -> dict:
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

    quality = score_quality(signal, settings.MIN_CONFIDENCE_ALERT)
    signal["quality"] = quality
    signal["data_source"] = "hyperliquid"

    if signal.get("bias") in ("LONG", "SHORT"):
        if quality.get("send_telegram"):
            asyncio.create_task(send_telegram_alert(signal, pair, timeframe, quality))

    return signal


async def run_scan(pairs: Optional[list] = None, timeframe: str = "1H", use_mtf: bool = True) -> dict:
    pairs = pairs or ALL_PAIRS

    async def _safe_signal(p: str):
        try:
            s = await run_signal(p, timeframe, use_mtf=use_mtf)
            s["scanned_pair"] = p
            return s
        except Exception as e:
            logger.warning(f"Scan {p}: {e}")
            return {"scanned_pair": p, "error": str(e), "bias": "WAIT", "confidence": 0}

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
