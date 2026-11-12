"""Administrador: crear y listar docentes (AD2 y AD3)."""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.auth.admin import AuthAdminError, GoTrueAdmin
from app.db.gateway import GatewayError, TeacherRow
from app.main import create_app
from tests.test_auth import SECRET, _hs256, _settings

ADMIN = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
NEW_ID = uuid.UUID("dddddddd-0000-0000-0000-000000000001")
PASSWORD = "Clave-inicial-1234"
EMAIL = "Profe.Nueva@Colegio.test"
PATH = "/v1/admin/teachers"
ADMIN_TOKEN = {"app_metadata": {"role": "admin"}}


@dataclass
class FakeGw:
    rows: list[TeacherRow] = field(default_factory=list)
    taken_codes: int = 0  # cuántas veces responde `code_taken` antes de aceptar
    fail: bool = False
    calls: list[tuple[uuid.UUID, uuid.UUID, str, str]] = field(default_factory=list)

    async def admin_create_teacher(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID, name: str, link_code: str
    ) -> str:
        if self.fail:
            raise GatewayError("status_500")
        self.calls.append((admin_id, teacher_id, name, link_code))
        if self.taken_codes > 0:
            self.taken_codes -= 1
            return "code_taken"
        return "ok"

    async def admin_list_teachers(self) -> list[TeacherRow]:
        if self.fail:
            raise GatewayError("status_500")
        return self.rows

    async def aclose(self) -> None:
        return None


@dataclass
class FakeAuth:
    exists: bool = False
    fail: bool = False
    created: list[tuple[str, str, str]] = field(default_factory=list)
    deleted: list[uuid.UUID] = field(default_factory=list)
    delete_fails: bool = False

    async def create_user(self, email: str, password: str, role: str) -> uuid.UUID:
        if self.exists:
            raise AuthAdminError("email_exists")
        if self.fail:
            raise AuthAdminError("transport")
        self.created.append((email, password, role))
        return NEW_ID

    async def delete(self, user_id: uuid.UUID) -> str:
        self.deleted.append(user_id)
        if self.delete_fails:
            raise AuthAdminError("transport")
        return "deleted"

    async def aclose(self) -> None:
        return None


def _client(gw: FakeGw, auth: FakeAuth) -> TestClient:
    app = create_app(
        _settings(supabase_jwt_secret=SECRET),
        gateway=gw,
        auth_admin=auth,  # type: ignore[arg-type]
    )
    return TestClient(app, raise_server_exceptions=False)


