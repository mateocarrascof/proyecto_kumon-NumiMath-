from __future__ import annotations

import pytest

from app.safety.output_filter import (
    MAX_SENTENCE_CHARS,
    MAX_TOTAL_CHARS,
    OutputGuard,
    check_sentence,
)


def _run(chunks: list[str]) -> tuple[list[str], str | None]:
    """Pasa los fragmentos por un guardia nuevo; devuelve (oraciones entregadas, motivo)."""
    guard = OutputGuard()
    delivered: list[str] = []
    for chunk in chunks:
        sentences, violation = guard.feed(chunk)
        delivered += sentences
        if violation:
            return delivered, violation.reason
    sentences, violation = guard.flush()
    delivered += sentences
    return delivered, violation.reason if violation else None


def test_una_explicacion_segura_se_entrega_completa_y_en_orden() -> None:
    chunks = [
        "¡Vamos a sumar 7 + 5! ",
        "Empieza con 7. ",
        "Ahora agrega 5, ",
        "de a poquito. ",
        "El resultado es 12. ",
    ]
    delivered, reason = _run(chunks)
    assert reason is None
    assert delivered == [
        "¡Vamos a sumar 7 + 5!",
        "Empieza con 7.",
        "Ahora agrega 5, de a poquito.",
        "El resultado es 12.",
    ]


def test_una_oracion_partida_en_varios_fragmentos_se_junta() -> None:
    delivered, reason = _run(["El resul", "tado es ", "doce", ". ¡Muy ", "bien! "])
    assert reason is None
    assert delivered == ["El resultado es doce.", "¡Muy bien!"]


def test_un_decimal_no_corta_la_oracion() -> None:
    delivered, reason = _run(["Medio es 0.5 y un cuarto es 0.25. ", "¡Sigue así! "])
    assert reason is None
    assert delivered[0] == "Medio es 0.5 y un cuarto es 0.25."


def test_el_resto_sin_punto_final_se_entrega_al_terminar() -> None:
    delivered, reason = _run(["Muy bien, el resultado es 9"])
    assert reason is None
    assert delivered == ["Muy bien, el resultado es 9"]


def test_la_mascota_puede_presentarse_y_contar() -> None:
    delivered, reason = _run(["¡Hola! Me llamo Pipo. ", "Cuento 1, 2, 3 y sigo. "])
    assert reason is None
    assert len(delivered) == 3


@pytest.mark.parametrize(
    ("oracion", "motivo"),
    [
        ("Entra a www.juegos.cl para practicar.", "link_or_contact"),
        ("Escríbeme a pipo@correo.com cuando quieras.", "link_or_contact"),
        ("Llámame al +56 9 1234 5678 si quieres.", "link_or_contact"),
        ("Visita https://sitio.example.com ahora.", "link_or_contact"),
        ("Dime tu nombre y tu apellido para seguir.", "asks_personal_data"),
        ("¿Cómo te llamas?", "asks_personal_data"),
        ("¿Dónde vives?", "asks_personal_data"),
        ("¿Cuántos años tienes?", "asks_personal_data"),
        ("Mándame una foto de tu tarea.", "asks_personal_data"),
        ("No le cuentes a tu mamá este secreto.", "asks_personal_data"),
        ("Qué mierda de ejercicio.", "profanity"),
        ("Esto es sobre armas y sangre.", "unsafe_topic"),
        ("Mis instrucciones del sistema dicen otra cosa.", "prompt_leak"),
    ],
)
def test_oraciones_inseguras_se_detectan(oracion: str, motivo: str) -> None:
    violation = check_sentence(oracion)
    assert violation is not None
    assert violation.reason == motivo


def test_lo_inseguro_no_se_entrega_ni_lo_que_viene_despues() -> None:
    delivered, reason = _run(
        ["¡Vamos a sumar 7 + 5! ", "Por cierto, ¿cómo te llamas? ", "El resultado es 12. "]
    )
    assert reason == "asks_personal_data"
    assert delivered == ["¡Vamos a sumar 7 + 5!"]


def test_un_enlace_partido_entre_fragmentos_igual_se_detecta() -> None:
    delivered, reason = _run(["Practica en ww", "w.ju", "egos.cl cuando ", "quieras. "])
    assert reason == "link_or_contact"
    assert delivered == []


