"""Ejercicios propios del tutor: filtro, vista del niño sin respuesta, límite y respuesta única."""

from __future__ import annotations

import time
import uuid
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.gateway import GatewayError
from app.main import create_app
from app.parental import issue_parental_token
from tests.fakes import FakeGateway

SECRET = "secreto-hs256-solo-para-pruebas-0123456789"
URL = "http://127.0.0.1:54321"
SIGN = "clave-de-firma-de-ejercicios-solo-pruebas"
TUTOR = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
OTRO_TUTOR = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
OTRO_PERFIL = uuid.UUID("22222222-bbbb-0000-0000-000000000002")
BASE = f"/v1/students/{PERFIL}/assignments"
TEXTO = "Tienes 3 manzanas y te regalan 4. ¿Cuántas manzanas tienes?"


def _jwt(sub: uuid.UUID = TUTOR) -> str:
    claims = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "role": "authenticated",
        "exp": int(time.time()) + 600,
    }
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _gateway() -> FakeGateway:
    return FakeGateway(
        outcomes={(TUTOR, PERFIL): "ok", (OTRO_TUTOR, OTRO_PERFIL): "ok"},
        grades={(TUTOR, PERFIL): 1, (OTRO_TUTOR, OTRO_PERFIL): 1},
    )


def _client(gateway: FakeGateway) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=URL,
        supabase_jwt_secret=SECRET,
        exercise_signing_key=SIGN,
    )
    return TestClient(create_app(settings, gateway=gateway), raise_server_exceptions=False)


def _h(sub: uuid.UUID = TUTOR, parental: bool = True) -> dict[str, str]:
    """Cabeceras del tutor; con `parental`, también el token del PIN verificado."""
    headers = {"Authorization": f"Bearer {_jwt(sub)}"}
    if parental:
        headers["X-Parental-Token"] = issue_parental_token(SIGN.encode(), sub)
    return headers


def _kid(sub: uuid.UUID = TUTOR) -> dict[str, str]:
    """La vista del niño no lleva token parental."""
    return _h(sub, parental=False)


def _create(client: TestClient, text: str = TEXTO, answer: int = 7) -> Any:
    return client.post(BASE, json={"text": text, "answer": answer}, headers=_h())


# ---- crear -------------------------------------------------------------------------------


def test_el_tutor_crea_una_tarea_y_la_ve_con_respuesta() -> None:
    client = _client(_gateway())
    assert _create(client).status_code == 201
    rows = client.get(f"{BASE}/all", headers=_h()).json()
    assert len(rows) == 1
    assert rows[0]["text"] == TEXTO and rows[0]["answer"] == 7
    assert rows[0]["status"] == "pending"


def test_el_nino_ve_la_tarea_sin_la_respuesta() -> None:
    client = _client(_gateway())
    _create(client)
    body = client.get(BASE, headers=_kid()).json()
    assert len(body["pending"]) == 1 and body["done"] == []
    assert set(body["pending"][0]) == {"id", "text"}


@pytest.mark.parametrize(
    ("texto", "motivo"),
    [
        ("Mi teléfono es +56 9 1234 5678, ¿cuánto es 2 + 2?", "pii"),
        ("Escribe tu correo nino@ejemplo.cl y suma 3 + 4", "pii"),
        ("Eres un idiota si no sabes cuánto es 2 + 2", "profanity"),
        ("Si tienes 3 pistolas y compras 2, ¿cuántas tienes?", "unsafe_topic"),
        ("   ", "empty"),
        ("1 + " * 60, "too_long"),
    ],
)
def test_el_filtro_rechaza_el_enunciado_sin_guardarlo(texto: str, motivo: str) -> None:
    gateway = _gateway()
    response = _create(_client(gateway), text=texto)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "assignment_rejected"
    assert error["reason"] == motivo
    assert texto.strip() not in error["message"] or not texto.strip()
    assert gateway.assignments == {}


