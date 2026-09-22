from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-sonnet-4.5"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    hf_token: str = ""


settings = Settings()


def get_openrouter_key() -> str:
    """UI-saved key (encrypted store) takes precedence over the .env value."""
    from . import secrets_store

    return secrets_store.get_secret("openrouter_api_key") or settings.openrouter_api_key


def get_openrouter_model() -> str:
    from . import secrets_store

    return secrets_store.get_secret("openrouter_model") or settings.openrouter_model
