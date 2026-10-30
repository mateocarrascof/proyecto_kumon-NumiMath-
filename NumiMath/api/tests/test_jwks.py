"""Tokens ES256 reales con el JWKS de Supabase y rechazos que deben fallar cerrado."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any

import httpx
import jwt
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from app.auth.jwks import CachedJwksClient
from app.auth.jwt import InvalidToken, TokenVerifier
from app.config import Settings

URL = "http://127.0.0.1:54321"
ISSUER = f"{URL}/auth/v1"
JWKS_URL = f"{URL}/auth/v1/.well-known/jwks.json"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
KID = "b81269f1-21d8-4f2e-b719-c2240a840d90"
SECRET = "secreto-hs256-solo-para-pruebas-0123456789"


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _ec_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def _jwk(private: Any, kid: str = KID) -> dict[str, Any]:
    algo = ECAlgorithm(ECAlgorithm.SHA256)
    jwk = json.loads(algo.to_jwk(private.public_key()))
    return {**jwk, "kid": kid, "use": "sig", "alg": "ES256"}


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
    return base


def _es256(private: Any, kid: str = KID, **overrides: Any) -> str:
    return jwt.encode(_claims(**overrides), private, algorithm="ES256", headers={"kid": kid})


def _verifier(secret: str = "", clock: Clock | None = None) -> TokenVerifier:
    settings = Settings(
        _env_file=None, app_env="test", supabase_url=URL, supabase_jwt_secret=secret
    )
    verifier = TokenVerifier(settings)
    if clock is not None:
        verifier._jwks = CachedJwksClient(JWKS_URL, clock=clock)  # noqa: SLF001
    return verifier


def _reason(verifier: TokenVerifier, token: str) -> str:
    with pytest.raises(InvalidToken) as error:
        verifier.verify(token)
    return error.value.reason


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


# ---- camino feliz ------------------------------------------------------------------------


@respx.mock
def test_es256_real_se_valida_con_el_jwks_por_defecto_de_supabase() -> None:
    private = _ec_key()
    route = respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    tutor = _verifier().verify(_es256(private))
    assert tutor.tutor_id == TUTOR
    assert route.call_count == 1


@respx.mock
def test_el_jwks_se_guarda_en_cache_y_no_se_pide_en_cada_token() -> None:
    private = _ec_key()
    route = respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    verifier = _verifier()
    for _ in range(5):
        verifier.verify(_es256(private))
    assert route.call_count == 1


@respx.mock
def test_la_cache_vence_y_se_vuelve_a_pedir() -> None:
    private = _ec_key()
    route = respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    clock = Clock()
    verifier = _verifier(clock=clock)
    verifier.verify(_es256(private))
    clock.now += 61
    verifier.verify(_es256(private))
    assert route.call_count == 2


@respx.mock
def test_una_clave_nueva_se_descubre_recargando_con_pausa_entre_recargas() -> None:
    old, new = _ec_key(), _ec_key()
    route = respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(old, "kid-viejo")]})
    clock = Clock()
    verifier = _verifier(clock=clock)
    verifier.verify(_es256(old, kid="kid-viejo"))

    # Supabase rota la clave: aparece "kid-nuevo".
    route.respond(200, json={"keys": [_jwk(old, "kid-viejo"), _jwk(new, "kid-nuevo")]})
    # Dentro de la pausa NO se recarga: el token con kid nuevo se rechaza sin tocar el JWKS.
    assert _reason(verifier, _es256(new, kid="kid-nuevo")) == "unknown_key"
    assert route.call_count == 1
    # Pasada la pausa, el kid desconocido dispara una recarga y se acepta.
    clock.now += 11
    assert verifier.verify(_es256(new, kid="kid-nuevo")).tutor_id == TUTOR
    assert route.call_count == 2


@respx.mock
def test_kids_al_azar_no_martillan_el_jwks() -> None:
    private = _ec_key()
    route = respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    clock = Clock()
    verifier = _verifier(clock=clock)
    verifier.verify(_es256(private))
    for i in range(50):
        assert _reason(verifier, _es256(private, kid=f"azar-{i}")) == "unknown_key"
    assert route.call_count == 1


# ---- rechazos ----------------------------------------------------------------------------


@respx.mock
def test_algoritmo_none_se_rechaza() -> None:
    respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(_ec_key())]})
    unsigned = jwt.encode(_claims(), key=None, algorithm="none", headers={"kid": KID})
    assert _reason(_verifier(SECRET), unsigned) == "alg_not_allowed"
    assert _reason(_verifier(), unsigned) == "alg_not_allowed"


@respx.mock
def test_hs256_firmado_con_la_clave_publica_no_valida_confusion_de_algoritmos() -> None:
    private = _ec_key()
    respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": KID}).encode())
    payload = _b64(json.dumps(_claims()).encode())
    signature = hmac.new(public_pem, f"{header}.{payload}".encode(), hashlib.sha256).digest()
    forged = f"{header}.{payload}.{_b64(signature)}"
    # Sin secreto HS256 configurado: el algoritmo ni siquiera se admite.
    assert _reason(_verifier(), forged) == "alg_not_allowed"
    # Con secreto HS256 configurado: la firma no coincide (la clave pública nunca es el secreto).
    assert _reason(_verifier(SECRET), forged) == "bad_signature"


@respx.mock
def test_hs256_valido_sigue_funcionando_si_hay_secreto_configurado() -> None:
    respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(_ec_key())]})
    token = jwt.encode(_claims(), SECRET, algorithm="HS256")
    assert _verifier(SECRET).verify(token).tutor_id == TUTOR


@respx.mock
def test_token_vencido_se_rechaza() -> None:
    private = _ec_key()
    respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    now = int(time.time())
    token = _es256(private, exp=now - 3600, iat=now - 7200)
    assert _reason(_verifier(), token) == "expired"


@respx.mock
def test_issuer_incorrecto_se_rechaza() -> None:
    private = _ec_key()
    respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    assert (
        _reason(_verifier(), _es256(private, iss="http://evil.example/auth/v1")) == "wrong_issuer"
    )


@respx.mock
def test_audience_incorrecta_se_rechaza() -> None:
    private = _ec_key()
    respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    assert _reason(_verifier(), _es256(private, aud="otra-app")) == "wrong_audience"


@respx.mock
def test_rol_distinto_de_authenticated_se_rechaza() -> None:
    private = _ec_key()
    respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    assert _reason(_verifier(), _es256(private, role="service_role")) == "wrong_role"


@respx.mock
def test_firma_de_otra_clave_se_rechaza() -> None:
    respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(_ec_key())]})
    assert _reason(_verifier(), _es256(_ec_key())) == "bad_signature"


@respx.mock
def test_token_sin_kid_o_con_kid_desconocido_se_rechaza() -> None:
    private = _ec_key()
    respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    sin_kid = jwt.encode(_claims(), private, algorithm="ES256")
    assert _reason(_verifier(), sin_kid) == "unknown_key"
    assert _reason(_verifier(), _es256(private, kid="no-existe")) == "unknown_key"


@respx.mock
def test_la_clave_rsa_no_sirve_para_un_token_es256() -> None:
    rsa_private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm(RSAAlgorithm.SHA256).to_jwk(rsa_private.public_key()))
    respx.get(JWKS_URL).respond(200, json={"keys": [{**jwk, "kid": KID, "use": "sig"}]})
    assert _reason(_verifier(), _es256(_ec_key())) in {"alg_not_allowed", "invalid"}


@respx.mock
def test_el_kid_declarado_con_otro_algoritmo_se_rechaza() -> None:
    private = _ec_key()
    jwk = {**_jwk(private), "alg": "RS256"}
    respx.get(JWKS_URL).respond(200, json={"keys": [jwk]})
    assert _reason(_verifier(), _es256(private)) in {"alg_not_allowed", "unknown_key"}


# ---- JWKS inaccesible o malicioso: fallar cerrado ----------------------------------------


@respx.mock
def test_jwks_inaccesible_falla_cerrado() -> None:
    respx.get(JWKS_URL).mock(side_effect=httpx.ConnectError("sin red"))
    assert _reason(_verifier(), _es256(_ec_key())) == "unknown_key"


@respx.mock
@pytest.mark.parametrize("status", [404, 500, 503])
def test_jwks_con_error_http_falla_cerrado(status: int) -> None:
    respx.get(JWKS_URL).respond(status)
    assert _reason(_verifier(), _es256(_ec_key())) == "unknown_key"


@respx.mock
def test_jwks_con_basura_o_vacio_falla_cerrado() -> None:
    private = _ec_key()
    token = _es256(private)
    route = respx.get(JWKS_URL)
    for body in ({"keys": []}, {"keys": "x"}, {"otra": 1}, [1, 2]):
        route.respond(200, json=body)
        assert _reason(_verifier(), token) == "unknown_key"
    route.respond(200, content=b"no es json")
    assert _reason(_verifier(), token) == "unknown_key"


@respx.mock
def test_una_clave_simetrica_publicada_en_el_jwks_se_ignora() -> None:
    forged_secret = _b64(SECRET.encode())
    respx.get(JWKS_URL).respond(
        200, json={"keys": [{"kty": "oct", "k": forged_secret, "kid": KID, "use": "sig"}]}
    )
    token = jwt.encode(_claims(), SECRET, algorithm="HS256", headers={"kid": KID})
    assert _reason(_verifier(), token) == "alg_not_allowed"


@respx.mock
def test_con_la_cache_vencida_y_el_jwks_caido_se_falla_cerrado() -> None:
    private = _ec_key()
    route = respx.get(JWKS_URL).respond(200, json={"keys": [_jwk(private)]})
    clock = Clock()
    verifier = _verifier(clock=clock)
    verifier.verify(_es256(private))
    route.mock(side_effect=httpx.ConnectError("sin red"))
    clock.now += 61  # la caché venció y no se puede renovar
    assert _reason(verifier, _es256(private)) == "unknown_key"
