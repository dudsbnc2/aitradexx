"""
Technical Analysis Engine
Preserved from TradeIA v6 with enhancements for the new architecture.
"""
import time
import logging
from typing import Optional

logger = logging.getLogger("tradeia.ta")


# ── EMA / RSI / MACD ────────────────────────────────────────────────────────

def ema(values: list, period: int) -> float:
    k = 2 / (period + 1)
    e = values[0]
    for v in values[1:]:
        e = v * k + e * (1 - k)
    return e


def rsi(closes: list, period: int = 14) -> float:
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    ag = sum(gains[-period:]) / period
    al = sum(losses[-period:]) / period
    if al == 0:
        return 100.0
    return round(100 - (100 / (1 + ag / al)), 1)


def macd(closes: list, fast: int = 12, slow: int = 26, sig: int = 9):
    if len(closes) < slow + sig:
        return 0, 0, 0
    series = []
    for i in range(sig + 1):
        sub = closes[: len(closes) - sig + i] if i < sig else closes
        series.append(ema(sub, fast) - ema(sub, slow))
    ml = series[-1]
    sl_ = ema(series, sig)
    hist = round(ml - sl_, 8)
    return round(ml, 8), round(sl_, 8), hist


def vwap(candles: list) -> float:
    tv = sum(c["v"] for c in candles)
    return sum((c["h"] + c["l"] + c["c"]) / 3 * c["v"] for c in candles) / tv if tv else 0


def atr(candles: list, period: int = 14) -> float:
    trs = []
    for i in range(1, len(candles)):
        p = candles[i - 1]["c"]
        trs.append(
            max(
                candles[i]["h"] - candles[i]["l"],
                abs(candles[i]["h"] - p),
                abs(candles[i]["l"] - p),
            )
        )
    return sum(trs[-period:]) / period if trs else 0


def atr_regime(candles: list, period: int = 14, lookback: int = 50) -> str:
    if len(candles) < lookback + period:
        return "NORMAL"
    current_atr = atr(candles, period)
    hist_atrs = []
    for i in range(lookback, 0, -10):
        sub = candles[:-i] if i < len(candles) else candles
        hist_atrs.append(atr(sub, period))
    if not hist_atrs:
        return "NORMAL"
    avg_atr = sum(hist_atrs) / len(hist_atrs)
    ratio = current_atr / avg_atr if avg_atr > 0 else 1.0
    if ratio < 0.4:
        return "LOW_VOL"
    if ratio > 3.0:
        return "HIGH_VOL"
    return "NORMAL"


def detect_structure(closes: list) -> str:
    if len(closes) < 10:
        return "RANGE"
    r = closes[-20:]
    m = len(r) // 2
    if max(r[m:]) > max(r[:m]) and min(r[m:]) > min(r[:m]):
        return "BOS"
    if max(r[m:]) < max(r[:m]) and min(r[m:]) < min(r[:m]):
        return "CHOCH"
    return "RANGE"


def detect_fvg(candles: list) -> str:
    for i in range(2, min(10, len(candles))):
        c1, c3 = candles[-(i + 1)], candles[-(i - 1)]
        if c3["l"] > c1["h"]:
            return "BULLISH_FVG"
        if c3["h"] < c1["l"]:
            return "BEARISH_FVG"
    return "NONE"


def vol_trend(candles: list, lb: int = 10) -> str:
    if len(candles) < lb * 2:
        return "NORMAL"
    r = sum(c["v"] for c in candles[-lb:]) / lb
    p = sum(c["v"] for c in candles[-(lb * 2): -lb]) / lb
    ratio = r / p if p else 1
    return "HIGH" if ratio > 1.4 else "LOW" if ratio < 0.7 else "NORMAL"


def vol_mult(candles: list, lb: int = 10) -> float:
    if len(candles) < lb * 2:
        return 1.0
    r = sum(c["v"] for c in candles[-5:]) / 5
    p = sum(c["v"] for c in candles[-(lb * 2): -5]) / (lb * 2 - 5) if lb * 2 - 5 > 0 else 1
    return round(r / p, 2) if p else 1.0


def compute_indicators(candles: list) -> dict:
    closes = [c["c"] for c in candles]
    price = closes[-1]
    e9, e21, e50 = ema(closes, 9), ema(closes, 21), ema(closes, 50)
    rsi_v = rsi(closes)
    vwap_v = vwap(candles)
    atr_v = atr(candles)
    ml, sl_, hist = macd(closes)
    ema_sig = "BULLISH" if e9 > e21 > e50 else "BEARISH" if e9 < e21 < e50 else "NEUTRAL"
    vwap_sig = "ABOVE" if price > vwap_v * 1.001 else "BELOW" if price < vwap_v * 0.999 else "AT"
    macd_sig = "BULLISH" if ml > sl_ else "BEARISH"
    vm = vol_mult(candles)
    atr_reg = atr_regime(candles)

    return dict(
        price=round(price, 6),
        ema9=round(e9, 6),
        ema21=round(e21, 6),
        ema50=round(e50, 6),
        rsi=rsi_v,
        vwap=round(vwap_v, 6),
        atr=round(atr_v, 6),
        macd_line=ml,
        macd_signal=sl_,
        macd_hist=hist,
        macd_signal_dir=macd_sig,
        ema_signal=ema_sig,
        vwap_signal=vwap_sig,
        volume=vol_trend(candles),
        vol_mult=vm,
        atr_regime=atr_reg,
        structure=detect_structure(closes),
        fvg=detect_fvg(candles),
    )


# ── Rule Engine ──────────────────────────────────────────────────────────────

