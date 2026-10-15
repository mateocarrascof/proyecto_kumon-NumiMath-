from __future__ import annotations

import json

import pytest

from app.config import Settings
from app.db.isolation import ISOLATION_LEVEL, IsolationLevelError, require_read_committed

SECRETO = "sb_secret_MUY_SECRETA_123"


def test_los_secretos_no_aparecen_en_repr_ni_en_str() -> None:
    settings = Settings(
        _env_file=None, supabase_service_role_key=SECRETO, supabase_jwt_secret=SECRETO
    )
    assert SECRETO not in repr(settings)
    assert SECRETO not in str(settings)
    assert SECRETO not in settings.model_dump_json()


def test_produccion_exige_las_claves() -> None:
    with pytest.raises(ValueError) as error:
        Settings(_env_file=None, app_env="production")
    mensaje = str(error.value)
    assert "SUPABASE_SERVICE_ROLE_KEY" in mensaje
    assert "HMAC_KEYS" in mensaje
    assert "EXERCISE_SIGNING_KEY" in mensaje


def test_produccion_con_las_claves_es_valida() -> None:
    settings = Settings(
        _env_file=None,
        app_env="production",
        supabase_service_role_key=SECRETO,
        supabase_jwks_url="https://example.supabase.co/auth/v1/.well-known/jwks.json",
        exercise_signing_key=SECRETO,
        hmac_keys=json.dumps({"1": "a" * 64}),
    )
    assert settings.app_env == "production"


def test_la_version_activa_de_hmac_debe_existir() -> None:
    with pytest.raises(ValueError):
        Settings(
            _env_file=None,
            app_env="production",
            supabase_service_role_key=SECRETO,
            supabase_jwt_secret=SECRETO,
            exercise_signing_key=SECRETO,
            hmac_keys=json.dumps({"1": "a" * 64}),
            hmac_active_version=2,
        )


def test_el_aislamiento_exigido_es_read_committed() -> None:
    assert ISOLATION_LEVEL == "read committed"
    require_read_committed("read committed")
    require_read_committed("  READ COMMITTED ")


@pytest.mark.parametrize("nivel", ["repeatable read", "serializable", "", "read uncommitted"])
def test_cualquier_otro_aislamiento_falla_cerrado(nivel: str) -> None:
    with pytest.raises(IsolationLevelError):
        require_read_committed(nivel)
