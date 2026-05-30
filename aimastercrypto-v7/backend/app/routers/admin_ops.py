"""
AIMasterCrypto — Admin Operations V7
=======================================
Endpoints de observabilidade operacional para o admin panel.

INTEGRAÇÃO no admin.py existente:
    from app.routers.admin_ops import router as admin_ops_router

    # Adicionar ao router de admin existente OU incluir separadamente:
    app.include_router(admin_ops_router, prefix="/api/v1/admin", tags=["admin"])

Endpoints adicionados:
  GET /admin/operations        — métricas em tempo real (tasks, WS, Redis)
  GET /admin/signals/analytics — performance de sinais por timeframe e par
  GET /admin/health            — health check completo
"""

import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case

from app.core.database import get_db
from app.core.config import settings

# Ajustar import do teu Depends de admin
try:
    from app.core.auth import require_admin
except ImportError:
    from app.core.auth import get_current_user_async as require_admin

logger = logging.getLogger("tradeia.admin_ops")
router = APIRouter()


# ── Helpers de import lazy ────────────────────────────────────────────────────

def _get_task_manager():
    try:
        from app.core.task_manager import task_manager
        return task_manager
    except ImportError:
        return None


def _get_ws_throttler():
    try:
        from app.websockets.throttler import ws_throttler
        return ws_throttler
    except ImportError:
        return None


async def _get_redis_info() -> dict:
    try:
        from app.core.clients import get_redis
        r = await get_redis()
        if not r:
            return {"available": False}
        info = await r.info()
        db_size = await r.dbsize()
        return {
            "available": True,
            "connected_clients": info.get("connected_clients", 0),
            "used_memory_human": info.get("used_memory_human", "?"),
            "total_commands_processed": info.get("total_commands_processed", 0),
            "keyspace_hits": info.get("keyspace_hits", 0),
            "keyspace_misses": info.get("keyspace_misses", 0),
            "hit_rate_pct": round(
                info.get("keyspace_hits", 0)
                / max(info.get("keyspace_hits", 0) + info.get("keyspace_misses", 1), 1)
                * 100,
                1,
            ),
            "total_keys": db_size,
            "uptime_seconds": info.get("uptime_in_seconds", 0),
        }
    except Exception as e:
        return {"available": False, "error": str(e)}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/operations")
async def operations_dashboard(
    admin=Depends(require_admin),
):
    """
    Dashboard de métricas operacionais em tempo real.

    Inclui:
      - Background tasks activas (task_manager)
      - WebSocket connections e throttling stats
      - Redis stats
      - AI providers configurados
    """
    task_manager = _get_task_manager()
    ws_throttler = _get_ws_throttler()
    redis_info = await _get_redis_info()

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "background_tasks": task_manager.stats if task_manager else {"error": "task_manager não disponível"},
        "websockets": ws_throttler.stats if ws_throttler else {"error": "ws_throttler não disponível"},
        "redis": redis_info,
        "ai_providers": {
            "groq": bool(getattr(settings, "GROQ_API_KEY", "")),
            "gemini": bool(getattr(settings, "GEMINI_API_KEY", "")),
            "anthropic": bool(getattr(settings, "ANTHROPIC_API_KEY", "")),
            "openai": bool(getattr(settings, "OPENAI_API_KEY", "")),
        },
        "config": {
            "access_token_expire_minutes": getattr(settings, "ACCESS_TOKEN_EXPIRE_MINUTES", "?"),
            "environment": getattr(settings, "ENV", getattr(settings, "ENVIRONMENT", "unknown")),
            "stripe_configured": bool(getattr(settings, "STRIPE_SECRET_KEY", "")),
        },
    }


