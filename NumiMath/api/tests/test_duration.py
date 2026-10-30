"""Tiempo por ejercicio: lo mide el servidor (firmado) y el informe usa la mediana."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.db.gateway import AttemptRow
from app.exercises.tickets import duration_since, issue_ticket, ticket_duration
from app.exercises.tokens import issue, verify
from app.routes.report import typical_seconds

KEY = b"clave-de-firma-de-ejercicios-solo-pruebas"
PERFIL = uuid.UUID("11111111-aaaa-0000-0000-000000000001")
OTRO = uuid.UUID("22222222-bbbb-0000-0000-000000000002")
TAREA = uuid.UUID("33333333-cccc-0000-0000-000000000003")


@pytest.mark.parametrize(
    ("elapsed", "expected"),
    [(0, 0), (42.4, 42), (600, 600), (601, None), (-2, 0), (-30, None)],
)
def test_duracion_creible_y_con_tope(elapsed: float, expected: int | None) -> None:
    assert duration_since(1000, now=1000 + elapsed) == expected


def test_el_token_del_ejercicio_lleva_la_hora_de_emision_firmada() -> None:
    issued = issue(KEY, PERFIL, "1-08", 600, now=1_000_000)
    assert issued is not None
    verified = verify(KEY, issued.token, PERFIL, now=1_000_042)
    assert verified.issued_at == 1_000_000
    assert duration_since(verified.issued_at, now=1_000_042) == 42


def test_ticket_de_tarea_mide_el_tiempo() -> None:
    ticket = issue_ticket(KEY, TAREA, PERFIL, now=5000)
    assert ticket_duration(KEY, ticket, TAREA, PERFIL, now=5095) == 95


@pytest.mark.parametrize(
    "caso", ["otra_tarea", "otro_perfil", "otra_clave", "alterado", "vencido", "vacio", "basura"]
)
def test_un_ticket_que_no_sirve_no_da_tiempo(caso: str) -> None:
    ticket = issue_ticket(KEY, TAREA, PERFIL, now=5000)
    args = {"key": KEY, "ticket": ticket, "a": TAREA, "s": PERFIL, "now": 5010.0}
    if caso == "otra_tarea":
        args["a"] = uuid.uuid4()
    elif caso == "otro_perfil":
        args["s"] = OTRO
    elif caso == "otra_clave":
        args["key"] = b"otra"
    elif caso == "alterado":
        payload, signature = ticket.split(".")
        args["ticket"] = f"{payload[:-2]}AA.{signature}"
    elif caso == "vencido":
        args["now"] = 5000 + 601.0
    elif caso == "vacio":
        args["ticket"] = None
    else:
        args["ticket"] = "a.b.c"
    assert (
        ticket_duration(args["key"], args["ticket"], args["a"], args["s"], now=args["now"]) is None
    )  # type: ignore[arg-type]


def _at(seconds: int | None, topic: str = "sumas") -> AttemptRow:
    return AttemptRow(topic, True, datetime.now(UTC), seconds)


def test_tiempo_tipico_es_la_mediana_y_pide_al_menos_3_datos() -> None:
    assert typical_seconds([_at(10), _at(20)]) is None
    assert typical_seconds([_at(10), _at(20), _at(None), _at(30)]) == 20
    # Un ejercicio olvidado abierto no distorsiona la mediana.
    assert typical_seconds([_at(20), _at(25), _at(30), _at(600)]) == 28
