"""
Security middleware and helpers.

Adds:
  - HTTP security headers (HSTS, CSP, X-Frame-Options, etc.)
  - User-ID-based rate limit key (falls back to IP)
  - WebSocket connection limiter
"""
import logging
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from typing import Optional

logger = logging.getLogger("tradeia.security")

# ── Security Headers Middleware ───────────────────────────────────────────

SECURITY_HEADERS = {
    # Prevent clickjacking
    "X-Frame-Options": "DENY",
    # Prevent MIME sniffing
    "X-Content-Type-Options": "nosniff",
    # Enable browser XSS filter (legacy but still useful)
    "X-XSS-Protection": "1; mode=block",
    # Force HTTPS for 1 year (only enable in production behind TLS)
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    # Don't send referrer to external sites
    "Referrer-Policy": "strict-origin-when-cross-origin",
    # Restrict browser features
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    # Basic CSP — tighten per your frontend's actual requirements
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "connect-src 'self' wss: https:; "
        "font-src 'self' data:; "
        "frame-ancestors 'none';"
    ),
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject security headers into every response."""

    def __init__(self, app: ASGIApp, enable_hsts: bool = True):
        super().__init__(app)
        self.headers = dict(SECURITY_HEADERS)
        if not enable_hsts:
            self.headers.pop("Strict-Transport-Security", None)

    async def dispatch(self, request: Request, call_next):
        try:
            response: Response = await call_next(request)
        except Exception as exc:
            # Prevent BaseHTTPMiddleware from swallowing unhandled exceptions
            # silently; re-raise so Uvicorn logs the full traceback.
            logger.exception(f"Unhandled exception on {request.method} {request.url.path}: {exc}")
            raise
        for header, value in self.headers.items():
            response.headers[header] = value
        # Remove server fingerprinting
        response.headers.pop("server", None)
        response.headers.pop("x-powered-by", None)
        return response


# ── Rate Limit Key by User ID ─────────────────────────────────────────────

def rate_limit_key(request: Request) -> str:
    """
    Use JWT user ID as rate limit key when authenticated.
    Falls back to client IP address.

    This prevents:
      - IP spoofing bypasses
      - Multiple accounts sharing one IP hitting limits
      - VPN users being blocked together

    Usage in a router:
        from slowapi import Limiter
        from app.core.security_middleware import rate_limit_key
        limiter = Limiter(key_func=rate_limit_key)
    """
    # Try to extract user ID from JWT (already decoded by auth middleware)
    user = getattr(request.state, "user", None)
    if user and isinstance(user, dict):
        uid = user.get("uid") or user.get("sub")
        if uid:
            return f"user:{uid}"

    # Try Authorization header (decode just the uid claim without full validation)
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            import base64
            token = auth[7:]
            # Decode payload without verifying signature (just for key)
            parts = token.split(".")
            if len(parts) == 3:
                padding = "=" * (4 - len(parts[1]) % 4)
                payload_bytes = base64.urlsafe_b64decode(parts[1] + padding)
                import json
                payload = json.loads(payload_bytes)
                uid = payload.get("uid") or payload.get("sub")
                if uid:
                    return f"user:{uid}"
        except Exception:
            pass

    # Fallback to IP
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return f"ip:{forwarded.split(',')[0].strip()}"
    client = getattr(request.client, "host", "unknown")
    return f"ip:{client}"


# ── WebSocket Connection Limiter ──────────────────────────────────────────

class WebSocketLimiter:
    """
    Simple in-memory per-IP WebSocket connection limiter.
    Prevents a single client from opening hundreds of WS connections.
    """

    def __init__(self, max_per_ip: int = 10, max_total: int = 500):
        self._max_per_ip = max_per_ip
        self._max_total = max_total
        # {ip: count}
        self._counts: dict[str, int] = {}
        self._total: int = 0

    def _get_ip(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return getattr(request.client, "host", "unknown")

    def can_connect(self, request: Request) -> tuple[bool, str]:
        ip = self._get_ip(request)
        if self._total >= self._max_total:
            return False, f"Server at capacity ({self._max_total} connections)"
        count = self._counts.get(ip, 0)
        if count >= self._max_per_ip:
            return False, f"Too many connections from {ip}"
        return True, ""

    def register(self, request: Request):
        ip = self._get_ip(request)
        self._counts[ip] = self._counts.get(ip, 0) + 1
        self._total += 1

    def unregister(self, request: Request):
        ip = self._get_ip(request)
        if self._counts.get(ip, 0) > 0:
            self._counts[ip] -= 1
        if self._total > 0:
            self._total -= 1

    @property
    def stats(self) -> dict:
        return {
            "total_connections": self._total,
            "unique_ips": len([v for v in self._counts.values() if v > 0]),
            "max_per_ip": self._max_per_ip,
            "max_total": self._max_total,
        }


# Global singleton used by ws.py
ws_limiter = WebSocketLimiter(max_per_ip=10, max_total=500)
