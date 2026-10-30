"""Temas de práctica: las habilidades del catálogo curricular (`app/curriculum/catalog.py`).

El "tema" que viaja en tokens, intentos y explicaciones es el código de la habilidad (p. ej.
"1-06"). Un alumno puede practicar las habilidades de fase A de su curso y, como repaso, las de
cursos anteriores; el servidor rechaza cualquier otra (el curso se lee de la base, nunca del
cliente).

Los intentos guardados antes del catálogo usan los 20 temas antiguos: se conservan en el historial
con su nombre (`LEGACY_TOPIC_LABELS`), pero no se pueden practicar ni pedir explicaciones de ellos.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.curriculum.catalog import get_skill, is_practice_skill, practice_skills


@dataclass(frozen=True)
class Topic:
    id: str
    label: str
    module: str = ""
    grade: int = 0


# Tema de los intentos que vienen de "Tareas de tu tutor" (ejercicios propios). No es un tema de
# práctica: no se ofrece en la lista, no tiene generador y no se acepta para explicaciones de la IA.
ASSIGNMENT_TOPIC = "tarea_tutor"
ASSIGNMENT_LABEL = "Tareas del tutor"

# Temas provisionales usados antes del catálogo (solo para mostrar el historial).
LEGACY_TOPIC_LABELS: dict[str, str] = {
    "contar_hasta_100": "Contar hasta 100",
    "sumas_hasta_20": "Sumas hasta 20",
    "restas_hasta_20": "Restas hasta 20",
    "comparar_numeros": "Comparar números (mayor, menor, igual)",
    "patrones_simples": "Patrones simples",
    "numeros_hasta_1000": "Números hasta 1.000",
    "sumas_con_reserva": "Sumas con reserva",
    "restas_con_canje": "Restas con canje",
    "tablas_del_2_5_10": "Tablas del 2, del 5 y del 10",
    "dobles_y_mitades": "Dobles y mitades",
    "tablas_de_multiplicar": "Tablas de multiplicar",
    "division_basica": "División básica",
    "fracciones_simples": "Fracciones simples",
    "perimetro_figuras": "Perímetro de figuras",
    "problemas_de_dos_pasos": "Problemas de dos pasos",
    "numeros_hasta_10000": "Números hasta 10.000",
    "multiplicacion_dos_cifras": "Multiplicación por números de dos cifras",
    "division_con_resto": "División con resto",
    "fracciones_equivalentes": "Fracciones equivalentes",
    "area_y_perimetro": "Área y perímetro",
}


def _topic(code: str) -> Topic | None:
    skill = get_skill(code)
    if skill is None:
        return None
    return Topic(skill.code, skill.name, skill.module, skill.grade)


def topic_label(grade: int, topic_id: str) -> str:
    if topic_id == ASSIGNMENT_TOPIC:
        return ASSIGNMENT_LABEL
    skill = get_skill(topic_id)
    if skill is not None:
        return skill.name
    return LEGACY_TOPIC_LABELS.get(topic_id, topic_id)


def topics_for_grade(grade: int) -> tuple[Topic, ...]:
    """Habilidades practicables: primero las del curso, luego las de repaso."""
    return tuple(Topic(s.code, s.name, s.module, s.grade) for s in practice_skills(grade))


def get_topic(grade: int, topic_id: str) -> Topic | None:
    """La habilidad, solo si el alumno de ese curso puede practicarla."""
    return _topic(topic_id) if is_practice_skill(grade, topic_id) else None
