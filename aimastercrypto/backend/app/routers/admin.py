from fastapi import APIRouter, Depends
from app.core.auth import require_admin
from app.core.clients import get_redis
from app.core.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats")
async def admin_stats(admin=Depends(require_admin)):
    r = await get_redis()
    redis_info = {}
    if r:
        try:
            info = await r.info("memory")
            redis_info = {
                "used_memory_human": info.get("used_memory_human"),
                "connected_clients": info.get("connected_clients"),
            }
        except Exception:
            pass

    return {
        "platform": "AIMasterCrypto v1.0",
        "ai_providers": {
            "groq": bool(settings.GROQ_API_KEY),
            "gemini": bool(settings.GEMINI_API_KEY),
            "anthropic": bool(settings.ANTHROPIC_API_KEY),
        },
        "integrations": {
            "telegram": bool(settings.TELEGRAM_TOKEN),
            "db": bool(settings.DATABASE_URL),
            "redis": bool(await get_redis()),
            "cryptopanic": bool(settings.CRYPTOPANIC_API_KEY),
        },
        "scanner": {
            "auto_scan_tf": settings.AUTO_SCAN_TF,
            "auto_scan_interval_mins": settings.AUTO_SCAN_INTERVAL_MINS,
            "min_confidence": settings.MIN_CONFIDENCE_ALERT,
        },
        "redis": redis_info,
    }