def rule_engine(ind: dict) -> dict:
    price, atr_v = ind["price"], ind["atr"]
    score, tags = 0, []

    atr_reg = ind.get("atr_regime", "NORMAL")
    if atr_reg != "NORMAL":
        return {
            "bias": "WAIT",
            "confidence": 25,
            "rating": "DEVELOPING",
            "entry": price,
            "entryZoneHigh": round(price * 1.05, 8),
            "stopLoss": round(price - atr_v * 1.5, 8),
            "takeProfit": round(price + atr_v * 2.0, 8),
            "invalidation": round(price - atr_v * 2, 8),
            "rr": "1:1.3",
            "analysis": f"ATR regime: {atr_reg}. Avoiding signal.",
            "indicators": {
                "ema": ind["ema_signal"],
                "rsi": int(ind["rsi"]),
                "macd": ind["macd_signal_dir"],
                "volume": ind["volume"],
                "volMult": ind.get("vol_mult", 1.0),
                "structure": ind["structure"],
                "vwap": ind["vwap_signal"],
            },
            "tags": [f"ATR {atr_reg}"],
            "source": "rule-engine",
        }

    if ind["ema_signal"] == "BULLISH":    score += 2; tags.append("EMA bullish")
    elif ind["ema_signal"] == "BEARISH":  score -= 2; tags.append("EMA bearish")
    if ind["macd_signal_dir"] == "BULLISH":   score += 2; tags.append("MACD bullish")
    elif ind["macd_signal_dir"] == "BEARISH": score -= 2; tags.append("MACD bearish")
    if ind["rsi"] < 35:       score += 2; tags.append("RSI oversold")
    elif ind["rsi"] > 65:     score -= 2; tags.append("RSI overbought")
    elif 40 < ind["rsi"] < 60:
        if ind["ema_signal"] == "BULLISH":   score += 1; tags.append("RSI neutral bull")
        elif ind["ema_signal"] == "BEARISH": score -= 1; tags.append("RSI neutral bear")
    if ind["vwap_signal"] == "ABOVE":  score += 1; tags.append("Above VWAP")
    elif ind["vwap_signal"] == "BELOW": score -= 1; tags.append("Below VWAP")
    if ind["structure"] == "BOS":    score += 2; tags.append("BOS confirmed")
    elif ind["structure"] == "CHOCH": score -= 2; tags.append("CHOCH bearish")
    vm = ind.get("vol_mult", 1.0)
    if ind["volume"] == "HIGH" or vm >= 1.3:   score += 1; tags.append(f"Vol {vm}x")
    elif ind["volume"] == "LOW" or vm < 0.6:   score -= 1; tags.append("Low volume")
    if ind["fvg"] == "BULLISH_FVG":   score += 1; tags.append("Bullish FVG")
    elif ind["fvg"] == "BEARISH_FVG": score -= 1; tags.append("Bearish FVG")

    ema_bull = ind["ema_signal"] == "BULLISH"
    ema_bear = ind["ema_signal"] == "BEARISH"
    macd_bull = ind["macd_signal_dir"] == "BULLISH"
    macd_bear = ind["macd_signal_dir"] == "BEARISH"
    has_vol = vm >= 0.6

    if score >= 5 and ema_bull and macd_bull and has_vol:
        bias = "LONG"
    elif score <= -5 and ema_bear and macd_bear and has_vol:
        bias = "SHORT"
    else:
        bias = "WAIT"

    if bias == "LONG":
        conf = min(50 + score * 5, 88)
        entry = price; sl = round(price - atr_v * 1.5, 8); tp = round(price + atr_v * 3.0, 8)
    elif bias == "SHORT":
        conf = min(50 + abs(score) * 5, 88)
        entry = price; sl = round(price + atr_v * 1.5, 8); tp = round(price - atr_v * 3.0, 8)
    else:
        conf = max(25, 50 - abs(score) * 6)
        entry = price; sl = round(price - atr_v * 1.5, 8); tp = round(price + atr_v * 2.0, 8)

    risk = abs(entry - sl); reward = abs(tp - entry)
    rr = round(reward / risk, 1) if risk > 0 else 0
    rating = "TEXTBOOK" if conf >= 85 else "STRONG" if conf >= 75 else "GOOD" if conf >= 65 else "DEVELOPING"

    msgs = {
        "LONG": f"Bullish confluence: EMA {ind['ema_signal'].lower()}, MACD {ind['macd_signal_dir'].lower()}, RSI {ind['rsi']}, structure {ind['structure']}. Volume {vm}x avg.",
        "SHORT": f"Bearish confluence: EMA {ind['ema_signal'].lower()}, MACD {ind['macd_signal_dir'].lower()}, RSI {ind['rsi']}, structure {ind['structure']}. Volume {vm}x avg.",
        "WAIT": f"Mixed signals. EMA {ind['ema_signal'].lower()}, MACD {ind['macd_signal_dir'].lower()}, RSI {ind['rsi']}. No clear setup — waiting.",
    }

    return {
        "bias": bias,
        "confidence": int(conf),
        "rating": rating,
        "entry": entry,
        "entryZoneHigh": round(price * 1.05, 8) if bias == "LONG" else round(price * 0.95, 8),
        "stopLoss": sl,
        "takeProfit": tp,
        "invalidation": round(price - atr_v * 2, 8) if bias == "LONG" else round(price + atr_v * 2, 8),
        "rr": f"1:{rr}",
        "analysis": msgs[bias],
        "indicators": {
            "ema": ind["ema_signal"],
            "rsi": int(ind["rsi"]),
            "macd": ind["macd_signal_dir"],
            "volume": ind["volume"],
            "volMult": vm,
            "structure": ind["structure"],
            "vwap": ind["vwap_signal"],
        },
        "tags": tags[:5] or ["TA signal"],
        "source": "rule-engine",
    }


# ── Backtesting ──────────────────────────────────────────────────────────────

BACKTEST_LOOKAHEAD = {"1m": 45, "5m": 36, "15m": 28, "1H": 20, "4H": 14, "1D": 10}
BACKTEST_COOLDOWN = {"1m": 5, "5m": 5, "15m": 4, "1H": 3, "4H": 2, "1D": 2}


