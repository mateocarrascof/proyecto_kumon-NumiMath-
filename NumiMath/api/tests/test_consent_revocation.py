"""Revocar el consentimiento (T20): PIN, constancia con fecha, verificación y fallos honestos."""

from __future__ import annotations

import io
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.gateway import ConsentSummary, GatewayError
from app.main import create_app
from app.parental import issue_parental_token
from tests.fakes import AccountFakeGateway, FakeAuthAdmin

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
SIGN = "clave-de-firma-solo-pruebas-0123456789-abc"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
EMAIL = "ana.perez@example.test"
PATH = "/v1/tutor/consent/revoke"
WHEN = datetime(2026, 11, 11, 15, 30, 0, tzinfo=UTC)


def _jwt(sub: uuid.UUID = TUTOR) -> str:
    claims: dict[str, Any] = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
        "email": EMAIL,
    }
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _build() -> tuple[TestClient, AccountFakeGateway, FakeAuthAdmin]:
    gateway = AccountFakeGateway(existing={TUTOR})
    admin = FakeAuthAdmin(gateway, emails={})
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key=SIGN,
    )
    app = create_app(settings, gateway=gateway, auth_admin=admin)
    return TestClient(app, raise_server_exceptions=False), gateway, admin


def _revoke(client: TestClient, *, pin: bool = True, pin_of: uuid.UUID = TUTOR, **body: Any) -> Any:
    headers = {"Authorization": f"Bearer {_jwt()}"}
    if pin:
        headers["X-Parental-Token"] = issue_parental_token(SIGN.encode(), pin_of)
    return client.post(PATH, json=body, headers=headers)


# ---- el camino feliz: constancia con fecha y qué pasa con los datos ---------------------------


def test_revoca_y_devuelve_la_constancia_con_fecha_y_el_plazo_de_los_datos() -> None:
    client, gateway, _ = _build()
    response = _revoke(client)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "revoked"
    assert datetime.fromisoformat(data["revoked_at"]) == gateway.summary.occurred_at
    assert data["profiles_blocked"] == 2
    assert data["purge_after_days"] == 30
    assert datetime.fromisoformat(data["purge_at"]) == gateway.summary.purge_at
    # Solo revoca y lee: no borra nada, no toca Auth y no archiva evidencia.
    assert gateway.log == ["revoke_consent", "summary"]


def test_revocar_dos_veces_es_seguro_y_devuelve_la_misma_fecha() -> None:
    client, gateway, _ = _build()
    first = _revoke(client).json()
    gateway.revoke_result = "already_revoked"
    second = _revoke(client)
    assert second.status_code == 200
    assert second.json()["status"] == "already_revoked"
    assert second.json()["revoked_at"] == first["revoked_at"]


def test_no_borra_la_cuenta_ni_los_perfiles_ni_bloquea_el_acceso_a_auth() -> None:
    client, gateway, admin = _build()
    _revoke(client)
    assert admin.deleted == [] and TUTOR in gateway.existing
    assert "ban" not in gateway.log and "delete" not in gateway.log


# ---- control parental --------------------------------------------------------------------------


def test_sin_pin_no_se_revoca_nada() -> None:
    client, gateway, _ = _build()
    response = _revoke(client, pin=False)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "parental_required"
    assert gateway.log == []


def test_el_pin_de_otro_tutor_no_sirve() -> None:
    client, gateway, _ = _build()
    assert _revoke(client, pin_of=OTRO).status_code == 401
    assert gateway.log == []


def test_sin_sesion_es_401() -> None:
    client, gateway, _ = _build()
    assert client.post(PATH).status_code == 401
    assert gateway.log == []


def test_el_tutor_sale_solo_del_jwt_no_del_cuerpo() -> None:
    client, gateway, _ = _build()
    assert _revoke(client, tutor_id=str(OTRO), id=str(OTRO)).status_code == 200
    assert gateway.revoked_for == [TUTOR]


# ---- fallos: nunca se afirma lo que no se comprobó ---------------------------------------------


def test_si_nunca_acepto_responde_409_y_no_inventa_una_fecha() -> None:
    client, gateway, _ = _build()
    gateway.revoke_result = "no_consent"
    response = _revoke(client)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_consent"
    assert "summary" not in gateway.log


def test_si_falla_la_base_al_revocar_responde_503_sin_fecha() -> None:
    client, gateway, _ = _build()
    gateway.revoke_error = GatewayError("transport")
    response = _revoke(client)
    assert response.status_code == 503
    assert "revoked_at" not in response.text
    assert "No pudimos confirmar" in response.json()["error"]["message"]


def test_si_falla_la_lectura_de_la_constancia_no_se_dice_que_no_se_hizo() -> None:
    client, gateway, _ = _build()
    gateway.summary_error = GatewayError("transport")
    response = _revoke(client)
    assert response.status_code == 503
    message = response.json()["error"]["message"]
    assert "Puede que ya esté hecha" in message and "no se borró" not in message.lower()


@pytest.mark.parametrize(
    "summary",
    [
        ConsentSummary("grant", WHEN, 2, 2, 30, None),  # sigue vigente
        ConsentSummary("revoke", WHEN, 2, 1, 30, WHEN),  # quedó un perfil activo
        ConsentSummary("revoke", None, 2, 0, 30, WHEN),  # sin fecha de constancia
    ],
)
def test_si_el_resultado_no_es_el_esperado_no_se_afirma_la_revocacion(
    summary: ConsentSummary,
) -> None:
    client, gateway, _ = _build()
    gateway.summary = summary
    response = _revoke(client)
    assert response.status_code == 503
    assert "revoked_at" not in response.text


# ---- registros sin datos personales -------------------------------------------------------------


def test_los_logs_no_llevan_correo_ni_id_ni_fecha(log_stream: io.StringIO) -> None:
    client, _, _ = _build()
    _revoke(client)
    logs = log_stream.getvalue()
    assert "consent.revoked" in logs
    assert EMAIL not in logs and str(TUTOR) not in logs
    assert "15:30" not in logs  # la fecha de la constancia no va a los registros


def test_el_purge_at_es_posterior_a_la_revocacion() -> None:
    client, gateway, _ = _build()
    gateway.summary = ConsentSummary("revoke", WHEN, 1, 0, 30, WHEN + timedelta(days=30))
    data = _revoke(client).json()
    assert datetime.fromisoformat(data["purge_at"]) > datetime.fromisoformat(data["revoked_at"])
