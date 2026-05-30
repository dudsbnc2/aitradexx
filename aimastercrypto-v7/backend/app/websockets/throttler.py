"""
AIMasterCrypto — WebSocket Throttler V7
=========================================
Rate limiting por conexão para evitar flood / DDoS via WebSocket.

INTEGRAÇÃO no ws.py:
    from app.websockets.throttler import ConnectionThrottler

    _throttler = ConnectionThrottler(max_msgs_per_second=5)

    @router.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket, ...):
        conn_id = str(id(websocket))
        while True:
            data = await websocket.receive_text()

            if not _throttler.allow(conn_id):
                await websocket.send_json({
                    "type": "error",
                    "detail": "Rate limit excedido — aguarda um momento"
                })
                continue

            # processar mensagem normalmente...

        # No disconnect:
        _throttler.remove(conn_id)
"""

import time
import logging
from collections import defaultdict
from typing import Optional

logger = logging.getLogger("tradeia.ws_throttler")


class ConnectionThrottler:
    """
    Throttler de mensagens WebSocket por conexão.

    Implementa um sliding window counter:
    - Mantém timestamps das últimas mensagens de cada conexão
    - Recusa mensagens se o rate limit for excedido
    - Limpa automaticamente conexões inativas

    Thread-safe para uso com asyncio (single-threaded event loop).
    """

    def __init__(
        self,
        max_msgs_per_second: int = 5,
        burst_multiplier: float = 2.0,
        cleanup_interval_seconds: float = 60.0,
    ):
        """
        Args:
            max_msgs_per_second: Máximo de mensagens por segundo por conexão.
            burst_multiplier: Permite burst até N× o limite (curto prazo).
            cleanup_interval_seconds: Intervalo de limpeza de conexões mortas.
        """
        self.max_msgs = max_msgs_per_second
        self.burst_limit = int(max_msgs_per_second * burst_multiplier)
        self._cleanup_interval = cleanup_interval_seconds

        # conn_id → lista de timestamps (monotonic)
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._violations: dict[str, int] = defaultdict(int)
        self._last_cleanup = time.monotonic()

        # Estatísticas globais
        self._stats = {
            "total_allowed": 0,
            "total_blocked": 0,
            "total_connections": 0,
        }

    def allow(self, conn_id: str) -> bool:
        """
        Verifica se a conexão pode enviar uma mensagem agora.

        Returns:
            True → mensagem permitida
            False → rate limit excedido, rejeitar
        """
        now = time.monotonic()
        window_start = now - 1.0  # janela de 1 segundo

        # Limpar timestamps fora da janela
        self._windows[conn_id] = [
            t for t in self._windows[conn_id] if t > window_start
        ]

        count = len(self._windows[conn_id])

        # Permitir burst curto mas bloquear flood sustentado
        if count >= self.max_msgs:
            self._violations[conn_id] += 1
            self._stats["total_blocked"] += 1

            # Log apenas nas primeiras violações (evitar log flood)
            if self._violations[conn_id] <= 3:
                logger.warning(
                    f"WS throttle: conn={conn_id[:8]}... "
                    f"msgs={count}/{self.max_msgs} na janela de 1s"
                )

            # Cleanup periódico
            self._maybe_cleanup(now)
            return False

        self._windows[conn_id].append(now)
        self._stats["total_allowed"] += 1
        self._violations[conn_id] = 0  # reset violations ao ter sucesso

        self._maybe_cleanup(now)
        return True

    def remove(self, conn_id: str) -> None:
        """Remover uma conexão quando ela desconecta."""
        self._windows.pop(conn_id, None)
        self._violations.pop(conn_id, None)

    def register(self, conn_id: str) -> None:
        """Registar nova conexão (opcional, para stats)."""
        self._stats["total_connections"] += 1
        self._windows[conn_id] = []

    @property
    def stats(self) -> dict:
        """Métricas para o admin dashboard."""
        return {
            "active_connections": len(self._windows),
            "total_allowed": self._stats["total_allowed"],
            "total_blocked": self._stats["total_blocked"],
            "total_connections_ever": self._stats["total_connections"],
            "block_rate_pct": round(
                self._stats["total_blocked"]
                / max(self._stats["total_allowed"] + self._stats["total_blocked"], 1)
                * 100,
                1,
            ),
        }

    def _maybe_cleanup(self, now: float) -> None:
        """Limpeza periódica de conexões sem actividade recente."""
        if now - self._last_cleanup < self._cleanup_interval:
            return

        self._last_cleanup = now
        cutoff = now - self._cleanup_interval

        dead_conns = [
            conn_id
            for conn_id, timestamps in self._windows.items()
            if not timestamps or max(timestamps) < cutoff
        ]

        for conn_id in dead_conns:
            self._windows.pop(conn_id, None)
            self._violations.pop(conn_id, None)

        if dead_conns:
            logger.debug(f"WS throttler: cleaned up {len(dead_conns)} inactive connections")


# Singleton global — partilhado por todos os WS handlers
ws_throttler = ConnectionThrottler(max_msgs_per_second=5)
