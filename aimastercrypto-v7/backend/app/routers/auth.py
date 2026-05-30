"""
Auth router — PostgreSQL-backed with email OTP verification.
"""
import json
import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, field_validator
import re as _re
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user,
)
from app.core.database import get_db, User, EmailVerification, LoginAttempt
from app.core.config import get_admin_emails, settings
from app.core.email_service import send_verification_email
from app.core import audit

router = APIRouter(prefix="/auth", tags=["auth"])

OTP_EXPIRE_MINUTES = 10
MAX_OTP_ATTEMPTS = 5
MAX_RESEND_COUNT = 3


# ── Schemas ───────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    username: Optional[str] = None  # optional — auto-derived from email if missing
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email address")
        # Block disposable/fake domains
        domain = v.split("@")[-1]
        _blocked = {"mailinator.com", "trashmail.com", "guerrillamail.com",
                    "tempmail.com", "throwam.com", "yopmail.com", "sharklasers.com"}
        if domain in _blocked:
            raise ValueError("Disposable email addresses are not allowed")
        return v

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:  # empty string after strip → treat as absent
            return None
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters")
        if len(v) > 30:
            raise ValueError("Username must be at most 30 characters")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v

class LoginRequest(BaseModel):
    email: str
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

class VerifyEmailRequest(BaseModel):
    email: str
    code: str

class ResendCodeRequest(BaseModel):
    email: str


# ── Helpers ────────────────────────────────────────────────────────────────

def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()

def _generate_otp() -> str:
    return f"{secrets.randbelow(1000000):06d}"

def _make_token(user: User) -> tuple[str, str]:
    data = {
        "sub": user.email,
        "uid": user.id,
        "username": user.username,
        "role": user.role,
        "email_verified": user.email_verified,
        "type": "access",   # ← prevents refresh tokens being used as access tokens
    }
    access = create_access_token(data)
    refresh = create_refresh_token({"sub": user.email, "uid": user.id, "type": "refresh"})
    return access, refresh

def _user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "role": user.role,
        "email_verified": user.email_verified,
    }


# ── In-memory fallback (DB not configured) ────────────────────────────────
# No hardcoded credentials. Admin access requires DATABASE_URL + ADMIN_EMAILS env var.
_mem_users: dict = {}


# ── Routes ─────────────────────────────────────────────────────────────────

@router.post("/register-debug")
async def register_debug(request: Request):
    """Temporary debug endpoint — remove after diagnosing 422. Returns raw body."""
    try:
        body_bytes = await request.body()
        body_text = body_bytes.decode("utf-8", errors="replace")
        try:
            body_json = json.loads(body_text)
        except Exception:
            body_json = None
        return {
            "raw_body": body_text,
            "parsed": body_json,
            "content_type": request.headers.get("content-type"),
            "fields_present": list(body_json.keys()) if body_json else [],
        }
    except Exception as e:
        return {"error": str(e)}


