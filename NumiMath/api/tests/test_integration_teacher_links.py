"""Vincular y quitar docentes (T25, T26) de punta a punta contra el Supabase LOCAL (Auth y base).

No corren por defecto. Con `supabase start` y las variables definidas (salen de
`supabase status -o env`; las llaves son las de DEMO local, nunca se versionan):

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> \\
        SUPABASE_SERVICE_ROLE_KEY=<servicio> \\
        api/.venv/Scripts/python -m pytest -q api -m integration -k teacher_links

Comprueba con la base real: el límite de 5 fallos y 15 minutos (por tutor), el vínculo por hijo,
que el docente solo ve al niño mientras el vínculo existe (`teacher_can_view`) y que quitar el
vínculo no toca al niño. El PIN se simula acuñando el token con la clave de firma del servidor.
"""

from __future__ import annotations

import os
import time
import uuid

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
    """Una cuenta real con consentimiento aceptado y dos perfiles."""

    def __init__(self, base: str) -> None:
        anon = httpx.Client(base_url=base, headers={"apikey": _ANON}, timeout=20)
        email = f"vincular-{uuid.uuid4().hex[:12]}@example.test"
        session = anon.post("/auth/v1/signup", json={"email": email, "password": _PASSWORD}).json()
        self.id = session["user"]["id"]
        self.jwt = session["access_token"]
        rest = httpx.Client(
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
            for v in rest.get("/legal_document_versions", params={"is_current": "eq.true"}).json()
        }
        assert "teacher_authorization" in versions  # lo publica la semilla
        consent = rest.post(
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
        self.students: list[str] = []
        for nickname in ("Pia", "Leo"):
            student = rest.post(
                "/students",
                json={
                    "tutor_id": self.id,
                    "nickname": nickname,
                    "grade": 2,
                    "adult_declaration_accepted": True,
                },
            )
            assert student.status_code == 201, student.text
            self.students.append(student.json()[0]["id"])

    def headers(self, pin_age: float = 0) -> dict[str, str]:
        token = issue_parental_token(_SIGN.encode(), uuid.UUID(self.id), now=time.time() - pin_age)
        return {"Authorization": f"Bearer {self.jwt}", "X-Parental-Token": token}


def _service(base: str, prefix: str) -> httpx.Client:
    return httpx.Client(
        base_url=f"{base}{prefix}",
        headers={
            "apikey": _SERVICE,
            "Authorization": f"Bearer {_SERVICE}",
            "Content-Type": "application/json",
        },
        timeout=20,
    )


def _api(base: str) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=base,
        supabase_service_role_key=_SERVICE,
        exercise_signing_key=_SIGN,
    )
    return TestClient(create_app(settings), raise_server_exceptions=False)


