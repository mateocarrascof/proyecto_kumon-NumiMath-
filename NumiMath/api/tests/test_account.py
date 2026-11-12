"""Eliminar la cuenta (T21): orden del ADR, confirmación fuerte, fallar sin borrar, reintentos."""

from __future__ import annotations

import io
import re
import time
import uuid
from typing import Any

import httpx
import jwt
import pytest
import respx
from fastapi.testclient import TestClient

from app.account import AccountDeletionError, EvidenceKey, evidence_key, tutor_ref
from app.auth.admin import AuthAdminError, GoTrueAdmin
from app.config import Settings
from app.db.gateway import GatewayError
from app.main import create_app
from app.parental import issue_parental_token
from tests.fakes import AccountFakeGateway, FakeAuthAdmin

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
SIGN = "clave-de-firma-solo-pruebas-0123456789-abc"
URL = "http://127.0.0.1:54321"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
EMAIL = "Ana.Perez@example.test"
PATH = "/v1/tutor/account/delete"


def _jwt(
    sub: uuid.UUID = TUTOR, *, email: str | None = EMAIL, password_age: int | None = None
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": now + 600,
    }
    if email:
        claims["email"] = email
    if password_age is not None:
        claims["amr"] = [{"method": "password", "timestamp": now - password_age}]
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _parental(tutor: uuid.UUID = TUTOR) -> str:
    return issue_parental_token(SIGN.encode(), tutor)


def _settings(**over: Any) -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key=SIGN,
        **over,
    )


def _build(
    *, exists: bool = True, emails: dict[uuid.UUID, str] | None = None, **settings_over: Any
) -> tuple[TestClient, AccountFakeGateway, FakeAuthAdmin]:
    gateway = AccountFakeGateway(existing={TUTOR} if exists else set())
    admin = FakeAuthAdmin(gateway, emails=emails or {})
    app = create_app(_settings(**settings_over), gateway=gateway, auth_admin=admin)
    return TestClient(app, raise_server_exceptions=False), gateway, admin


def _delete(
    client: TestClient,
    *,
    confirm: str = "ELIMINAR",
    sub: uuid.UUID = TUTOR,
    email: str | None = EMAIL,
    parental: str | None = None,
    password_age: int | None = 30,
    extra: dict[str, Any] | None = None,
) -> Any:
    headers = {"Authorization": f"Bearer {_jwt(sub, email=email, password_age=password_age)}"}
    if parental is not None:
        headers["X-Parental-Token"] = parental
    return client.post(PATH, json={"confirm": confirm, **(extra or {})}, headers=headers)


# ---- el orden del ADR ---------------------------------------------------------------------------


def test_borra_en_el_orden_del_adr_y_responde_204() -> None:
    client, gateway, admin = _build()
    response = _delete(client)
    assert response.status_code == 204
    assert gateway.log == [
        "tutor_exists",  # ¿ya estaba borrada? (reintentos)
        "revoke_consent",  # 1. congelar: bloquea los perfiles y deja constancia
        "ban",  # 1. congelar: bloquea el acceso en Auth
        "archive",  # 3. evidencia
        "archive",  # 4. otra vez (idempotente)
        "complete",  # comprobación del paso 3
        "delete",  # 5. borrar en Auth
        "tutor_exists",  # 6. verificar
        "purge_audit",  # 7. purgar el correo y la IP del registro de auditoría de Auth
    ]
    assert admin.deleted == [TUTOR]
    assert TUTOR not in gateway.existing


def test_la_evidencia_solo_lleva_el_seudonimo_hmac_no_el_id_ni_el_correo() -> None:
    client, gateway, _ = _build()
    _delete(client)
    (tutor_id, t_ref, version), _ = gateway.archived
    assert tutor_id == TUTOR and version == 1
    assert re.fullmatch(r"[0-9a-f]{64}", t_ref)
    assert str(TUTOR) not in t_ref and EMAIL.lower() not in t_ref


def test_el_seudonimo_es_determinista_y_depende_de_la_clave() -> None:
    key = EvidenceKey(1, b"k" * 32)
    assert tutor_ref(key, TUTOR) == tutor_ref(key, TUTOR)
    assert tutor_ref(key, TUTOR) != tutor_ref(key, OTRO)
    assert tutor_ref(key, TUTOR) != tutor_ref(EvidenceKey(1, b"z" * 32), TUTOR)


# ---- confirmación fuerte ------------------------------------------------------------------------


def test_sin_contrasena_reciente_no_se_toca_nada() -> None:
    client, gateway, admin = _build()
    response = _delete(client, password_age=None)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "parental_required"
    assert gateway.log == [] and admin.deleted == []


