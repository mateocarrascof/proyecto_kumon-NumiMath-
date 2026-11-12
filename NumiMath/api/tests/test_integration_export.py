"""T22 contra el Supabase LOCAL: el tutor exporta el CSV de su hijo (PIN, sin datos ajenos)."""

from __future__ import annotations

import csv
import io
import os
import uuid

import httpx
import pytest

from tests.test_integration_teacher_links import _api, _service, _Tutor

pytestmark = pytest.mark.integration

_URL = os.environ.get("SUPABASE_URL", "")
_ANON = os.environ.get("SUPABASE_ANON_KEY", "")
_SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


@pytest.fixture
def base() -> str:
    if not (_URL and _ANON and _SERVICE):
        pytest.skip("faltan SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY")
    return _URL.rstrip("/")


def test_exportar_csv_contra_la_base_real(base: str) -> None:
    rest = _service(base, "/rest/v1")
    tutor, stranger = _Tutor(base), _Tutor(base)
    try:
        pia = tutor.students[0]
        with _api(base) as api:
            path = f"/v1/students/{pia}/export.csv"
            # Sin intentos: se informa, no hay archivo.
            empty = api.get(path, headers=tutor.headers())
            assert empty.status_code == 404 and empty.json()["error"]["code"] == "no_data"

            for _ in range(2):
                rest.post(
                    "/student_attempts",
                    json={
                        "student_id": pia,
                        "tutor_id": tutor.id,
                        "exercise_id": str(uuid.uuid4()),
                        "topic": "2-01",
                        "exercise": "SECRETO 7 + 5",
                        "correct": True,
                        "level": 1,
                        "duration_s": 9,
                        "activity": "practice",
                    },
                )
            ok = api.get(path, headers=tutor.headers())
            assert ok.status_code == 200 and ok.headers["content-type"].startswith("text/csv")
            rows = list(csv.reader(io.StringIO(ok.text.lstrip("﻿"))))
            assert ["Total", "2", "2", "100%"] in rows
            assert "SECRETO" not in ok.text  # el enunciado nunca sale en el CSV

            # Sin PIN no hay archivo; otro tutor no exporta datos ajenos.
            assert api.get(path).status_code == 401
            assert api.get(path, headers=stranger.headers()).status_code == 403
    finally:
        for user_id in (tutor.id, stranger.id):
            httpx.delete(
                f"{base}/auth/v1/admin/users/{user_id}",
                headers={"apikey": _SERVICE, "Authorization": f"Bearer {_SERVICE}"},
                timeout=20,
            )
