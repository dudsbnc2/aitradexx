from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import (
    Column, Integer, String, Numeric, Text, Boolean,
    DateTime, JSON, ForeignKey
)
from sqlalchemy.sql import func
from app.core.config import settings
import logging

logger = logging.getLogger("tradeia.db")


class Base(DeclarativeBase):
    pass


def get_async_db_url(url: str) -> str:
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


engine = None
AsyncSessionLocal = None


def init_engine():
    global engine, AsyncSessionLocal
    if not settings.DATABASE_URL:
        logger.warning("DATABASE_URL not set — running without DB")
        return
    try:
        async_url = get_async_db_url(settings.DATABASE_URL)
        engine = create_async_engine(
            async_url,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            echo=settings.DEBUG,
        )
        AsyncSessionLocal = async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        logger.info("Async DB engine ready")
    except Exception as e:
        logger.error(f"DB engine init failed: {e}")


async def get_db():
    if AsyncSessionLocal is None:
        yield None
        return
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_tables():
    if engine is None:
        return
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migration: add columns that may be missing from older deployments
        await conn.execute(
            __import__("sqlalchemy").text(
                "ALTER TABLE signals ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;"
            )
        )
    logger.info("DB tables ready (migrations applied)")


# ── Models ─────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), default="free")  # free | premium | admin | superadmin
    is_active = Column(Boolean, default=True)
    is_banned = Column(Boolean, default=False)
    ban_reason = Column(Text)
    ban_until = Column(DateTime(timezone=True))
    email_verified = Column(Boolean, default=False)
    email_verified_at = Column(DateTime(timezone=True))
    failed_login_attempts = Column(Integer, default=0)
    last_login = Column(DateTime(timezone=True))
    language = Column(String(5), default="en")
    theme = Column(String(20), default="dark")
    telegram_chat_id = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    code_hash = Column(String(255), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    attempts = Column(Integer, default=0)
    verified = Column(Boolean, default=False)
    resend_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), index=True)
    ip_address = Column(String(50))
    success = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserBan(Base):
    __tablename__ = "user_bans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reason = Column(Text)
    banned_by = Column(Integer)  # admin user_id
    banned_until = Column(DateTime(timezone=True))
    permanent = Column(Boolean, default=False)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Signal(Base):
    __tablename__ = "signals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    pair = Column(String(20), index=True)
    timeframe = Column(String(5))
    bias = Column(String(10))
    confidence = Column(Integer)
    entry = Column(Numeric(20, 8))
    stop_loss = Column(Numeric(20, 8))
    take_profit = Column(Numeric(20, 8))
    rr = Column(String(10))
    analysis = Column(Text)
    indicators = Column(JSON)
    tags = Column(JSON)
    source = Column(String(50))
    quality_score = Column(Numeric(4, 1))
    quality_grade = Column(String(2))
    result = Column(String(10), default="OPEN")
    close_price = Column(Numeric(20, 8))
    pnl_pct = Column(Numeric(10, 4))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    closed_at = Column(DateTime(timezone=True))


class Watchlist(Base):
    __tablename__ = "watchlists"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    name = Column(String(100))
    coins = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    pair = Column(String(20))
    alert_type = Column(String(30))
    condition = Column(String(20))
    value = Column(Numeric(20, 8))
    message = Column(Text)
    is_active = Column(Boolean, default=True)
    triggered_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── NEW v6 Models ──────────────────────────────────────────────────────────

class RefreshTokenBlacklist(Base):
    """
    Revoked refresh tokens (logout / force-expire).
    Rows older than REFRESH_TOKEN_EXPIRE_DAYS can be pruned safely.
    """
    __tablename__ = "refresh_token_blacklist"

    id = Column(Integer, primary_key=True, index=True)
    jti = Column(String(64), unique=True, index=True, nullable=False)  # JWT ID
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    revoked_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)


class AdminAuditLog(Base):
    """
    Persistent admin action log (who did what, when, from where).
    Supplements the structured log stream with a queryable DB record.
    """
    __tablename__ = "admin_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    admin_email = Column(String(255), index=True)
    action = Column(String(100), nullable=False, index=True)
    target_type = Column(String(50))   # "user" | "signal" | "plan" | etc.
    target_id = Column(String(50))     # str so it works for any PK type
    detail = Column(JSON)              # arbitrary metadata dict
    ip_address = Column(String(50))
    ok = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class Subscription(Base):
    """
    User subscription / plan tracking.
    Decoupled from the User.role field so billing state can be managed
    independently without role mutations.

    Plans: free | pro | elite | institutional
    """
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, index=True)
    plan = Column(String(30), default="free", index=True)  # free|pro|elite|institutional
    status = Column(String(20), default="active")  # active|cancelled|trialing|past_due
    # Stripe / LemonSqueezy IDs (nullable — crypto payments don't need them)
    stripe_customer_id = Column(String(100))
    stripe_subscription_id = Column(String(100))
    payment_provider = Column(String(30))  # stripe | crypto | manual
    # Billing cycle
    current_period_start = Column(DateTime(timezone=True))
    current_period_end = Column(DateTime(timezone=True))
    trial_ends_at = Column(DateTime(timezone=True))
    # Referral
    referred_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ReferralLink(Base):
    """Affiliate / referral tracking."""
    __tablename__ = "referral_links"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, index=True)
    code = Column(String(20), unique=True, index=True, nullable=False)
    clicks = Column(Integer, default=0)
    conversions = Column(Integer, default=0)
    commission_total = Column(Numeric(12, 4), default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
