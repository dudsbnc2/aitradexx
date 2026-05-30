"""
AIMasterCrypto — Signal Staleness V7
=======================================
Calcula a "frescura" de um sinal com base no tempo decorrido e no timeframe.

Um sinal de 1H de há 8 horas está expirado.
Um sinal de 1D de há 8 horas ainda é válido.

INTEGRAÇÃO em signal_service.py:

    from app.services.signal_staleness import compute_signal_staleness, apply_staleness_to_history

    # Ao retornar histórico de sinais:
    signals = apply_staleness_to_history(signals_from_db)

    # Ou individualmente:
    staleness = compute_signal_staleness(signal.created_at, signal.timeframe)
    signal_dict["staleness"] = staleness
"""

from datetime import datetime, timezone
from typing import Optional


# Validade de cada timeframe em horas
# Depois de este tempo, o sinal considera-se expirado (staleness=100%)
TF_VALIDITY_HOURS: dict[str, float] = {
    "1m":  0.25,    # 15 minutos
    "3m":  0.5,     # 30 minutos
    "5m":  1.0,     # 1 hora
    "15m": 2.0,     # 2 horas
    "30m": 4.0,     # 4 horas
    "1H":  8.0,     # 8 horas
    "2H":  16.0,    # 16 horas
    "4H":  24.0,    # 1 dia
    "6H":  36.0,    # 1.5 dias
    "12H": 60.0,    # 2.5 dias
    "1D":  72.0,    # 3 dias
    "3D":  168.0,   # 7 dias
    "1W":  336.0,   # 14 dias
}

# A partir de que % de staleness o sinal é marcado como "stale"
STALE_THRESHOLD_PCT = 50.0

# Ícones/labels para o frontend
FRESHNESS_LEVELS = [
    (0,   25,  "🟢", "fresh",   "Sinal fresco"),
    (25,  50,  "🟡", "aging",   "A envelhecer"),
    (50,  75,  "🟠", "stale",   "Desatualizado"),
    (75,  100, "🔴", "expired", "Expirado"),
]


def compute_signal_staleness(
    created_at: str | datetime,
    timeframe: str,
    now: Optional[datetime] = None,
) -> dict:
    """
    Calcula a frescura de um sinal.

    Args:
        created_at: Timestamp de criação (ISO string ou datetime).
        timeframe: Timeframe do sinal (ex: "1H", "4H", "1D").
        now: Momento actual (para testes; por defeito usa UTC now).

    Returns:
        {
            "fresh": bool,
            "staleness_pct": float,  # 0-100
            "hours_old": float,
            "valid_hours": float,
            "expires_in_hours": float,
            "label": str,
            "icon": str,
            "level": str,  # fresh | aging | stale | expired
        }
    """
    if not created_at:
        return _expired_result(timeframe)

    # Normalizar created_at para datetime
    if isinstance(created_at, str):
        try:
            created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            return _expired_result(timeframe)
    elif isinstance(created_at, datetime):
        created = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
    else:
        return _expired_result(timeframe)

    if now is None:
        now = datetime.now(timezone.utc)

    hours_old = (now - created).total_seconds() / 3600
    valid_hours = TF_VALIDITY_HOURS.get(timeframe, 8.0)

    staleness_pct = min(hours_old / valid_hours * 100, 100.0)
    expires_in = max(0.0, valid_hours - hours_old)
    fresh = staleness_pct < STALE_THRESHOLD_PCT

    # Determinar nível
    icon = "🔴"
    label = "Expirado"
    level = "expired"
    for low, high, ico, lvl, lbl in FRESHNESS_LEVELS:
        if low <= staleness_pct < high:
            icon, level, label = ico, lvl, lbl
            break

    return {
        "fresh": fresh,
        "staleness_pct": round(staleness_pct, 1),
        "hours_old": round(hours_old, 2),
        "valid_hours": valid_hours,
        "expires_in_hours": round(expires_in, 2),
        "label": label,
        "icon": icon,
        "level": level,  # fresh | aging | stale | expired
    }


def apply_staleness_to_history(signals: list[dict]) -> list[dict]:
    """
    Adiciona dados de staleness a uma lista de sinais do histórico.

    Uso:
        history = apply_staleness_to_history(raw_signals_from_db)

    Cada sinal recebe um campo "staleness" com o dict retornado por compute_signal_staleness.
    """
    now = datetime.now(timezone.utc)
    for signal in signals:
        created_at = signal.get("created_at")
        timeframe = signal.get("timeframe", "1H")
        signal["staleness"] = compute_signal_staleness(created_at, timeframe, now=now)
    return signals


def filter_fresh_signals(signals: list[dict]) -> list[dict]:
    """
    Filtra apenas sinais frescos (staleness < 50%).
    Útil para alerts e notificações.
    """
    now = datetime.now(timezone.utc)
    result = []
    for signal in signals:
        staleness = compute_signal_staleness(
            signal.get("created_at"),
            signal.get("timeframe", "1H"),
            now=now,
        )
        if staleness["fresh"]:
            signal["staleness"] = staleness
            result.append(signal)
    return result


# ── Helpers privados ──────────────────────────────────────────────────────────

def _expired_result(timeframe: str) -> dict:
    return {
        "fresh": False,
        "staleness_pct": 100.0,
        "hours_old": 0.0,
        "valid_hours": TF_VALIDITY_HOURS.get(timeframe, 8.0),
        "expires_in_hours": 0.0,
        "label": "Expirado",
        "icon": "🔴",
        "level": "expired",
    }
