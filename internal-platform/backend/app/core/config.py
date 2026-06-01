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

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.BACKEND_CORS_ORIGINS.split(",") if o.strip()]

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
