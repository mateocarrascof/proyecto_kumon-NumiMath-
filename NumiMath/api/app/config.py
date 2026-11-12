"""Configuración del servidor, leída de variables de entorno (ver api/.env.example)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Todas las claves son `SecretStr`: no aparecen en `repr`, logs ni errores."""

    model_config = SettingsConfigDict(
        # Siempre el archivo de la carpeta api/, sin importar desde dónde se arranque el servidor.
        env_file=str(Path(__file__).resolve().parents[1] / ".env"),
        extra="ignore",
        populate_by_name=True,
        case_sensitive=False,
    )

    app_env: Literal["local", "test", "production"] = "local"

    supabase_url: str = "http://127.0.0.1:54321"
    supabase_service_role_key: SecretStr = SecretStr("")
    supabase_jwks_url: str = ""
    supabase_jwt_secret: SecretStr = SecretStr("")
    jwt_audience: str = "authenticated"
    # Emisor esperado del JWT. Vacío = `<SUPABASE_URL>/auth/v1` (el valor de GoTrue).
    jwt_issuer: str = ""

    ai_provider: Literal["mock", "gemini"] = "mock"
    # Clave de Gemini: solo del servidor, nunca se imprime ni se registra (SecretStr).
    gemini_api_key: SecretStr = SecretStr("")
    # Sin valor por defecto a propósito: el nombre de versión estable lo elige la persona
    # responsable (no se usan alias "-latest"). Se usa a partir del proveedor Gemini.
    gemini_model: str = ""

    # Tope de tokens de salida y plazo máximo para el primer fragmento de Gemini.
    # Los tokens de "razonamiento" del modelo cuentan contra este tope: con poco margen la respuesta
    # sale cortada o vacía. `low` es un nivel válido en los modelos de texto de Gemini; vacío =
    # el valor propio del modelo (más razonamiento, más costo).
    gemini_max_output_tokens: int = Field(1024, ge=64, le=4096)
    gemini_thinking_level: Literal["", "minimal", "low", "medium", "high"] = "low"
    gemini_first_chunk_seconds: float = Field(12.0, ge=1.0, le=60.0)

    # Orígenes que pueden llamar a la API desde un navegador, separados por comas (lista explícita).
    cors_origins: str = "http://localhost:8100"

    cost_per_explanation: int = Field(1, ge=1)
    student_daily_limit: int = Field(30, ge=1)
    tutor_daily_limit: int = Field(90, ge=1)

    # Tamaño máximo del cuerpo de una petición (las de este servidor son JSON cortos).
    max_body_bytes: int = Field(8192, ge=1024, le=1_048_576)

    stream_max_seconds: int = Field(60, ge=1, le=600)
    stream_recheck_seconds: int = Field(10, ge=1, le=60)

    # Clave de firma de los ejercicios (aleatoria, solo del servidor). Sin ella no hay práctica.
    exercise_signing_key: SecretStr = SecretStr("")
    # Vida corta del ejercicio firmado: tiempo máximo para responderlo.
    exercise_token_ttl_seconds: int = Field(600, ge=30, le=3600)

    # Modo sin conexión (CU-A12, ADR 0002). El lote se responde sin internet, así que sus tokens
    # viven días: 7 por defecto. El tope de 3600 s de arriba sigue valiendo para la práctica en
    # línea (son tokens de otro dominio).
    offline_token_ttl_seconds: int = Field(7 * 24 * 3600, ge=3600, le=7 * 24 * 3600)
    # Ejercicios por nivel en el lote (nivel actual y vecinos): 10 = un bloque completo.
    offline_batch_per_level: int = Field(10, ge=1, le=10)
    # Descargas del lote por perfil y día (hora de Chile): evita acumular lotes y cargar al
    # servidor, que genera cientos de ejercicios por descarga.
    offline_batch_daily_limit: int = Field(5, ge=1, le=20)
    # CU-A13: margen para sincronizar un intento sin conexión tras la caducidad del token (14 días,
    # decisión 3 del ADR 0002). Solo se aplica a tokens del lote.
    offline_sync_grace_seconds: int = Field(14 * 24 * 3600, ge=0, le=14 * 24 * 3600)

    hmac_keys: SecretStr = SecretStr("")
    hmac_active_version: int = Field(1, ge=1)

    @model_validator(mode="after")
    def _gemini_requires_key_and_pinned_model(self) -> Settings:
        if self.ai_provider != "gemini":
            return self
        problems: list[str] = []
        if not self.gemini_api_key.get_secret_value():
            problems.append("GEMINI_API_KEY")
        model = self.gemini_model.strip()
        if not model:
            problems.append("GEMINI_MODEL")
        elif model.lower().endswith("-latest"):
            raise ValueError(
                "GEMINI_MODEL no admite alias '-latest': usa un nombre de versión estable"
            )
        elif not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{2,79}", model):
            raise ValueError("GEMINI_MODEL tiene caracteres no permitidos")
        if problems:
            # Solo los NOMBRES de las variables, nunca sus valores.
            raise ValueError("Con AI_PROVIDER=gemini faltan: " + ", ".join(problems))
        return self

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
    def expected_jwks_url(self) -> str:
        return (
            self.supabase_jwks_url
            or self.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
        )

    @property
    def expected_issuer(self) -> str:
        return self.jwt_issuer or self.supabase_url.rstrip("/") + "/auth/v1"


def get_settings() -> Settings:
    return Settings()
