from __future__ import annotations

import io
import time
import uuid
from dataclasses import dataclass
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.jwt import TokenVerifier
from app.config import Settings
from app.deps import CurrentTutor
from app.main import create_app

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
URL = "http://127.0.0.1:54321"
ISSUER = f"{URL}/auth/v1"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")


@dataclass
class _Key:
    key: Any


class _FakeJwks:
    """Sustituye al cliente JWKS: entrega siempre la clave pública indicada."""

    def __init__(self, public_key: Any) -> None:
        self._key = _Key(public_key)

    def get_signing_key_from_jwt(self, token: str) -> _Key:
        return self._key


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    base: dict[str, Any] = {
        "sub": str(TUTOR),
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "iat": now,
        "exp": now + 600,
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def _hs256(secret: str = SECRET, **overrides: Any) -> str:
    return jwt.encode(_claims(**overrides), secret, algorithm="HS256")


def _settings(**kwargs: Any) -> Settings:
    return Settings(_env_file=None, app_env="test", supabase_url=URL, **kwargs)


def _client(settings: Settings, jwks: Any = None) -> TestClient:
    app: FastAPI = create_app(settings)
    app.state.token_verifier = TokenVerifier(settings, jwks_client=jwks)

    @app.get("/_me")
    async def me(tutor: CurrentTutor) -> dict[str, str]:
        return {"tutor_id": str(tutor.tutor_id)}

    return TestClient(app, raise_server_exceptions=False)


def _get(client: TestClient, token: str | None) -> Any:
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    return client.get("/_me", headers=headers)


@pytest.fixture
def hs_client() -> TestClient:
    return _client(_settings(supabase_jwt_secret=SECRET))


def test_token_valido_identifica_al_tutor(hs_client: TestClient) -> None:
    response = _get(hs_client, _hs256())
    assert response.status_code == 200
    assert response.json() == {"tutor_id": str(TUTOR)}


def test_sin_cabecera_authorization_es_401(hs_client: TestClient) -> None:
    response = _get(hs_client, None)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "unauthorized"


@pytest.mark.parametrize("header", ["Basic abc", "Bearer", "Bearer ", "token-suelto", ""])
def test_cabeceras_mal_formadas_son_401(hs_client: TestClient, header: str) -> None:
    response = hs_client.get("/_me", headers={"Authorization": header})
    assert response.status_code == 401


def test_token_basura_es_401(hs_client: TestClient) -> None:
    assert _get(hs_client, "no.es.un.jwt").status_code == 401


def test_token_vencido_es_401(hs_client: TestClient) -> None:
    now = int(time.time())
    assert _get(hs_client, _hs256(exp=now - 3600, iat=now - 7200)).status_code == 401


def test_la_tolerancia_de_reloj_es_corta(hs_client: TestClient) -> None:
    now = int(time.time())
    assert _get(hs_client, _hs256(exp=now - 5)).status_code == 200  # dentro de 10 s
    assert _get(hs_client, _hs256(exp=now - 60)).status_code == 401


def test_token_sin_vencimiento_es_401(hs_client: TestClient) -> None:
    assert _get(hs_client, _hs256(exp=None)).status_code == 401


def test_firma_con_otro_secreto_es_401(hs_client: TestClient) -> None:
    assert (
        _get(hs_client, _hs256(secret="otro-secreto-distinto-0123456789-abcdef")).status_code == 401
    )


def test_token_manipulado_es_401(hs_client: TestClient) -> None:
    header, payload, signature = _hs256().split(".")
    forged = ".".join(
        [header, payload[:-2] + ("AA" if not payload.endswith("AA") else "BB"), signature]
    )
    assert _get(hs_client, forged).status_code == 401


def test_algoritmo_none_es_401(hs_client: TestClient) -> None:
    unsigned = jwt.encode(_claims(), key=None, algorithm="none")
    assert _get(hs_client, unsigned).status_code == 401


def test_audiencia_equivocada_es_401(hs_client: TestClient) -> None:
    assert _get(hs_client, _hs256(aud="otra-app")).status_code == 401


def test_emisor_equivocado_es_401(hs_client: TestClient) -> None:
    assert _get(hs_client, _hs256(iss="https://otro.example.com/auth/v1")).status_code == 401


@pytest.mark.parametrize("role", ["anon", "service_role", "admin", None])
def test_solo_se_acepta_el_rol_authenticated(hs_client: TestClient, role: str | None) -> None:
    # Un token `service_role` o `anon` es válido para Supabase, pero no identifica a un tutor.
    assert _get(hs_client, _hs256(role=role)).status_code == 401


def test_los_usuarios_anonimos_de_auth_no_son_tutores(hs_client: TestClient) -> None:
    assert _get(hs_client, _hs256(is_anonymous=True)).status_code == 401


@pytest.mark.parametrize("sub", ["no-es-uuid", "123", "", None])
def test_el_sub_debe_ser_un_uuid(hs_client: TestClient, sub: str | None) -> None:
    assert _get(hs_client, _hs256(sub=sub)).status_code == 401


def test_el_emisor_puede_configurarse() -> None:
    client = _client(
        _settings(supabase_jwt_secret=SECRET, jwt_issuer="https://x.example.com/auth/v1")
    )
    assert _get(client, _hs256(iss="https://x.example.com/auth/v1")).status_code == 200
    assert _get(client, _hs256()).status_code == 401


# --- JWKS (claves asimétricas) -------------------------------------------------


def _es256(private_key: Any, **overrides: Any) -> str:
    return jwt.encode(_claims(**overrides), private_key, algorithm="ES256", headers={"kid": "k1"})


def test_es256_con_jwks_es_valido() -> None:
    private = ec.generate_private_key(ec.SECP256R1())
    client = _client(_settings(), jwks=_FakeJwks(private.public_key()))
    assert _get(client, _es256(private)).status_code == 200


def test_es256_firmado_con_otra_clave_es_401() -> None:
    legit = ec.generate_private_key(ec.SECP256R1())
    attacker = ec.generate_private_key(ec.SECP256R1())
    client = _client(_settings(), jwks=_FakeJwks(legit.public_key()))
    assert _get(client, _es256(attacker)).status_code == 401


def test_hs256_se_rechaza_si_solo_hay_jwks() -> None:
    # Confusión de algoritmos: sin secreto HS256 configurado, un token HS256 no se acepta.
    private = ec.generate_private_key(ec.SECP256R1())
    client = _client(_settings(), jwks=_FakeJwks(private.public_key()))
    assert _get(client, _hs256()).status_code == 401


def test_es256_se_rechaza_si_solo_hay_secreto() -> None:
    private = ec.generate_private_key(ec.SECP256R1())
    client = _client(_settings(supabase_jwt_secret=SECRET))
    assert _get(client, _es256(private)).status_code == 401


def test_hs256_usando_la_clave_publica_como_secreto_es_401() -> None:
    # Ataque clásico: firmar con HS256 usando el texto de la clave pública. Con el secreto
    # real configurado distinto, debe fallar.
    private = ec.generate_private_key(ec.SECP256R1())
    client = _client(_settings(supabase_jwt_secret=SECRET), jwks=_FakeJwks(private.public_key()))
    forged = jwt.encode(_claims(), "clave-publica-como-secreto-0123456789abcdef", algorithm="HS256")
    assert _get(client, forged).status_code == 401


# --- Respuesta y registros -------------------------------------------------------


def test_el_rechazo_no_explica_el_motivo(hs_client: TestClient) -> None:
    expirado = _hs256(exp=int(time.time()) - 3600)
    for token in (expirado, _hs256(role="anon"), "basura"):
        body = _get(hs_client, token).json()["error"]
        assert body["code"] == "unauthorized"
        assert body["message"] == "No se pudo verificar tu sesión."
        for pista in ("expir", "rol", "role", "firma", "signature", "audience"):
            assert pista not in body["message"].lower()


def test_los_logs_tienen_el_codigo_pero_nunca_el_token(
    hs_client: TestClient, log_stream: io.StringIO
) -> None:
    token = _hs256(exp=int(time.time()) - 3600)
    _get(hs_client, token)
    logs = log_stream.getvalue()
    assert "auth.rejected" in logs
    assert '"code": "expired"' in logs
    assert token not in logs
    assert token.split(".")[1] not in logs
