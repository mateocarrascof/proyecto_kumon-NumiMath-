"""Evolución del progreso (CU-A23) contra el Supabase LOCAL (Auth y base reales).

No corren por defecto. Con `supabase start` y las variables de `supabase status -o env`
(la llave de servicio es la de DEMO local, nunca se versiona):

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> \\
        SUPABASE_SERVICE_ROLE_KEY=<servicio> \\
        api/.venv/Scripts/python -m pytest -q api -m integration -k progress_evolution

Una cuenta real hace el diagnóstico inicial completo (6 intentos) y luego 2 ejercicios de
práctica: la evolución por semana debe contar SOLO las 2 prácticas. Es la prueba de punta a punta
del filtro `activity = 'practice'` (los dobles en memoria no distinguen el tipo de intento).
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.exercises.tokens import verify
from app.main import create_app

pytestmark = pytest.mark.integration

_URL = os.environ.get("SUPABASE_URL", "")
_ANON = os.environ.get("SUPABASE_ANON_KEY", "")
_SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
_SIGN = "clave-de-firma-solo-pruebas-0123456789-abc"
_PASSWORD = "Clave-inicial-123"
_TOPIC = "1-08"


@pytest.fixture
def base() -> str:
    if not (_URL and _ANON and _SERVICE):
        pytest.skip("faltan SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY")
    return _URL.rstrip("/")


def _tutor_with_student(base: str) -> tuple[str, str]:
    """Cuenta real con consentimiento aceptado y un perfil de 1° básico. Devuelve (jwt, perfil)."""
    anon = httpx.Client(base_url=base, headers={"apikey": _ANON}, timeout=20)
    email = f"evolucion-{uuid.uuid4().hex[:12]}@example.test"
    session = anon.post("/auth/v1/signup", json={"email": email, "password": _PASSWORD}).json()
    tutor_id, token = session["user"]["id"], session["access_token"]
    rest = httpx.Client(
        base_url=f"{base}/rest/v1",
        headers={
            "apikey": _ANON,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        timeout=20,
    )
    versions = {
        v["kind"]: v["id"]
        for v in rest.get("/legal_document_versions", params={"is_current": "eq.true"}).json()
    }
    consent = rest.post(
        "/consents",
        json={
            "tutor_id": tutor_id,
            "event_type": "grant",
            "terms_version_id": versions["terms"],
            "privacy_version_id": versions["privacy"],
            "channel": "web",
        },
    )
    assert consent.status_code == 201, consent.text
    student = rest.post(
        "/students",
        json={
            "tutor_id": tutor_id,
            "nickname": "Tomi",
            "grade": 1,
            "adult_declaration_accepted": True,
        },
    )
    assert student.status_code == 201, student.text
    return token, student.json()[0]["id"]


def _api(base: str) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=base,
        supabase_service_role_key=_SERVICE,
        exercise_signing_key=_SIGN,
    )
    return TestClient(create_app(settings), raise_server_exceptions=False)


def test_la_evolucion_no_cuenta_el_diagnostico(base: str) -> None:
    token, student = _tutor_with_student(base)
    auth = {"Authorization": f"Bearer {token}"}
    key = _SIGN.encode()
    perfil = uuid.UUID(student)

    with _api(base) as api:
        # Diagnóstico completo: 6 intentos guardados como 'diagnostic'.
        answers = []
        for step in range(6):
            response = api.post(
                f"/v1/students/{student}/diagnostic/exercises",
                json={"topic": _TOPIC, "step": step},
                headers=auth,
            )
            assert response.status_code == 200, response.text
            tok = response.json()["token"]
            answers.append(
                {"token": tok, "answer": verify(key, tok, perfil, diagnostic=True).exercise.answer}
            )
        saved = api.post(
            f"/v1/students/{student}/diagnostic",
            json={"topic": _TOPIC, "answers": answers},
            headers=auth,
        )
        assert saved.status_code == 200, saved.text

        # Dos ejercicios de práctica.
        for _ in range(2):
            tok = api.post(
                f"/v1/students/{student}/exercises", json={"topic": _TOPIC}, headers=auth
            ).json()["token"]
            answered = api.post(
                f"/v1/students/{student}/exercises/answer",
                json={"token": tok, "answer": verify(key, tok, perfil).exercise.answer},
                headers=auth,
            )
            assert answered.status_code == 200, answered.text

        today = datetime.now(UTC).date().isoformat()
        progress = api.get(
            f"/v1/students/{student}/progress", params={"today": today}, headers=auth
        )
        assert progress.status_code == 200, progress.text
        body = progress.json()
        assert body["total"] == 2
        assert len(body["weeks"]) == 8
        assert sum(w["total"] for w in body["weeks"]) == 2
        assert body["weeks"][-1]["total"] == 2 and body["weeks"][-1]["correct"] == 2
