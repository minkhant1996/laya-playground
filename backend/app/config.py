from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-sonnet-5"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    hf_token: str = ""
    typesafe_api_key: str = ""
    kaggle_username: str = ""
    kaggle_key: str = ""


settings = Settings()


def get_openrouter_key() -> str:
    """UI-saved key (encrypted store) takes precedence over the .env value."""
    from . import secrets_store

    return secrets_store.get_secret("openrouter_api_key") or settings.openrouter_api_key


def get_openrouter_model() -> str:
    from . import secrets_store

    return secrets_store.get_prefs().get("openrouter_model") or secrets_store.get_secret("openrouter_model") or settings.openrouter_model


def get_decision_engine() -> dict:
    """Which model answers Laya-style questions: {"kind": "laya"} or {"kind": "openrouter", "model": ...}."""
    from . import secrets_store

    eng = dict(secrets_store.get_prefs().get("decision_engine") or {"kind": "laya"})
    if eng.get("kind") == "openrouter" and not eng.get("model"):
        eng["model"] = get_openrouter_model()
    if eng.get("kind") == "jev" and not eng.get("model"):
        eng["model"] = "jev-1.13"
    if eng.get("kind") == "openjev" and not eng.get("model"):
        eng["model"] = "qwen3.5-0.8b-nli-v2s-long"
    return eng
