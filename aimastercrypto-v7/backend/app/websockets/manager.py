"""
WebSocket Manager
Manages real-time connections and broadcasts price updates.
"""
import asyncio
import json
import logging
from typing import Dict, Set
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("tradeia.ws")


class ConnectionManager:
    def __init__(self):
        # {channel: {websocket, ...}}
        self._channels: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, channel: str = "global"):
        await websocket.accept()
        if channel not in self._channels:
            self._channels[channel] = set()
        self._channels[channel].add(websocket)
        logger.info(f"WS connected: {channel} (total={self._count(channel)})")

    def disconnect(self, websocket: WebSocket, channel: str = "global"):
        if channel in self._channels:
            self._channels[channel].discard(websocket)
        logger.info(f"WS disconnected: {channel} (total={self._count(channel)})")

    def _count(self, channel: str) -> int:
        return len(self._channels.get(channel, set()))

    async def broadcast(self, data: dict, channel: str = "global"):
        message = json.dumps(data)
        dead: Set[WebSocket] = set()
        for ws in list(self._channels.get(channel, set())):
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._channels.get(channel, set()).discard(ws)

    async def broadcast_all(self, data: dict):
        """Broadcast to all channels."""
        for channel in list(self._channels.keys()):
            await self.broadcast(data, channel)

    async def send_personal(self, websocket: WebSocket, data: dict):
        try:
            await websocket.send_text(json.dumps(data))
        except Exception as e:
            logger.warning(f"WS personal send error: {e}")

    @property
    def total_connections(self) -> int:
        return sum(len(v) for v in self._channels.values())


# Global singleton
ws_manager = ConnectionManager()


async def price_broadcaster(pairs: list):
    """Background task: fetches prices and broadcasts every 5 seconds."""
    from app.services.data_fetcher import get_current_price
    while True:
        try:
            if ws_manager.total_connections > 0:
                prices = {}
                for pair in pairs:
                    try:
                        price = await get_current_price(pair)
                        if price > 0:
                            prices[pair] = price
                    except Exception:
                        pass
                if prices:
                    await ws_manager.broadcast_all({
                        "type": "prices",
                        "data": prices,
                    })
        except Exception as e:
            logger.warning(f"Price broadcaster: {e}")
        await asyncio.sleep(5)
