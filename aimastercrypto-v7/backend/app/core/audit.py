"""
Audit logger — structured security event log.
All sensitive actions (login, register, scan, admin) are written here
so they can be monitored, exported to a SIEM, or simply grepped.

Format:  [AUDIT] EVENT | ip=x.x.x.x | user=x | detail=x
"""
import logging
import json
from datetime import datetime, timezone
from typing import Optional
from fastapi import Request

_audit = logging.getLogger("tradeia.audit")

# Ensure audit logs always appear even if root logger is set to WARNING
if not _audit.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("[AUDIT] %(message)s"))
    _audit.addHandler(_h)
_audit.setLevel(logging.INFO)
_audit.propagate = False


def _ip(request: Optional[Request]) -> str:
    if not request:
        return "unknown"
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return getattr(request.client, "host", "unknown")


def log(
    event: str,
    request: Optional[Request] = None,
    user: Optional[str] = None,
    detail: Optional[str] = None,
    ok: bool = True,
):
    parts = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "status": "OK" if ok else "FAIL",
        "ip": _ip(request),
    }
    if user:
        parts["user"] = user
    if detail:
        parts["detail"] = detail
    _audit.info(json.dumps(parts))


# ── Convenience wrappers ───────────────────────────────────────────────────

def login_ok(request: Request, email: str):
    log("LOGIN", request, user=email, ok=True)

def login_fail(request: Request, email: str):
    log("LOGIN_FAIL", request, user=email, ok=False)

def register_ok(request: Request, email: str, role: str):
    log("REGISTER", request, user=email, detail=f"role={role}", ok=True)

def verify_ok(request: Request, email: str):
    log("EMAIL_VERIFY", request, user=email, ok=True)

def verify_fail(request: Request, email: str, reason: str):
    log("EMAIL_VERIFY_FAIL", request, user=email, detail=reason, ok=False)

def scan_requested(request: Request, user: str, timeframe: str, pairs_count: int):
    log("SCAN", request, user=user, detail=f"tf={timeframe} pairs={pairs_count}", ok=True)

def signal_requested(request: Request, user: str, pair: str, tf: str):
    log("SIGNAL", request, user=user, detail=f"{pair}/{tf}", ok=True)

def admin_action(request: Request, user: str, action: str):
    log("ADMIN", request, user=user, detail=action, ok=True)

def access_denied(request: Request, user: str, endpoint: str):
    log("ACCESS_DENIED", request, user=user, detail=endpoint, ok=False)
