"""Crear docentes de punta a punta contra el Supabase LOCAL (Auth y base reales).

No corren por defecto. Con `supabase start` y las variables definidas (salen de
`supabase status -o env`; las llaves son las de DEMO local, nunca se versionan):

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> \\
        SUPABASE_SERVICE_ROLE_KEY=<servicio> \\
        api/.venv/Scripts/python -m pytest -q api -m integration -k admin_teachers

Comprueba contra el Auth real lo que las pruebas con dobles no pueden: que `app_metadata.role`
queda grabado (y llega al token), que el docente NO termina con fila en `tutors`, que el correo
repetido no crea nada, que queda el registro del alta y que cada token solo entra a lo suyo.
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

pytestmark = pytest.mark.integration

_URL = os.environ.get("SUPABASE_URL", "")
_ANON = os.environ.get("SUPABASE_ANON_KEY", "")
_SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
_PASSWORD = "Clave-inicial-123"


@pytest.fixture
def base() -> str:
    if not (_URL and _ANON and _SERVICE):
        pytest.skip("faltan SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY")
    return _URL.rstrip("/")


def _service(base: str, prefix: str) -> httpx.Client:
    return httpx.Client(
        base_url=f"{base}{prefix}",
        headers={"apikey": _SERVICE, "Authorization": f"Bearer {_SERVICE}"},
        timeout=20,
    )


def _login(base: str, email: str, password: str) -> str:
    response = httpx.post(
        f"{base}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": _ANON},
        json={"email": email, "password": password},
        timeout=20,
    )
    assert response.status_code == 200
    return str(response.json()["access_token"])


def _api(base: str) -> TestClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        supabase_url=base,
        supabase_service_role_key=_SERVICE,
        exercise_signing_key="clave-de-firma-solo-pruebas-0123456789-abc",
    )
    return TestClient(create_app(settings), raise_server_exceptions=False)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_crear_y_listar_docentes_contra_el_auth_real(base: str) -> None:
    run = uuid.uuid4().hex[:10]
    admin_email = f"admin-{run}@example.test"
    teacher_email = f"docente-{run}@example.test"
    auth = _service(base, "/auth/v1/admin")
    created = auth.post(
        "/users",
        json={
            "email": admin_email,
            "password": _PASSWORD,
            "email_confirm": True,
            "app_metadata": {"role": "admin"},
        },
    )
    assert created.status_code in (200, 201)
    admin_id = created.json()["id"]
    teacher_id = ""
    api_ctx: TestClient | None = None
    try:
        token = _login(base, admin_email, _PASSWORD)
        # Con `with`, el cliente HTTP de la API vive en un solo bucle de eventos entre llamadas.
        api_ctx = _api(base)
        api = api_ctx.__enter__()
        rest = _service(base, "/rest/v1")

        # El administrador no es tutor: el alta no le creó fila en `tutors`.
        assert rest.get("/tutors", params={"id": f"eq.{admin_id}"}).json() == []

        body = {"name": "Profe Prueba", "email": teacher_email, "password": _PASSWORD}
        ok = api.post("/v1/admin/teachers", json=body, headers=_bearer(token))
        assert ok.status_code == 201, ok.text
        teacher_id = ok.json()["id"]
        code = ok.json()["link_code"]
        assert len(code) == 8

        # app_metadata.role quedó grabado y NO hay fila en tutors, con el Auth real.
        assert rest.get("/tutors", params={"id": f"eq.{teacher_id}"}).json() == []
        row = rest.get("/teachers", params={"id": f"eq.{teacher_id}"}).json()
        assert row and row[0]["link_code"] == code and row[0]["name"] == "Profe Prueba"

        # La lista lo trae con su correo y código.
        listed = api.get("/v1/admin/teachers", headers=_bearer(token)).json()["teachers"]
        mine = [t for t in listed if t["id"] == teacher_id]
        assert mine == [
            {"id": teacher_id, "name": "Profe Prueba", "email": teacher_email, "link_code": code}
        ]

        # Queda el registro del alta, solo con ids.
        audit = rest.get("/admin_audit", params={"target_id": f"eq.{teacher_id}"}).json()
        assert (
            audit and audit[0]["admin_id"] == admin_id and audit[0]["action"] == "teacher_created"
        )

        # Correo repetido: 409 y no se crea nada más.
        before = len(listed)
        again = api.post("/v1/admin/teachers", json=body, headers=_bearer(token))
        assert again.status_code == 409
        assert (
            len(api.get("/v1/admin/teachers", headers=_bearer(token)).json()["teachers"]) == before
        )

        # El docente entra con la contraseña inicial y su token solo vale para lo suyo.
        teacher_token = _login(base, teacher_email, _PASSWORD)
        assert api.get("/v1/admin/teachers", headers=_bearer(teacher_token)).status_code == 403
        assert (
            api.get(
                f"/v1/students/{uuid.uuid4()}/progress", headers=_bearer(teacher_token)
            ).status_code
            == 403
        )
        # Con el token del administrador, PostgREST (llave pública) no deja leer ni escribir datos
        # niños. (Las filas reales de niños se siembran en la prueba pgTAP `admin_no_child_data`.)
        public = httpx.Client(
            base_url=f"{base}/rest/v1",
            headers={"apikey": _ANON, "Authorization": f"Bearer {token}"},
            timeout=20,
        )
        for table in (
            "students",
            "student_attempts",
            "student_skill_progress",
            "student_daily_streaks",
            "assigned_exercises",
            "consents",
            "tutors",
            "tutor_pins",
            "teacher_links",
            "admin_audit",
        ):
            read = public.get(f"/{table}", params={"limit": "5"})
            assert read.status_code in (401, 403) or read.json() == [], table
        denied = public.post(
            "/students",
            json={"tutor_id": admin_id, "nickname": "Intruso", "grade": 1},
        )
        assert denied.status_code >= 400
        assert public.get("/students", params={"nickname": "eq.Intruso"}).json() == []
        # Y el del administrador no entra a las rutas del tutor.
        assert (
            api.get(f"/v1/students/{uuid.uuid4()}/progress", headers=_bearer(token)).status_code
            == 403
        )
    finally:
        if api_ctx is not None:
            api_ctx.__exit__(None, None, None)
        auth.delete(f"/users/{admin_id}")
        if teacher_id:
            auth.delete(f"/users/{teacher_id}")


def test_un_admin_degradado_con_token_vigente_no_borra_docentes(base: str) -> None:
    """Con el Auth real: quitarle el rol a un admin corta el borrado aunque tenga token vigente."""
    run = uuid.uuid4().hex[:10]
    admin_email = f"admin-deg-{run}@example.test"
    auth = _service(base, "/auth/v1/admin")
    rest = _service(base, "/rest/v1")
    admin_id = auth.post(
        "/users",
        json={
            "email": admin_email,
            "password": _PASSWORD,
            "email_confirm": True,
            "app_metadata": {"role": "admin"},
        },
    ).json()["id"]
    teacher_id = ""
    try:
        token = _login(base, admin_email, _PASSWORD)
        with _api(base) as api:
            created = api.post(
                "/v1/admin/teachers",
                json={
                    "name": "Profe Degradado",
                    "email": f"docente-deg-{run}@example.test",
                    "password": _PASSWORD,
                },
                headers=_bearer(token),
            )
            assert created.status_code == 201, created.text
            teacher_id = created.json()["id"]

            # Se le quita el rol al admin; el token que ya tenía sigue diciendo "admin".
            demoted = auth.put(f"/users/{admin_id}", json={"app_metadata": {"role": None}})
            assert demoted.status_code == 200, demoted.text

            refused = api.delete(f"/v1/admin/teachers/{teacher_id}", headers=_bearer(token))
            assert refused.status_code == 403
            # El docente sigue existiendo, en Auth y en la base.
            assert auth.get(f"/users/{teacher_id}").status_code == 200
            assert rest.get("/teachers", params={"id": f"eq.{teacher_id}"}).json() != []
    finally:
        for user_id in (teacher_id, admin_id):
            if user_id:
                auth.delete(f"/users/{user_id}")
