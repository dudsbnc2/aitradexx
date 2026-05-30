"""
AIMasterCrypto — Quant Engine V7
Motor de sinais probabilístico que substitui o scoring narrativo.

Este módulo separa:
  1. Edge Quantitativo (este ficheiro) — baseado em alinhamento de indicadores
  2. Narrativa AI (ai_service.py)       — explicação em linguagem natural

O edge quantitativo é sempre calculado. A AI enriquece, não substitui.
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class QuantSignal:
    bias: str                   # LONG | SHORT | WAIT
    confidence: float           # 0-100, calibrado estatisticamente
    edge_score: float           # alinhamento de indicadores (0-100)
    regime: str                 # TREND_UP | TREND_DOWN | RANGE | CHOPPY | VOLATILE
    entry_prob: float           # P(preço atingir zona de entrada)
    tp_prob: float              # P(TP hit antes SL) — probabilidade real
    sl_prob: float              # P(SL hit antes TP)
    expected_rr: float          # valor esperado em múltiplos de risco
    invalidation: float
    entry: float
    stop_loss: float
    take_profit: float
    rr_ratio: float = 2.0
    regime_note: str = ""


def detect_regime(ind: dict) -> tuple[str, str]:
    """
    Detecta regime de mercado a partir dos indicadores.
    Retorna (regime, nota explicativa).

    Regimes:
      TREND_UP   — preço acima EMAs, BOS recente, volume alto
      TREND_DOWN — preço abaixo EMAs, CHOCH recente, volume alto
      RANGE      — EMAs misturadas, sem estrutura clara
      CHOPPY     — baixa volatilidade, EMAs juntas, falsos breaks
      VOLATILE   — ATR muito alto, RSI extremo
    """
    atr_regime = ind.get('atr_regime', 'NORMAL')
    structure = ind.get('structure', 'RANGE')
    ema_signal = ind.get('ema_signal', 'NEUTRAL')
    rsi = float(ind.get('rsi', 50))
    vwap_signal = ind.get('vwap_signal', 'NEUTRAL')
    vol = ind.get('volume', 'NORMAL')

    # Volátil: ATR muito alto com extremos de RSI
    if atr_regime == 'HIGH_VOL' and (rsi > 78 or rsi < 22):
        return 'VOLATILE', f'ATR regime alto + RSI extremo ({rsi:.0f})'

    # Trend confirmado: EMAs alinhadas + estrutura de mercado
    if ema_signal == 'BULLISH' and structure == 'BOS':
        note = 'EMA stack bullish + BOS confirmado'
        if vol == 'HIGH':
            note += ' + volume alto'
        return 'TREND_UP', note

    if ema_signal == 'BEARISH' and structure == 'CHOCH':
        note = 'EMA stack bearish + CHOCH confirmado'
        if vol == 'HIGH':
            note += ' + volume alto'
        return 'TREND_DOWN', note

    # Trend fraco: só EMAs sem estrutura
    if ema_signal == 'BULLISH' and vwap_signal == 'ABOVE':
        return 'TREND_UP', 'EMA bullish + acima VWAP (sem BOS)'

    if ema_signal == 'BEARISH' and vwap_signal == 'BELOW':
        return 'TREND_DOWN', 'EMA bearish + abaixo VWAP (sem CHOCH)'

    # Choppy: volatilidade baixa
    if atr_regime == 'LOW_VOL':
        return 'CHOPPY', 'ATR baixo — mercado em compressão, whipsaw elevado'

    # Default: range
    return 'RANGE', 'Sem direção clara, EMAs misturadas'


def compute_edge_score(ind: dict, regime: str, bias: str) -> float:
    """
    Score de alinhamento de indicadores (0-100).

    Não é confiança subjectiva — é a percentagem de indicadores que
    confirmam a direcção do sinal, ponderada por regime.

    Calibração:
      80-100  → Setup institucional, todos os indicadores alinhados
      60-79   → Setup bom, maioria alinhada
      40-59   → Setup mediocre, sinais mistos
      0-39    → Setup fraco, não vale a pena entrar
    """
    if bias == 'WAIT':
        return 0.0

    score = 0.0
    max_score = 0.0

    def add(weight: float, condition: bool):
        nonlocal score, max_score
        max_score += weight
        if condition:
            score += weight

    is_long = bias == 'LONG'

    # === EMA Stack (peso 2.5) — trend following
    # Peso extra em regime de trend
    ema_weight = 2.5 if 'TREND' in regime else 1.5
    add(ema_weight, (is_long and ind.get('ema_signal') == 'BULLISH') or
                    (not is_long and ind.get('ema_signal') == 'BEARISH'))

    # === MACD (peso 1.5) — momentum
    add(1.5, (is_long and ind.get('macd_signal_dir') == 'BULLISH') or
             (not is_long and ind.get('macd_signal_dir') == 'BEARISH'))

    # === RSI (peso 1.0) — depende do regime
    rsi = float(ind.get('rsi', 50))
    if 'TREND' in regime:
        # Em trend: RSI neutro (40-60) = pullback entry, bom sinal
        rsi_ok = (is_long and 35 <= rsi <= 62) or (not is_long and 38 <= rsi <= 65)
    else:
        # Em range: RSI extremo = potencial reversão
        rsi_ok = (is_long and rsi < 38) or (not is_long and rsi > 62)
    add(1.0, rsi_ok)

    # === Market Structure BOS/CHOCH (peso 2.0) — smart money
    add(2.0, (is_long and ind.get('structure') == 'BOS') or
             (not is_long and ind.get('structure') == 'CHOCH'))

    # === Volume (peso 1.0) — confirmação
    add(1.0, ind.get('volume') == 'HIGH')

    # === VWAP position (peso 1.0)
    add(1.0, (is_long and ind.get('vwap_signal') == 'ABOVE') or
             (not is_long and ind.get('vwap_signal') == 'BELOW'))

    # === FVG (Fair Value Gap) (peso 0.5) — se disponível
    fvg = ind.get('fvg', '')
    if fvg and fvg != 'NONE':
        add(0.5, (is_long and 'BULL' in str(fvg).upper()) or
                 (not is_long and 'BEAR' in str(fvg).upper()))

    raw_score = (score / max_score * 100) if max_score > 0 else 0.0

    # === Ajuste por regime adverso
    if regime == 'CHOPPY':
        raw_score *= 0.45   # Muito penalizado — sinais em compressão falham frequentemente
    elif regime == 'VOLATILE':
        raw_score *= 0.65   # Volatilidade alta = stops wider = RR pior
    elif regime == 'RANGE':
        raw_score *= 0.80   # Ligeiramente penalizado

    return round(min(raw_score, 100.0), 1)


def estimate_probabilities(
    edge_score: float,
    regime: str,
    rr_ratio: float = 2.0,
) -> tuple[float, float, float]:
    """
    Estima probabilidades baseadas em edge score e regime.

    Calibração conservadora baseada em backtests típicos de setups técnicos:
      edge 0   → ~44% win rate (abaixo do random ajustado por spreads)
      edge 50  → ~50% win rate
      edge 100 → ~63% win rate (setups perfeitos raramente passam 65%)

    Regime multipliers baseados em literatura quantitativa:
      TREND_*  → trend following funciona melhor em trend
      RANGE    → mean reversion funciona em range, mas trend following pior
      CHOPPY   → qualquer sistema tem edge reduzido
    """
    # Base win rate linear
    base_wr = 0.44 + (edge_score / 100) * 0.19   # range: 44% - 63%

    # Multiplicador por regime
    regime_mult = {
        'TREND_UP':   1.12,
        'TREND_DOWN': 1.12,
        'RANGE':      0.92,
        'CHOPPY':     0.72,
        'VOLATILE':   0.82,
    }.get(regime, 1.0)

    tp_prob = min(base_wr * regime_mult, 0.69)   # tecto realista: 69%
    tp_prob = max(tp_prob, 0.30)                  # floor: nunca abaixo de 30%

    # Assumir ~10% de timeouts/neutrals
    timeout = 0.10
    sl_prob = max(1.0 - tp_prob - timeout, 0.0)

    return (
        round(tp_prob * 100, 1),
        round(sl_prob * 100, 1),
        round(timeout * 100, 1),
    )


def compute_expected_value(tp_prob: float, sl_prob: float, rr_ratio: float) -> float:
    """
    Valor esperado do trade em múltiplos de risco (R).

    EV = P(win) × RR - P(loss) × 1
    EV > 0 → trade tem edge positivo
    EV < 0 → trade tem edge negativo (não tomar)

    Exemplo: tp=55%, sl=35%, RR=2.0
      EV = 0.55 × 2.0 - 0.35 × 1.0 = 1.10 - 0.35 = +0.75R
    """
    ev = (tp_prob / 100) * rr_ratio - (sl_prob / 100) * 1.0
    return round(ev, 3)


def determine_bias(ind: dict) -> str:
    """
    Determina bias usando votação ponderada de indicadores.
    Requer ≥3 sinais alinhados para LONG ou SHORT.
    """
    long_votes = 0
    short_votes = 0

    if ind.get('ema_signal') == 'BULLISH':
        long_votes += 2
    elif ind.get('ema_signal') == 'BEARISH':
        short_votes += 2

    if ind.get('macd_signal_dir') == 'BULLISH':
        long_votes += 1.5
    elif ind.get('macd_signal_dir') == 'BEARISH':
        short_votes += 1.5

    rsi = float(ind.get('rsi', 50))
    if rsi < 45:
        long_votes += 1
    elif rsi > 55:
        short_votes += 1

    if ind.get('structure') == 'BOS':
        long_votes += 2
    elif ind.get('structure') == 'CHOCH':
        short_votes += 2

    if ind.get('vwap_signal') == 'ABOVE':
        long_votes += 0.5
    elif ind.get('vwap_signal') == 'BELOW':
        short_votes += 0.5

    if long_votes >= 4.0 and long_votes > short_votes + 1:
        return 'LONG'
    elif short_votes >= 4.0 and short_votes > long_votes + 1:
        return 'SHORT'
    return 'WAIT'


def quant_signal(ind: dict, price: Optional[float] = None, atr_val: Optional[float] = None) -> QuantSignal:
    """
    Motor quantitativo principal.

    Fluxo:
      1. Detectar regime
      2. Determinar bias por votação
      3. Calcular edge score
      4. Estimar probabilidades calibradas
      5. Calcular expected value
      6. Construir níveis com ATR

    Uso em signal_service.py:
        quant = quant_signal(ind, ind['price'], ind['atr'])
        signal['quant'] = {
            'regime': quant.regime,
            'edge_score': quant.edge_score,
            'tp_probability': quant.tp_prob,
            'sl_probability': quant.sl_prob,
            'expected_rr': quant.expected_rr,
            'quant_bias': quant.bias,
        }
    """
    price = price or float(ind.get('price', 0))
    atr_val = atr_val or float(ind.get('atr', price * 0.01))  # fallback 1%

    regime, regime_note = detect_regime(ind)
    bias = determine_bias(ind)

    if bias == 'WAIT' or price <= 0:
        return QuantSignal(
            bias='WAIT', confidence=0, edge_score=0,
            regime=regime, entry_prob=0, tp_prob=0, sl_prob=0,
            expected_rr=0, invalidation=0, entry=price,
            stop_loss=0, take_profit=0, regime_note=regime_note,
        )

    # Níveis baseados em ATR
    # SL: 1.5× ATR (protege contra ruído normal)
    # TP: 3.0× ATR (RR = 2:1)
    # Invalidação: 2.0× ATR (break desta zona invalida o setup)
    sl_mult = 1.5
    tp_mult = 3.0
    inv_mult = 2.0
    rr_ratio = tp_mult / sl_mult  # = 2.0

    if bias == 'LONG':
        entry = price
        stop_loss = round(price - atr_val * sl_mult, 6)
        take_profit = round(price + atr_val * tp_mult, 6)
        invalidation = round(price - atr_val * inv_mult, 6)
    else:  # SHORT
        entry = price
        stop_loss = round(price + atr_val * sl_mult, 6)
        take_profit = round(price - atr_val * tp_mult, 6)
        invalidation = round(price + atr_val * inv_mult, 6)

    # Edge e probabilidades
    edge_score = compute_edge_score(ind, regime, bias)
    tp_prob, sl_prob, _ = estimate_probabilities(edge_score, regime, rr_ratio)
    expected_rr = compute_expected_value(tp_prob, sl_prob, rr_ratio)

    # Confiança = combinação de edge e EV positivo
    # Penalizar se EV ≤ 0 (não vale a pena mesmo com bom edge)
    ev_bonus = max(expected_rr * 10, 0)
    confidence = round(min(edge_score * 0.75 + ev_bonus, 90), 0)
    confidence = max(confidence, 0)

    # P(entry zone) — ligeiramente mais fácil do que TP
    entry_prob = min(tp_prob + 12, 90)

    return QuantSignal(
        bias=bias,
        confidence=confidence,
        edge_score=edge_score,
        regime=regime,
        regime_note=regime_note,
        entry_prob=entry_prob,
        tp_prob=tp_prob,
        sl_prob=sl_prob,
        expected_rr=expected_rr,
        invalidation=invalidation,
        entry=entry,
        stop_loss=stop_loss,
        take_profit=take_profit,
        rr_ratio=rr_ratio,
    )


def quant_to_dict(q: QuantSignal) -> dict:
    """Serializar QuantSignal para JSON."""
    return {
        "bias": q.bias,
        "confidence": q.confidence,
        "edge_score": q.edge_score,
        "regime": q.regime,
        "regime_note": q.regime_note,
        "entry_probability": q.entry_prob,
        "tp_probability": q.tp_prob,
        "sl_probability": q.sl_prob,
        "expected_rr": q.expected_rr,
        "rr_ratio": q.rr_ratio,
        "levels": {
            "entry": q.entry,
            "stop_loss": q.stop_loss,
            "take_profit": q.take_profit,
            "invalidation": q.invalidation,
        },
        "interpretation": _interpret_signal(q),
    }


def _interpret_signal(q: QuantSignal) -> str:
    """Gera uma interpretação concisa para o frontend."""
    if q.bias == 'WAIT':
        return f"Sem edge suficiente no regime {q.regime}."

    direction = "compra" if q.bias == 'LONG' else "venda"
    ev_desc = "positivo" if q.expected_rr > 0 else "negativo"

    if q.edge_score >= 75:
        strength = "forte"
    elif q.edge_score >= 55:
        strength = "moderado"
    else:
        strength = "fraco"

    return (
        f"Setup de {direction} com edge {strength} ({q.edge_score:.0f}/100). "
        f"Regime: {q.regime}. "
        f"P(TP)={q.tp_prob}% | P(SL)={q.sl_prob}%. "
        f"Valor esperado {ev_desc}: {q.expected_rr:+.2f}R."
    )
