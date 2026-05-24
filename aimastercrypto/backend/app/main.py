"""
AIMasterCrypto — FastAPI Backend v1.0
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.clients import close_http_client, close_redis, get_redis
from app.core.database import init_engine, create_tables
from app.routers import signals, market, auth, admin, ws
from app.websockets.manager import ws_manager, price_broadcaster
from app.services.signal_service import run_scan
from app.services.data_fetcher import ALL_PAIRS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("tradeia")

# ── Background Tasks ─────────────────────────────────────────────────────────

_background_tasks: list = []


async def auto_scan_job():
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    scheduler = AsyncIOScheduler()

    async def _job():
        logger.info(f"Auto-scan {settings.AUTO_SCAN_TF}")
        try:
            result = await run_scan(ALL_PAIRS, settings.AUTO_SCAN_TF, use_mtf=True)
            # Broadcast actionable signals to scanner WS channel
            if result.get("actionable", 0) > 0:
                await ws_manager.broadcast(
                    {"type": "scan_result", "data": result},
                    channel="scanner",
                )
        except Exception as e:
            logger.error(f"Auto-scan error: {e}")

    scheduler.add_job(_job, "interval", minutes=settings.AUTO_SCAN_INTERVAL_MINS, id="auto_scan")
    scheduler.start()
    logger.info(f"Auto-scan scheduled every {settings.AUTO_SCAN_INTERVAL_MINS}min on {settings.AUTO_SCAN_TF}")
    return scheduler


# ── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("AIMasterCrypto starting up")
    init_engine()
    await create_tables()

    # Start price broadcaster background task
    broadcaster = asyncio.create_task(price_broadcaster(ALL_PAIRS))
    _background_tasks.append(broadcaster)

    # Start auto-scan scheduler
    try:
        scheduler = await auto_scan_job()
        _background_tasks.append(scheduler)
    except Exception as e:
        logger.warning(f"Scheduler init failed: {e}")

    logger.info("AIMasterCrypto ready ✓")
    yield

    # Shutdown
    logger.info("Shutting down")
    for task in _background_tasks:
        if hasattr(task, "cancel"):
            task.cancel()
        elif hasattr(task, "shutdown"):
            task.shutdown(wait=False)
    await close_http_client()
    await close_redis()
    logger.info("Shutdown complete")


# ── App ───────────────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="AIMasterCrypto API",
    version=settings.VERSION,
    description="Institutional-grade AI crypto trading platform",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Railway dynamic URLs — restrict in production if needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(signals.router, prefix="/api")
app.include_router(market.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(ws.router)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    try:
        r = await get_redis()
        redis_ok = bool(r)
    except Exception:
        redis_ok = False

    return {
        "status": "ok",
        "version": settings.VERSION,
        "ai": {
            "groq": bool(settings.GROQ_API_KEY),
            "gemini": bool(settings.GEMINI_API_KEY),
            "anthropic": bool(settings.ANTHROPIC_API_KEY),
        },
        "services": {
            "db": bool(settings.DATABASE_URL),
            "redis": redis_ok,
            "telegram": bool(settings.TELEGRAM_TOKEN),
        },
        "ws_connections": ws_manager.total_connections,
    }


@app.get("/")
async def root():
    return JSONResponse({"name": "AIMasterCrypto API", "version": settings.VERSION, "status": "operational"})
