"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    db_path: str
    jwt_secret: str
    jwt_expiry_hours: int
    port: int
    enable_driver_role: bool
    routing_api_url: str
    routing_api_key: str
    routing_api_timeout_sec: float


def load_config() -> Config:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_db = os.path.join(base_dir, "data", "transport.db")
    return Config(
        db_path=os.environ.get("DATABASE_PATH", default_db),
        jwt_secret=os.environ.get("JWT_SECRET", "dev-pbl-transport-secret-change-me"),
        jwt_expiry_hours=int(os.environ.get("JWT_EXPIRY_HOURS", "24")),
        port=int(os.environ.get("BACKEND_PORT", "5001")),
        enable_driver_role=_parse_bool(os.environ.get("ENABLE_DRIVER_ROLE"), default=True),
        routing_api_url=os.environ.get("ROUTING_API_URL", "").strip(),
        routing_api_key=os.environ.get("ROUTING_API_KEY", "").strip(),
        routing_api_timeout_sec=float(os.environ.get("ROUTING_API_TIMEOUT_SEC", "2.5")),
    )
