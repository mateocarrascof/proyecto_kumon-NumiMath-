from __future__ import annotations

import argparse
import asyncio
import time

import pytest

from app.ai.topics import topics_for_grade


def _args(**kwargs: object) -> argparse.Namespace:
    base: dict[str, object] = {
        "exercise": "¿Cuánto es 7 + 5?",
        "grade": 1,
        "topic": None,
        "unsafe": False,
        "revoke_after": None,
        "delay": 0.0,
        "requests": 1,
        "student_limit": 30,
        "serve": False,
        "logs": False,
    }
    base.update(kwargs)
    return argparse.Namespace(**base)


# --- tema por defecto de la demo -------------------------------------------------------------


@pytest.mark.parametrize(
    ("curso", "ejercicio", "esperado"),
    [
        (1, "¿Cuánto es 7 + 5?", "1-06"),
        (1, "9 - 4", "1-07"),
        (2, "38 + 27", "2-07"),
        (2, "23 - 9", "2-08"),
        (3, "6 × 7", "3-08"),
        (3, "12 ÷ 3", "3-11"),
        (4, "12 x 5", "4-03"),
        (4, "17 ÷ 5", "4-03"),
        (1, "hola", "1-01"),  # sin operación: el primero del curso
    ],
)
def test_la_demo_elige_el_tema_segun_la_operacion(
    curso: int, ejercicio: str, esperado: str
) -> None:
    from app.devtools.demo import default_topic

    tema = default_topic(curso, ejercicio)
    assert tema == esperado
    assert tema in {t.id for t in topics_for_grade(curso)}


# --- la demo termina limpia --------------------------------------------------------------------


async def test_la_demo_normal_termina_sin_errores() -> None:
    from app.devtools.demo import _main

    assert await asyncio.wait_for(_main(_args()), timeout=30) == 0


async def test_interrumpir_la_demo_con_serve_termina_en_silencio(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Ctrl+C cancela la tarea principal; no debe quedar un CancelledError sin manejar."""
    from app.devtools.demo import _main

    tarea = asyncio.create_task(_main(_args(serve=True)))
    salida = ""
    limite = time.monotonic() + 15
    while "Documentación interactiva" not in salida and time.monotonic() < limite:
        await asyncio.sleep(0.1)
        salida += capsys.readouterr().out
    assert "Documentación interactiva" in salida

    tarea.cancel()
    assert await asyncio.wait_for(tarea, timeout=15) == 0