def _auth(**claims: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {_hs256(sub=str(ADMIN), **(claims or ADMIN_TOKEN))}"}


def _body(**over: Any) -> dict[str, Any]:
    return {"name": "Profe Nueva", "email": EMAIL, "password": PASSWORD, **over}


# ---------------------------------------------------------------- crear


def test_crear_docente_devuelve_correo_clave_y_codigo_una_vez() -> None:
    gw, auth = FakeGw(), FakeAuth()
    response = _client(gw, auth).post(PATH, json=_body(), headers=_auth())
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "profe.nueva@colegio.test"  # se normaliza a minúsculas
    assert data["password"] == PASSWORD
    assert len(data["link_code"]) == 8
    assert response.headers["cache-control"] == "no-store"
    assert auth.created == [("profe.nueva@colegio.test", PASSWORD, "teacher")]
    assert gw.calls[0][0] == ADMIN and gw.calls[0][1] == NEW_ID and gw.calls[0][2] == "Profe Nueva"


def test_el_codigo_es_de_8_caracteres_sin_letras_ambiguas() -> None:
    from app.routes.admin import new_link_code

    codes = {new_link_code() for _ in range(300)}
    assert all(len(c) == 8 and set(c) <= set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for c in codes)
    assert not any(ch in "IO01" for c in codes for ch in c)


def test_correo_ya_registrado_responde_409_y_no_crea_nada() -> None:
    gw, auth = FakeGw(), FakeAuth(exists=True)
    response = _client(gw, auth).post(PATH, json=_body(), headers=_auth())
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_taken"
    assert gw.calls == [] and auth.deleted == []


def test_codigo_repetido_se_reintenta_con_otro() -> None:
    gw, auth = FakeGw(taken_codes=2), FakeAuth()
    response = _client(gw, auth).post(PATH, json=_body(), headers=_auth())
    assert response.status_code == 201
    assert len(gw.calls) == 3
    assert len({c[3] for c in gw.calls}) == 3
    assert response.json()["link_code"] == gw.calls[-1][3]


def test_si_falla_el_perfil_se_borra_la_cuenta_creada() -> None:
    gw, auth = FakeGw(fail=True), FakeAuth()
    response = _client(gw, auth).post(PATH, json=_body(), headers=_auth())
    assert response.status_code == 503
    assert auth.deleted == [NEW_ID]
    assert PASSWORD not in response.text and "colegio.test" not in response.text


def test_si_ademas_falla_la_limpieza_igual_responde_503_sin_filtrar() -> None:
    gw, auth = FakeGw(fail=True), FakeAuth(delete_fails=True)
    response = _client(gw, auth).post(PATH, json=_body(), headers=_auth())
    assert response.status_code == 503


def test_codigos_agotados_tambien_compensa() -> None:
    gw, auth = FakeGw(taken_codes=99), FakeAuth()
    assert _client(gw, auth).post(PATH, json=_body(), headers=_auth()).status_code == 503
    assert auth.deleted == [NEW_ID]


def test_falla_de_auth_responde_503_y_no_toca_la_base() -> None:
    gw, auth = FakeGw(), FakeAuth(fail=True)
    assert _client(gw, auth).post(PATH, json=_body(), headers=_auth()).status_code == 503
    assert gw.calls == []


@pytest.mark.parametrize(
    "over",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 61},
        {"email": "sin-arroba"},
        {"email": "a@b"},
        {"password": "1234567"},
        {"password": "x" * 73},
        {"password": "ñ" * 40},  # 80 bytes: pasa el largo en caracteres pero no el de bcrypt
    ],
)
def test_datos_invalidos_responden_422_sin_crear_nada(over: dict[str, Any]) -> None:
    gw, auth = FakeGw(), FakeAuth()
    response = _client(gw, auth).post(PATH, json=_body(**over), headers=_auth())
    assert response.status_code == 422
    assert auth.created == [] and gw.calls == []
    assert PASSWORD not in response.text


def test_limites_validos_se_aceptan() -> None:
    gw, auth = FakeGw(), FakeAuth()
    ok = _client(gw, auth).post(
        PATH, json=_body(name="n" * 60, password="12345678"), headers=_auth()
    )
    assert ok.status_code == 201


def test_campos_faltantes_responden_422() -> None:
    assert _client(FakeGw(), FakeAuth()).post(PATH, json={}, headers=_auth()).status_code == 422


