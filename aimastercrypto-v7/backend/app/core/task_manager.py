"""
AIMasterCrypto — Task Manager V7
Substitui as _background_tasks frágeis do main.py.

Funcionalidades:
  - Retry automático com backoff exponencial
  - Tracking de todas as tasks activas
  - Logging estruturado por task
  - Shutdown gracioso
  - Stats para o admin dashboard

Uso:
    from app.core.task_manager import task_manager

    # Lançar task simples com retry
    task_manager.spawn("my_task", my_coro(), retry=3)

    # Task com delay (para outcome checks)
    task_manager.spawn_delayed(
        name=f"outcome_{signal_id}",
        coro_factory=check_outcome,
        delay_seconds=3600,
        signal_id=signal_id,
        pair="BTC/USDT",
    )

    # No shutdown do lifespan
    await task_manager.shutdown()
"""
import asyncio
import logging
import time
from collections import defaultdict
from typing import Callable, Awaitable, Any, Optional

logger = logging.getLogger("tradeia.tasks")


class TaskInfo:
    __slots__ = ("name", "started_at", "retries", "last_error")

    def __init__(self, name: str):
        self.name = name
        self.started_at = time.monotonic()
        self.retries = 0
        self.last_error: Optional[str] = None


class TaskManager:
    """
    Gestor de background tasks asyncio com retry, tracking e observabilidade.
    """

    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}
        self._info: dict[str, TaskInfo] = {}
        self._counters = defaultdict(int)

    # ── Spawn ────────────────────────────────────────────────────────────

    def spawn(
        self,
        name: str,
        coro: Awaitable,
        *,
        retry: int = 0,
        retry_delay: float = 5.0,
        retry_backoff: float = 2.0,
    ) -> asyncio.Task:
        """
        Lança uma coroutine como background task com retry opcional.

        Args:
            name:          Identificador único da task.
            coro:          Coroutine a executar.
            retry:         Número máximo de retentativas (0 = sem retry).
            retry_delay:   Delay inicial entre tentativas (segundos).
            retry_backoff: Multiplicador do delay entre tentativas.

        Returns:
            asyncio.Task — pode ser ignorado na maioria dos casos.
        """
        info = TaskInfo(name)
        self._info[name] = info

        async def _runner():
            delay = retry_delay
            for attempt in range(retry + 1):
                try:
                    self._counters["total_started"] += 1
                    if attempt > 0:
                        logger.info(f"[task:{name}] Retry {attempt}/{retry}")
                        self._counters["total_retried"] += 1
                        await asyncio.sleep(delay)
                        delay *= retry_backoff

                    await coro
                    self._counters["total_completed"] += 1
                    logger.debug(f"[task:{name}] Completed")
                    return

                except asyncio.CancelledError:
                    logger.info(f"[task:{name}] Cancelled")
                    self._counters["total_cancelled"] += 1
                    raise

                except Exception as exc:
                    info.last_error = str(exc)
                    info.retries = attempt + 1
                    self._counters["total_failed"] += 1

                    if attempt >= retry:
                        logger.error(
                            f"[task:{name}] Permanently failed after {attempt + 1} attempt(s): {exc}"
                        )
                        return

                    logger.warning(
                        f"[task:{name}] Failed (attempt {attempt + 1}/{retry + 1}): {exc} "
                        f"— retrying in {delay:.1f}s"
                    )

        task = asyncio.create_task(_runner(), name=name)
        self._tasks[name] = task

        def _on_done(t: asyncio.Task):
            self._tasks.pop(name, None)
            self._info.pop(name, None)
            if not t.cancelled() and t.exception():
                logger.debug(f"[task:{name}] Done callback — exception was logged during retry")

        task.add_done_callback(_on_done)
        logger.debug(f"[task:{name}] Spawned (retry={retry})")
        return task

    def spawn_delayed(
        self,
        name: str,
        coro_factory: Callable[..., Awaitable],
        delay_seconds: float,
        **kwargs: Any,
    ) -> asyncio.Task:
        """
        Lança uma coroutine após um delay.
        Útil para outcome checks de sinais.

        Args:
            name:          Identificador único.
            coro_factory:  Função async que aceita **kwargs.
            delay_seconds: Segundos de espera antes de executar.
            **kwargs:      Argumentos passados ao coro_factory.

        Example:
            task_manager.spawn_delayed(
                name=f"outcome_{signal_id}",
                coro_factory=_check_outcome,
                delay_seconds=1800,
                signal_id=signal_id,
                pair=pair,
                timeframe=timeframe,
                bias=bias,
                entry=entry,
                stop_loss=stop_loss,
                take_profit=take_profit,
            )
        """
        async def _delayed_coro():
            await asyncio.sleep(delay_seconds)
            await coro_factory(**kwargs)

        return self.spawn(name, _delayed_coro(), retry=1, retry_delay=30.0)

    def cancel(self, name: str) -> bool:
        """Cancela uma task por nome. Retorna True se encontrada."""
        task = self._tasks.get(name)
        if task and not task.done():
            task.cancel()
            return True
        return False

    # ── Shutdown ─────────────────────────────────────────────────────────

    async def shutdown(self, timeout: float = 15.0) -> None:
        """
        Cancela todas as tasks activas e espera que terminem.
        Chamar no lifespan shutdown.
        """
        tasks = list(self._tasks.values())
        active = [t for t in tasks if not t.done()]

        if not active:
            logger.info("[task_manager] Shutdown — no active tasks")
            return

        logger.info(f"[task_manager] Shutting down {len(active)} active tasks")

        for task in active:
            task.cancel()

        done, pending = await asyncio.wait(active, timeout=timeout)

        if pending:
            logger.warning(f"[task_manager] {len(pending)} tasks did not finish within {timeout}s")

        logger.info(f"[task_manager] Shutdown complete: {len(done)} done, {len(pending)} pending")

    # ── Observabilidade ───────────────────────────────────────────────────

    @property
    def stats(self) -> dict:
        """Retorna métricas para o admin dashboard."""
        active_tasks = []
        for name, info in self._info.items():
            elapsed = time.monotonic() - info.started_at
            active_tasks.append({
                "name": name,
                "running_seconds": round(elapsed, 1),
                "retries": info.retries,
                "last_error": info.last_error,
            })

        return {
            "active_count": len(self._tasks),
            "active_tasks": active_tasks,
            "lifetime_stats": dict(self._counters),
        }

    def __len__(self) -> int:
        return len(self._tasks)

    def __contains__(self, name: str) -> bool:
        return name in self._tasks


# Singleton global — importar e usar em qualquer módulo
task_manager = TaskManager()
