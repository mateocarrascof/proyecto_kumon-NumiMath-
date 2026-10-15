"""Configuración del servidor, leída de variables de entorno (ver api/.env.example)."""

from __future__ import annotations

import json
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Todas las claves son `SecretStr`: no aparecen en `repr`, logs ni errores."""

    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", populate_by_name=True, case_sensitive=False
    )

    app_env: Literal["local", "test", "production"] = "local"

    supabase_url: str = "http://127.0.0.1:54321"
    supabase_service_role_key: SecretStr = SecretStr("")
    supabase_jwks_url: str = ""
    supabase_jwt_secret: SecretStr = SecretStr("")
    jwt_audience: str = "authenticated"
    # Emisor esperado del JWT. Vacío = `<SUPABASE_URL>/auth/v1` (el valor de GoTrue).
    jwt_issuer: str = ""

    ai_provider: Literal["mock"] = "mock"
    # Sin valor por defecto a propósito: el nombre de versión estable lo elige la persona
    # responsable (no se usan alias "-latest"). Se usa a partir del proveedor Gemini.
    gemini_model: str = ""

    # Orígenes que pueden llamar a la API desde un navegador, separados por comas (lista explícita).
    cors_origins: str = "http://localhost:8100"

    cost_per_explanation: int = Field(1, ge=1)
    student_daily_limit: int = Field(30, ge=1)
    tutor_daily_limit: int = Field(90, ge=1)

    stream_max_seconds: int = Field(60, ge=1, le=600)
    stream_recheck_seconds: int = Field(10, ge=1, le=60)

    # Clave de firma de los ejercicios (aleatoria, solo del servidor). Sin ella no hay práctica.
    exercise_signing_key: SecretStr = SecretStr("")
    # Vida corta del ejercicio firmado: tiempo máximo para responderlo.
    exercise_token_ttl_seconds: int = Field(600, ge=30, le=3600)

    hmac_keys: SecretStr = SecretStr("")
    hmac_active_version: int = Field(1, ge=1)

    @model_validator(mode="after")
    def _production_requires_secrets(self) -> Settings:
        if self.app_env != "production":
            return self
        missing: list[str] = []
        if not self.supabase_service_role_key.get_secret_value():
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
        if not self.supabase_jwks_url and not self.supabase_jwt_secret.get_secret_value():
            missing.append("SUPABASE_JWKS_URL o SUPABASE_JWT_SECRET")
        if not self.exercise_signing_key.get_secret_value():
            missing.append("EXERCISE_SIGNING_KEY")
        if not self.hmac_keys.get_secret_value():
            missing.append("HMAC_KEYS")
        else:
            try:
                keys = json.loads(self.hmac_keys.get_secret_value())
            except ValueError as exc:
                raise ValueError("HMAC_KEYS no es un JSON válido") from exc
            if str(self.hmac_active_version) not in keys:
                raise ValueError("HMAC_ACTIVE_VERSION no existe en HMAC_KEYS")
        if missing:
            # Solo los NOMBRES de las variables, nunca sus valores.
            raise ValueError("Faltan variables obligatorias en producción: " + ", ".join(missing))
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]
        if "*" in origins:
            raise ValueError("CORS_ORIGINS no admite '*': usa una lista explícita")
        return origins

    @property
    def expected_issuer(self) -> str:
        return self.jwt_issuer or self.supabase_url.rstrip("/") + "/auth/v1"


def get_settings() -> Settings:
    return Settings()