def test_vincular_y_quitar_docentes_contra_la_base_real(base: str) -> None:
    run = uuid.uuid4().hex[:8].upper()
    code = f"{run[:4]}2345".replace("0", "2").replace("1", "3")
    auth = _service(base, "/auth/v1/admin")
    rest = _service(base, "/rest/v1")
    created = auth.post(
        "/users",
        json={
            "email": f"docente-{run}@example.test",
            "password": _PASSWORD,
            "email_confirm": True,
            "app_metadata": {"role": "teacher"},
        },
    )
    assert created.status_code in (200, 201)
    teacher_id = created.json()["id"]
    ids = [teacher_id]
    try:
        assert (
            rest.post(
                "/teachers", json={"id": teacher_id, "name": "Docente Real", "link_code": code}
            ).status_code
            == 201
        )
        tutor, other = _Tutor(base), _Tutor(base)
        ids += [tutor.id, other.id]
        pia, leo = tutor.students

        def can_view(student: str) -> bool:
            result = rest.post(
                "/rpc/teacher_can_view", json={"p_teacher_id": teacher_id, "p_student_id": student}
            )
            return bool(result.json())

        with _api(base) as api:
            url = f"/v1/students/{pia}/teacher-links"

            # El PIN debe ser reciente: el permiso del panel (más viejo) no basta.
            stale = api.post(
                f"{url}/lookup", json={"code": code}, headers=tutor.headers(pin_age=300)
            )
            assert stale.status_code == 401

            # Límite: 5 códigos que no existen y el sexto (aunque sea el bueno) se bloquea.
            for n in range(5):
                bad = api.post(
                    f"{url}/lookup", json={"code": f"ZZZZ234{n + 2}"}, headers=tutor.headers()
                )
                assert bad.status_code == 404 and bad.json()["error"]["code"] == "code_not_found"
            locked = api.post(f"{url}/lookup", json={"code": code}, headers=tutor.headers())
            assert locked.status_code == 429 and int(locked.headers["retry-after"]) > 0
            # El bloqueo es por tutor: otro tutor puede buscar al mismo docente.
            elsewhere = api.post(
                f"/v1/students/{other.students[0]}/teacher-links/lookup",
                json={"code": code},
                headers=other.headers(),
            )
            assert (
                elsewhere.status_code == 200 and elsewhere.json()["teacher_name"] == "Docente Real"
            )
            # Vence el bloqueo (se simula) y todo vuelve a funcionar.
            rest.patch(
                "/link_code_attempts",
                params={"tutor_id": f"eq.{tutor.id}"},
                json={"locked_until": "2000-01-01T00:00:00Z"},
            )

            found = api.post(f"{url}/lookup", json={"code": code.lower()}, headers=tutor.headers())
            assert found.status_code == 200, found.text
            data = found.json()
            assert data["teacher_name"] == "Docente Real" and len(data["terms"]["sha256"]) == 64

            # Sin aceptar, no se crea; aceptando, queda el vínculo con lo que se mostró.
            no = api.post(
                url,
                json={"confirmation_token": data["confirmation_token"], "accept": False},
                headers=tutor.headers(),
            )
            assert no.status_code == 422 and not can_view(pia)
            ok = api.post(
                url,
                json={"confirmation_token": data["confirmation_token"], "accept": True},
                headers=tutor.headers(),
            )
            assert ok.status_code == 201, ok.text
            link = rest.get("/teacher_links", params={"student_id": f"eq.{pia}"}).json()[0]
            assert link["teacher_name"] == "Docente Real"
            assert link["terms_version_id"] == data["terms"]["id"] and link["accepted_at"]

            # El docente ve a ESE hijo y a ningún otro (cada hijo se vincula por separado).
            assert can_view(pia) and not can_view(leo)
            again = api.post(f"{url}/lookup", json={"code": code}, headers=tutor.headers())
            assert again.status_code == 409 and again.json()["error"]["code"] == "already_linked"
            listed = api.get(f"/v1/students/{pia}/teachers", headers=tutor.headers()).json()
            assert [t["name"] for t in listed["teachers"]] == ["Docente Real"]
            assert api.get(f"/v1/students/{leo}/teachers", headers=tutor.headers()).json() == {
                "teachers": []
            }
            # Otro tutor no ve ni toca este vínculo.
            assert (
                api.get(f"/v1/students/{pia}/teachers", headers=other.headers()).status_code == 403
            )
            gone = api.delete(f"/v1/students/{pia}/teachers/{teacher_id}", headers=other.headers())
            assert gone.status_code in (403, 404) and can_view(pia)

            # Quitar: PIN reciente. El docente deja de ver al niño; el niño no se toca.
            old = api.delete(
                f"/v1/students/{pia}/teachers/{teacher_id}", headers=tutor.headers(pin_age=300)
            )
            assert old.status_code == 401 and can_view(pia)
            removed = api.delete(
                f"/v1/students/{pia}/teachers/{teacher_id}", headers=tutor.headers()
            )
            assert removed.status_code == 204
            assert not can_view(pia)
            assert rest.get("/students", params={"id": f"eq.{pia}"}).json() != []
            assert (
                api.delete(
                    f"/v1/students/{pia}/teachers/{teacher_id}", headers=tutor.headers()
                ).status_code
                == 404
            )
    finally:
        for user_id in ids:
            auth.delete(f"/users/{user_id}")
