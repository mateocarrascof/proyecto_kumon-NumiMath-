"""Hojas del papel (CU-A22, CU-D8) contra el Supabase LOCAL (Auth y base reales).

No corren por defecto: `-m integration` con SUPABASE_URL, SUPABASE_ANON_KEY y
SUPABASE_SERVICE_ROLE_KEY (de `supabase status -o env`; llaves de DEMO local, nunca versionadas).

Con un tutor y un docente reales: sin vínculo no se guarda; con vínculo se guarda sola (y de nuevo
sin duplicar); el docente ve la hoja y solo la guardada desde su vínculo; quitar el vínculo no la
borra pero deja de verse; revocar el consentimiento la borra.
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest

from app.exercises.tokens import verify
from tests.test_integration_teacher_links import _api, _service, _Tutor
from tests.test_integration_teacher_reads import _login

pytestmark = pytest.mark.integration

_URL = os.environ.get("SUPABASE_URL", "")
_ANON = os.environ.get("SUPABASE_ANON_KEY", "")
_SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
_PASSWORD = "Clave-inicial-123"
_SIGN = "clave-de-firma-solo-pruebas-0123456789-abc"
_STROKES = [{"eraser": False, "color": "#2b2d42", "width": 4, "points": [[10, 10], [60, 40]]}]


@pytest.fixture
def base() -> str:
    if not (_URL and _ANON and _SERVICE):
        pytest.skip("faltan SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY")
    return _URL.rstrip("/")


def test_hojas_guardadas_contra_la_base_real(base: str) -> None:
    run = uuid.uuid4().hex[:8].upper()
    code = f"{run[:4]}2345".replace("0", "2").replace("1", "3")
    auth = _service(base, "/auth/v1/admin")
    rest = _service(base, "/rest/v1")
    email = f"docente-hojas-{run}@example.test"
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
                "/teachers", json={"id": teacher_id, "name": "Docente Hojas", "link_code": code}
            ).status_code
            == 201
        )
        tutor = _Tutor(base)
        ids.append(tutor.id)
        pia = tutor.students[0]
        terms = rest.get(
            "/legal_document_versions",
            params={"kind": "eq.teacher_authorization", "is_current": "eq.true"},
        ).json()[0]["id"]

        with _api(base) as api:
            teacher = _login(base, email)

            def practice() -> tuple[str, int]:
                """Pide un ejercicio, lo responde bien y devuelve (token, respuesta)."""
                exercise = api.post(
                    f"/v1/students/{pia}/exercises", json={"topic": "2-01"}, headers=tutor.headers()
                ).json()
                answer = verify(_SIGN.encode(), exercise["token"], uuid.UUID(pia)).exercise.answer
                done = api.post(
                    f"/v1/students/{pia}/exercises/answer",
                    json={"token": exercise["token"], "answer": answer},
                    headers=tutor.headers(),
                )
                assert done.status_code == 200, done.text
                return exercise["token"], answer

            def save(token: str, answer: int) -> dict[str, bool]:
                response = api.post(
                    f"/v1/students/{pia}/exercises/sheet",
                    json={"token": token, "answer": answer, "strokes": _STROKES},
                    headers=tutor.headers(),
                )
                assert response.status_code == 200, response.text
                return response.json()

            # Sin docente vinculado: el ejercicio se registra y la hoja NO se guarda.
            token, answer = practice()
            assert save(token, answer) == {"saved": False}
            assert rest.get("/student_sheets", params={"student_id": f"eq.{pia}"}).json() == []
            enabled = f"/v1/students/{pia}/sheets/enabled"
            assert api.get(enabled, headers=tutor.headers()).json() == {"enabled": False}

            linked = rest.post(
                "/rpc/create_teacher_link",
                json={
                    "p_tutor_id": tutor.id,
                    "p_student_id": pia,
                    "p_teacher_id": teacher_id,
                    "p_teacher_name": "Docente Hojas",
                    "p_terms_version_id": terms,
                },
            )
            assert linked.json() == "ok", linked.text

            # Con vínculo (texto prov-5, que cubre las hojas) se habilita y se guarda; otra vez
            # (manual) no duplica.
            assert api.get(enabled, headers=tutor.headers()).json() == {"enabled": True}
            token, answer = practice()
            assert save(token, answer) == {"saved": True}
            assert save(token, answer) == {"saved": True}
            rows = rest.get("/student_sheets", params={"student_id": f"eq.{pia}"}).json()
            assert len(rows) == 1 and rows[0]["content"]["child_answer"] == str(answer)
            assert rows[0]["content"]["strokes"][0]["points"] == [[10, 10], [60, 40]]

            # Una respuesta que no coincide con el intento registrado no se guarda.
            assert save(token, answer + 1) == {"saved": False}

            # El docente la ve (y solo esa: la del ejercicio previo al vínculo no existe).
            listed = api.get(f"/v1/teacher/students/{pia}/sheets", headers=teacher).json()
            assert len(listed["items"]) == 1
            sheet_id = listed["items"][0]["id"]
            sheet = api.get(f"/v1/teacher/students/{pia}/sheets/{sheet_id}", headers=teacher).json()
            assert sheet["child_answer"] == str(answer) and sheet["correct"] is True
            assert sheet["strokes"][0]["points"] == [[10.0, 10.0], [60.0, 40.0]]
            # Otro niño del mismo tutor, sin vínculo: el mismo 404 que para un id inexistente.
            leo = tutor.students[1]
            absent = api.get(f"/v1/teacher/students/{uuid.uuid4()}/sheets", headers=teacher)
            other = api.get(f"/v1/teacher/students/{leo}/sheets", headers=teacher)
            assert other.status_code == absent.status_code == 404
            assert other.json()["error"]["message"] == absent.json()["error"]["message"]

            # Quitar el vínculo NO borra la hoja, pero el docente deja de verla.
            removed = rest.post(
                "/rpc/remove_teacher_link",
                json={"p_tutor_id": tutor.id, "p_student_id": pia, "p_teacher_id": teacher_id},
            )
            assert removed.json() == "ok"
            assert len(rest.get("/student_sheets", params={"student_id": f"eq.{pia}"}).json()) == 1
            gone = api.get(f"/v1/teacher/students/{pia}/sheets/{sheet_id}", headers=teacher)
            assert gone.status_code == 404

            # Revocar el consentimiento borra las hojas del tutor.
            revoked = rest.post("/rpc/revoke_consent", json={"p_tutor_id": tutor.id})
            assert revoked.status_code in (200, 204), revoked.text
            assert rest.get("/student_sheets", params={"tutor_id": f"eq.{tutor.id}"}).json() == []
    finally:
        for user_id in ids:
            httpx.delete(
                f"{base}/auth/v1/admin/users/{user_id}",
                headers={"apikey": _SERVICE, "Authorization": f"Bearer {_SERVICE}"},
                timeout=20,
            )


def test_el_tutor_ve_y_borra_las_hojas_contra_la_base_real(base: str) -> None:
    """T27: el tutor lista, abre y borra (una o todas) con PIN reciente; el docente las pierde."""
    run = uuid.uuid4().hex[:8].upper()
    code = f"{run[:4]}2345".replace("0", "2").replace("1", "3")
    auth = _service(base, "/auth/v1/admin")
    rest = _service(base, "/rest/v1")
    email = f"docente-t27-{run}@example.test"
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
                "/teachers", json={"id": teacher_id, "name": "Docente T27", "link_code": code}
            ).status_code
            == 201
        )
        tutor, stranger = _Tutor(base), _Tutor(base)
        ids += [tutor.id, stranger.id]
        pia = tutor.students[0]
        terms = rest.get(
            "/legal_document_versions",
            params={"kind": "eq.teacher_authorization", "is_current": "eq.true"},
        ).json()[0]["id"]
        linked = rest.post(
            "/rpc/create_teacher_link",
            json={
                "p_tutor_id": tutor.id,
                "p_student_id": pia,
                "p_teacher_id": teacher_id,
                "p_teacher_name": "Docente T27",
                "p_terms_version_id": terms,
            },
        )
        assert linked.json() == "ok", linked.text

        with _api(base) as api:
            teacher = _login(base, email)

            def practice_and_save() -> None:
                exercise = api.post(
                    f"/v1/students/{pia}/exercises", json={"topic": "2-01"}, headers=tutor.headers()
                ).json()
                answer = verify(_SIGN.encode(), exercise["token"], uuid.UUID(pia)).exercise.answer
                done = api.post(
                    f"/v1/students/{pia}/exercises/answer",
                    json={"token": exercise["token"], "answer": answer},
                    headers=tutor.headers(),
                )
                assert done.status_code == 200, done.text
                saved = api.post(
                    f"/v1/students/{pia}/exercises/sheet",
                    json={"token": exercise["token"], "answer": answer, "strokes": _STROKES},
                    headers=tutor.headers(),
                )
                assert saved.json() == {"saved": True}, saved.text

            for _ in range(3):
                practice_and_save()
            sheets = f"/v1/students/{pia}/sheets"

            # El tutor titular ve la lista (con total y hora) y abre una hoja con sus trazos.
            listed = api.get(sheets, headers=tutor.headers()).json()
            assert listed["total"] == 3 and len(listed["items"]) == 3
            first = listed["items"][0]
            assert set(first) == {"id", "label", "tutor_task", "correct", "statement", "saved_at"}
            opened = api.get(f"{sheets}/{first['id']}", headers=tutor.headers()).json()
            assert opened["strokes"][0]["points"] == [[10.0, 10.0], [60.0, 40.0]]

            # Sin PIN activo no se ve; otro tutor recibe el mismo 404 que con un perfil inexistente.
            assert api.get(sheets).status_code == 401
            other = api.get(sheets, headers=stranger.headers())
            absent = api.get(f"/v1/students/{uuid.uuid4()}/sheets", headers=tutor.headers())
            assert other.status_code == absent.status_code == 404
            assert other.json()["error"]["message"] == absent.json()["error"]["message"]
            assert (
                api.delete(f"{sheets}/{first['id']}", headers=stranger.headers()).status_code == 404
            )

            # Borrar exige el PIN RECIÉN verificado: con uno viejo, 401 y no se borra nada.
            stale = api.delete(f"{sheets}/{first['id']}", headers=tutor.headers(pin_age=600))
            assert stale.status_code == 401
            assert api.get(sheets, headers=tutor.headers()).json()["total"] == 3

            # El docente ve las 3; el tutor borra una con el PIN reciente y el docente ya ve 2.
            teacher_list = f"/v1/teacher/students/{pia}/sheets"
            assert len(api.get(teacher_list, headers=teacher).json()["items"]) == 3
            removed = api.delete(f"{sheets}/{first['id']}", headers=tutor.headers(pin_age=0))
            assert removed.status_code == 204
            assert api.get(f"{sheets}/{first['id']}", headers=tutor.headers()).status_code == 404
            seen = api.get(teacher_list, headers=teacher).json()["items"]
            assert len(seen) == 2 and first["id"] not in [s["id"] for s in seen]
            gone = api.get(f"/v1/teacher/students/{pia}/sheets/{first['id']}", headers=teacher)
            assert gone.status_code == 404

            # Borrar todas dice cuántas fueron; el docente ya no ve ninguna.
            everything = api.delete(sheets, headers=tutor.headers(pin_age=0))
            assert everything.status_code == 200 and everything.json() == {"deleted": 2}
            assert api.get(teacher_list, headers=teacher).json()["items"] == []
            assert api.get(sheets, headers=tutor.headers()).json()["total"] == 0
            assert rest.get("/student_sheets", params={"student_id": f"eq.{pia}"}).json() == []
    finally:
        for user_id in ids:
            httpx.delete(
                f"{base}/auth/v1/admin/users/{user_id}",
                headers={"apikey": _SERVICE, "Authorization": f"Bearer {_SERVICE}"},
                timeout=20,
            )
