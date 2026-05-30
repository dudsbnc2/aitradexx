"""
Data Fetcher Service
Sources: Hyperliquid (candles), CoinGecko (market data), DexScreener (DEX),
         Alternative.me (Fear & Greed), CryptoPanic (news)
"""
import asyncio
import time
import logging
from typing import Optional
from app.core.clients import get_http_client, cache_get, cache_set
from app.core.config import settings

logger = logging.getLogger("tradeia.data")

HL_URL = "https://api.hyperliquid.xyz/info"
COINGECKO_BASE = "https://api.coingecko.com/api/v3"
DEXSCREENER_BASE = "https://api.dexscreener.com/latest"
GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2"
FEARGREED_URL = "https://api.alternative.me/fng/"
CRYPTOCOMPARE_BASE = "https://min-api.cryptocompare.com/data"

TF_MAP_HL = {"1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "4h", "1D": "1d"}
TF_MAP_CC = {
    "1m": ("histominute", 1), "5m": ("histominute", 5), "15m": ("histominute", 15),
    "1H": ("histohour", 1), "4H": ("histohour", 4), "1D": ("histoday", 1),
}

ALL_PAIRS = [
    # Tier 1 — mega caps
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "BNB/USDT",
    # Tier 2 — large caps
    "DOGE/USDT", "ADA/USDT", "AVAX/USDT", "LINK/USDT", "DOT/USDT",
    "MATIC/USDT", "TON/USDT", "SUI/USDT", "APT/USDT", "NEAR/USDT",
    # Tier 3 — mid caps / trending
    "PEPE/USDT", "WIF/USDT", "BONK/USDT", "FLOKI/USDT", "SHIB/USDT",
    # DeFi / DEX tokens
    "UNI/USDT", "AAVE/USDT", "CRV/USDT", "JUP/USDT", "RAY/USDT",
    # Layer 2 / infra
    "ARB/USDT", "OP/USDT", "STX/USDT", "INJ/USDT", "SEI/USDT",
]

# Pairs used in auto-scan — excludes tokens not on Hyperliquid that always
# fall back to CryptoCompare and hammer the free-tier rate limit.
_CC_ONLY_PAIRS = {"PEPE/USDT", "BONK/USDT", "FLOKI/USDT", "SHIB/USDT", "RAY/USDT", "MATIC/USDT"}
SCAN_PAIRS = [p for p in ALL_PAIRS if p not in _CC_ONLY_PAIRS]

_hl_symbols: set = set()
_hl_symbols_ts: float = 0.0


HL_SYMBOL_ALIASES = {
    "MATIC": "POL",   # rebranded on Hyperliquid
}

def _hl_symbol(pair: str) -> str:
    s = pair.replace("-", "/").split("/")[0].upper()
    for suf in ("-PERP", "PERP", "-USD", "/USD", "-USDT", "/USDT", "USDT"):
        if s.endswith(suf):
            s = s[: -len(suf)]
    s = s.strip()
    return HL_SYMBOL_ALIASES.get(s, s)


async def _hl_post(payload: dict) -> dict:
    c = get_http_client()
    r = await c.post(HL_URL, json=payload, headers={"Content-Type": "application/json"})
    r.raise_for_status()
    return r.json()


async def _hl_available_symbols() -> set:
    global _hl_symbols, _hl_symbols_ts
    if time.time() < _hl_symbols_ts + 300 and _hl_symbols:
        return _hl_symbols
    try:
        data = await _hl_post({"type": "meta"})
        syms = {a["name"] for a in data.get("universe", []) if isinstance(a, dict) and a.get("name")}
        _hl_symbols = syms
        _hl_symbols_ts = time.time()
        return syms
    except Exception as e:
        logger.warning(f"_hl_available_symbols failed: {e}")
        return _hl_symbols


async def fetch_candles_hyperliquid(pair: str, tf: str, limit: int = 150) -> list:
    coin = _hl_symbol(pair)
    syms = await _hl_available_symbols()
    if syms and coin not in syms:
        raise ValueError(f"{coin} not on Hyperliquid")
    interval = TF_MAP_HL.get(tf, "1h")
    tf_ms = {"1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000}
    ms_per = tf_ms.get(interval, 3600000)
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - (ms_per * (limit + 20))
    data = await _hl_post({"type": "candleSnapshot", "req": {
        "coin": coin, "interval": interval, "startTime": start_ms, "endTime": end_ms,
    }})
    if not isinstance(data, list) or len(data) < 5:
        raise ValueError(f"HL: only {len(data) if isinstance(data, list) else 0} candles for {coin}")
    candles = []
    for c in data:
        if not isinstance(c, dict):
            continue
        try:
            candles.append({"o": float(c["o"]), "h": float(c["h"]), "l": float(c["l"]),
                            "c": float(c["c"]), "v": float(c.get("v", 0))})
        except Exception:
            continue
    if len(candles) < 20:
        raise ValueError(f"Not enough HL candles for {pair}")
    return candles[-limit:]


async def fetch_candles_cryptocompare(pair: str, tf: str, limit: int = 150) -> list:
    parts = pair.replace("-", "/").split("/")
    fsym, tsym = parts[0].upper(), (parts[1].upper() if len(parts) > 1 else "USDT")
    endpoint, aggregate = TF_MAP_CC.get(tf, ("histohour", 1))
    url = f"{CRYPTOCOMPARE_BASE}/{endpoint}?fsym={fsym}&tsym={tsym}&limit={limit}&aggregate={aggregate}"
    headers = {}
    if settings.CRYPTOCOMPARE_API_KEY:
        headers["authorization"] = f"Apikey {settings.CRYPTOCOMPARE_API_KEY}"
    c = get_http_client()
    r = await c.get(url, headers=headers)
    r.raise_for_status()
    data = r.json()
    if data.get("Response") == "Error":
        raise ValueError(f"CryptoCompare: {data.get('Message', 'error')}")
    raw = data["Data"].get("Data", []) if isinstance(data.get("Data"), dict) else data.get("Data", [])
    raw = [x for x in raw if isinstance(x, dict) and float(x.get("close", 0)) > 0]
    if len(raw) < 20:
        raise ValueError(f"Not enough CC data for {pair}")
    return [{"o": float(x["open"]), "h": float(x["high"]), "l": float(x["low"]),
             "c": float(x["close"]), "v": float(x.get("volumeto", x.get("volumefrom", 1)))} for x in raw]


async def fetch_candles(pair: str, tf: str, limit: int = 150) -> list:
    cache_key = f"candles:{pair}:{tf}:{limit}"
    cached = await cache_get(cache_key)
    if cached:
        return cached
    try:
        candles = await fetch_candles_hyperliquid(pair, tf, limit)
    except Exception as e_hl:
        logger.warning(f"HL failed {pair}/{tf}: {e_hl} → CryptoCompare")
        candles = await fetch_candles_cryptocompare(pair, tf, limit)
        await cache_set(cache_key, candles, ttl=120)  # longer TTL for CC to avoid rate limits
        return candles
    await cache_set(cache_key, candles, ttl=30)
    return candles


async def get_current_price(pair: str) -> float:
    coin = _hl_symbol(pair)
    try:
        data = await _hl_post({"type": "l2Book", "coin": coin})
        if data is None:
            raise ValueError("Empty response from Hyperliquid")
        levels = data.get("levels", [])
        if len(levels) >= 2:
            bids, asks = levels[0], levels[1]
            bid = float(bids[0]["px"]) if bids and "px" in bids[0] else None
            ask = float(asks[0]["px"]) if asks and "px" in asks[0] else None
            if bid and ask:
                return (bid + ask) / 2
            if bid:
                return bid
            if ask:
                return ask
    except Exception as e:
        logger.warning(f"HL price {pair}: {e}")
    try:
        candles = await fetch_candles(pair, "1m", limit=5)
        return candles[-1]["c"]
    except Exception:
        return 0.0


# ── CoinGecko ────────────────────────────────────────────────────────────────

COIN_ID_MAP = {
    "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana", "XRP": "ripple",
    "DOGE": "dogecoin", "ADA": "cardano", "AVAX": "avalanche-2", "LINK": "chainlink",
    "DOT": "polkadot", "MATIC": "matic-network", "TON": "the-open-network",
    "SUI": "sui", "BNB": "binancecoin", "APT": "aptos", "NEAR": "near",
    "PEPE": "pepe", "SHIB": "shiba-inu", "BONK": "bonk", "WIF": "dogwifcoin",
    "FLOKI": "floki", "UNI": "uniswap", "AAVE": "aave", "CRV": "curve-dao-token",
    "JUP": "jupiter-exchange-solana", "RAY": "raydium",
    "ARB": "arbitrum", "OP": "optimism", "STX": "blockstack",
    "INJ": "injective-protocol", "SEI": "sei-network",
}


async def get_market_overview() -> dict:
    cache_key = "market:overview"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    c = get_http_client()
    try:
        r = await c.get(f"{COINGECKO_BASE}/global")
        r.raise_for_status()
        data = r.json().get("data", {})
        result = {
            "total_market_cap_usd": data.get("total_market_cap", {}).get("usd", 0),
            "total_volume_24h": data.get("total_volume", {}).get("usd", 0),
            "btc_dominance": round(data.get("market_cap_percentage", {}).get("btc", 0), 1),
            "eth_dominance": round(data.get("market_cap_percentage", {}).get("eth", 0), 1),
            "active_cryptocurrencies": data.get("active_cryptocurrencies", 0),
            "market_cap_change_24h": round(data.get("market_cap_change_percentage_24h_usd", 0), 2),
        }
        await cache_set(cache_key, result, ttl=120)
        return result
    except Exception as e:
        logger.warning(f"CoinGecko global: {e}")
        return {}


async def get_trending_coins() -> list:
    cache_key = "market:trending"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    c = get_http_client()
    try:
        r = await c.get(f"{COINGECKO_BASE}/search/trending")
        r.raise_for_status()
        coins = r.json().get("coins", [])
        result = []
        for item in coins[:10]:
            coin = item.get("item", {})
            result.append({
                "id": coin.get("id"),
                "symbol": coin.get("symbol"),
                "name": coin.get("name"),
                "thumb": coin.get("small"),
                "market_cap_rank": coin.get("market_cap_rank"),
                "price_btc": coin.get("price_btc"),
                "score": coin.get("score"),
            })
        await cache_set(cache_key, result, ttl=300)
        return result
    except Exception as e:
        logger.warning(f"CoinGecko trending: {e}")
        return []


async def get_coins_market_data(coins: Optional[list] = None) -> list:
    ids = ",".join(COIN_ID_MAP.get(c, c.lower()) for c in (coins or list(COIN_ID_MAP.keys())[:20]))
    cache_key = f"market:coins:{ids[:50]}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    c = get_http_client()
    try:
        r = await c.get(
            f"{COINGECKO_BASE}/coins/markets",
            params={
                "vs_currency": "usd",
                "ids": ids,
                "order": "market_cap_desc",
                "per_page": 50,
                "page": 1,
                "sparkline": True,
                "price_change_percentage": "1h,24h,7d",
            },
        )
        r.raise_for_status()
        data = r.json()
        await cache_set(cache_key, data, ttl=60)
        return data
    except Exception as e:
        logger.warning(f"CoinGecko markets: {e}")
        return []


# ── Fear & Greed ─────────────────────────────────────────────────────────────

async def get_fear_greed() -> dict:
    cache_key = "market:feargreed"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    c = get_http_client()
    try:
        r = await c.get(FEARGREED_URL, params={"limit": 7})
        r.raise_for_status()
        data = r.json().get("data", [])
        if data:
            latest = data[0]
            result = {
                "value": int(latest.get("value", 50)),
                "classification": latest.get("value_classification", "Neutral"),
                "timestamp": latest.get("timestamp"),
                "history": [{"value": int(d["value"]), "classification": d["value_classification"],
                             "timestamp": d["timestamp"]} for d in data],
            }
            await cache_set(cache_key, result, ttl=3600)
            return result
    except Exception as e:
        logger.warning(f"Fear & Greed: {e}")
    return {"value": 50, "classification": "Neutral", "history": []}


# ── DexScreener ──────────────────────────────────────────────────────────────

async def get_dex_trending() -> list:
    cache_key = "dex:trending"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    c = get_http_client()
    try:
        r = await c.get(f"{DEXSCREENER_BASE}/dex/tokens/trending")
        r.raise_for_status()
        pairs = r.json().get("pairs", [])[:20]
        result = []
        for p in pairs:
            result.append({
                "pair": f"{p.get('baseToken', {}).get('symbol')}/{p.get('quoteToken', {}).get('symbol')}",
                "chain": p.get("chainId"),
                "price_usd": p.get("priceUsd"),
                "volume_24h": p.get("volume", {}).get("h24"),
                "change_24h": p.get("priceChange", {}).get("h24"),
                "liquidity_usd": p.get("liquidity", {}).get("usd"),
                "pair_address": p.get("pairAddress"),
                "dex_id": p.get("dexId"),
            })
        await cache_set(cache_key, result, ttl=120)
        return result
    except Exception as e:
        logger.warning(f"DexScreener trending: {e}")
        return []


async def search_dex_pair(query: str) -> list:
    c = get_http_client()
    try:
        r = await c.get(f"{DEXSCREENER_BASE}/dex/search/?q={query}")
        r.raise_for_status()
        return r.json().get("pairs", [])[:10]
    except Exception as e:
        logger.warning(f"DexScreener search {query}: {e}")
        return []


# ── CryptoPanic News ─────────────────────────────────────────────────────────

async def get_crypto_news(currencies: Optional[str] = None) -> list:
    cache_key = f"news:{currencies or 'general'}"

    cached = await cache_get(cache_key)
    if cached:
        return cached

    c = get_http_client()

    try:
        api_key = settings.NEWSDATA_API_KEY

        if not api_key:
            logger.warning("NEWSDATA_API_KEY missing")
            return []

        params = {
            "apikey": api_key,
            "q": currencies or "bitcoin OR ethereum OR crypto",
            "language": "en",
            "size": 10,
        }

        r = await c.get(
            "https://newsdata.io/api/1/news",
            params=params,
            timeout=20
        )

        data = r.json()

        logger.info(f"News API response: {data}")

        articles = data.get("results", [])

        result = []

        for a in articles:
            result.append({
                "title": a.get("title"),
                "link": a.get("link"),
                "description": a.get("description"),
                "source_id": a.get("source_id"),
                "image_url": a.get("image_url"),
                "pubDate": a.get("pubDate"),
            })

        await cache_set(cache_key, result, ttl=300)

        return result

    except Exception as e:
        logger.warning(f"News fetch failed: {e}")
        return []
