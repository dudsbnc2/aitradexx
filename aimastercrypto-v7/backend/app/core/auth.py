import warnings
warnings.filterwarnings("ignore", ".*error reading bcrypt version.*")
warnings.filterwarnings("ignore", ".*trapped.*")

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


# ── Password helpers ──────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── Token creation ────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({
        "exp": expire,
        "type": "access",
        "jti": str(uuid.uuid4()),   # unique token ID (used for blacklist)
    })
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    jti = str(uuid.uuid4())
    to_encode.update({
        "exp": expire,
        "type": "refresh",
        "jti": jti,
    })
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )


# ── Token blacklist (Redis-backed) ────────────────────────────────────────

async def blacklist_token(jti: str, expires_at: datetime):
    """Store a token JTI in Redis so it cannot be reused after logout."""
    try:
        from app.core.clients import get_redis
        r = await get_redis()
        if r:
            ttl = max(int((expires_at - datetime.now(timezone.utc)).total_seconds()), 1)
            await r.setex(f"blacklist:{jti}", ttl, "1")
    except Exception:
        pass  # Redis down → best-effort; DB fallback handles persistence


async def is_token_blacklisted(jti: str) -> bool:
    """Return True if the token JTI has been revoked."""
    if not jti:
        return False
    try:
        from app.core.clients import get_redis
        r = await get_redis()
        if r:
            return bool(await r.exists(f"blacklist:{jti}"))
    except Exception:
        pass
    return False


# ── Dependency helpers ────────────────────────────────────────────────────

def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Optional[dict]:
    if not credentials:
        return None
    try:
        payload = decode_token(credentials.credentials)
        return payload
    except HTTPException:
        return None


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_token(credentials.credentials)


# ── Async variants (check blacklist) ─────────────────────────────────────

async def get_current_user_async(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """Like get_current_user but also checks the Redis blacklist."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    jti = payload.get("jti")
    if jti and await is_token_blacklisted(jti):
        raise HTTPException(status_code=401, detail="Token has been revoked")
    return payload


# ── Role guards ───────────────────────────────────────────────────────────

def require_verified(user: dict = Depends(get_current_user)) -> dict:
    """User must be authenticated AND have verified email."""
    if not user.get("email_verified", False):
        raise HTTPException(status_code=403, detail="Email not verified")
    return user


def require_premium(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("email_verified", False):
        raise HTTPException(status_code=403, detail="Email not verified")
    if user.get("role") not in ("premium", "admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Premium subscription required")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_superadmin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return user
