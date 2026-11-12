"""Docente: su perfil (D3). Administrador: editar (AD4) y eliminar (AD5) docentes."""

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
from app.db.gateway import GatewayError, TeacherProfile, TeacherRow
from app.deps import CurrentTeacher
from app.main import create_app
from tests.test_auth import SECRET, _hs256, _settings

ADMIN = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
TEACHER = uuid.UUID("dddddddd-0000-0000-0000-000000000001")
OTHER = uuid.UUID("dddddddd-0000-0000-0000-000000000002")
BASE = "http://127.0.0.1:54321/auth/v1/admin"
PATH = f"/v1/admin/teachers/{TEACHER}"
ADMIN_CLAIMS = {"app_metadata": {"role": "admin"}}
TEACHER_CLAIMS = {"app_metadata": {"role": "teacher"}}


def _row() -> TeacherRow:
    return TeacherRow(TEACHER, "Ana Pérez", "Ana@Colegio.test", "AAAA2345")


@dataclass
class Gw:
    current: TeacherRow | None = field(default_factory=_row)
    profile: TeacherProfile | None = field(
        default_factory=lambda: TeacherProfile("Ana", "AAAA2345")
    )
    update_result: str = "ok"
    email_taken: bool = False
    revoked: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)
    fail: set[str] = field(default_factory=set)
    updates: list[tuple[uuid.UUID, uuid.UUID, str, bool]] = field(default_factory=list)
    recorded: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)
    is_admin: bool = True  # el rol vigente en la base (el del token puede estar desactualizado)

    def _maybe(self, name: str) -> None:
        if name in self.fail:
            raise GatewayError("status_500")

    async def teacher_profile(self, teacher_id: uuid.UUID) -> TeacherProfile | None:
        self._maybe("profile")
        return self.profile

    async def admin_get_teacher(self, teacher_id: uuid.UUID) -> TeacherRow | None:
        self._maybe("get")
        return self.current

    async def admin_revoke_teacher_sessions(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID
    ) -> int:
        self._maybe("revoke")
        self.revoked.append((admin_id, teacher_id))
        return 1

    async def admin_email_in_use(self, email: str, except_id: uuid.UUID) -> bool:
        self._maybe("check")
        return self.email_taken

    async def admin_update_teacher(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID, name: str, email_changed: bool
    ) -> str:
        self._maybe("update")
        self.updates.append((admin_id, teacher_id, name, email_changed))
        return self.update_result

    async def admin_is_admin(self, admin_id: uuid.UUID) -> bool:
        self._maybe("is_admin")
        return self.is_admin

    async def admin_record_teacher_deleted(
        self, admin_id: uuid.UUID, teacher_id: uuid.UUID
    ) -> None:
        self._maybe("record")
        self.recorded.append((admin_id, teacher_id))

    async def aclose(self) -> None:
        return None


@dataclass
class Auth:
    email_calls: list[str] = field(default_factory=list)
    exists: bool = False
    fail_email: bool = False
    fail_revert: bool = False
    delete_outcome: str = "deleted"
    delete_fails: bool = False
    deleted: list[uuid.UUID] = field(default_factory=list)

    async def update_email(self, user_id: uuid.UUID, email: str) -> None:
        if self.exists and not self.email_calls_reverted(email):
            raise AuthAdminError("email_exists")
        if self.fail_email or (self.fail_revert and self.email_calls_reverted(email)):
            raise AuthAdminError("transport")
        self.email_calls.append(email)

    def email_calls_reverted(self, email: str) -> bool:
        return email == "ana@colegio.test"  # volver al correo propio nunca choca

    async def delete(self, user_id: uuid.UUID) -> str:
        if self.delete_fails:
            raise AuthAdminError("transport")
        self.deleted.append(user_id)
        return self.delete_outcome

    async def aclose(self) -> None:
        return None


def _client(gw: Gw, auth: Auth) -> TestClient:
    app = create_app(
        _settings(supabase_jwt_secret=SECRET),
        gateway=gw,
        auth_admin=auth,  # type: ignore[arg-type]
    )
    return TestClient(app, raise_server_exceptions=False)


def _h(claims: dict[str, Any], sub: uuid.UUID = ADMIN) -> dict[str, str]:
    return {"Authorization": f"Bearer {_hs256(sub=str(sub), **claims)}"}


# ------------------------------------------------------------------ D3: mi perfil