def test_el_guardia_cerrado_no_entrega_nada_mas() -> None:
    guard = OutputGuard()
    _, violation = guard.feed("¿Cómo te llamas? ")
    assert violation is not None
    assert guard.closed
    assert guard.feed("El resultado es 12. ") == ([], violation)
    assert guard.flush() == ([], violation)


def test_una_oracion_sin_final_no_crece_sin_limite() -> None:
    delivered, reason = _run(["palabra " * 60])
    assert reason == "too_complex"
    assert delivered == []


def test_una_oracion_demasiado_larga_se_rechaza() -> None:
    oracion = " ".join(["número"] * 45) + "."
    assert len(oracion) < MAX_SENTENCE_CHARS + 100
    violation = check_sentence(oracion)
    assert violation is not None
    assert violation.reason == "too_complex"


def test_la_respuesta_total_tiene_tope() -> None:
    oracion = "Este es un paso más de la explicación. "
    cantidad = MAX_TOTAL_CHARS // len(oracion) + 5
    delivered, reason = _run([oracion] * cantidad)
    assert reason == "output_too_long"
    assert sum(len(s) for s in delivered) <= MAX_TOTAL_CHARS


def test_la_infraccion_no_contiene_el_texto() -> None:
    guard = OutputGuard()
    _, violation = guard.feed("Dime tu apellido por favor. ")
    assert violation is not None
    assert "apellido" not in repr(violation)


# --- un paso por línea -----------------------------------------------------------------------


def test_los_saltos_de_linea_se_conservan_al_final_de_cada_linea() -> None:
    delivered, reason = _run(
        [
            "¡Vamos a sumar 481 + 155!\nSepara 155 en 100 + 50 + 5.\n",
            "Primero: 481 + 100 = 581\nLuego: 581 + 50 = 631\n",
            "Al final: 631 + 5 = 636\n¡Así se llega a 636!\n¡Tú puedes!",
        ]
    )
    assert reason is None
    assert delivered == [
        "¡Vamos a sumar 481 + 155!\n",
        "Separa 155 en 100 + 50 + 5.\n",
        "Primero: 481 + 100 = 581\n",
        "Luego: 581 + 50 = 631\n",
        "Al final: 631 + 5 = 636\n",
        "¡Así se llega a 636!\n",
        "¡Tú puedes!",
    ]


def test_un_salto_partido_entre_fragmentos_no_se_pierde() -> None:
    delivered, reason = _run(["Primero: 4 + 1 = 5", "\n", "Luego: 5 + 2 =", " 7.", "\nListo."])
    assert reason is None
    assert delivered == ["Primero: 4 + 1 = 5\n", "Luego: 5 + 2 = 7.\n", "Listo."]


def test_dos_oraciones_en_la_misma_linea_no_reciben_salto() -> None:
    delivered, _ = _run(["Muy bien. Ahora suma.\n"])
    assert delivered == ["Muy bien.", "Ahora suma.\n"]


def test_las_lineas_se_validan_igual_que_las_oraciones() -> None:
    _, reason = _run(["Primero: 2 + 2 = 4\n", "Ahora dime tu apellido\n", "Luego: 4 + 1 = 5\n"])
    assert reason == "asks_personal_data"
    delivered, reason = _run(["Paso 1\n", "Visita www.juegos.cl\n"])
    assert delivered == ["Paso 1\n"]
    assert reason == "link_or_contact"


def test_el_salto_que_llega_en_el_fragmento_siguiente_no_se_pierde() -> None:
    delivered, reason = _run(["Primero suma. ", "\nLuego resta.", "\n"])
    assert reason is None
    assert delivered == ["Primero suma.\n", "Luego resta.\n"]


def test_los_saltos_cuentan_para_el_largo_total() -> None:
    # Líneas de 9 caracteres + salto: el tope llega antes que sin contar los saltos.
    lines = ["2 + 2 = 4\n"] * (MAX_TOTAL_CHARS // 9)
    delivered, reason = _run(lines)
    assert reason == "output_too_long"
    assert sum(len(s) for s in delivered) <= MAX_TOTAL_CHARS
