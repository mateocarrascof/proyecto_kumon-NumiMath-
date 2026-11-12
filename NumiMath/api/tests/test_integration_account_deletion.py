"""Eliminar la cuenta de punta a punta contra el Supabase LOCAL: Auth real + base real.

No corren por defecto. Con `supabase start` y las variables definidas (salen de
`supabase status -o env`; la llave de servicio es la de DEMO local, nunca se versiona):

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> \\
        SUPABASE_SERVICE_ROLE_KEY=<servicio> \\
        api/.venv/Scripts/python -m pytest -q api -m integration -k account_deletion

Se crea una cuenta real con datos en TODAS las tablas, se elimina por la API y se comprueba que
NO queda nada: ni el usuario en Auth, ni el tutor, ni los perfiles, ni el progreso, las tareas, la
racha, el uso, el PIN o los consentimientos. Solo queda la evidencia mínima que exige la ley.
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.account import evidence_key, tutor_ref
from app.config import Settings
from app.main import create_app

pytestmark = pytest.mark.integration

_URL = os.environ.get("SUPABASE_URL", "")
_ANON = os.environ.get("SUPABASE_ANON_KEY", "")
_SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
_SIGN = "clave-de-firma-solo-pruebas-0123456789-abc"
_PASSWORD = "Clave-inicial-123"

# Tablas públicas con datos del tutor o de sus perfiles: deben quedar SIN filas.
_BY_TUTOR = [
    "consents",
    "student_creation_log",
    "tutor_pins",
    "usage_tutor_daily",
    "students",
    "student_attempts",
    "student_daily_streaks",
    "student_skill_progress",
    "student_status_events",
    "assigned_exercises",
    "usage_student_daily",
]


@pytest.fixture
def env() -> dict[str, str]:
    if not (_URL and _ANON and _SERVICE):
        pytest.skip("faltan SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY")
    return {"url": _URL.rstrip("/")}


def _rest(client: httpx.Client, method: str, path: str, **kwargs: object) -> httpx.Response:
    return client.request(method, f"/rest/v1/{path}", **kwargs)  # type: ignore[arg-type]


def _count(service: httpx.Client, table: str, column: str, value: str) -> int:
    response = _rest(service, "GET", f"{table}", params={"select": "*", column: f"eq.{value}"})
    assert response.status_code == 200, f"{table}: {response.text}"
    return len(response.json())


def test_eliminar_la_cuenta_no_deja_nada_y_conserva_solo_la_evidencia_minima(
    env: dict[str, str],
) -> None:
    base = env["url"]
    anon = httpx.Client(
        base_url=base, headers={"apikey": _ANON, "Content-Type": "application/json"}, timeout=20
    )
    service = httpx.Client(
        base_url=base,
        headers={
            "apikey": _SERVICE,
            "Authorization": f"Bearer {_SERVICE}",
            "Content-Type": "application/json",
        },
        timeout=20,
    )

    # --- una cuenta real con datos en todas partes ---------------------------------------------
    email = f"borrar-{uuid.uuid4().hex[:12]}@example.test"
    signup = anon.post("/auth/v1/signup", json={"email": email, "password": _PASSWORD})
    assert signup.status_code == 200, signup.text
    session = signup.json()
    tutor_id = session["user"]["id"]
    user = httpx.Client(
        base_url=base,
        headers={
            "apikey": _ANON,
            "Authorization": f"Bearer {session['access_token']}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        timeout=20,
    )

    versions = {
        v["kind"]: v["id"]
        for v in _rest(
            user, "GET", "legal_document_versions", params={"is_current": "eq.true"}
        ).json()
    }
    consent = _rest(
        user,
        "POST",
        "consents",
        json={
            "tutor_id": tutor_id,
            "event_type": "grant",
            "terms_version_id": versions["terms"],
            "privacy_version_id": versions["privacy"],
            "channel": "web",
        },
    )
    assert consent.status_code == 201, consent.text
    student = _rest(
        user,
        "POST",
        "students",
        json={
            "tutor_id": tutor_id,
            "nickname": "Pia",
            "grade": 2,
            "adult_declaration_accepted": True,
        },
    )
    assert student.status_code == 201, student.text
    student_id = student.json()[0]["id"]

    def rpc(name: str, payload: dict) -> httpx.Response:
        return service.post(f"/rest/v1/rpc/{name}", json=payload)

    exercise_id = str(uuid.uuid4())
    assert rpc(
        "record_attempt",
        {
            "p_tutor_id": tutor_id,
            "p_student_id": student_id,
            "p_exercise_id": exercise_id,
            "p_topic": "sumas_hasta_20",
            "p_exercise": "7 + 5",
            "p_correct": True,
        },
    ).status_code in (200, 204), "no se pudo crear el intento de prueba"
    assert rpc(
        "set_tutor_pin",
        {
            "p_tutor_id": tutor_id,
            "p_pin_hash": "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$" + "a" * 43,
        },
    ).status_code in (200, 204)
    assert (
        rpc(
            "consume_usage",
            {
                "p_tutor_id": tutor_id,
                "p_student_id": student_id,
                "p_cost": 1,
                "p_student_limit": 30,
                "p_tutor_limit": 90,
            },
        ).status_code
        == 200
    )
    assigned = service.post(
        "/rest/v1/assigned_exercises",
        json={"student_id": student_id, "tutor_id": tutor_id, "text": "3 + 4 = ?", "answer": 7},
    )
    assert assigned.status_code == 201, assigned.text

    # Antes de borrar sí hay datos (la verificación no es vacía).
    present = {t: _count(service, t, "tutor_id", tutor_id) for t in _BY_TUTOR}
    assert present["students"] == 1 and present["consents"] == 1
    assert present["student_attempts"] == 1 and present["tutor_pins"] == 1
    assert present["assigned_exercises"] == 1
    declarations_before = len(_rest(service, "GET", "declaration_evidence").json())

    # --- eliminar por la API real (Auth y base reales) -----------------------------------------
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=base,
        supabase_service_role_key=_SERVICE,
        exercise_signing_key=_SIGN,
    )
    key = evidence_key(settings)
    assert key is not None
    app = create_app(settings)
    with TestClient(app, raise_server_exceptions=False) as api:
        response = api.post(
            "/v1/tutor/account/delete",
            json={"confirm": "ELIMINAR"},
            # El JWT del registro acaba de salir de una contraseña: es la confirmación fuerte.
            headers={"Authorization": f"Bearer {session['access_token']}"},
        )
    assert response.status_code == 204, response.text

    # --- NO queda nada ---------------------------------------------------------------------------
    for table in _BY_TUTOR:
        assert _count(service, table, "tutor_id", tutor_id) == 0, f"quedan filas en {table}"
    assert _count(service, "tutors", "id", tutor_id) == 0
    assert _count(service, "students", "id", student_id) == 0
    for table in (
        "student_attempts",
        "student_daily_streaks",
        "student_skill_progress",
        "assigned_exercises",
        "usage_student_daily",
        "student_status_events",
    ):
        assert _count(service, table, "student_id", student_id) == 0, f"quedan filas en {table}"
    gone = service.get(f"/auth/v1/admin/users/{tutor_id}")
    assert gone.status_code == 404, "el usuario sigue existiendo en Auth"
    login = anon.post(
        "/auth/v1/token",
        params={"grant_type": "password"},
        json={"email": email, "password": _PASSWORD},
    )
    assert login.status_code == 400, "no debe poder volver a entrar"

    # --- lo único que queda: evidencia mínima, sin identificadores en claro --------------------
    evidence = _rest(
        service,
        "GET",
        "consent_evidence",
        params={"tutor_ref": f"eq.{tutor_ref(key, uuid.UUID(tutor_id))}"},
    ).json()
    assert [e["event_type"] for e in sorted(evidence, key=lambda e: e["source_seq"])] == [
        "grant",
        "revoke",
    ]
    text = str(evidence)
    assert tutor_id not in text and email not in text
    declarations_after = len(_rest(service, "GET", "declaration_evidence").json())
    assert declarations_after == declarations_before + 1
    newest = _rest(
        service, "GET", "declaration_evidence", params={"order": "archived_at.desc", "limit": "1"}
    ).json()
    assert "Pia" not in str(newest)


def test_con_la_palabra_incorrecta_no_se_borra_nada(env: dict[str, str]) -> None:
    """Contra la base real: sin escribir ELIMINAR la cuenta sigue existiendo (422)."""
    base = env["url"]
    anon = httpx.Client(base_url=base, headers={"apikey": _ANON}, timeout=20)
    email = f"conservar-{uuid.uuid4().hex[:12]}@example.test"
    session = anon.post("/auth/v1/signup", json={"email": email, "password": _PASSWORD}).json()
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=base,
        supabase_service_role_key=_SERVICE,
        exercise_signing_key=_SIGN,
    )
    with TestClient(create_app(settings), raise_server_exceptions=False) as api:
        response = api.post(
            "/v1/tutor/account/delete",
            json={"confirm": "borrar"},
            headers={"Authorization": f"Bearer {session['access_token']}"},
        )
    assert response.status_code == 422, response.text
    service = httpx.Client(
        base_url=base, headers={"apikey": _SERVICE, "Authorization": f"Bearer {_SERVICE}"}
    )
    assert service.get(f"/auth/v1/admin/users/{session['user']['id']}").status_code == 200