def test_el_docente_ve_su_nombre_y_su_codigo() -> None:
    response = _client(Gw(), Auth()).get("/v1/teacher/me", headers=_h(TEACHER_CLAIMS, TEACHER))
    assert response.status_code == 200
    assert response.json() == {"name": "Ana", "link_code": "AAAA2345"}
    assert response.headers["cache-control"] == "no-store"


def test_un_docente_eliminado_con_token_vigente_recibe_403() -> None:
    gw = Gw(profile=None)  # su perfil ya no existe
    response = _client(gw, Auth()).get("/v1/teacher/me", headers=_h(TEACHER_CLAIMS, TEACHER))
    assert response.status_code == 403
    assert "AAAA2345" not in response.text


def test_current_teacher_rechaza_al_eliminado_en_cualquier_ruta_de_docente() -> None:
    app = create_app(_settings(supabase_jwt_secret=SECRET), gateway=Gw(profile=None))  # type: ignore[arg-type]

    @app.get("/_probe")
    async def probe(user: CurrentTeacher) -> dict[str, str]:
        return {"id": str(user.tutor_id)}

    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/_probe", headers=_h(TEACHER_CLAIMS, TEACHER)).status_code == 403


def test_perfil_con_base_caida_responde_503() -> None:
    gw = Gw(fail={"profile"})
    assert (
        _client(gw, Auth()).get("/v1/teacher/me", headers=_h(TEACHER_CLAIMS, TEACHER)).status_code
        == 503
    )


@pytest.mark.parametrize("claims", [ADMIN_CLAIMS, {}])
def test_solo_un_docente_entra_a_su_perfil(claims: dict[str, Any]) -> None:
    assert _client(Gw(), Auth()).get("/v1/teacher/me", headers=_h(claims)).status_code == 403


def test_perfil_sin_token_es_401() -> None:
    assert _client(Gw(), Auth()).get("/v1/teacher/me").status_code == 401


# ------------------------------------------------------------------ AD4: editar


def _patch(client: TestClient, body: dict[str, Any], claims: dict[str, Any] = ADMIN_CLAIMS) -> Any:
    return client.patch(PATH, json=body, headers=_h(claims))


def test_cambiar_el_nombre_registra_y_no_toca_auth() -> None:
    gw, auth = Gw(), Auth()
    response = _patch(_client(gw, auth), {"name": "  Ana María  "})
    assert response.status_code == 200
    assert response.json()["name"] == "Ana María" and response.json()["changed"] is True
    assert response.json()["link_code"] == "AAAA2345"  # el código no cambia
    assert gw.updates == [(ADMIN, TEACHER, "Ana María", False)]
    assert auth.email_calls == []


def test_cambiar_el_correo_lo_hace_en_auth_y_se_registra() -> None:
    gw, auth = Gw(), Auth()
    response = _patch(_client(gw, auth), {"email": " Nuevo@Colegio.test "})
    assert response.status_code == 200
    assert response.json()["email"] == "nuevo@colegio.test"
    assert auth.email_calls == ["nuevo@colegio.test"]
    assert gw.updates == [(ADMIN, TEACHER, "Ana Pérez", True)]


def test_cambiar_el_correo_cierra_las_sesiones_del_docente() -> None:
    gw, auth = Gw(), Auth()
    assert _patch(_client(gw, auth), {"email": "nuevo@colegio.test"}).status_code == 200
    assert gw.revoked == [(ADMIN, TEACHER)]


def test_cambiar_solo_el_nombre_no_cierra_sesiones() -> None:
    gw, auth = Gw(), Auth()
    assert _patch(_client(gw, auth), {"name": "Ana María"}).status_code == 200
    assert gw.revoked == []


def test_si_falla_el_cierre_de_sesiones_el_cambio_igual_queda_hecho() -> None:
    gw, auth = Gw(fail={"revoke"}), Auth()
    response = _patch(_client(gw, auth), {"email": "nuevo@colegio.test"})
    assert response.status_code == 200 and response.json()["email"] == "nuevo@colegio.test"


def test_si_falla_el_guardado_no_se_cierran_sesiones() -> None:
    gw, auth = Gw(fail={"update"}), Auth()
    assert _patch(_client(gw, auth), {"email": "nuevo@colegio.test"}).status_code == 503
    assert gw.revoked == []