@router.post("/register")
async def register(req: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # Auto-derive username from email if not provided
    if not req.username:
        base = req.email.split("@")[0]
        # sanitise: keep alphanumeric + underscore, max 20 chars
        sanitised = _re.sub(r"[^a-zA-Z0-9_]", "_", base)[:20]
        req.username = sanitised or "user"

    # ── No DB: fallback to in-memory ──────────────────────────────────────
    if db is None:
        if req.email in _mem_users:
            raise HTTPException(400, "Email already registered")
        role = "admin" if req.email.lower() in get_admin_emails() else "free"
        _mem_users[req.email] = {
            "email": req.email, "username": req.username,
            "hashed_password": hash_password(req.password),
            "role": role, "email_verified": True, "id": len(_mem_users) + 1,
        }
        u = _mem_users[req.email]
        access = create_access_token({
            "sub": req.email, "uid": u["id"], "username": req.username,
            "role": role, "email_verified": True, "type": "access",
        })
        refresh = create_refresh_token({"sub": req.email, "uid": u["id"], "type": "refresh"})
        audit.register_ok(request, req.email, role)
        return {"access_token": access, "refresh_token": refresh,
                "token_type": "bearer",
                "user": {"email": req.email, "username": req.username, "role": role, "email_verified": True},
                "email_sent": False}

    # ── DB path ───────────────────────────────────────────────────────────
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")

    existing_un = await db.execute(select(User).where(User.username == req.username))
    if existing_un.scalar_one_or_none():
        raise HTTPException(400, "Username already taken")

    role = "admin" if req.email.lower() in get_admin_emails() else "free"

    user = User(
        email=req.email,
        username=req.username,
        hashed_password=hash_password(req.password),
        role=role,
        email_verified=True,
        email_verified_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    access, refresh = _make_token(user)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": _user_dict(user),
        "email_sent": False,
        "requires_verification": False,
    }


@router.post("/login")
async def login(req: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # ── No DB fallback ────────────────────────────────────────────────────
    if db is None:
        user = _mem_users.get(req.email)
        if not user or not verify_password(req.password, user["hashed_password"]):
            audit.login_fail(request, req.email)
            raise HTTPException(401, "Invalid credentials")
        access = create_access_token({
            "sub": req.email, "uid": user["id"], "username": user["username"],
            "role": user["role"], "email_verified": user.get("email_verified", True),
            "type": "access",
        })
        refresh = create_refresh_token({"sub": req.email, "uid": user["id"], "type": "refresh"})
        audit.login_ok(request, req.email)
        return {"access_token": access, "refresh_token": refresh,
                "token_type": "bearer", "user": {**user, "hashed_password": None}}

    # ── DB path ───────────────────────────────────────────────────────────
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.hashed_password):
        # Log failed attempt
        ip = request.client.host if request.client else "unknown"
        db.add(LoginAttempt(email=req.email, ip_address=ip, success=False))
        await db.commit()
        audit.login_fail(request, req.email)
        raise HTTPException(401, "Invalid credentials")

    if user.is_banned:
        audit.access_denied(request, req.email, "login:banned")
        raise HTTPException(403, f"Account banned. Reason: {user.ban_reason or 'Policy violation'}")

    if not user.is_active:
        audit.access_denied(request, req.email, "login:deactivated")
        raise HTTPException(403, "Account deactivated")

    # Update last login
    ip = request.client.host if request.client else "unknown"
    user.last_login = datetime.now(timezone.utc)
    user.failed_login_attempts = 0
    db.add(LoginAttempt(email=req.email, ip_address=ip, success=True))
    await db.commit()

    audit.login_ok(request, req.email)
    access, refresh = _make_token(user)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": _user_dict(user),
    }


