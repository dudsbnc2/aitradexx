from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, Integer, String, Numeric, Text, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.core.config import settings
import logging

logger = logging.getLogger("tradeia.db")


class Base(DeclarativeBase):
    pass


# Convert postgres:// to postgresql+asyncpg://
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
    logger.info("DB tables created")


# ── Models ─────────────────────────────────────────────────────────────────

class Signal(Base):
    __tablename__ = "signals"

    id = Column(Integer, primary_key=True, index=True)
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


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True)
    username = Column(String(100), unique=True, index=True)
    hashed_password = Column(String(255))
    role = Column(String(20), default="free")  # free | premium | admin
    is_active = Column(Boolean, default=True)
    language = Column(String(5), default="en")
    theme = Column(String(20), default="dark")
    telegram_chat_id = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


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
    alert_type = Column(String(30))  # price | signal | breakout | volatility
    condition = Column(String(20))   # above | below | crosses
    value = Column(Numeric(20, 8))
    message = Column(Text)
    is_active = Column(Boolean, default=True)
    triggered_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
