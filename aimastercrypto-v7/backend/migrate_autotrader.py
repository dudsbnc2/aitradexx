"""
Migration v2: Auto-trade melhorias
- pair nullable (modo automático IA)
- adicionar trade_mode e min_confidence às configs
- adicionar trade_mode e triggered_by aos logs
Run: python migrate_autotrader_v2.py
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import os

DB_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./tradeia.db")
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+asyncpg://", 1)

IS_SQLITE = "sqlite" in DB_URL

MIGRATIONS = [
    # auto_trade_configs: pair nullable (modo AI automático)
    "ALTER TABLE auto_trade_configs ALTER COLUMN pair DROP NOT NULL"
        if not IS_SQLITE else
        "SELECT 1",  # SQLite não suporta ALTER COLUMN; a coluna já é nullable por omissão

    # auto_trade_configs: adicionar trade_mode se não existir
    """ALTER TABLE auto_trade_configs
       ADD COLUMN IF NOT EXISTS trade_mode VARCHAR(10) DEFAULT 'spot'""",

    # auto_trade_configs: adicionar min_confidence se não existir
    """ALTER TABLE auto_trade_configs
       ADD COLUMN IF NOT EXISTS min_confidence INTEGER DEFAULT 70""",

    # trade_logs: adicionar trade_mode se não existir
    """ALTER TABLE trade_logs
       ADD COLUMN IF NOT EXISTS trade_mode VARCHAR(10) DEFAULT 'spot'""",

    # trade_logs: adicionar triggered_by se não existir
    """ALTER TABLE trade_logs
       ADD COLUMN IF NOT EXISTS triggered_by VARCHAR(30) DEFAULT 'manual'""",

    # trade_logs: adicionar signal_id se não existir
    """ALTER TABLE trade_logs
       ADD COLUMN IF NOT EXISTS signal_id INTEGER""",
]

# SQLite não suporta ADD COLUMN IF NOT EXISTS — usa CREATE TABLE caso não exista
SQLITE_MIGRATIONS = [
    "SELECT 1",  # pair já é nullable em SQLite
    "ALTER TABLE auto_trade_configs ADD COLUMN trade_mode VARCHAR(10) DEFAULT 'spot'",
    "ALTER TABLE auto_trade_configs ADD COLUMN min_confidence INTEGER DEFAULT 70",
    "ALTER TABLE trade_logs ADD COLUMN trade_mode VARCHAR(10) DEFAULT 'spot'",
    "ALTER TABLE trade_logs ADD COLUMN triggered_by VARCHAR(30) DEFAULT 'manual'",
    "ALTER TABLE trade_logs ADD COLUMN signal_id INTEGER",
]

async def run():
    engine = create_async_engine(DB_URL)
    stmts = SQLITE_MIGRATIONS if IS_SQLITE else MIGRATIONS
    async with engine.begin() as conn:
        for stmt in stmts:
            stmt = stmt.strip()
            if not stmt or stmt == "SELECT 1":
                continue
            try:
                await conn.execute(text(stmt))
                print(f"✓ {stmt[:60]}...")
            except Exception as e:
                # Ignorar erros "column already exists"
                if "already exists" in str(e).lower() or "duplicate column" in str(e).lower():
                    print(f"  (já existe, ok) {stmt[:60]}...")
                else:
                    print(f"✗ ERRO: {e}")
                    print(f"  SQL: {stmt}")
    print("\n✓ Migração v2 concluída")

if __name__ == "__main__":
    asyncio.run(run())