def test_ni_la_clave_ni_el_correo_llegan_a_los_logs(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client = _client(FakeGw(), FakeAuth())
    client.post(PATH, json=_body(), headers=_auth())
    client.post(PATH, json=_body(email="malo"), headers=_auth())
    _client(FakeGw(), FakeAuth(exists=True)).post(PATH, json=_body(), headers=_auth())
    text = caplog.text
    assert PASSWORD not in text and "colegio.test" not in text.lower()


# ---------------------------------------------------------------- listar


def test_lista_devuelve_docentes_y_no_se_cachea() -> None:
    rows = [TeacherRow(NEW_ID, "Ana", "ana@x.test", "AAAA2345")]
    response = _client(FakeGw(rows=rows), FakeAuth()).get(PATH, headers=_auth())
    assert response.status_code == 200
    assert response.json() == {
        "teachers": [
            {"id": str(NEW_ID), "name": "Ana", "email": "ana@x.test", "link_code": "AAAA2345"}
        ]
    }
    assert response.headers["cache-control"] == "no-store"


def test_lista_vacia() -> None:
    assert _client(FakeGw(), FakeAuth()).get(PATH, headers=_auth()).json() == {"teachers": []}


def test_lista_con_base_caida_responde_503() -> None:
    assert _client(FakeGw(fail=True), FakeAuth()).get(PATH, headers=_auth()).status_code == 503


# ---------------------------------------------------------------- roles


@pytest.mark.parametrize("method", ["get", "post"])
@pytest.mark.parametrize(
    "claims", [{"app_metadata": {"role": "teacher"}}, {}, {"user_metadata": {"role": "admin"}}]
)
def test_solo_el_administrador_entra(method: str, claims: dict[str, Any]) -> None:
    gw, auth = FakeGw(), FakeAuth()
    client = _client(gw, auth)
    headers = {"Authorization": f"Bearer {_hs256(sub=str(ADMIN), **claims)}"}
    response = getattr(client, method)(
        PATH, headers=headers, **({"json": _body()} if method == "post" else {})
    )
    assert response.status_code == 403
    assert auth.created == [] and gw.calls == []


@pytest.mark.parametrize("method", ["get", "post"])
def test_sin_token_es_401(method: str) -> None:
    response = getattr(_client(FakeGw(), FakeAuth()), method)(PATH)
    assert response.status_code == 401


# ---------------------------------------------------------------- Auth (GoTrue)

BASE = "http://127.0.0.1:54321/auth/v1/admin"


def _gotrue() -> GoTrueAdmin:
    settings = _settings(supabase_service_role_key="llave-de-servicio-de-prueba")
    return GoTrueAdmin(settings)


@pytest.mark.asyncio
async def test_gotrue_crea_el_usuario_confirmado_y_con_rol() -> None:
    with respx.mock(assert_all_called=True) as mock:
        route = mock.post(f"{BASE}/users").mock(
            return_value=httpx.Response(200, json={"id": str(NEW_ID)})
        )
        assert await _gotrue().create_user("a@b.test", PASSWORD, "teacher") == NEW_ID
    sent = json.loads(route.calls[0].request.content)
    assert sent == {
        "email": "a@b.test",
        "password": PASSWORD,
        "email_confirm": True,
        "app_metadata": {"role": "teacher"},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [409, 422])
async def test_gotrue_correo_existente_se_reporta_como_email_exists(status: int) -> None:
    with respx.mock() as mock:
        mock.post(f"{BASE}/users").mock(
            return_value=httpx.Response(status, json={"error_code": "email_exists"})
        )
        with pytest.raises(AuthAdminError) as info:
            await _gotrue().create_user("a@b.test", PASSWORD, "teacher")
    assert info.value.reason == "email_exists"


@pytest.mark.asyncio
async def test_gotrue_otros_errores_solo_llevan_un_codigo() -> None:
    with respx.mock() as mock:
        mock.post(f"{BASE}/users").mock(
            return_value=httpx.Response(500, json={"msg": "a@b.test " + PASSWORD})
        )
        with pytest.raises(AuthAdminError) as info:
            await _gotrue().create_user("a@b.test", PASSWORD, "teacher")
    assert info.value.reason == "status_500"
    assert PASSWORD not in str(info.value) and "a@b.test" not in str(info.value)


@pytest.mark.asyncio
async def test_gotrue_error_de_red_no_filtra_la_url() -> None:
    with respx.mock() as mock:
        mock.post(f"{BASE}/users").mock(side_effect=httpx.ConnectError("http://x/ " + PASSWORD))
        with pytest.raises(AuthAdminError) as info:
            await _gotrue().create_user("a@b.test", PASSWORD, "teacher")
    assert info.value.reason == "transport" and PASSWORD not in str(info.value)
