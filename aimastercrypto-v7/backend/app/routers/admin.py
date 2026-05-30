"""
Admin router — full user management, bans, signals, stats.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, and_

from app.core.auth import require_admin
from app.core.database import get_db, User, UserBan, Signal, LoginAttempt
from app.core.clients import get_redis
from app.core.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Schemas ───────────────────────────────────────────────────────────────

class BanRequest(BaseModel):
    user_id: int
    reason: str
    permanent: bool = False
    ban_until: Optional[str] = None  # ISO datetime string

class UpdateRoleRequest(BaseModel):
    user_id: int
    role: str  # free | premium | admin

class UpdateUserRequest(BaseModel):
    user_id: int
    username: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


# ── Stats ─────────────────────────────────────────────────────────────────

@router.get("/stats")
async def admin_stats(admin=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if db is None:
        return {"error": "Database not configured", "platform": "AIMasterCrypto v1.0"}

    total_users = await db.execute(select(func.count()).select_from(User))
    banned_users = await db.execute(select(func.count()).select_from(User).where(User.is_banned == True))
    verified_users = await db.execute(select(func.count()).select_from(User).where(User.email_verified == True))
    premium_users = await db.execute(select(func.count()).select_from(User).where(User.role == "premium"))
    total_signals = await db.execute(select(func.count()).select_from(Signal))

    r = await get_redis()
    redis_info = {}
    if r:
        try:
            info = await r.info("memory")
            redis_info = {"used_memory_human": info.get("used_memory_human")}
        except Exception:
            pass

    return {
        "users": {
            "total": total_users.scalar(),
            "banned": banned_users.scalar(),
            "verified": verified_users.scalar(),
            "premium": premium_users.scalar(),
        },
        "signals": {
            "total": total_signals.scalar(),
        },
        "platform": "AIMasterCrypto v1.0",
        "ai_providers": {
            "groq": bool(settings.GROQ_API_KEY),
            "gemini": bool(settings.GEMINI_API_KEY),
            "anthropic": bool(settings.ANTHROPIC_API_KEY),
        },
        "redis": redis_info,
    }


# ── User Management ───────────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    banned: Optional[bool] = Query(None),
):
    if db is None:
        raise HTTPException(503, "Database not configured")

    query = select(User)
    conditions = []

    if search:
        conditions.append(
            User.email.ilike(f"%{search}%") | User.username.ilike(f"%{search}%")
        )
    if role:
        conditions.append(User.role == role)
    if banned is not None:
        conditions.append(User.is_banned == banned)

    if conditions:
        query = query.where(and_(*conditions))

    total_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(total_q)).scalar()

    query = query.order_by(desc(User.created_at)).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    users = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit,
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "username": u.username,
                "role": u.role,
                "is_active": u.is_active,
                "is_banned": u.is_banned,
                "ban_reason": u.ban_reason,
                "email_verified": u.email_verified,
                "last_login": u.last_login.isoformat() if u.last_login else None,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ],
    }


@router.get("/users/{user_id}")
async def get_user(user_id: int, admin=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if db is None:
        raise HTTPException(503, "Database not configured")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    # Login history
    logins_result = await db.execute(
        select(LoginAttempt)
        .where(LoginAttempt.email == user.email)
        .order_by(desc(LoginAttempt.created_at))
        .limit(10)
    )
    logins = logins_result.scalars().all()

    # Signal count
    sig_count = await db.execute(
        select(func.count()).select_from(Signal).where(Signal.user_id == user_id)
    )

    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "role": user.role,
        "is_active": user.is_active,
        "is_banned": user.is_banned,
        "ban_reason": user.ban_reason,
        "email_verified": user.email_verified,
        "email_verified_at": user.email_verified_at.isoformat() if user.email_verified_at else None,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "signals_total": sig_count.scalar(),
        "login_history": [
            {
                "ip": l.ip_address,
                "success": l.success,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            }
            for l in logins
        ],
    }


@router.post("/ban-user")
async def ban_user(req: BanRequest, admin=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if db is None:
        raise HTTPException(503, "Database not configured")

    result = await db.execute(select(User).where(User.id == req.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role in ("admin", "superadmin"):
        raise HTTPException(403, "Cannot ban admin users")

    ban_until = None
    if req.ban_until and not req.permanent:
        try:
            ban_until = datetime.fromisoformat(req.ban_until)
        except ValueError:
            raise HTTPException(400, "Invalid ban_until format. Use ISO datetime.")

    user.is_banned = True
    user.ban_reason = req.reason
    user.ban_until = ban_until

    admin_id = admin.get("uid")
    ban = UserBan(
        user_id=req.user_id,
        reason=req.reason,
        banned_by=admin_id,
        banned_until=ban_until,
        permanent=req.permanent,
        active=True,
    )
    db.add(ban)
    await db.commit()

    return {"message": f"User {user.username} banned successfully", "permanent": req.permanent}


@router.post("/unban-user")
async def unban_user(body: dict, admin=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if db is None:
        raise HTTPException(503, "Database not configured")

    user_id = body.get("user_id")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    user.is_banned = False
    user.ban_reason = None
    user.ban_until = None

    # Deactivate active bans
    bans_result = await db.execute(
        select(UserBan).where(and_(UserBan.user_id == user_id, UserBan.active == True))
    )
    for ban in bans_result.scalars().all():
        ban.active = False

    await db.commit()
    return {"message": f"User {user.username} unbanned successfully"}


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    req: UpdateUserRequest,
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if db is None:
        raise HTTPException(503, "Database not configured")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    if req.role is not None:
        allowed_roles = {"free", "premium", "admin"}
        if req.role not in allowed_roles:
            raise HTTPException(400, f"Role must be one of: {allowed_roles}")
        user.role = req.role

    if req.is_active is not None:
        user.is_active = req.is_active

    if req.username is not None:
        user.username = req.username

    await db.commit()
    return {"message": "User updated", "user_id": user_id}


# ── Signals Monitor ───────────────────────────────────────────────────────

@router.get("/signals")
async def admin_signals(
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    pair: Optional[str] = Query(None),
    bias: Optional[str] = Query(None),
):
    if db is None:
        raise HTTPException(503, "Database not configured")

    query = select(Signal)
    conditions = []
    if pair:
        conditions.append(Signal.pair == pair)
    if bias:
        conditions.append(Signal.bias == bias)
    if conditions:
        query = query.where(and_(*conditions))

    total_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(total_q)).scalar()

    query = query.order_by(desc(Signal.created_at)).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    signals = result.scalars().all()

    # Win rate stats
    wins = await db.execute(
        select(func.count()).select_from(Signal).where(Signal.result == "WIN")
    )
    losses = await db.execute(
        select(func.count()).select_from(Signal).where(Signal.result == "LOSS")
    )
    w = wins.scalar() or 0
    l = losses.scalar() or 0
    win_rate = round((w / (w + l) * 100), 1) if (w + l) > 0 else 0

    return {
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit,
        "stats": {"win_rate": win_rate, "wins": w, "losses": l},
        "signals": [
            {
                "id": s.id,
                "pair": s.pair,
                "timeframe": s.timeframe,
                "bias": s.bias,
                "confidence": s.confidence,
                "entry": float(s.entry) if s.entry else None,
                "stop_loss": float(s.stop_loss) if s.stop_loss else None,
                "take_profit": float(s.take_profit) if s.take_profit else None,
                "quality_grade": s.quality_grade,
                "result": s.result,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in signals
        ],
    }


# ── Activity Logs ─────────────────────────────────────────────────────────

@router.get("/activity")
async def admin_activity(
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
):
    if db is None:
        raise HTTPException(503, "Database not configured")

    result = await db.execute(
        select(LoginAttempt).order_by(desc(LoginAttempt.created_at)).limit(limit)
    )
    attempts = result.scalars().all()

    return {
        "activity": [
            {
                "email": a.email,
                "ip_address": a.ip_address,
                "success": a.success,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in attempts
        ]
    }


# ── NEW v6: DB Audit Log endpoints ────────────────────────────────────────

from app.core.database import AdminAuditLog, Subscription
from fastapi import Request as _Request


async def _db_audit(
    db: AsyncSession,
    admin_user: dict,
    action: str,
    target_type: str = None,
    target_id: str = None,
    detail: dict = None,
    request: _Request = None,
    ok: bool = True,
):
    """Write an admin action to the DB audit log."""
    if db is None:
        return
    ip = "unknown"
    if request and request.client:
        ip = request.headers.get("X-Forwarded-For", request.client.host).split(",")[0].strip()
    entry = AdminAuditLog(
        admin_id=admin_user.get("uid"),
        admin_email=admin_user.get("sub", "unknown"),
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id else None,
        detail=detail or {},
        ip_address=ip,
        ok=ok,
    )
    db.add(entry)
    try:
        await db.commit()
    except Exception:
        await db.rollback()


@router.get("/audit-log")
async def get_audit_log(
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    action: Optional[str] = Query(None),
    admin_email: Optional[str] = Query(None),
):
    """Retrieve the most recent admin audit log entries."""
    if db is None:
        raise HTTPException(503, "Database not configured")

    query = select(AdminAuditLog).order_by(desc(AdminAuditLog.created_at)).limit(limit)
    if action:
        query = query.where(AdminAuditLog.action == action)
    if admin_email:
        query = query.where(AdminAuditLog.admin_email == admin_email)

    result = await db.execute(query)
    rows = result.scalars().all()
    return {
        "total": len(rows),
        "logs": [
            {
                "id": r.id,
                "admin": r.admin_email,
                "action": r.action,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "detail": r.detail,
                "ip": r.ip_address,
                "ok": r.ok,
                "ts": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.get("/ws-stats")
async def ws_stats(admin=Depends(require_admin)):
    """Real-time WebSocket connection stats."""
    from app.core.security_middleware import ws_limiter
    from app.websockets.manager import ws_manager
    return {
        "total_ws_connections": ws_manager.total_connections,
        **ws_limiter.stats,
    }


@router.get("/subscriptions")
async def list_subscriptions(
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    plan: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """List all user subscriptions."""
    if db is None:
        raise HTTPException(503, "Database not configured")
    query = select(Subscription).limit(limit)
    if plan:
        query = query.where(Subscription.plan == plan)
    result = await db.execute(query)
    rows = result.scalars().all()
    return {
        "total": len(rows),
        "subscriptions": [
            {
                "user_id": r.user_id,
                "plan": r.plan,
                "status": r.status,
                "provider": r.payment_provider,
                "period_end": r.current_period_end.isoformat() if r.current_period_end else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.post("/subscriptions/update")
async def update_subscription(
    body: dict,
    request: _Request,
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Manually set a user's subscription plan (e.g. gifting pro access)."""
    if db is None:
        raise HTTPException(503, "Database not configured")

    user_id = body.get("user_id")
    plan = body.get("plan", "free")
    if plan not in ("free", "pro", "elite", "institutional"):
        raise HTTPException(400, "Invalid plan")

    result = await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    sub = result.scalar_one_or_none()
    if sub:
        sub.plan = plan
        sub.status = "active"
        sub.payment_provider = "manual"
    else:
        db.add(Subscription(user_id=user_id, plan=plan, status="active", payment_provider="manual"))

    # Sync User.role
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user and plan != "free":
        user.role = "premium"
    elif user:
        user.role = "free"

    await db.commit()

    await _db_audit(
        db, admin, "UPDATE_SUBSCRIPTION",
        target_type="user", target_id=str(user_id),
        detail={"plan": plan}, request=request,
    )

    return {"message": f"User {user_id} plan updated to {plan}"}
