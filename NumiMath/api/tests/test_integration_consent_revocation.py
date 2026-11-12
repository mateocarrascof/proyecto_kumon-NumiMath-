"""Revocar el consentimiento de punta a punta contra el Supabase LOCAL (Auth y base reales).

No corren por defecto. Con `supabase start` y las variables definidas (salen de
`supabase status -o env`; la llave de servicio es la de DEMO local, nunca se versiona):

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> \\
        SUPABASE_SERVICE_ROLE_KEY=<servicio> \\
        api/.venv/Scripts/python -m pytest -q api -m integration -k consent_revocation

Se crea una cuenta real con un perfil, se comprueba que el perfil funciona, se revoca por la API
y se comprueba que DESDE ESE MOMENTO no hay práctica, explicaciones, progreso ni informe (403),
que los datos NO se borraron y que quedó la constancia con fecha. Otro tutor no se ve afectado.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.parental import issue_parental_token

pytestmark = pytest.mark.integration

_URL = os.environ.get("SUPABASE_URL", "")
_ANON = os.environ.get("SUPABASE_ANON_KEY", "")
_SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
_SIGN = "clave-de-firma-solo-pruebas-0123456789-abc"
_PASSWORD = "Clave-inicial-123"


@pytest.fixture
def base() -> str:
    if not (_URL and _ANON and _SERVICE):
        pytest.skip("faltan SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY")
    return _URL.rstrip("/")


class _Tutor:
    """Una cuenta real con consentimiento aceptado y un perfil."""

    def __init__(self, base: str) -> None:
        anon = httpx.Client(base_url=base, headers={"apikey": _ANON}, timeout=20)
        email = f"revocar-{uuid.uuid4().hex[:12]}@example.test"
        session = anon.post("/auth/v1/signup", json={"email": email, "password": _PASSWORD}).json()
        self.id = session["user"]["id"]
        self.jwt = session["access_token"]
        self.rest = httpx.Client(
            base_url=f"{base}/rest/v1",
            headers={
                "apikey": _ANON,
                "Authorization": f"Bearer {self.jwt}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            timeout=20,
        )
        versions = {
            v["kind"]: v["id"]
            for v in self.rest.get(
                "/legal_document_versions", params={"is_current": "eq.true"}
            ).json()
        }
        consent = self.rest.post(
            "/consents",
            json={
                "tutor_id": self.id,
                "event_type": "grant",
                "terms_version_id": versions["terms"],
                "privacy_version_id": versions["privacy"],
                "channel": "web",
            },
        )
        assert consent.status_code == 201, consent.text
        student = self.rest.post(
            "/students",
            json={
                "tutor_id": self.id,
                "nickname": "Pia",
                "grade": 2,
                "adult_declaration_accepted": True,
            },
        )
        assert student.status_code == 201, student.text
        self.student = student.json()[0]["id"]

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.jwt}"}

    @property
    def pin(self) -> dict[str, str]:
        return {"X-Parental-Token": issue_parental_token(_SIGN.encode(), uuid.UUID(self.id))}


def _api(base: str) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=base,
        supabase_service_role_key=_SERVICE,
        exercise_signing_key=_SIGN,
    )
    return TestClient(create_app(settings), raise_server_exceptions=False)


def _service(base: str) -> httpx.Client:
    return httpx.Client(
        base_url=f"{base}/rest/v1",
        headers={"apikey": _SERVICE, "Authorization": f"Bearer {_SERVICE}"},
        timeout=20,
    )


def test_al_revocar_deja_de_procesarse_todo_pero_los_datos_no_se_borran(base: str) -> None:
    ana, otra = _Tutor(base), _Tutor(base)
    with _api(base) as api:
        sid = ana.student

        # Antes de revocar el perfil funciona: práctica, progreso y explicación.
        topics = api.get(f"/v1/students/{sid}/topics", headers=ana.auth)
        assert topics.status_code == 200, topics.text
        topic = topics.json()[0]["id"]
        assert (
            api.post(
                f"/v1/students/{sid}/exercises", json={"topic": topic}, headers=ana.auth
            ).status_code
            == 200
        )
        assert api.get(f"/v1/students/{sid}/progress", headers=ana.auth).status_code == 200
        explain = {"topic": topic, "exercise": "7 + 5"}
        before = api.post(f"/v1/students/{sid}/explanations", json=explain, headers=ana.auth)
        assert before.status_code == 200, before.text

        # --- revocar (con el PIN) ---
        started = datetime.now(UTC)
        revoked = api.post("/v1/tutor/consent/revoke", headers={**ana.auth, **ana.pin})
        assert revoked.status_code == 200, revoked.text
        data = revoked.json()
        assert data["status"] == "revoked" and data["profiles_blocked"] == 1
        when = datetime.fromisoformat(data["revoked_at"])
        assert started - timedelta(minutes=1) <= when <= datetime.now(UTC) + timedelta(minutes=1)
        assert data["purge_after_days"] == 30
        assert datetime.fromisoformat(data["purge_at"]) > when

        # --- DESDE ESE MOMENTO no se procesan datos del niño ni se usa la IA ---
        for method, path, kwargs in (
            ("GET", f"/v1/students/{sid}/topics", {}),
            ("POST", f"/v1/students/{sid}/exercises", {"json": {"topic": topic}}),
            ("GET", f"/v1/students/{sid}/progress", {}),
            ("POST", f"/v1/students/{sid}/explanations", {"json": explain}),
            ("GET", f"/v1/students/{sid}/assignments", {}),
            ("GET", f"/v1/students/{sid}/report", {}),
        ):
            response = api.request(method, path, headers={**ana.auth, **ana.pin}, **kwargs)
            assert response.status_code == 403, f"{method} {path} → {response.status_code}"

        # --- los datos NO se borraron: quedan bloqueados con plazo ---
        service = _service(base)
        rows = service.get(
            "/students", params={"id": f"eq.{sid}", "select": "blocked_reason"}
        ).json()
        assert rows == [{"blocked_reason": "consent_revoked"}]
        events = service.get(
            "/consents",
            params={
                "tutor_id": f"eq.{ana.id}",
                "order": "seq.asc",
                "select": "event_type,occurred_at",
            },
        ).json()
        assert [e["event_type"] for e in events] == ["grant", "revoke"]  # la constancia con fecha
        assert datetime.fromisoformat(events[1]["occurred_at"]) == when

        # --- revocar otra vez es seguro y devuelve la misma fecha ---
        again = api.post("/v1/tutor/consent/revoke", headers={**ana.auth, **ana.pin}).json()
        assert again["status"] == "already_revoked" and again["revoked_at"] == data["revoked_at"]

        # --- el otro tutor no se ve afectado ---
        assert api.get(f"/v1/students/{otra.student}/topics", headers=otra.auth).status_code == 200
        # ... y el id a revocar sale solo del JWT: "otra" no puede revocar el consentimiento de
        # una tercera persona aunque mande su id en el cuerpo.
        tercera = _Tutor(base)
        own = api.post(
            "/v1/tutor/consent/revoke",
            json={"tutor_id": tercera.id},
            headers={**otra.auth, **otra.pin},
        )
        assert own.status_code == 200
        assert api.get(f"/v1/students/{otra.student}/topics", headers=otra.auth).status_code == 403
        assert (
            api.get(f"/v1/students/{tercera.student}/topics", headers=tercera.auth).status_code
            == 200
        )


def test_sin_pin_no_se_revoca_y_el_perfil_sigue_funcionando(base: str) -> None:
    ana = _Tutor(base)
    with _api(base) as api:
        response = api.post("/v1/tutor/consent/revoke", headers=ana.auth)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "parental_required"
        assert api.get(f"/v1/students/{ana.student}/topics", headers=ana.auth).status_code == 200
        service = _service(base)
        events = service.get(
            "/consents", params={"tutor_id": f"eq.{ana.id}", "select": "event_type"}
        ).json()
        assert [e["event_type"] for e in events] == ["grant"]
