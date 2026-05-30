"""
AIMasterCrypto — FastAPI Backend v7
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.clients import close_http_client, close_redis, get_redis
from app.core.database import init_engine, create_tables
from app.core.logging_config import setup_logging, get_logger
from app.core.security_middleware import SecurityHeadersMiddleware, rate_limit_key, ws_limiter
from app.core.task_manager import task_manager
from app.routers import signals, market, auth, admin, ws
from app.routers.admin_ops import router as admin_ops_router
from app.routers.auth_secure import router as auth_secure_router
from app.routers.billing import router as billing_router
from app.routers.autotrader import router as autotrader_router
from app.websockets.manager import ws_manager, price_broadcaster
from app.services.signal_service import run_scan
from app.services.data_fetcher import ALL_PAIRS, SCAN_PAIRS

# ── Logging ───────────────────────────────────────────────────────────────
setup_logging(
    debug=settings.DEBUG,
    json_output=(settings.ENV == "production"),
)
logger = get_logger("tradeia.main")


# ── Background Tasks ──────────────────────────────────────────────────────

async def _auto_scan_job():
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    scheduler = AsyncIOScheduler()

    async def _job():
        logger.info(f"Auto-scan {settings.AUTO_SCAN_TF}")
        try:
            result = await run_scan(SCAN_PAIRS, settings.AUTO_SCAN_TF, use_mtf=True)
            if result.get("actionable", 0) > 0:
                await ws_manager.broadcast(
                    {"type": "scan_result", "data": result},
                    channel="scanner",
                )
        except Exception as e:
            logger.error(f"Auto-scan error: {e}")

    scheduler.add_job(
        _job, "interval",
        minutes=settings.AUTO_SCAN_INTERVAL_MINS,
        id="auto_scan",
    )
    scheduler.start()
    logger.info(f"Auto-scan every {settings.AUTO_SCAN_INTERVAL_MINS}min on {settings.AUTO_SCAN_TF}")
    return scheduler


# ── Lifespan ──────────────────────────────────────────────────────────────

_schedulers = []

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("AIMasterCrypto v7 starting up")
    init_engine()
    await create_tables()

    task_manager.spawn("price_broadcaster", price_broadcaster(ALL_PAIRS), retry=3)

    try:
        scheduler = await _auto_scan_job()
        _schedulers.append(scheduler)
    except Exception as e:
        logger.warning(f"Scheduler init failed: {e}")

    logger.info("AIMasterCrypto v7 ready ✓")
    yield

    logger.info("Shutting down")
    for scheduler in _schedulers:
        scheduler.shutdown(wait=False)
    await task_manager.shutdown()
    await close_http_client()
    await close_redis()
    logger.info("Shutdown complete")


# ── App ───────────────────────────────────────────────────────────────────

limiter = Limiter(key_func=rate_limit_key)

app = FastAPI(
    title="AIMasterCrypto API",
    version="7.0.0",
    description="Institutional-grade AI crypto trading platform",
    lifespan=lifespan,
    docs_url="/docs" if settings.ENV != "production" else None,
    redoc_url=None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Pydantic v2 can embed non-serializable objects (e.g. ValueError) in the
    # "ctx" field of errors(). Sanitise each error to guarantee JSON safety.
    def _safe(err: dict) -> dict:
        out = {k: v for k, v in err.items() if k != "ctx"}
        if "ctx" in err:
            out["ctx"] = {k: str(v) for k, v in err["ctx"].items()}
        return out

    errors = [_safe(e) for e in exc.errors()]
    try:
        body = await request.body()
        body_str = body.decode("utf-8", errors="replace")[:500]
    except Exception:
        body_str = "<unreadable>"
    logger.warning(
        f"422 Validation error on {request.method} {request.url.path}: "
        f"errors={errors} | body={body_str}"
    )
    return JSONResponse(status_code=422, content={"detail": errors})

app.add_middleware(
    SecurityHeadersMiddleware,
    enable_hsts=(settings.ENV == "production"),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# Routers v7
V1 = "/api/v1"
app.include_router(auth.router,          prefix=V1)
app.include_router(auth_secure_router,   prefix=f"{V1}/auth",   tags=["auth"])
app.include_router(signals.router,       prefix=V1)
app.include_router(market.router,        prefix=V1)
app.include_router(admin.router,         prefix=V1)
app.include_router(admin_ops_router,     prefix=f"{V1}/admin",  tags=["admin"])
app.include_router(billing_router,       prefix=V1)
# Legacy /api prefix para compatibilidade
app.include_router(auth.router,          prefix="/api")
app.include_router(auth_secure_router,   prefix="/api/auth",   tags=["auth"])
app.include_router(signals.router,       prefix="/api")
app.include_router(market.router,        prefix="/api")
app.include_router(admin.router,         prefix="/api")
# AutoTrader — Bybit integration
app.include_router(autotrader_router)
# WebSockets
app.include_router(ws.router)


# ── Health ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    # Each service check is isolated so a single failure can't cause a 500.
    # The endpoint always returns 200; callers inspect the "status" field.
    try:
        r = await get_redis()
        redis_ok = bool(r)
    except Exception as exc:
        logger.warning(f"Health: Redis check failed: {exc}")
        redis_ok = False

    try:
        bg_stats = task_manager.stats
    except Exception as exc:
        logger.warning(f"Health: task_manager.stats failed: {exc}")
        bg_stats = {"error": str(exc)}

    try:
        ws_stats = {
            "total_connections": ws_manager.total_connections,
            **{k: v for k, v in ws_limiter.stats.items() if k != "total_connections"},
        }
    except Exception as exc:
        logger.warning(f"Health: ws stats failed: {exc}")
        ws_stats = {"error": str(exc)}

    return {
        "status": "ok",
        "version": "7.0.0",
        "env": settings.ENV,
        "ai": {
            "groq": bool(settings.GROQ_API_KEY),
            "gemini": bool(settings.GEMINI_API_KEY),
            "anthropic": bool(settings.ANTHROPIC_API_KEY),
        },
        "services": {
            "db": bool(settings.DATABASE_URL),
            "redis": redis_ok,
            "telegram": bool(settings.TELEGRAM_TOKEN),
            "stripe": bool(settings.STRIPE_SECRET_KEY),
        },
        "background_tasks": bg_stats,
        "websockets": ws_stats,
    }


@app.get("/")
async def root():
    return JSONResponse({
        "name": "AIMasterCrypto API",
        "version": "7.0.0",
        "status": "operational",
    })