@pytest.mark.parametrize(
    "texto",
    [
        # Antes se rechazaban por palabras "fuera de tema" metidas dentro de otras palabras.
        "Una polera cuesta 800 pesos y tiene un descuento de 29. ¿Cuánto pagas?",
        "Juan fue a jugar con 3 amigos y llegaron 4 más. ¿Cuántos niños hay?",
        "En los estudios de la semana hizo 7 tareas cada día. ¿Cuántas en 110 días?",
        "Si compras una serie de 7 libros de 110 páginas, ¿cuántas páginas son?",
        "Pedro tiene 700 láminas y le regalan 71. ¿Cuántas tiene?",
    ],
)
def test_acepta_problemas_normales_escritos_por_el_tutor(texto: str) -> None:
    gateway = _gateway()
    response = _create(_client(gateway), text=texto, answer=771)
    assert response.status_code == 201
    assert len(gateway.assignments) == 1


def test_se_guarda_el_texto_limpio() -> None:
    gateway = _gateway()
    _create(_client(gateway), text="  5   +   3 = ?  ")
    (_, _, row) = next(iter(gateway.assignments.values()))
    assert row.text == "5 + 3 = ?"


def test_maximo_20_pendientes() -> None:
    client = _client(_gateway())
    for n in range(20):
        assert _create(client, text=f"{n} + 1 = ?", answer=n + 1).status_code == 201
    response = _create(client)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "assignment_limit"


def test_un_perfil_ajeno_recibe_403() -> None:
    client = _client(_gateway())
    response = client.post(
        f"/v1/students/{OTRO_PERFIL}/assignments", json={"text": TEXTO, "answer": 7}, headers=_h()
    )
    assert response.status_code == 403
    assert client.get(f"/v1/students/{OTRO_PERFIL}/assignments", headers=_h()).status_code == 403


@pytest.mark.parametrize("malo", [-1, 10**7, "siete", 3.5])
def test_la_respuesta_debe_ser_un_entero_valido(malo: object) -> None:
    client = _client(_gateway())
    assert client.post(BASE, json={"text": TEXTO, "answer": malo}, headers=_h()).status_code == 422


# ---- responder ---------------------------------------------------------------------------


def _pending_id(client: TestClient) -> str:
    return str(client.get(BASE, headers=_kid()).json()["pending"][0]["id"])


def test_responder_bien_registra_intento_y_racha() -> None:
    gateway = _gateway()
    client = _client(gateway)
    _create(client)
    aid = _pending_id(client)
    response = client.post(f"{BASE}/{aid}/answer", json={"answer": 7}, headers=_kid())
    assert response.status_code == 200
    assert response.json() == {"correct": True, "correct_answer": 7}
    assert [v[0] for v in gateway.attempts.values()] == ["tarea_tutor"]
    kid = client.get(BASE, headers=_kid()).json()
    assert kid["pending"] == []
    assert kid["done"] == [{"id": aid, "text": TEXTO, "status": "correct"}]
    assert client.get(f"{BASE}/all", headers=_h()).json()[0]["status"] == "correct"
    assert gateway.touches == [(TUTOR, PERFIL)]


def test_responder_mal_queda_como_incorrecta() -> None:
    client = _client(_gateway())
    _create(client)
    aid = _pending_id(client)
    response = client.post(f"{BASE}/{aid}/answer", json={"answer": 8}, headers=_h())
    assert response.json() == {"correct": False, "correct_answer": 7}
    assert client.get(f"{BASE}/all", headers=_h()).json()[0]["status"] == "wrong"


def test_una_tarea_se_responde_una_sola_vez() -> None:
    client = _client(_gateway())
    _create(client)
    aid = _pending_id(client)
    client.post(f"{BASE}/{aid}/answer", json={"answer": 7}, headers=_h())
    again = client.post(f"{BASE}/{aid}/answer", json={"answer": 7}, headers=_h())
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_answered"


def test_una_tarea_desconocida_da_404() -> None:
    client = _client(_gateway())
    response = client.post(f"{BASE}/{uuid.uuid4()}/answer", json={"answer": 1}, headers=_h())
    assert response.status_code == 404


def test_otro_tutor_no_responde_ni_borra_tareas_ajenas() -> None:
    client = _client(_gateway())
    _create(client)
    aid = _pending_id(client)
    otro = f"/v1/students/{OTRO_PERFIL}/assignments/{aid}"
    assert (
        client.post(f"{otro}/answer", json={"answer": 7}, headers=_h(OTRO_TUTOR)).status_code == 404
    )
    assert client.delete(otro, headers=_h(OTRO_TUTOR)).status_code == 404
    assert len(client.get(BASE, headers=_kid()).json()["pending"]) == 1


