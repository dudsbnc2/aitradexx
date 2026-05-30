from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import Optional, List
import os


class Settings(BaseSettings):
    # App
    APP_NAME: str = "AIMasterCrypto"
    VERSION: str = "1.0.0"
    DEBUG: bool = False
    # "development" | "staging" | "production"
    ENV: str = "development"

    # CORS — set CORS_ORIGINS env var as comma-separated list in production
    # e.g. CORS_ORIGINS=https://aimastercrypto.com,https://www.aimastercrypto.com
    CORS_ORIGINS_RAW: str = "http://localhost:3000"

    @property
    def CORS_ORIGINS(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS_RAW.split(",") if o.strip()]

    # Database
    DATABASE_URL: str = ""

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # Auth / JWT
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15  # V7: reduzido de 60 para 15 min (httpOnly cookie refresh)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # AI Keys
    GROQ_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""

    # External APIs
    CRYPTOCOMPARE_API_KEY: str = ""
    CRYPTOPANIC_API_KEY: str = ""
    NEWSDATA_API_KEY: str = ""

    # Telegram
    TELEGRAM_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""

    # Scanner
    AUTO_SCAN_TF: str = "1H"
    AUTO_SCAN_INTERVAL_MINS: int = 60
    MIN_CONFIDENCE_ALERT: int = 70

    # Email / SMTP
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@aimastercrypto.com"
    EMAIL_FROM_NAME: str = "AIMasterCrypto"

    # Admin — set in env, never hardcode here
    # e.g. ADMIN_EMAILS=you@domain.com,other@domain.com
    ADMIN_EMAILS: str = ""

    # OpenAI (opcional)
    OPENAI_API_KEY: str = ""

    # Stripe (billing V7)
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_PRO_MONTHLY: str = ""
    STRIPE_PRICE_ELITE_MONTHLY: str = ""

    # Frontend URL (para redirects Stripe)
    FRONTEND_URL: str = "https://aimastercrypto.com"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()


def get_admin_emails() -> set:
    return {e.strip().lower() for e in settings.ADMIN_EMAILS.split(",") if e.strip()}
