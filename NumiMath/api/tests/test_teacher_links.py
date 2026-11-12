"""Vincular un docente a un hijo (T25) y quitarlo (T26)."""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db.gateway import GatewayError, LinkedTeacher, LinkLookup
from app.link_token import (
    LINK_TOKEN_TTL_SECONDS,
    InvalidLinkToken,
    LinkClaims,
    issue_link_token,
    verify_link_token,
)
from app.main import create_app
from app.parental import TOKEN_TTL_SECONDS, InvalidParentalToken, issue_parental_token
from app.parental import verify_parental_token as verify_parental
from tests.test_auth import SECRET, _hs256, _settings

SIGN = "clave-de-firma-solo-pruebas-0123456789-abc"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTHER_TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000002")
STUDENT = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000001")
STUDENT2 = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
TEACHER = uuid.UUID("dddddddd-0000-0000-0000-000000000001")
TERMS = uuid.UUID("11111111-0000-0000-0000-000000000011")
CODE = "XXXX2345"
BASE = f"/v1/students/{STUDENT}"


@dataclass
class Gw:
    lookup: LinkLookup = field(
        default_factory=lambda: LinkLookup("ok", TEACHER, "Docente X", TERMS, "doc-1", "e" * 64)
    )
    create_result: str = "ok"
    remove_result: str = "ok"
    teachers: list[LinkedTeacher] | None = field(
        default_factory=lambda: [
            LinkedTeacher(TEACHER, "Docente X", "Docente X", datetime(2026, 11, 12, tzinfo=UTC))
        ]
    )
    fail: set[str] = field(default_factory=set)
    lookups: list[tuple[uuid.UUID, uuid.UUID, str]] = field(default_factory=list)
    created: list[tuple[Any, ...]] = field(default_factory=list)
    removed: list[tuple[Any, ...]] = field(default_factory=list)

    def _maybe(self, name: str) -> None:
        if name in self.fail:
            raise GatewayError("status_500")

    async def authorize_student_use(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        return "ok" if student_id == STUDENT else "student_not_found"

    async def teacher_link_lookup(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID, code: str
    ) -> LinkLookup:
        self._maybe("lookup")
        self.lookups.append((tutor_id, student_id, code))
        return self.lookup

    async def create_teacher_link(self, *args: Any) -> str:
        self._maybe("create")
        self.created.append(args)
        return self.create_result

    async def list_student_teachers(
        self, tutor_id: uuid.UUID, student_id: uuid.UUID
    ) -> list[LinkedTeacher] | None:
        self._maybe("list")
        return self.teachers

    async def remove_teacher_link(self, *args: Any) -> str:
        self._maybe("remove")
        self.removed.append(args)
        return self.remove_result

    async def aclose(self) -> None:
        return None


def _client(gw: Gw) -> TestClient:
    settings = _settings(supabase_jwt_secret=SECRET, exercise_signing_key=SIGN)
    return TestClient(create_app(settings, gateway=gw), raise_server_exceptions=False)  # type: ignore[arg-type]


def _headers(
    age: float = 0, sub: uuid.UUID = TUTOR, pin: bool = True, **claims: Any
) -> dict[str, str]:
    """`age`: hace cuántos segundos se verificó el PIN."""
    headers = {"Authorization": f"Bearer {_hs256(sub=str(sub), **claims)}"}
    if pin:
        headers["X-Parental-Token"] = issue_parental_token(
            SIGN.encode(), sub, now=time.time() - age
        )
    return headers


def _confirmation(**over: Any) -> str:
    claims = LinkClaims(TUTOR, STUDENT, TEACHER, "Docente X", TERMS)
    values = {**claims.__dict__, **over}
    return issue_link_token(SIGN.encode(), LinkClaims(**values))


def _lookup(client: TestClient, code: str = CODE, **kw: Any) -> Any:
    return client.post(f"{BASE}/teacher-links/lookup", json={"code": code}, headers=_headers(**kw))


# ------------------------------------------------------------------ PIN recién verificado


def test_buscar_con_el_pin_recien_verificado_funciona() -> None:
    assert _lookup(_client(Gw()), age=5).status_code == 200


def test_el_permiso_del_panel_ya_no_basta_para_buscar() -> None:
    gw = Gw()
    response = _lookup(_client(gw), age=300)  # token válido (vence a los 600 s) pero no reciente
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "parental_required"
    assert gw.lookups == []


def test_quitar_exige_el_pin_recien_verificado() -> None:
    gw = Gw()
    client = _client(gw)
    stale = client.delete(f"{BASE}/teachers/{TEACHER}", headers=_headers(age=300))
    assert stale.status_code == 401 and gw.removed == []
    fresh = client.delete(f"{BASE}/teachers/{TEACHER}", headers=_headers(age=10))
    assert fresh.status_code == 204 and len(gw.removed) == 1


def test_sin_token_del_pin_es_401() -> None:
    client = _client(Gw())
    assert (
        client.post(
            f"{BASE}/teacher-links/lookup", json={"code": CODE}, headers=_headers(pin=False)
        ).status_code
        == 401
    )
    assert (
        client.delete(f"{BASE}/teachers/{TEACHER}", headers=_headers(pin=False)).status_code == 401
    )
    assert client.get(f"{BASE}/teachers", headers=_headers(pin=False)).status_code == 401


def test_el_token_parental_de_otro_tutor_no_sirve() -> None:
    headers = _headers()
    headers["X-Parental-Token"] = issue_parental_token(SIGN.encode(), OTHER_TUTOR)
    response = _client(Gw()).post(
        f"{BASE}/teacher-links/lookup", json={"code": CODE}, headers=headers
    )
    assert response.status_code == 401


def test_edad_maxima_del_token_parental() -> None:
    token = issue_parental_token(SIGN.encode(), TUTOR, now=1000)
    verify_parental(SIGN.encode(), token, TUTOR, now=1050, max_age=120)  # reciente: ok
    with pytest.raises(InvalidParentalToken):
        verify_parental(SIGN.encode(), token, TUTOR, now=1200, max_age=120)  # viejo
    verify_parental(SIGN.encode(), token, TUTOR, now=1200)  # sin límite de edad sigue valiendo
    with pytest.raises(InvalidParentalToken):
        verify_parental(SIGN.encode(), token, TUTOR, now=1000 + TOKEN_TTL_SECONDS)  # vencido


# ------------------------------------------------------------------ buscar


def test_buscar_devuelve_solo_el_nombre_el_texto_vigente_y_un_token() -> None:
    gw = Gw()
    response = _lookup(_client(gw), code=" xxxx2345 ")
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {"teacher_name", "confirmation_token", "terms"}
    assert data["teacher_name"] == "Docente X"
    assert data["terms"] == {"id": str(TERMS), "version": "doc-1", "sha256": "e" * 64}
    assert response.headers["cache-control"] == "no-store"
    assert gw.lookups == [(TUTOR, STUDENT, CODE)]  # el código se normaliza
    claims = verify_link_token(SIGN.encode(), data["confirmation_token"], TUTOR, STUDENT)
    assert claims.teacher_id == TEACHER and claims.teacher_name == "Docente X"


def test_un_codigo_inexistente_y_uno_mal_formado_responden_lo_mismo() -> None:
    client = _client(Gw(lookup=LinkLookup("not_found")))
    missing = _lookup(client, code="ZZZZ2345")
    malformed = _lookup(client, code="abc")
    assert missing.status_code == malformed.status_code == 404
    assert missing.json()["error"]["code"] == malformed.json()["error"]["code"] == "code_not_found"
    assert missing.json()["error"]["message"] == malformed.json()["error"]["message"]


def test_un_codigo_mal_formado_no_llega_a_la_base_ni_cuenta_intento() -> None:
    gw = Gw()
    for code in ("", "abc", "XXXX234", "XXXX23456", "XXXX-345", "XXXX0345", "😀" * 8):
        assert _lookup(_client(gw), code=code).status_code == 404
    assert gw.lookups == []


def test_tras_demasiados_fallos_responde_429_con_retry_after() -> None:
    gw = Gw(lookup=LinkLookup("locked", retry_after=840))
    response = _lookup(_client(gw))
    assert response.status_code == 429
    assert response.headers["retry-after"] == "840"
    assert response.json()["error"]["code"] == "rate_limited"


def test_un_docente_ya_vinculado_se_informa_y_no_se_duplica() -> None:
    response = _lookup(_client(Gw(lookup=LinkLookup("already_linked"))))
    assert response.status_code == 409 and response.json()["error"]["code"] == "already_linked"


def test_buscar_en_un_perfil_ajeno_es_403() -> None:
    client = _client(Gw())
    response = client.post(
        f"/v1/students/{STUDENT2}/teacher-links/lookup", json={"code": CODE}, headers=_headers()
    )
    assert response.status_code == 403


@pytest.mark.parametrize("status", ["no_terms", "student_not_found", "algo_raro"])
def test_estados_sin_nada_que_aceptar_no_entregan_token(status: str) -> None:
    response = _lookup(_client(Gw(lookup=LinkLookup(status))))
    assert response.status_code in (403, 503)
    assert "confirmation_token" not in response.text


def test_buscar_con_la_base_caida_responde_503() -> None:
    assert _lookup(_client(Gw(fail={"lookup"}))).status_code == 503


def test_ni_el_codigo_ni_el_nombre_del_docente_llegan_a_los_logs(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    _lookup(_client(Gw()))
    _lookup(_client(Gw(lookup=LinkLookup("not_found"))), code="ZZZZ2345")
    _lookup(_client(Gw(lookup=LinkLookup("locked", retry_after=5))))
    assert (
        CODE not in caplog.text and "ZZZZ2345" not in caplog.text and "Docente X" not in caplog.text
    )


# ------------------------------------------------------------------ crear


def _create(client: TestClient, token: str | None = None, accept: bool = True, **kw: Any) -> Any:
    return client.post(
        f"{BASE}/teacher-links",
        json={
            "confirmation_token": token if token is not None else _confirmation(),
            "accept": accept,
        },
        headers=_headers(**kw),
    )


def test_crear_el_vinculo_con_lo_que_se_mostro() -> None:
    gw = Gw()
    response = _create(_client(gw))
    assert response.status_code == 201
    assert response.json()["name"] == "Docente X"
    assert gw.created == [(TUTOR, STUDENT, TEACHER, "Docente X", TERMS)]


def test_crear_no_exige_un_pin_recien_verificado_pero_si_vigente() -> None:
    # El PIN reciente se exigió al buscar; aquí basta el permiso vigente.
    assert _create(_client(Gw()), age=300).status_code == 201
    assert _create(_client(Gw()), pin=False).status_code == 401


def test_sin_aceptar_no_se_crea() -> None:
    gw = Gw()
    response = _create(_client(gw), accept=False)
    assert response.status_code == 422 and response.json()["error"]["code"] == "acceptance_required"
    assert gw.created == []


def test_el_token_de_confirmacion_debe_ser_de_este_tutor_y_este_hijo_y_estar_vigente() -> None:
    gw = Gw()
    client = _client(gw)
    other_student = _confirmation(student_id=STUDENT2)
    other_tutor = _confirmation(tutor_id=OTHER_TUTOR)
    expired = issue_link_token(
        SIGN.encode(),
        LinkClaims(TUTOR, STUDENT, TEACHER, "Docente X", TERMS),
        now=time.time() - LINK_TOKEN_TTL_SECONDS - 5,
    )
    tampered = _confirmation()[:-3] + "AAA"
    parental_as_link = issue_parental_token(SIGN.encode(), TUTOR)
    for token in (other_student, other_tutor, expired, tampered, parental_as_link, "x.y", ""):
        response = _create(client, token=token)
        assert response.status_code == 422, token
        assert response.json()["error"]["code"] == "confirmation_expired"
    assert gw.created == []


def test_si_el_docente_cambio_de_nombre_hay_que_volver_a_buscar() -> None:
    for result in ("name_changed", "terms_outdated", "teacher_not_found"):
        response = _create(_client(Gw(create_result=result)))
        assert (
            response.status_code == 409
            and response.json()["error"]["code"] == "confirmation_expired"
        )


def test_ya_vinculado_al_crear_no_duplica() -> None:
    response = _create(_client(Gw(create_result="already_linked")))
    assert response.status_code == 409 and response.json()["error"]["code"] == "already_linked"


def test_sin_consentimiento_vigente_no_se_crea() -> None:
    assert _create(_client(Gw(create_result="consent_required"))).status_code == 403
    assert _create(_client(Gw(create_result="student_not_found"))).status_code == 403


def test_crear_con_la_base_caida_responde_503() -> None:
    assert _create(_client(Gw(fail={"create"}))).status_code == 503


def test_el_token_de_confirmacion_no_se_puede_forjar_con_el_token_parental() -> None:
    with pytest.raises(InvalidLinkToken):
        verify_link_token(SIGN.encode(), issue_parental_token(SIGN.encode(), TUTOR), TUTOR, STUDENT)


# ------------------------------------------------------------------ listar y quitar


def test_listar_los_docentes_del_hijo_sin_correo() -> None:
    response = _client(Gw()).get(f"{BASE}/teachers", headers=_headers(age=300))
    assert response.status_code == 200
    body = response.json()
    assert body["teachers"][0]["name"] == "Docente X"
    assert set(body["teachers"][0]) == {"teacher_id", "name", "shown_name", "accepted_at"}
    assert response.headers["cache-control"] == "no-store"


def test_listar_en_un_perfil_ajeno_es_403() -> None:
    assert _client(Gw(teachers=None)).get(f"{BASE}/teachers", headers=_headers()).status_code == 403


def test_quitar_un_vinculo_que_no_existe_es_404() -> None:
    gw = Gw(remove_result="not_found")
    assert _client(gw).delete(f"{BASE}/teachers/{TEACHER}", headers=_headers()).status_code == 404


def test_quitar_con_la_base_caida_responde_503() -> None:
    gw = Gw(fail={"remove"})
    assert _client(gw).delete(f"{BASE}/teachers/{TEACHER}", headers=_headers()).status_code == 503


def test_quitar_usa_el_tutor_del_token_y_no_borra_nada_mas() -> None:
    gw = Gw()
    _client(gw).delete(f"{BASE}/teachers/{TEACHER}", headers=_headers())
    assert gw.removed == [(TUTOR, STUDENT, TEACHER)]


# ------------------------------------------------------------------ roles


@pytest.mark.parametrize(
    "claims", [{"app_metadata": {"role": "teacher"}}, {"app_metadata": {"role": "admin"}}]
)
def test_un_docente_o_admin_no_vincula_ni_quita(claims: dict[str, Any]) -> None:
    gw = Gw()
    client = _client(gw)
    headers = _headers(**claims)
    assert (
        client.post(
            f"{BASE}/teacher-links/lookup", json={"code": CODE}, headers=headers
        ).status_code
        == 403
    )
    assert client.get(f"{BASE}/teachers", headers=headers).status_code == 403
    assert client.delete(f"{BASE}/teachers/{TEACHER}", headers=headers).status_code == 403
    assert gw.lookups == [] and gw.removed == []


def test_sin_sesion_es_401() -> None:
    client = _client(Gw())
    assert client.post(f"{BASE}/teacher-links/lookup", json={"code": CODE}).status_code == 401
    assert client.get(f"{BASE}/teachers").status_code == 401