@router.get("/signals/analytics")
async def signal_analytics(
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    days: int = Query(30, ge=1, le=365, description="Número de dias para análise"),
):
    """
    Análise de performance de sinais.

    Retorna:
      - Win rate por timeframe
      - Top pares por volume de sinais
      - Confidence médio e qualidade por timeframe
    """
    if db is None:
        raise HTTPException(503, "Base de dados não configurada")

    # Importar modelo Signal — ajustar path se necessário
    try:
        from app.core.database import Signal
    except ImportError:
        try:
            from app.models.signal import Signal
        except ImportError:
            raise HTTPException(503, "Modelo Signal não encontrado — ajustar import em admin_ops.py")

    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Win rate por timeframe
    tf_result = await db.execute(
        select(
            Signal.timeframe,
            func.count(Signal.id).label("total"),
            func.sum(case((Signal.result == "WIN", 1), else_=0)).label("wins"),
            func.sum(case((Signal.result == "LOSS", 1), else_=0)).label("losses"),
            func.avg(Signal.confidence).label("avg_confidence"),
            func.avg(Signal.quality_score).label("avg_quality"),
        )
        .where(Signal.created_at >= since)
        .group_by(Signal.timeframe)
        .order_by(func.count(Signal.id).desc())
    )
    tf_rows = tf_result.all()

    # Top pares por volume
    pair_result = await db.execute(
        select(
            Signal.pair,
            func.count(Signal.id).label("total"),
            func.sum(case((Signal.result == "WIN", 1), else_=0)).label("wins"),
            func.avg(Signal.confidence).label("avg_confidence"),
        )
        .where(Signal.created_at >= since)
        .group_by(Signal.pair)
        .order_by(func.count(Signal.id).desc())
        .limit(15)
    )
    pair_rows = pair_result.all()

    # Totais gerais
    total_result = await db.execute(
        select(
            func.count(Signal.id).label("total"),
            func.sum(case((Signal.result == "WIN", 1), else_=0)).label("wins"),
            func.sum(case((Signal.result == "LOSS", 1), else_=0)).label("losses"),
            func.avg(Signal.confidence).label("avg_confidence"),
        )
        .where(Signal.created_at >= since)
    )
    total_row = total_result.one()

    total = total_row.total or 0
    wins = int(total_row.wins or 0)
    losses = int(total_row.losses or 0)
    resolved = wins + losses

    return {
        "period_days": days,
        "summary": {
            "total_signals": total,
            "wins": wins,
            "losses": losses,
            "pending": total - resolved,
            "win_rate_pct": round(wins / max(resolved, 1) * 100, 1),
            "avg_confidence": round(float(total_row.avg_confidence or 0), 1),
        },
        "by_timeframe": [
            {
                "timeframe": r.timeframe,
                "total": r.total,
                "wins": int(r.wins or 0),
                "losses": int(r.losses or 0),
                "win_rate_pct": round(int(r.wins or 0) / max(int(r.wins or 0) + int(r.losses or 0), 1) * 100, 1),
                "avg_confidence": round(float(r.avg_confidence or 0), 1),
                "avg_quality": round(float(r.avg_quality or 0), 1),
            }
            for r in tf_rows
        ],
        "top_pairs": [
            {
                "pair": r.pair,
                "total": r.total,
                "wins": int(r.wins or 0),
                "win_rate_pct": round(int(r.wins or 0) / max(r.total, 1) * 100, 1),
                "avg_confidence": round(float(r.avg_confidence or 0), 1),
            }
            for r in pair_rows
        ],
    }


@router.get("/health")
async def health_check(admin=Depends(require_admin)):
    """
    Health check completo do sistema.
    Útil para monitorizar em produção (Uptime Kuma, etc.).
    """
    checks = {}

    # Redis
    redis_info = await _get_redis_info()
    checks["redis"] = "ok" if redis_info.get("available") else "fail"

    # Task manager
    tm = _get_task_manager()
    checks["task_manager"] = "ok" if tm is not None else "not_configured"

    # WS throttler
    wst = _get_ws_throttler()
    checks["ws_throttler"] = "ok" if wst is not None else "not_configured"

    # Stripe
    checks["stripe"] = "configured" if getattr(settings, "STRIPE_SECRET_KEY", "") else "not_configured"

    # AI
    ai_keys = {
        k: bool(getattr(settings, k, ""))
        for k in ["GROQ_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"]
    }
    checks["ai_providers"] = sum(ai_keys.values())

    all_ok = all(v in ("ok", "not_configured", "configured") for v in checks.values() if isinstance(v, str))

    return {
        "status": "ok" if all_ok else "degraded",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }
