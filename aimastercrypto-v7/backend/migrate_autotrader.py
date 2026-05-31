"""
Migration: Add AutoTrader tables
Run: python migrate_autotrader.py
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import os

DB_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./tradeia.db")
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+asyncpg://", 1)

SQL = """
CREATE TABLE IF NOT EXISTS exchange_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    exchange VARCHAR(30) DEFAULT 'bybit',
    api_key VARCHAR(255) NOT NULL,
    api_secret_encrypted VARCHAR(512) NOT NULL,
    label VARCHAR(100) DEFAULT 'Main Account',
    testnet BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_trade_configs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    exchange_key_id INTEGER NOT NULL REFERENCES exchange_keys(id),
    pair VARCHAR(20) NOT NULL,
    timeframe VARCHAR(5) DEFAULT '1H',
    order_size_usdt NUMERIC(12,2) DEFAULT 10,
    leverage INTEGER DEFAULT 1,
    risk_profile VARCHAR(20) DEFAULT 'balanced',
    tp_multiplier NUMERIC(4,2) DEFAULT 1.0,
    sl_multiplier NUMERIC(4,2) DEFAULT 1.0,
    max_open_trades INTEGER DEFAULT 3,
    auto_execute BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    exchange_key_id INTEGER REFERENCES exchange_keys(id),
    exchange VARCHAR(30) DEFAULT 'bybit',
    pair VARCHAR(20),
    side VARCHAR(10),
    order_type VARCHAR(20),
    qty NUMERIC(20,8),
    price NUMERIC(20,8),
    take_profit NUMERIC(20,8),
    stop_loss NUMERIC(20,8),
    leverage INTEGER DEFAULT 1,
    order_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    error_msg TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
"""

async def run():
    engine = create_async_engine(DB_URL)
    async with engine.begin() as conn:
        for stmt in SQL.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                await conn.execute(text(stmt))
    print("✓ AutoTrader tables created successfully")

if __name__ == "__main__":
    asyncio.run(run())
