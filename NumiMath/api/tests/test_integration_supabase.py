"""Pruebas contra la base LOCAL de Supabase (`supabase start`).

No corren por defecto. Para ejecutarlas, con las variables de entorno definidas:

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<llave local> \\
        api/.venv/Scripts/python -m pytest -q api -m integration

La llave local sale de `supabase status -o env` (SERVICE_ROLE_KEY). Nunca se versiona.
"""

from __future__ import annotations

import os
import uuid

import pytest

from app.config import Settings
from app.db.supabase_gateway import SupabaseGateway

pytestmark = pytest.mark.integration

_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
_URL = os.environ.get("SUPABASE_URL", "")


@pytest.fixture
def gateway() -> SupabaseGateway:
    if not _KEY or not _URL:
        pytest.skip("faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY")
    settings = Settings(
        _env_file=None, app_env="local", supabase_url=_URL, supabase_service_role_key=_KEY
    )
    return SupabaseGateway(settings)


async def test_la_base_atiende_bajo_read_committed(gateway: SupabaseGateway) -> None:
    await gateway.assert_read_committed()
    await gateway.aclose()


async def test_authorize_student_use_responde_por_el_transporte_real(
    gateway: SupabaseGateway,
) -> None:
    code = await gateway.authorize_student_use(uuid.uuid4(), uuid.uuid4())
    assert code == "student_not_found"
    await gateway.aclose()


async def test_consume_usage_rechaza_un_perfil_inexistente_en_la_base_real(
    gateway: SupabaseGateway,
) -> None:
    from app.db.gateway import GatewayError

    with pytest.raises(GatewayError) as error:
        await gateway.consume_usage(uuid.uuid4(), uuid.uuid4(), 1, 30, 90)
    assert error.value.reason == "status_400"  # la base lanza student_not_found
    await gateway.aclose()
