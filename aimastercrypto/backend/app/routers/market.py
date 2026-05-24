from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from app.services.data_fetcher import (
    get_market_overview, get_trending_coins, get_coins_market_data,
    get_fear_greed, get_dex_trending, search_dex_pair, get_crypto_news,
    get_current_price, ALL_PAIRS,
)
from app.services.ai_service import get_market_summary

router = APIRouter(prefix="/market", tags=["market"])


@router.get("/overview")
async def overview():
    try:
        data = await get_market_overview()
        fg = await get_fear_greed()
        data["fear_greed"] = fg
        summary = await get_market_summary({**data, "fear_greed": fg})
        data["ai_summary"] = summary
        return data
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/trending")
async def trending():
    try:
        return await get_trending_coins()
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/coins")
async def coins(symbols: Optional[str] = Query(None)):
    try:
        coin_list = symbols.split(",") if symbols else None
        return await get_coins_market_data(coin_list)
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/fear-greed")
async def fear_greed():
    try:
        return await get_fear_greed()
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/dex/trending")
async def dex_trending():
    try:
        return await get_dex_trending()
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/dex/search")
async def dex_search(q: str = Query(..., min_length=1)):
    try:
        return await search_dex_pair(q)
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/news")
async def news(currencies: Optional[str] = Query(None)):
    try:
        return await get_crypto_news(currencies)
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/price/{pair}")
async def price(pair: str):
    try:
        p = await get_current_price(pair.replace("-", "/"))
        return {"pair": pair, "price": p}
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/pairs")
async def pairs():
    return {"pairs": ALL_PAIRS}
