from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.websockets.manager import ws_manager
import logging

logger = logging.getLogger("tradeia.router.ws")
router = APIRouter(tags=["websocket"])


@router.websocket("/ws/prices")
async def ws_prices(websocket: WebSocket, pairs: str = Query("BTC/USDT,ETH/USDT,SOL/USDT")):
    """Real-time price feed for requested pairs."""
    channel = "prices"
    await ws_manager.connect(websocket, channel)
    try:
        # Send welcome message
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "channel": channel,
            "pairs": pairs.split(","),
        })
        while True:
            # Keep alive — data is pushed by price_broadcaster background task
            data = await websocket.receive_text()
            if data == "ping":
                await ws_manager.send_personal(websocket, {"type": "pong"})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, channel)
    except Exception as e:
        logger.warning(f"WS prices error: {e}")
        ws_manager.disconnect(websocket, channel)


@router.websocket("/ws/scanner")
async def ws_scanner(websocket: WebSocket):
    """Real-time scanner signal feed."""
    channel = "scanner"
    await ws_manager.connect(websocket, channel)
    try:
        await ws_manager.send_personal(websocket, {"type": "connected", "channel": channel})
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await ws_manager.send_personal(websocket, {"type": "pong"})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, channel)
    except Exception as e:
        logger.warning(f"WS scanner error: {e}")
        ws_manager.disconnect(websocket, channel)