@router.post("/verify-email")
async def verify_email(req: VerifyEmailRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if db is None:
        raise HTTPException(503, "Database not configured")

    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    if user.email_verified:
        access, refresh = _make_token(user)
        return {"message": "Already verified", "access_token": access,
                "refresh_token": refresh, "token_type": "bearer", "user": _user_dict(user)}

    # Get latest unverified OTP
    ev_result = await db.execute(
        select(EmailVerification)
        .where(and_(
            EmailVerification.user_id == user.id,
            EmailVerification.verified == False,
        ))
        .order_by(EmailVerification.created_at.desc())
    )
    ev = ev_result.scalar_one_or_none()

    if not ev:
        audit.verify_fail(request, req.email, "no_pending_otp")
        raise HTTPException(400, "No verification pending. Request a new code.")

    now = datetime.now(timezone.utc)
    if ev.expires_at.replace(tzinfo=timezone.utc) < now:
        audit.verify_fail(request, req.email, "otp_expired")
        raise HTTPException(400, "Code expired. Request a new one.")

    if ev.attempts >= MAX_OTP_ATTEMPTS:
        audit.verify_fail(request, req.email, "max_attempts")
        raise HTTPException(429, "Too many attempts. Request a new code.")

    ev.attempts += 1

    if ev.code_hash != _hash_code(req.code):
        await db.commit()
        remaining = MAX_OTP_ATTEMPTS - ev.attempts
        audit.verify_fail(request, req.email, f"wrong_code attempt={ev.attempts}")
        raise HTTPException(400, f"Invalid code. {remaining} attempts remaining.")

    # Success
    ev.verified = True
    user.email_verified = True
    user.email_verified_at = now
    await db.commit()

    audit.verify_ok(request, req.email)
    access, refresh = _make_token(user)
    return {
        "message": "Email verified successfully",
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": _user_dict(user),
    }


@router.post("/resend-code")
async def resend_code(req: ResendCodeRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if db is None:
        raise HTTPException(503, "Database not configured")

    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    if user.email_verified:
        raise HTTPException(400, "Email already verified")

    # Check resend limit
    ev_result = await db.execute(
        select(EmailVerification)
        .where(and_(
            EmailVerification.user_id == user.id,
            EmailVerification.verified == False,
        ))
        .order_by(EmailVerification.created_at.desc())
    )
    latest = ev_result.scalar_one_or_none()

    if latest and latest.resend_count >= MAX_RESEND_COUNT:
        raise HTTPException(429, "Maximum resend limit reached. Contact support.")

    new_resend_count = (latest.resend_count + 1) if latest else 1

    # Invalidate old codes (mark as expired by setting attempts to max)
    if latest:
        latest.attempts = MAX_OTP_ATTEMPTS
        await db.commit()

    code = _generate_otp()
    ev = EmailVerification(
        user_id=user.id,
        code_hash=_hash_code(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES),
        resend_count=new_resend_count,
    )
    db.add(ev)
    await db.commit()

    await send_verification_email(user.email, user.username, code)
    return {"message": "Verification code sent", "resend_count": new_resend_count}


@router.post("/refresh")
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(req.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Invalid refresh token")

    email = payload.get("sub")

    if db is None:
        user = _mem_users.get(email)
        if not user:
            raise HTTPException(401, "User not found")
        access = create_access_token({
            "sub": email, "uid": user["id"], "username": user["username"],
            "role": user["role"], "email_verified": user.get("email_verified", True),
        })
        return {"access_token": access, "token_type": "bearer"}

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")

    access, _ = _make_token(user)
    return {"access_token": access, "token_type": "bearer"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    email = user.get("sub")

    if db is None:
        db_user = _mem_users.get(email, {})
        return {
            "email": email,
            "username": user.get("username"),
            "role": user.get("role", "free"),
            "email_verified": db_user.get("email_verified", True),
            "language": db_user.get("language", "en"),
            "theme": db_user.get("theme", "dark"),
        }

    result = await db.execute(select(User).where(User.email == email))
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(404, "User not found")

    return {
        "id": db_user.id,
        "email": db_user.email,
        "username": db_user.username,
        "role": db_user.role,
        "email_verified": db_user.email_verified,
        "language": db_user.language,
        "theme": db_user.theme,
        "last_login": db_user.last_login.isoformat() if db_user.last_login else None,
    }


# ── NEW v6: Logout (token blacklist) ─────────────────────────────────────

class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


@router.post("/logout")
async def logout(
    req: LogoutRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Revoke the current access token AND optionally the refresh token.
    Both JTIs are added to the Redis blacklist and (when DB is available)
    persisted to refresh_token_blacklist for durability.
    """
    from app.core.auth import blacklist_token
    from app.core.database import RefreshTokenBlacklist

    email = current_user.get("sub", "unknown")

    # Blacklist access token
    access_jti = current_user.get("jti")
    if access_jti:
        exp = current_user.get("exp")
        import datetime as _dt
        expires_at = _dt.datetime.fromtimestamp(exp, tz=_dt.timezone.utc) if exp else (
            _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(minutes=60)
        )
        await blacklist_token(access_jti, expires_at)

    # Blacklist refresh token if provided
    if req.refresh_token and db:
        try:
            refresh_payload = decode_token(req.refresh_token)
            if refresh_payload.get("type") == "refresh":
                refresh_jti = refresh_payload.get("jti")
                import datetime as _dt
                ref_exp = refresh_payload.get("exp")
                ref_expires = _dt.datetime.fromtimestamp(ref_exp, tz=_dt.timezone.utc) if ref_exp else (
                    _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=30)
                )
                # Redis blacklist
                await blacklist_token(refresh_jti, ref_expires)
                # DB persistence
                if refresh_jti:
                    db.add(RefreshTokenBlacklist(
                        jti=refresh_jti,
                        user_id=current_user.get("uid", 0),
                        expires_at=ref_expires,
                    ))
                    await db.commit()
        except Exception:
            pass  # Invalid refresh token — ignore

    audit.log("LOGOUT", request, user=email, ok=True)
    return {"message": "Logged out successfully"}
