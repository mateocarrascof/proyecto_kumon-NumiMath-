"""Temas de práctica por curso (1° a 4° básico).

╔══════════════════════════════════════════════════════════════════════════════════════════╗
║  PENDIENTE DE REVISIÓN DEL USUARIO: esta lista es PROVISIONAL.                           ║
║  Fue escrita por el asistente como punto de partida; no es currículo validado.           ║
║  Edítala libremente: solo hay que mantener el formato (id estable, etiqueta legible).    ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝

Cómo editar:
- `id`: identificador estable que envía la app (sin tildes ni espacios). Cambiarlo rompe a los
  clientes que ya lo usan; agregar o quitar temas es seguro.
- `label`: nombre legible, para el prompt y para la interfaz.
- Un tema pertenece a un curso: el servidor rechaza un tema que no corresponde al curso del
  perfil (el curso se lee de la base, nunca del cliente).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Topic:
    id: str
    label: str


# PENDIENTE DE REVISIÓN DEL USUARIO (ver el encabezado del archivo).
TOPICS_BY_GRADE: dict[int, tuple[Topic, ...]] = {
    1: (
        Topic("contar_hasta_100", "Contar hasta 100"),
        Topic("sumas_hasta_20", "Sumas hasta 20"),
        Topic("restas_hasta_20", "Restas hasta 20"),
        Topic("comparar_numeros", "Comparar números (mayor, menor, igual)"),
        Topic("patrones_simples", "Patrones simples"),
    ),
    2: (
        Topic("numeros_hasta_1000", "Números hasta 1.000"),
        Topic("sumas_con_reserva", "Sumas con reserva"),
        Topic("restas_con_canje", "Restas con canje"),
        Topic("tablas_del_2_5_10", "Tablas del 2, del 5 y del 10"),
        Topic("dobles_y_mitades", "Dobles y mitades"),
    ),
    3: (
        Topic("tablas_de_multiplicar", "Tablas de multiplicar"),
        Topic("division_basica", "División básica"),
        Topic("fracciones_simples", "Fracciones simples"),
        Topic("perimetro_figuras", "Perímetro de figuras"),
        Topic("problemas_de_dos_pasos", "Problemas de dos pasos"),
    ),
    4: (
        Topic("numeros_hasta_10000", "Números hasta 10.000"),
        Topic("multiplicacion_dos_cifras", "Multiplicación por números de dos cifras"),
        Topic("division_con_resto", "División con resto"),
        Topic("fracciones_equivalentes", "Fracciones equivalentes"),
        Topic("area_y_perimetro", "Área y perímetro"),
    ),
}


def topics_for_grade(grade: int) -> tuple[Topic, ...]:
    return TOPICS_BY_GRADE.get(grade, ())


def get_topic(grade: int, topic_id: str) -> Topic | None:
    for topic in topics_for_grade(grade):
        if topic.id == topic_id:
            return topic
    return None
