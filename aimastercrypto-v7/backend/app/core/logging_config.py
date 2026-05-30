"""
Structured JSON logging via loguru.
Replace Python's basicConfig with this for production-ready logs.

Usage:
    from app.core.logging_config import setup_logging, get_logger
    setup_logging()
    logger = get_logger("my.module")
    logger.info("signal_generated", pair="BTCUSDT", confidence=92)
"""
import logging
import sys
import json
from datetime import datetime, timezone
from typing import Optional

try:
    from loguru import logger as _loguru_logger
    LOGURU_AVAILABLE = True
except ImportError:
    LOGURU_AVAILABLE = False


# ── Loguru JSON sink ──────────────────────────────────────────────────────

def _json_sink(message):
    """Serialize loguru records to structured JSON for production."""
    record = message.record
    log_entry = {
        "ts": record["time"].astimezone(timezone.utc).isoformat(),
        "level": record["level"].name,
        "logger": record["name"],
        "msg": record["message"],
        "file": f"{record['file'].name}:{record['line']}",
    }
    # Extra context fields (e.g. pair=, user_id=)
    if record["extra"]:
        log_entry.update(record["extra"])
    # Exception info
    if record["exception"]:
        exc = record["exception"]
        log_entry["exc_type"] = str(exc.type.__name__) if exc.type else None
        log_entry["exc_value"] = str(exc.value)
    print(json.dumps(log_entry), file=sys.stdout, flush=True)


# ── Intercept stdlib logging → loguru ─────────────────────────────────────

class _InterceptHandler(logging.Handler):
    """Route all stdlib logging through loguru for unified output."""

    def emit(self, record: logging.LogRecord):
        # Find loguru level
        try:
            level = _loguru_logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Walk stack to find the real caller
        frame, depth = logging.currentframe(), 2
        while frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        _loguru_logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


def setup_logging(debug: bool = False, json_output: bool = True):
    """
    Call once at startup (before any other import uses logging).
    - debug=True → human-readable coloured output
    - json_output=True → structured JSON (for Railway / production)
    """
    if not LOGURU_AVAILABLE:
        # Graceful fallback: standard basicConfig
        logging.basicConfig(
            level=logging.DEBUG if debug else logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        )
        return

    # Remove default loguru handler
    _loguru_logger.remove()

    if debug or not json_output:
        # Pretty coloured output for local dev
        _loguru_logger.add(
            sys.stdout,
            level="DEBUG" if debug else "INFO",
            colorize=True,
            format=(
                "<green>{time:HH:mm:ss}</green> | "
                "<level>{level: <8}</level> | "
                "<cyan>{name}</cyan> | "
                "<level>{message}</level>"
            ),
        )
    else:
        # Structured JSON for production / Railway
        _loguru_logger.add(_json_sink, level="INFO")

    # Intercept all stdlib loggers (fastapi, uvicorn, sqlalchemy…)
    logging.basicConfig(handlers=[_InterceptHandler()], level=0, force=True)
    for name in logging.root.manager.loggerDict:
        logging.getLogger(name).handlers = [_InterceptHandler()]
        logging.getLogger(name).propagate = False


def get_logger(name: str):
    """Return a loguru logger bound to a module name."""
    if LOGURU_AVAILABLE:
        return _loguru_logger.bind(logger=name)
    return logging.getLogger(name)


# ── Audit-specific structured logger ─────────────────────────────────────

def audit_log(
    event: str,
    ip: str = "unknown",
    user: Optional[str] = None,
    detail: Optional[str] = None,
    ok: bool = True,
):
    """
    Emit a structured audit event.
    These are always INFO level and tagged with event_type=AUDIT.
    """
    entry = {
        "event_type": "AUDIT",
        "event": event,
        "status": "OK" if ok else "FAIL",
        "ip": ip,
    }
    if user:
        entry["user"] = user
    if detail:
        entry["detail"] = detail

    if LOGURU_AVAILABLE:
        _loguru_logger.bind(**entry).info(f"[AUDIT] {event}")
    else:
        import json as _json
        print(f"[AUDIT] {_json.dumps(entry)}", flush=True)