def backtest_rule_engine(candles: list, timeframe: str = "1H", initial_balance: float = 1000.0) -> dict:
    trades = []
    balance = initial_balance
    lookahead = BACKTEST_LOOKAHEAD.get(timeframe, 20)
    cooldown = BACKTEST_COOLDOWN.get(timeframe, 3)
    last_trade_idx = -1

    for i in range(60, len(candles) - lookahead):
        if i - last_trade_idx < cooldown:
            continue
        window = candles[max(0, i - 119): i + 1]
        ind = compute_indicators(window)
        sig = rule_engine(ind)
        if sig["bias"] == "WAIT" or sig["confidence"] < 60:
            continue

        entry_idx = i + 1
        if entry_idx >= len(candles):
            continue
        entry = candles[entry_idx]["o"]
        bias = sig["bias"]
        atr_v = ind["atr"]
        FEES = 0.0006

        if bias == "LONG":
            entry = entry * (1 + FEES)
            sl = round(entry - atr_v * 1.5, 8)
            tp = round(entry + atr_v * 3.0, 8)
        else:
            entry = entry * (1 - FEES)
            sl = round(entry + atr_v * 1.5, 8)
            tp = round(entry - atr_v * 3.0, 8)

        risk_pct = abs(entry - sl) / entry * 100
        if risk_pct < 0.1:
            continue

        result = "TIMEOUT"
        exit_price = candles[min(entry_idx + lookahead, len(candles) - 1)]["c"]
        last_j = entry_idx

        for j in range(entry_idx + 1, min(entry_idx + lookahead + 1, len(candles))):
            hi = candles[j]["h"]
            lo = candles[j]["l"]
            last_j = j
            if bias == "LONG":
                if lo <= sl:  result = "LOSS"; exit_price = sl; break
                if hi >= tp:  result = "WIN";  exit_price = tp; break
            else:
                if hi >= sl:  result = "LOSS"; exit_price = sl; break
                if lo <= tp:  result = "WIN";  exit_price = tp; break

        if result == "TIMEOUT":
            continue

        pnl = ((exit_price - entry) / entry * 100) if bias == "LONG" else ((entry - exit_price) / entry * 100)
        pnl -= FEES * 100
        balance += balance * (pnl / 100) * 0.02
        last_trade_idx = last_j
        trades.append({
            "bias": bias,
            "entry": round(entry, 6),
            "exit": round(exit_price, 6),
            "result": result,
            "pnl_pct": round(pnl, 3),
            "balance": round(balance, 2),
            "confidence": sig["confidence"],
        })

    if not trades:
        return {"trades": 0, "wins": 0, "losses": 0, "win_rate": 0,
                "total_pnl_pct": 0, "final_balance": initial_balance,
                "max_drawdown": 0, "sharpe_ratio": 0, "detail": []}

    wins = sum(1 for t in trades if t["result"] == "WIN")
    peak = initial_balance
    max_dd = 0
    pnls = []
    for t in trades:
        if t["balance"] > peak:
            peak = t["balance"]
        dd = (peak - t["balance"]) / peak * 100
        if dd > max_dd:
            max_dd = dd
        pnls.append(t["pnl_pct"])

    avg_pnl = sum(pnls) / len(pnls) if pnls else 0
    import statistics
    std_pnl = statistics.stdev(pnls) if len(pnls) > 1 else 1
    sharpe = round((avg_pnl / std_pnl) * (252 ** 0.5), 2) if std_pnl > 0 else 0

    return {
        "trades": len(trades),
        "wins": wins,
        "losses": len(trades) - wins,
        "win_rate": round(wins / len(trades) * 100, 1),
        "total_pnl_pct": round((balance - initial_balance) / initial_balance * 100, 2),
        "final_balance": round(balance, 2),
        "max_drawdown": round(max_dd, 2),
        "sharpe_ratio": sharpe,
        "profit_factor": round(
            sum(t["pnl_pct"] for t in trades if t["pnl_pct"] > 0) /
            abs(sum(t["pnl_pct"] for t in trades if t["pnl_pct"] < 0) or 1),
            2,
        ),
        "detail": trades[-50:],
    }
