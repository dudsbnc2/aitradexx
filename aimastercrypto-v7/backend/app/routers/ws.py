"""
WebSocket routes with:
  - JWT token authentication (query param or header)
  - Per-IP connection limits
  - Heartbeat / ping-pong
  - Premium-only scanner channel
"""
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from app.websockets.manager import ws_manager
from app.core.auth import decode_token
from app.core.security_middleware import ws_limiter
from app.websockets.throttler import ws_throttler  # V7: rate limit por mensagem

logger = logging.getLogger("tradeia.router.ws")
router = APIRouter(tags=["websocket"])

HEARTBEAT_INTERVAL = 30  # seconds


def _authenticate_ws(token: str | None) -> dict | None:
    """Validate Bearer token from WS query param. Returns payload or None."""
    if not token:
        return None
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        return payload
    except Exception:
        return None


@router.websocket("/ws/prices")
async def ws_prices(
    websocket: WebSocket,
    pairs: str = Query("BTC/USDT,ETH/USDT,SOL/USDT"),
    token: str | None = Query(None),
):
    """
    Real-time price feed.
    Token is optional for prices — public channel.
    Connection limits still apply.
    """
    ok, reason = ws_limiter.can_connect(websocket)
    if not ok:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=reason)
        return

    channel = "prices"
    ws_limiter.register(websocket)
    ws_throttler.register(str(id(websocket)))  # V7
    await ws_manager.connect(websocket, channel)

    user = _authenticate_ws(token)
    user_info = user.get("username", "anonymous") if user else "anonymous"

    try:
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "channel": channel,
            "pairs": pairs.split(","),
            "user": user_info,
            "authenticated": user is not None,
        })

        while True:
            try:
                data = await websocket.receive_text()
                # V7: rate limit por mensagem
                if not ws_throttler.allow(str(id(websocket))):
                    await ws_manager.send_personal(websocket, {
                        "type": "error", "code": "RATE_LIMITED",
                        "detail": "Demasiadas mensagens — aguarda um momento"
                    })
                    continue
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
            except WebSocketDisconnect:
                break

    except Exception as e:
        logger.warning(f"WS prices error [{user_info}]: {e}")
    finally:
        ws_manager.disconnect(websocket, channel)
        ws_limiter.unregister(websocket)
        ws_throttler.remove(str(id(websocket)))  # V7
        ws_throttler.remove(str(id(websocket)))  # V7


@router.websocket("/ws/scanner")
async def ws_scanner(
    websocket: WebSocket,
    token: str | None = Query(None),
):
    """
    Real-time scanner signal feed.
    REQUIRES valid JWT — premium/admin only.
    """
    # Connection limit check first (before auth, to defend against auth flood)
    ok, reason = ws_limiter.can_connect(websocket)
    if not ok:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=reason)
        return

    # Auth check
    user = _authenticate_ws(token)
    if not user:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Authentication required for scanner feed",
        )
        return

    # Role check — scanner is premium+
    role = user.get("role", "free")
    if role not in ("premium", "admin", "superadmin"):
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Premium subscription required",
        )
        return

    channel = "scanner"
    ws_limiter.register(websocket)
    ws_throttler.register(str(id(websocket)))  # V7
    await ws_manager.connect(websocket, channel)

    try:
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "channel": channel,
            "user": user.get("username"),
            "role": role,
        })

        while True:
            try:
                data = await websocket.receive_text()
                # V7: rate limit por mensagem
                if not ws_throttler.allow(str(id(websocket))):
                    await ws_manager.send_personal(websocket, {
                        "type": "error", "code": "RATE_LIMITED",
                        "detail": "Demasiadas mensagens — aguarda um momento"
                    })
                    continue
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
            except WebSocketDisconnect:
                break

    except Exception as e:
        logger.warning(f"WS scanner error [{user.get('username')}]: {e}")
    finally:
        ws_manager.disconnect(websocket, channel)
        ws_limiter.unregister(websocket)
        ws_throttler.remove(str(id(websocket)))  # V7


@router.websocket("/ws/alerts")
async def ws_alerts(
    websocket: WebSocket,
    token: str | None = Query(None),
):
    """
    Personal alerts feed (price alerts, signal triggers).
    REQUIRES valid JWT. Messages are user-scoped.
    """
    ok, reason = ws_limiter.can_connect(websocket)
    if not ok:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=reason)
        return

    user = _authenticate_ws(token)
    if not user:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Authentication required",
        )
        return

    # Each user gets their own personal channel
    user_id = user.get("uid")
    channel = f"alerts:user:{user_id}"

    ws_limiter.register(websocket)
    ws_throttler.register(str(id(websocket)))  # V7
    await ws_manager.connect(websocket, channel)

    try:
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "channel": "alerts",
            "user": user.get("username"),
        })

        while True:
            try:
                data = await websocket.receive_text()
                # V7: rate limit por mensagem
                if not ws_throttler.allow(str(id(websocket))):
                    await ws_manager.send_personal(websocket, {
                        "type": "error", "code": "RATE_LIMITED",
                        "detail": "Demasiadas mensagens — aguarda um momento"
                    })
                    continue
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
            except WebSocketDisconnect:
                break

    except Exception as e:
        logger.warning(f"WS alerts error [{user.get('username')}]: {e}")
    finally:
        ws_manager.disconnect(websocket, channel)
        ws_limiter.unregister(websocket)
