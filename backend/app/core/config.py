"""Application configuration (environment variables prefixed VANTARA_)."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

VERSION = "0.1.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VANTARA_")

    host: str = "127.0.0.1"
    port: int = 8787
    runtime_url: str = "http://127.0.0.1:11434"
    data_dir: Path = Path(__file__).resolve().parents[3] / "data"
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]


def get_settings() -> Settings:
    return Settings()
