import httpx
import redis.asyncio as aioredis
import json
import logging
from typing import Optional, Any
from app.core.config import settings

logger = logging.getLogger("tradeia.clients")

# ── HTTP Client ─────────────────────────────────────────────────────────────

_http_client: Optional[httpx.AsyncClient] = None


def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=30,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=30),
            headers={"User-Agent": "AIMasterCrypto/1.0"},
        )
    return _http_client


async def close_http_client():
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


# ── Redis Cache ──────────────────────────────────────────────────────────────

_redis: Optional[aioredis.Redis] = None


async def get_redis() -> Optional[aioredis.Redis]:
    global _redis
    if _redis is None:
        try:
            _redis = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
            )
            await _redis.ping()
            logger.info("Redis connected")
        except Exception as e:
            logger.warning(f"Redis unavailable: {e}")
            _redis = None
    return _redis


async def cache_get(key: str) -> Optional[Any]:
    r = await get_redis()
    if not r:
        return None
    try:
        val = await r.get(key)
        return json.loads(val) if val else None
    except Exception as e:
        logger.debug(f"cache_get error {key}: {e}")
        return None


async def cache_set(key: str, value: Any, ttl: int = 60):
    r = await get_redis()
    if not r:
        return
    try:
        await r.setex(key, ttl, json.dumps(value))
    except Exception as e:
        logger.debug(f"cache_set error {key}: {e}")


async def close_redis():
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None
