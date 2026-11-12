"""Lecturas del docente (D4, D5, D7) y del tutor (T5) contra el Supabase LOCAL (Auth y base reales).

No corren por defecto. Con `supabase start` y las variables definidas (salen de
`supabase status -o env`; las llaves son las de DEMO local, nunca se versionan):

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon> \\
        SUPABASE_SERVICE_ROLE_KEY=<servicio> \\
        api/.venv/Scripts/python -m pytest -q api -m integration -k teacher_reads

Con un docente real entrando por la API se comprueba: sin vínculo (o tras quitarlo, o con el
consentimiento revocado) no se ve nada y la respuesta es la misma que para un niño inexistente; el
historial solo muestra lo posterior a `accepted_at`, sin el texto de las tareas del tutor ni
duraciones, y un vínculo nuevo parte de su propia fecha.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from tests.test_integration_teacher_links import _api, _service, _Tutor

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


def _login(base: str, email: str) -> dict[str, str]:
    response = httpx.post(
        f"{base}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": _ANON},
        json={"email": email, "password": _PASSWORD},
        timeout=20,
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_lecturas_del_docente_contra_la_base_real(base: str) -> None:
    run = uuid.uuid4().hex[:8].upper()
    code = f"{run[:4]}2345".replace("0", "2").replace("1", "3")
    auth = _service(base, "/auth/v1/admin")
    rest = _service(base, "/rest/v1")
    email = f"docente-{run}@example.test"
    created = auth.post(
        "/users",
        json={
            "email": email,
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
        tutor = _Tutor(base)
        ids.append(tutor.id)
        pia, leo = tutor.students
        terms = rest.get(
            "/legal_document_versions",
            params={"kind": "eq.teacher_authorization", "is_current": "eq.true"},
        ).json()[0]["id"]

        def attempt(student: str, topic: str, exercise: str, when: datetime) -> None:
            row = rest.post(
                "/student_attempts",
                json={
                    "student_id": student,
                    "tutor_id": tutor.id,
                    "exercise_id": str(uuid.uuid4()),
                    "topic": topic,
                    "exercise": exercise,
                    "correct": topic != "tarea_tutor",
                    "answered_at": when.isoformat(),
                    "level": 1,
                    "duration_s": 17,
                    "activity": "practice",
                },
            )
            assert row.status_code == 201, row.text

        def link() -> None:
            result = rest.post(
                "/rpc/create_teacher_link",
                json={
                    "p_tutor_id": tutor.id,
                    "p_student_id": pia,
                    "p_teacher_id": teacher_id,
                    "p_teacher_name": "Docente Real",
                    "p_terms_version_id": terms,
                },
            )
            assert result.json() == "ok", result.text

        now = datetime.now(UTC)
        attempt(pia, "2-01", "ANTES 1 + 1", now - timedelta(days=2))
        attempt(leo, "2-01", "DE LEO 5 + 5", now - timedelta(minutes=5))
        rest.post(
            "/student_skill_progress",
            json={
                "student_id": pia,
                "tutor_id": tutor.id,
                "skill_code": "2-01",
                "level": 2,
                "block_total": 3,
                "block_correct": 2,
            },
        )

        with _api(base) as api:
            teacher = _login(base, email)
            missing = str(uuid.uuid4())

            # Sin vínculo: no ve nada y la respuesta es la misma que para un niño inexistente.
            assert api.get("/v1/teacher/students", headers=teacher).json() == {"students": []}
            for kind in ("progress", "history", "evolution"):
                unlinked = api.get(f"/v1/teacher/students/{pia}/{kind}", headers=teacher)
                absent = api.get(f"/v1/teacher/students/{missing}/{kind}", headers=teacher)
                assert unlinked.status_code == absent.status_code == 404
                assert unlinked.json()["error"]["message"] == absent.json()["error"]["message"]

            link()
            attempt(pia, "2-01", "7 + 5", now + timedelta(seconds=30))
            attempt(pia, "tarea_tutor", "Carla vive en Los Pinos 123", now + timedelta(seconds=60))

            listed = api.get("/v1/teacher/students", headers=teacher).json()["students"]
            assert listed == [{"student_id": pia, "nickname": "Pia", "grade": 2}]  # no ve a Leo

            progress = api.get(f"/v1/teacher/students/{pia}/progress", headers=teacher).json()
            assert [s["code"] for s in progress["skills"]] == ["2-01"]
            assert progress["skills"][0]["level"] == 2 and progress["skills"][0]["label"]
            other = api.get(f"/v1/teacher/students/{leo}/progress", headers=teacher)
            assert other.status_code == 404  # mismo tutor, pero sin vínculo con ese hijo

            history = api.get(f"/v1/teacher/students/{pia}/history", headers=teacher)
            assert history.status_code == 200
            items = history.json()["items"]
            assert [i["tutor_task"] for i in items] == [True, False]  # solo lo posterior al vínculo
            assert items[0]["exercise"] is None and items[1]["exercise"] == "7 + 5"
            for forbidden in ("ANTES", "DE LEO", "Carla", "Pinos", "17", "duration"):
                assert forbidden not in history.text
            assert all(
                set(i) == {"label", "tutor_task", "exercise", "correct", "level", "day"}
                for i in items
            )
            page = api.get(f"/v1/teacher/students/{pia}/history?limit=1", headers=teacher).json()
            assert page["has_more"] is True and page["next_offset"] == 1 and len(page["items"]) == 1
            rest_page = api.get(
                f"/v1/teacher/students/{pia}/history?limit=1&offset=1", headers=teacher
            ).json()
            assert rest_page["has_more"] is False and rest_page["items"][0]["exercise"] == "7 + 5"
            # Solo lectura.
            assert (
                api.post(f"/v1/teacher/students/{pia}/history", headers=teacher).status_code == 405
            )

            # T5: el tutor (con su PIN) ve TODOS los intentos de su hijo, con hora.
            mine = api.get(f"/v1/students/{pia}/history", headers=tutor.headers()).json()
            assert len(mine["items"]) == 3 and "answered_at" in mine["items"][0]
            assert (
                api.get(f"/v1/students/{pia}/history", headers=tutor.headers(pin_age=0)).status_code
                == 200
            )

            # D6: 8 semanas con solo lo posterior al vínculo (2 intentos), solo totales.
            evolution = api.get(f"/v1/teacher/students/{pia}/evolution", headers=teacher).json()
            assert len(evolution["weeks"]) == 8
            assert sum(w["total"] for w in evolution["weeks"]) == 2
            assert all(set(w) == {"start", "total", "correct"} for w in evolution["weeks"])

            # Se quita el vínculo: el docente deja de ver todo.
            removed = rest.post(
                "/rpc/remove_teacher_link",
                json={"p_tutor_id": tutor.id, "p_student_id": pia, "p_teacher_id": teacher_id},
            )
            assert removed.json() == "ok"
            assert api.get("/v1/teacher/students", headers=teacher).json() == {"students": []}
            for kind in ("progress", "history", "evolution"):
                assert (
                    api.get(f"/v1/teacher/students/{pia}/{kind}", headers=teacher).status_code
                    == 404
                )

            # Un vínculo nuevo parte de SU fecha: solo se ve lo posterior a su `accepted_at`.
            link()
            patched = rest.patch(
                "/teacher_links",
                params={"teacher_id": f"eq.{teacher_id}", "student_id": f"eq.{pia}"},
                json={"accepted_at": (now + timedelta(seconds=45)).isoformat()},
            )
            assert patched.status_code in (200, 204)
            again = api.get(f"/v1/teacher/students/{pia}/history", headers=teacher).json()
            assert [i["tutor_task"] for i in again["items"]] == [True]  # lo de +30 s ya no se ve

            # Consentimiento revocado: sin acceso.
            assert (
                rest.post("/rpc/revoke_consent", json={"p_tutor_id": tutor.id}).status_code == 200
            )
            assert api.get("/v1/teacher/students", headers=teacher).json() == {"students": []}
            assert (
                api.get(f"/v1/teacher/students/{pia}/progress", headers=teacher).status_code == 404
            )
    finally:
        for user_id in ids:
            auth.delete(f"/users/{user_id}")