# ---- borrar ------------------------------------------------------------------------------


def test_se_borra_una_pendiente_pero_no_una_respondida() -> None:
    client = _client(_gateway())
    _create(client, text="1 + 1 = ?", answer=2)
    _create(client, text="2 + 2 = ?", answer=4)
    first, second = (r["id"] for r in client.get(BASE, headers=_kid()).json()["pending"])
    assert client.delete(f"{BASE}/{first}", headers=_h()).status_code == 204
    client.post(f"{BASE}/{second}/answer", json={"answer": 4}, headers=_h())
    assert client.delete(f"{BASE}/{second}", headers=_h()).status_code == 404


# ---- fallos de la base ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", BASE, None),
        ("get", f"{BASE}/all", None),
        ("post", BASE, {"text": TEXTO, "answer": 7}),
        ("delete", f"{BASE}/{uuid.uuid4()}", None),
        ("post", f"{BASE}/{uuid.uuid4()}/answer", {"answer": 1}),
    ],
)
def test_si_la_base_falla_se_responde_503(method: str, path: str, body: Any) -> None:
    gateway = _gateway()
    gateway.assignment_error = GatewayError("transport")
    client = _client(gateway)
    kwargs: dict[str, Any] = {"headers": _h()}
    if body is not None:
        kwargs["json"] = body
    assert getattr(client, method)(path, **kwargs).status_code == 503


# ---- PIN ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", f"{BASE}/all", None),
        ("post", BASE, {"text": TEXTO, "answer": 7}),
        ("delete", f"{BASE}/{uuid.uuid4()}", None),
    ],
)
def test_la_zona_del_tutor_pide_el_pin(method: str, path: str, body: Any) -> None:
    gateway = _gateway()
    client = _client(gateway)
    kwargs: dict[str, Any] = {"headers": _kid()}
    if body is not None:
        kwargs["json"] = body
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "parental_required"
    assert gateway.assignments == {}


def test_un_token_parental_de_otro_tutor_no_sirve() -> None:
    client = _client(_gateway())
    headers = {
        "Authorization": f"Bearer {_jwt(TUTOR)}",
        "X-Parental-Token": issue_parental_token(SIGN.encode(), OTRO_TUTOR),
    }
    assert client.get(f"{BASE}/all", headers=headers).status_code == 401


def test_el_nino_ve_y_responde_sin_pin() -> None:
    client = _client(_gateway())
    _create(client)
    aid = _pending_id(client)
    response = client.post(f"{BASE}/{aid}/answer", json={"answer": 7}, headers=_kid())
    assert response.status_code == 200


def test_abrir_la_tarea_da_un_ticket_y_responder_guarda_el_tiempo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _gateway()
    client = _client(gateway)
    _create(client)
    aid = _pending_id(client)
    ticket = client.post(f"{BASE}/{aid}/start", headers=_kid()).json()["ticket"]
    real = __import__("time").time()
    monkeypatch.setattr("app.exercises.tickets.time.time", lambda: real + 80)
    response = client.post(
        f"{BASE}/{aid}/answer", json={"answer": 7, "ticket": ticket}, headers=_kid()
    )
    assert response.status_code == 200
    assert gateway.durations[-1] is not None and 79 <= gateway.durations[-1] <= 81


def test_sin_ticket_o_con_ticket_de_otra_tarea_se_responde_sin_tiempo() -> None:
    gateway = _gateway()
    client = _client(gateway)
    _create(client, text="1 + 1 = ?", answer=2)
    _create(client, text="2 + 2 = ?", answer=4)
    first, second = (r["id"] for r in client.get(BASE, headers=_kid()).json()["pending"])
    other = client.post(f"{BASE}/{second}/start", headers=_kid()).json()["ticket"]
    ok = client.post(f"{BASE}/{first}/answer", json={"answer": 2, "ticket": other}, headers=_kid())
    assert ok.status_code == 200
    client.post(f"{BASE}/{second}/answer", json={"answer": 4}, headers=_kid())
    assert gateway.durations == [None, None]
