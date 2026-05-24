from pydantic_settings import BaseSettings
from typing import Optional, List


class Settings(BaseSettings):
    # App
    APP_NAME: str = "AIMasterCrypto"
    VERSION: str = "1.0.0"
    DEBUG: bool = False
    ALLOWED_ORIGINS: List[str] = ["https://aimastercrypto.com", "http://localhost:3000"]

    # Database
    DATABASE_URL: str = ""

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # Auth / JWT
    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # AI Keys
    GROQ_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""

    # External APIs
    CRYPTOCOMPARE_API_KEY: str = ""
    CRYPTOPANIC_API_KEY: str = ""

    # Telegram
    TELEGRAM_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""

    # Scanner
    AUTO_SCAN_TF: str = "1H"
    AUTO_SCAN_INTERVAL_MINS: int = 60
    MIN_CONFIDENCE_ALERT: int = 70

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
