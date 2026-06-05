from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # App
    APP_NAME: str = "AG Holding Internal Platform"
    ENVIRONMENT: str = "development"
    SQL_ECHO: bool = False
    SECRET_KEY: str = "change-me"
    # Comma-separated string; use the `cors_origins` property for the parsed list.
    BACKEND_CORS_ORIGINS: str = "http://localhost:5173"
    PUBLIC_BASE_URL: str = "http://localhost:8000"
    FRONTEND_BASE_URL: str = "http://localhost:5173"
    # Comma-separated email domains allowed to sign in (empty = allow any).
    # New accounts still land in "pending" until an admin approves them.
    ALLOWED_EMAIL_DOMAINS: str = ""
    # Run the in-process background scheduler (asset warranty/maintenance alerts).
    RUN_SCHEDULER: bool = True

    # Database
    DATABASE_URL: str = "postgresql+psycopg://platform:platform@localhost:5432/platform"

    # Azure Entra ID
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""
    AZURE_REDIRECT_URI: str = "http://localhost:8000/api/auth/callback"

    # Session JWT
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # Storage
    MEDIA_ROOT: str = "./media"
    MEDIA_URL: str = "/media"

    # SMTP (optional — used to email secure-transfer links)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_STARTTLS: bool = True
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.BACKEND_CORS_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_domains(self) -> list[str]:
        return [
            d.strip().lstrip("@").lower()
            for d in self.ALLOWED_EMAIL_DOMAINS.split(",")
            if d.strip()
        ]

    @property
    def azure_discovery_url(self) -> str:
        return (
            f"https://login.microsoftonline.com/{self.AZURE_TENANT_ID}"
            "/v2.0/.well-known/openid-configuration"
        )

    @property
    def azure_authority(self) -> str:
        return f"https://login.microsoftonline.com/{self.AZURE_TENANT_ID}"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
