"""PIN del tutor: formato, hash, token parental, verificación con bloqueo y "Olvidé mi PIN"."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.auth.jwt import password_auth_time
from app.config import Settings
from app.db.gateway import GatewayError, PinState
from app.main import create_app
from app.parental import (
    InvalidParentalToken,
    hash_pin,
    issue_parental_token,
    pin_problem,
    recently_reauthenticated,
    verify_parental_token,
    verify_pin,
)
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
SIGN = "clave-de-firma-de-ejercicios-solo-pruebas"
KEY = SIGN.encode()
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO_TUTOR = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
PIN_URL = "/v1/tutor/pin"


# ---- funciones puras -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("pin", "problem"),
    [
        ("2580", None),
        ("1357", None),
        ("123", "format"),
        ("12345", "format"),
        ("12a4", "format"),
        ("１２３４", "format"),  # dígitos no ASCII
        ("0000", "weak"),
        ("7777", "weak"),
        ("1234", "weak"),
        ("6789", "weak"),
        ("9876", "weak"),
        ("3210", "weak"),
    ],
)
def test_formato_del_pin(pin: str, problem: str | None) -> None:
    assert pin_problem(pin) == problem


def test_el_hash_es_argon2id_y_verifica() -> None:
    hashed = hash_pin("2580")
    assert hashed.startswith("$argon2id$")
    assert "2580" not in hashed
    assert verify_pin(hashed, "2580")
    assert not verify_pin(hashed, "2581")
    assert not verify_pin("basura", "2580")


def test_token_parental_valido_vencido_alterado_y_de_otro_tutor() -> None:
    now = 1_000_000.0
    token = issue_parental_token(KEY, TUTOR, now=now)
    verify_parental_token(KEY, token, TUTOR, now=now + 599)
    with pytest.raises(InvalidParentalToken):
        verify_parental_token(KEY, token, TUTOR, now=now + 600)
    with pytest.raises(InvalidParentalToken):
        verify_parental_token(KEY, token, OTRO_TUTOR, now=now)
    with pytest.raises(InvalidParentalToken):
        verify_parental_token(b"otra-clave", token, TUTOR, now=now)
    payload, signature = token.split(".")
    with pytest.raises(InvalidParentalToken):
        verify_parental_token(KEY, f"{payload[:-2]}AA.{signature}", TUTOR, now=now)
    for basura in (None, "", "a", "a.b", "a.b.c", "x" * 400):
        with pytest.raises(InvalidParentalToken):
            verify_parental_token(KEY, basura, TUTOR, now=now)


def test_un_token_de_ejercicio_no_sirve_como_token_parental() -> None:
    from app.exercises.tokens import issue

    issued = issue(KEY, TUTOR, "1-08", 600)
    assert issued is not None
    with pytest.raises(InvalidParentalToken):
        verify_parental_token(KEY, issued.token, TUTOR)


def test_reautenticacion_reciente() -> None:
    now = 1_000_000.0
    assert recently_reauthenticated(int(now) - 299, now=now)
    assert not recently_reauthenticated(int(now) - 301, now=now)
    assert not recently_reauthenticated(None, now=now)
    assert not recently_reauthenticated(int(now) + 3600, now=now)  # reloj del futuro


@pytest.mark.parametrize(
    ("amr", "expected"),
    [
        ([{"method": "password", "timestamp": 100}], 100),
        ([{"method": "otp", "timestamp": 200}, {"method": "password", "timestamp": 150}], 150),
        ([{"method": "otp", "timestamp": 200}], None),
        ([{"method": "password", "timestamp": "100"}], None),
        ([{"method": "password", "timestamp": True}], None),
        ("password", None),
        (None, None),
    ],
)
def test_lee_el_login_con_contrasena_del_claim_amr(amr: Any, expected: int | None) -> None:
    claims: dict[str, Any] = {} if amr is None else {"amr": amr}
    assert password_auth_time(claims) == expected


# ---- rutas -------------------------------------------------------------------------------


def _jwt(sub: uuid.UUID = TUTOR, password_at: int | None = None) -> str:
    claims: dict[str, Any] = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    if password_at is not None:
        claims["amr"] = [{"method": "password", "timestamp": password_at}]
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _client(gateway: FakeGateway, signing: str = SIGN) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key=signing,
    )
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _post(
    client: TestClient, path: str, pin: str, headers: dict[str, str] | None = None, **jwt_kw: Any
) -> Any:
    h = {"Authorization": f"Bearer {_jwt(**jwt_kw)}", **(headers or {})}
    return client.post(path, json={"pin": pin}, headers=h)


def _status(client: TestClient) -> Any:
    return client.get(PIN_URL, headers={"Authorization": f"Bearer {_jwt()}"}).json()


def test_crear_pin_por_primera_vez_da_token() -> None:
    gateway = FakeGateway()
    client = _client(gateway)
    assert _status(client) == {"has_pin": False, "locked_until": None}
    response = _post(client, PIN_URL, "2580")
    assert response.status_code == 200
    body = response.json()
    assert body["expires_in"] == 600
    verify_parental_token(KEY, body["token"], TUTOR)
    assert gateway.pins[TUTOR].pin_hash.startswith("$argon2id$")
    assert _status(client)["has_pin"] is True


@pytest.mark.parametrize(("pin", "code"), [("1234", "pin_weak"), ("12", "pin_format")])
def test_no_acepta_pines_debiles_o_mal_formados(pin: str, code: str) -> None:
    gateway = FakeGateway()
    response = _post(_client(gateway), PIN_URL, pin)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert gateway.pins == {}


def test_verificar_bien_da_token_y_mal_cuenta_intentos() -> None:
    gateway = FakeGateway(pins={TUTOR: PinState(hash_pin("2580"), None, 0)})
    client = _client(gateway)
    ok = _post(client, f"{PIN_URL}/verify", "2580")
    assert ok.status_code == 200
    verify_parental_token(KEY, ok.json()["token"], TUTOR)

    wrong = _post(client, f"{PIN_URL}/verify", "1357")
    assert wrong.status_code == 401
    error = wrong.json()["error"]
    assert (error["code"], error["remaining"]) == ("pin_wrong", "4")
    assert "2580" not in str(error) and "1357" not in str(error)


def test_cinco_errores_bloquean_15_minutos() -> None:
    gateway = FakeGateway(pins={TUTOR: PinState(hash_pin("2580"), None, 0)})
    client = _client(gateway)
    for _ in range(4):
        assert _post(client, f"{PIN_URL}/verify", "1357").status_code == 401
    locked = _post(client, f"{PIN_URL}/verify", "1357")
    assert locked.status_code == 423
    assert locked.json()["error"]["code"] == "pin_locked"
    # Bloqueado, ni el PIN correcto sirve.
    assert _post(client, f"{PIN_URL}/verify", "2580").status_code == 423
    assert _status(client)["locked_until"] is not None


def test_verificar_sin_pin_creado_da_404() -> None:
    response = _post(_client(FakeGateway()), f"{PIN_URL}/verify", "2580")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "pin_not_set"


def test_cambiar_el_pin_exige_token_o_contrasena_reciente() -> None:
    gateway = FakeGateway(pins={TUTOR: PinState(hash_pin("2580"), None, 0)})
    client = _client(gateway)
    old_hash = gateway.pins[TUTOR].pin_hash

    denied = _post(client, PIN_URL, "1357")
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "pin_reauth_required"
    assert gateway.pins[TUTOR].pin_hash == old_hash

    # Login con contraseña de hace 10 minutos: no basta.
    stale = _post(client, PIN_URL, "1357", password_at=int(time.time()) - 600)
    assert stale.status_code == 403

    # Token de otro tutor: no basta.
    other = {"X-Parental-Token": issue_parental_token(KEY, OTRO_TUTOR)}
    assert _post(client, PIN_URL, "1357", headers=other).status_code == 403

    # Con token parental vigente (cambiar PIN).
    mine = {"X-Parental-Token": issue_parental_token(KEY, TUTOR)}
    assert _post(client, PIN_URL, "1357", headers=mine).status_code == 200
    assert verify_pin(gateway.pins[TUTOR].pin_hash, "1357")


def test_olvide_mi_pin_con_contrasena_reciente() -> None:
    gateway = FakeGateway(
        pins={TUTOR: PinState(hash_pin("2580"), datetime.now(UTC) + timedelta(minutes=10), 0)}
    )
    client = _client(gateway)
    response = _post(client, PIN_URL, "1357", password_at=int(time.time()) - 30)
    assert response.status_code == 200
    state = gateway.pins[TUTOR]
    assert verify_pin(state.pin_hash, "1357")
    # Crear uno nuevo quita el bloqueo.
    assert state.locked_until is None


def test_sin_clave_de_firma_falla_cerrado() -> None:
    gateway = FakeGateway()
    client = _client(gateway, signing="")
    assert _post(client, PIN_URL, "2580").status_code == 503
    assert gateway.pins == {}


def test_si_la_base_falla_se_responde_503() -> None:
    gateway = FakeGateway(pin_error=GatewayError("transport"))
    client = _client(gateway)
    assert _post(client, f"{PIN_URL}/verify", "2580").status_code == 503
    assert _post(client, PIN_URL, "2580").status_code == 503


def test_sin_sesion_no_hay_pin() -> None:
    client = _client(FakeGateway())
    assert client.post(f"{PIN_URL}/verify", json={"pin": "2580"}).status_code == 401