def test_una_contrasena_de_hace_mas_de_5_minutos_no_sirve() -> None:
    client, gateway, _ = _build()
    assert _delete(client, password_age=3600).status_code == 401
    assert gateway.log == []


def test_una_contrasena_reciente_si_sirve() -> None:
    client, _, admin = _build()
    assert _delete(client, password_age=30).status_code == 204
    assert admin.deleted == [TUTOR]


def test_el_pin_NO_reemplaza_a_la_contrasena_ni_con_un_token_valido_y_reciente() -> None:
    """El servidor ya no acepta el PIN para eliminar la cuenta (un niño podría conocerlo)."""
    client, gateway, admin = _build()
    fresco = issue_parental_token(SIGN.encode(), TUTOR)
    assert _delete(client, password_age=None, parental=fresco).status_code == 401
    assert _delete(client, password_age=3600, parental=fresco).status_code == 401
    assert gateway.log == [] and admin.deleted == []


@pytest.mark.parametrize("word", ["", "eliminar", "ELIMINAR TODO", "borrar", "SI"])
def test_hay_que_escribir_eliminar_exactamente(word: str) -> None:
    client, gateway, _ = _build()
    response = _delete(
        client,
        confirm=word,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "confirmation_required"
    assert gateway.log == []


def test_sin_sesion_es_401() -> None:
    client, _, _ = _build()
    assert client.post(PATH, json={"confirm": "ELIMINAR"}).status_code == 401


def test_solo_se_borra_la_cuenta_del_jwt_aunque_la_peticion_traiga_otro_id() -> None:
    client, _, admin = _build()
    _delete(client, extra={"tutor_id": str(OTRO), "id": str(OTRO)})
    assert admin.deleted == [TUTOR]


# ---- falla antes de borrar: NO se borra nada y se descongela ------------------------------------


def test_si_falla_archivar_no_se_borra_nada_y_se_descongela() -> None:
    client, gateway, admin = _build()
    gateway.archive_error = GatewayError("transport")
    response = _delete(client)
    assert response.status_code == 503
    message = response.json()["error"]["message"]
    # Honesto: no se borraron los datos, pero la revocación ya quedó y bloquea los perfiles.
    assert "no se borraron" in message and "perfiles pueden haber quedado bloqueados" in message
    assert admin.deleted == [] and TUTOR in gateway.existing
    assert gateway.log[-1] == "unban" and TUTOR not in admin.banned


def test_si_la_evidencia_queda_incompleta_no_se_borra() -> None:
    client, gateway, admin = _build()
    gateway.complete = False
    assert _delete(client).status_code == 503
    assert admin.deleted == [] and "delete" not in gateway.log
    assert TUTOR not in admin.banned


def test_si_falla_congelar_no_se_archiva_ni_se_borra() -> None:
    client, gateway, admin = _build()
    admin.fail_on = {"ban"}
    assert _delete(client).status_code == 503
    assert "archive" not in gateway.log and admin.deleted == []


def test_si_no_hay_correo_no_se_puede_calcular_la_huella_y_no_se_borra() -> None:
    client, gateway, admin = _build()  # el JWT sin correo y Auth tampoco lo tiene
    assert _delete(client, email=None).status_code == 503
    assert gateway.archived == [] and admin.deleted == []


def test_si_el_jwt_no_trae_correo_se_pregunta_a_auth() -> None:
    client, gateway, admin = _build(emails={TUTOR: EMAIL})
    assert _delete(client, email=None).status_code == 204
    assert "get_email" in gateway.log and admin.deleted == [TUTOR]


def test_sin_clave_de_huellas_falla_cerrado(monkeypatch: pytest.MonkeyPatch) -> None:
    client, gateway, admin = _build()
    # Se simula una configuración sin ninguna clave utilizable para la evidencia.
    monkeypatch.setattr("app.routes.account.evidence_key", lambda _s: None)
    assert _delete(client).status_code == 503
    assert gateway.log == [] and admin.deleted == []


# ---- reintentos ---------------------------------------------------------------------------------


def test_si_falla_el_paso_de_borrar_la_evidencia_ya_esta_y_el_reintento_termina() -> None:
    client, gateway, admin = _build()
    admin.fail_on = {"delete"}
    assert _delete(client).status_code == 503
    assert len(gateway.archived) == 2  # la evidencia ya estaba archivada
    assert TUTOR not in admin.banned  # se descongela: la persona puede entrar y reintentar
    admin.fail_on = set()
    assert _delete(client).status_code == 204
    assert TUTOR not in gateway.existing


def test_la_purga_de_auditoria_lleva_el_id_y_el_correo() -> None:
    client, gateway, _ = _build()
    assert _delete(client).status_code == 204
    assert gateway.purged == [(TUTOR, EMAIL)]


def test_un_reintento_sobre_una_cuenta_ya_borrada_tambien_purga_la_auditoria() -> None:
    client, gateway, _ = _build(exists=False)
    assert _delete(client).status_code == 204
    assert gateway.purged == [(TUTOR, EMAIL)]


def test_si_falla_la_purga_de_auditoria_la_cuenta_igual_queda_borrada(
    log_stream: io.StringIO,
) -> None:
    client, gateway, admin = _build()
    gateway.purge_error = GatewayError("transport")
    assert _delete(client).status_code == 204
    assert admin.deleted == [TUTOR]
    assert "account.audit_purge_failed" in log_stream.getvalue()


def test_si_falla_un_paso_tardio_el_mensaje_no_dice_que_no_se_borro_nada() -> None:
    client, _, admin = _build()
    admin.fail_on = {"delete"}
    message = _delete(client).json()["error"]["message"]
    assert "no se borraron" not in message and "siguen protegidos" in message


def test_si_falla_revocar_no_se_congela_ni_se_borra_nada() -> None:
    client, gateway, admin = _build()
    gateway.revoke_error = GatewayError("transport")
    assert _delete(client).status_code == 503
    assert "ban" not in gateway.log and "unban" not in gateway.log
    assert admin.deleted == [] and gateway.archived == []


@pytest.mark.parametrize("result", ["already_revoked", "no_consent"])
def test_si_ya_estaba_revocado_o_nunca_acepto_el_flujo_continua(result: str) -> None:
    client, gateway, admin = _build()
    gateway.revoke_result = result
    assert _delete(client).status_code == 204
    assert admin.deleted == [TUTOR]


def test_si_falla_leer_el_estado_inicial_no_se_hace_nada() -> None:
    client, gateway, admin = _build()
    gateway.exists_error_on_call = 1
    assert _delete(client).status_code == 503
    assert gateway.log == ["tutor_exists"] and admin.deleted == []


def test_si_falla_la_verificacion_final_se_avisa_sin_decir_que_no_se_borro_nada() -> None:
    client, gateway, admin = _build()
    gateway.exists_error_on_call = 2  # la verificación del paso 6
    response = _delete(client)
    assert response.status_code == 503
    assert admin.deleted == [TUTOR]  # ya se había borrado
    assert "siguen protegidos" in response.json()["error"]["message"]


def test_si_auth_no_responde_al_pedir_el_correo_no_se_hace_nada() -> None:
    client, gateway, admin = _build()
    admin.fail_on = {"get_email"}
    assert _delete(client, email=None).status_code == 503
    assert "revoke_consent" not in gateway.log and admin.deleted == []


def test_si_falla_archivar_y_tambien_descongelar_el_bloqueo_corto_vence_solo() -> None:
    client, gateway, admin = _build()
    gateway.archive_error = GatewayError("transport")
    admin.fail_on = {"unban"}
    assert _delete(client).status_code == 503
    assert admin.deleted == [] and TUTOR in gateway.existing


def test_si_falla_borrar_y_tambien_descongelar_el_bloqueo_corto_se_levanta_solo() -> None:
    client, _, admin = _build()
    admin.fail_on = {"delete", "unban"}
    assert _delete(client).status_code == 503
    assert TUTOR in admin.banned  # no se pudo descongelar a mano; el bloqueo de 15 min vence solo


def test_si_la_cuenta_ya_no_existe_el_borrado_es_idempotente() -> None:
    client, gateway, admin = _build(exists=False)
    assert _delete(client).status_code == 204
    assert gateway.archived == []  # no hay nada que archivar
    assert admin.deleted == [TUTOR]  # solo se asegura el borrado en Auth


def test_si_tras_borrar_el_tutor_aun_existe_se_avisa() -> None:
    client, gateway, admin = _build()

    async def delete_sin_cascada(user_id: uuid.UUID) -> str:
        admin.deleted.append(user_id)
        return "deleted"  # Auth borró pero la cascada no corrió

    admin.delete = delete_sin_cascada  # type: ignore[method-assign]
    assert _delete(client).status_code == 503
    assert TUTOR in gateway.existing


# ---- sin datos personales en los logs -----------------------------------------------------------


def test_los_logs_no_llevan_correo_id_ni_huellas(log_stream: io.StringIO) -> None:
    client, gateway, _ = _build()
    _delete(client)
    gateway.archive_error = GatewayError("transport")
    gateway.existing.add(TUTOR)
    _delete(client)
    logs = log_stream.getvalue()
    assert "account.deleted" in logs and "account.delete_failed" in logs
    assert EMAIL.lower() not in logs.lower() and str(TUTOR) not in logs
    _, t_ref, _ = gateway.archived[0]
    assert t_ref not in logs


def test_httpx_no_registra_las_urls_con_el_id_del_tutor() -> None:
    import logging

    from app.logging import configure_logging

    configure_logging()
    assert logging.getLogger("httpx").level >= logging.WARNING


# ---- clave de las huellas ----------------------------------------------------------------------


def test_clave_de_huellas_configurada_se_usa_y_respeta_la_version_activa() -> None:
    settings = _settings(hmac_keys='{"1": "vieja", "2": "nueva"}', hmac_active_version=2)
    key = evidence_key(settings)
    assert key == EvidenceKey(2, b"nueva")


def test_la_clave_derivada_solo_se_usa_contra_una_base_local() -> None:
    assert evidence_key(_settings()) is not None  # 127.0.0.1
    remota = Settings(
        _env_file=None,
        app_env="local",  # el valor por defecto: un despliegue real que olvidó APP_ENV
        supabase_url="https://proyecto.supabase.co",
        exercise_signing_key=SIGN,
    )
    assert evidence_key(remota) is None


def test_en_desarrollo_se_deriva_de_la_clave_de_ejercicios_y_en_produccion_no() -> None:
    assert evidence_key(_settings()) is not None
    sin_nada = Settings(_env_file=None, app_env="test")
    assert evidence_key(sin_nada) is None
    prod = Settings.model_construct(
        app_env="production",
        hmac_keys=_settings().hmac_keys,
        hmac_active_version=1,
        exercise_signing_key=_settings().exercise_signing_key,
    )
    assert evidence_key(prod) is None  # en producción nunca se deriva


def test_error_de_borrado_solo_lleva_codigos() -> None:
    error = AccountDeletionError("archive", "gateway_transport")
    assert str(error) == "archive:gateway_transport"


# ---- administración de Auth (HTTP) -------------------------------------------------------------

KEY = "llave-de-servicio-de-prueba-NO-REAL-0123456789"
ADMIN_URL = f"{URL}/auth/v1/admin/users/{TUTOR}"


def _admin() -> GoTrueAdmin:
    return GoTrueAdmin(_settings(supabase_service_role_key=KEY))


@respx.mock
async def test_ban_y_unban_usan_ban_duration() -> None:
    route = respx.put(ADMIN_URL).respond(200, json={})
    admin = _admin()
    await admin.ban(TUTOR)
    await admin.unban(TUTOR)
    bodies = [c.request.content.decode() for c in route.calls]
    assert '"ban_duration":"15m"' in bodies[0].replace(" ", "")  # bloqueo corto, no para siempre
    assert '"ban_duration":"none"' in bodies[1].replace(" ", "")
    assert route.calls[0].request.headers["apikey"] == KEY
    await admin.aclose()


@respx.mock
async def test_delete_es_un_borrado_real_y_404_es_not_found() -> None:
    route = respx.delete(ADMIN_URL).respond(200, json={})
    admin = _admin()
    assert await admin.delete(TUTOR) == "deleted"
    assert '"should_soft_delete":false' in route.calls[0].request.content.decode().replace(" ", "")
    route.respond(404, json={})
    assert await admin.delete(TUTOR) == "not_found"
    await admin.aclose()


@respx.mock
@pytest.mark.parametrize("status", [400, 401, 403, 500, 503])
async def test_los_errores_http_solo_dejan_un_codigo(status: int) -> None:
    respx.delete(ADMIN_URL).respond(status, json={"error": f"detalle con {KEY} y {EMAIL}"})
    with pytest.raises(AuthAdminError) as error:
        await _admin().delete(TUTOR)
    assert error.value.reason == f"status_{status}"
    assert KEY not in str(error.value) and EMAIL not in str(error.value)


@respx.mock
async def test_un_fallo_de_red_no_filtra_la_url_ni_la_llave() -> None:
    respx.delete(ADMIN_URL).mock(side_effect=httpx.ConnectError(f"sin red para {ADMIN_URL} {KEY}"))
    with pytest.raises(AuthAdminError) as error:
        await _admin().delete(TUTOR)
    assert error.value.reason == "transport"
    assert KEY not in repr(error.value) and "auth/v1" not in repr(error.value)


@respx.mock
async def test_get_email_devuelve_el_correo_o_none_si_no_existe() -> None:
    route = respx.get(ADMIN_URL).respond(200, json={"email": EMAIL})
    admin = _admin()
    assert await admin.get_email(TUTOR) == EMAIL
    route.respond(404, json={})
    assert await admin.get_email(TUTOR) is None
    await admin.aclose()


async def test_sin_llave_de_servicio_falla_cerrado() -> None:
    with pytest.raises(AuthAdminError) as error:
        await GoTrueAdmin(_settings()).delete(TUTOR)
    assert error.value.reason == "not_configured"
