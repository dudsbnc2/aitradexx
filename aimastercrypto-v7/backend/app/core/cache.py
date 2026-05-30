"""
Redis cache layer for FastAPI.

Usage (in a router):

    from app.core.cache import cache_response

    @router.get("/market/overview")
    @cache_response(ttl=30, key_prefix="market:overview")
    async def overview():
        ...

The decorator serialises the return value to JSON, stores it in Redis
with the given TTL (seconds), and returns the cached copy on subsequent
calls — bypassing the handler entirely.

Key format:  cache:{key_prefix}:{extra_args}
             e.g. cache:market:overview
                  cache:signal:BTCUSDT:1H

Cache is bypassed (falls through to the real handler) when:
  - Redis is unavailable
  - The cached value is missing or expired
  - DEBUG mode forces a bypass (set CACHE_BYPASS=true in env)
"""
import json
import functools
import hashlib
import logging
from typing import Callable, Optional, Any

from app.core.clients import get_redis

logger = logging.getLogger("tradeia.cache")

# ── TTL presets (seconds) — match the analysis recommendations ────────────
TTL_PRICES       = 5        # live prices — very short
TTL_MARKET       = 30       # market overview
TTL_FEAR_GREED   = 300      # fear & greed index — 5 min
TTL_SCANNER      = 45       # scanner results
TTL_NEWS         = 120      # news feed — 2 min
TTL_AI_ANALYSIS  = 600      # AI market summary — 10 min
TTL_TRENDING     = 120      # trending coins
TTL_INDICATORS   = 30       # indicator values per pair


def _build_key(prefix: str, *args, **kwargs) -> str:
    """Build a deterministic Redis key from prefix + call arguments."""
    raw = f"{prefix}:{args}:{sorted(kwargs.items())}"
    digest = hashlib.md5(raw.encode()).hexdigest()[:8]
    return f"cache:{prefix}:{digest}"


def cache_response(
    ttl: int = TTL_MARKET,
    key_prefix: str = "generic",
    skip_if_none: bool = True,
):
    """
    Async-function decorator that caches the return value in Redis.

    Parameters
    ----------
    ttl         : Cache lifetime in seconds.
    key_prefix  : Namespaces the key (e.g. "market:overview").
    skip_if_none: Don't cache None / empty responses.
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Build cache key (ignore FastAPI dependency-injected objects)
            safe_kwargs = {
                k: v for k, v in kwargs.items()
                if isinstance(v, (str, int, float, bool, type(None)))
            }
            key = _build_key(key_prefix, *args, **safe_kwargs)

            # ── Try cache read ────────────────────────────────────────────
            try:
                r = await get_redis()
                if r:
                    cached = await r.get(key)
                    if cached:
                        logger.debug(f"Cache HIT: {key}")
                        return json.loads(cached)
            except Exception as e:
                logger.warning(f"Cache read error ({key}): {e}")

            # ── Cache miss — call the real handler ────────────────────────
            result = await func(*args, **kwargs)

            # ── Write to cache ─────────────────────────────────────────────
            if result is not None or not skip_if_none:
                try:
                    r = await get_redis()
                    if r:
                        await r.setex(key, ttl, json.dumps(result, default=str))
                        logger.debug(f"Cache SET: {key} (ttl={ttl}s)")
                except Exception as e:
                    logger.warning(f"Cache write error ({key}): {e}")

            return result

        return wrapper
    return decorator


async def invalidate_prefix(prefix: str):
    """Delete all cache keys starting with cache:{prefix}."""
    try:
        r = await get_redis()
        if r:
            pattern = f"cache:{prefix}:*"
            cursor = 0
            deleted = 0
            while True:
                cursor, keys = await r.scan(cursor, match=pattern, count=100)
                if keys:
                    await r.delete(*keys)
                    deleted += len(keys)
                if cursor == 0:
                    break
            logger.info(f"Cache invalidated {deleted} keys matching {pattern}")
            return deleted
    except Exception as e:
        logger.warning(f"Cache invalidation error: {e}")
        return 0


async def cache_set(key: str, value: Any, ttl: int = 60):
    """Low-level helper to set an arbitrary cache value."""
    try:
        r = await get_redis()
        if r:
            await r.setex(f"cache:{key}", ttl, json.dumps(value, default=str))
    except Exception as e:
        logger.warning(f"cache_set error: {e}")


async def cache_get(key: str) -> Optional[Any]:
    """Low-level helper to get an arbitrary cache value."""
    try:
        r = await get_redis()
        if r:
            raw = await r.get(f"cache:{key}")
            if raw:
                return json.loads(raw)
    except Exception as e:
        logger.warning(f"cache_get error: {e}")
    return None