def test_sin_cambios_no_se_hace_nada_ni_se_registra() -> None:
    gw, auth = Gw(), Auth()
    for body in (
        {},
        {"name": "Ana Pérez"},
        {"email": "ana@colegio.test"},
        {"name": "Ana Pérez", "email": "ANA@colegio.test"},
    ):
        response = _patch(_client(gw, auth), body)
        assert response.status_code == 200 and response.json()["changed"] is False
    assert gw.updates == [] and auth.email_calls == []


def test_correo_usado_por_otra_cuenta_responde_409_antes_de_tocar_auth() -> None:
    gw, auth = Gw(email_taken=True), Auth()
    response = _patch(_client(gw, auth), {"name": "Otro nombre", "email": "ocupado@colegio.test"})
    assert response.status_code == 409
    assert gw.updates == [] and auth.email_calls == []


def test_si_auth_detecta_el_correo_ocupado_por_carrera_tambien_es_409() -> None:
    gw, auth = Gw(), Auth(exists=True)
    response = _patch(_client(gw, auth), {"name": "Otro nombre", "email": "ocupado@colegio.test"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_taken"
    assert gw.updates == []  # ni siquiera el nombre


def test_si_falla_el_guardado_se_revierte_el_correo() -> None:
    gw, auth = Gw(fail={"update"}), Auth()
    response = _patch(_client(gw, auth), {"email": "nuevo@colegio.test"})
    assert response.status_code == 503
    assert auth.email_calls == ["nuevo@colegio.test", "ana@colegio.test"]


def test_si_ademas_falla_la_reversion_el_mensaje_avisa_que_pudo_cambiar() -> None:
    gw, auth = Gw(fail={"update"}), Auth(fail_revert=True)
    response = _patch(_client(gw, auth), {"email": "nuevo@colegio.test"})
    assert response.status_code == 503
    assert "pudo haberse cambiado" in response.json()["error"]["message"]


def test_docente_no_encontrado_al_guardar_tambien_revierte() -> None:
    gw, auth = Gw(update_result="not_found"), Auth()
    assert _patch(_client(gw, auth), {"email": "nuevo@colegio.test"}).status_code == 503
    assert auth.email_calls[-1] == "ana@colegio.test"


def test_falla_de_la_comprobacion_de_correo_responde_503_sin_cambiar_nada() -> None:
    gw, auth = Gw(fail={"check"}), Auth()
    assert _patch(_client(gw, auth), {"email": "nuevo@colegio.test"}).status_code == 503
    assert gw.updates == [] and auth.email_calls == []


def test_falla_de_auth_al_cambiar_el_correo_no_toca_la_base() -> None:
    gw, auth = Gw(), Auth(fail_email=True)
    assert _patch(_client(gw, auth), {"email": "nuevo@colegio.test"}).status_code == 503
    assert gw.updates == []


def test_editar_un_docente_que_no_existe_es_404() -> None:
    assert _patch(_client(Gw(current=None), Auth()), {"name": "X"}).status_code == 404


@pytest.mark.parametrize("body", [{"name": ""}, {"name": "x" * 61}, {"email": "sin-arroba"}])
def test_edicion_invalida_responde_422(body: dict[str, Any]) -> None:
    gw, auth = Gw(), Auth()
    assert _patch(_client(gw, auth), body).status_code == 422
    assert gw.updates == [] and auth.email_calls == []


def test_ni_correos_ni_nombres_llegan_a_los_logs(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    _patch(_client(Gw(), Auth()), {"name": "Zulema Secreta", "email": "zulema@colegio.test"})
    _patch(_client(Gw(), Auth(exists=True)), {"email": "zulema@colegio.test"})
    assert "Zulema" not in caplog.text and "colegio.test" not in caplog.text.lower()


# ------------------------------------------------------------------ AD5: eliminar


def _delete(client: TestClient, claims: dict[str, Any] = ADMIN_CLAIMS) -> Any:
    return client.delete(PATH, headers=_h(claims))


def test_eliminar_borra_la_cuenta_y_deja_constancia() -> None:
    gw, auth = Gw(), Auth()
    response = _delete(_client(gw, auth))
    assert response.status_code == 204
    assert auth.deleted == [TEACHER]
    assert gw.recorded == [(ADMIN, TEACHER)]


def test_un_admin_degradado_con_token_vigente_no_puede_eliminar() -> None:
    # El token todavía dice "admin", pero en la base ya no lo es: no se borra nada en Auth.
    gw, auth = Gw(is_admin=False), Auth()
    response = _delete(_client(gw, auth))
    assert response.status_code == 403
    assert auth.deleted == [] and gw.recorded == []


def test_si_no_se_puede_comprobar_el_rol_en_la_base_no_se_borra() -> None:
    gw, auth = Gw(fail={"is_admin"}), Auth()
    assert _delete(_client(gw, auth)).status_code == 503
    assert auth.deleted == [] and gw.recorded == []


def test_eliminar_un_docente_que_no_existe_es_404_y_no_borra() -> None:
    gw, auth = Gw(current=None), Auth()
    assert _delete(_client(gw, auth)).status_code == 404
    assert auth.deleted == [] and gw.recorded == []


def test_si_falla_auth_no_se_registra_nada() -> None:
    gw, auth = Gw(), Auth(delete_fails=True)
    assert _delete(_client(gw, auth)).status_code == 503
    assert gw.recorded == []


def test_si_la_cuenta_ya_no_estaba_en_auth_es_404() -> None:
    gw, auth = Gw(), Auth(delete_outcome="not_found")
    assert _delete(_client(gw, auth)).status_code == 404
    assert gw.recorded == []


def test_si_falla_el_registro_la_baja_igual_responde_204() -> None:
    gw, auth = Gw(fail={"record"}), Auth()
    assert _delete(_client(gw, auth)).status_code == 204
    assert auth.deleted == [TEACHER]


# ------------------------------------------------------------------ roles


@pytest.mark.parametrize("method", ["patch", "delete"])
@pytest.mark.parametrize("claims", [TEACHER_CLAIMS, {}, {"user_metadata": {"role": "admin"}}])
def test_solo_el_administrador_edita_o_elimina(method: str, claims: dict[str, Any]) -> None:
    gw, auth = Gw(), Auth()
    client = _client(gw, auth)
    kwargs: dict[str, Any] = {"json": {"name": "X"}} if method == "patch" else {}
    response = getattr(client, method)(PATH, headers=_h(claims), **kwargs)
    assert response.status_code == 403
    assert auth.deleted == [] and gw.updates == [] and auth.email_calls == []


@pytest.mark.parametrize("method", ["patch", "delete"])
def test_sin_token_es_401(method: str) -> None:
    assert getattr(_client(Gw(), Auth()), method)(PATH).status_code == 401


def test_id_mal_formado_es_422() -> None:
    response = _client(Gw(), Auth()).delete(
        "/v1/admin/teachers/no-es-uuid", headers=_h(ADMIN_CLAIMS)
    )
    assert response.status_code == 422


# ------------------------------------------------------------------ GoTrue: cambio de correo


def _gotrue() -> GoTrueAdmin:
    return GoTrueAdmin(_settings(supabase_service_role_key="llave-de-servicio-de-prueba"))


async def test_gotrue_cambia_el_correo_al_instante_sin_confirmacion() -> None:
    with respx.mock(assert_all_called=True) as mock:
        route = mock.put(f"{BASE}/users/{TEACHER}").mock(return_value=httpx.Response(200, json={}))
        await _gotrue().update_email(TEACHER, "nuevo@colegio.test")
    sent = json.loads(route.calls[0].request.content)
    assert sent == {"email": "nuevo@colegio.test", "email_confirm": True}


@pytest.mark.parametrize("status", [409, 422])
async def test_gotrue_correo_ocupado_es_email_exists(status: int) -> None:
    with respx.mock() as mock:
        mock.put(f"{BASE}/users/{TEACHER}").mock(
            return_value=httpx.Response(status, json={"error_code": "email_exists"})
        )
        with pytest.raises(AuthAdminError) as info:
            await _gotrue().update_email(TEACHER, "x@y.test")
    assert info.value.reason == "email_exists"


async def test_gotrue_otros_errores_solo_llevan_un_codigo() -> None:
    with respx.mock() as mock:
        mock.put(f"{BASE}/users/{TEACHER}").mock(
            return_value=httpx.Response(500, json={"msg": "x@y.test"})
        )
        with pytest.raises(AuthAdminError) as info:
            await _gotrue().update_email(TEACHER, "x@y.test")
    assert info.value.reason == "status_500" and "x@y.test" not in str(info.value)
