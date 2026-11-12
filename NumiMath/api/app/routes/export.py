"""T22: el tutor descarga el historial y las estadísticas de su hijo en CSV (portabilidad).

- Zona del tutor: pide el token del PIN. El archivo se arma en memoria y se devuelve como descarga
  (`no-store`); NO se guarda nada en el servidor ni se registra su contenido.
- Solo tema, resultado, hora y segundos de cada intento de práctica (nunca respuestas ni textos de
  ejercicios; las tareas del tutor salen como "Tarea del tutor", sin su texto).
- Contra la inyección de fórmulas: toda celda de texto que empiece con =, +, -, @, tab o CR se
  antecede con una comilla simple.
Reglas: docs/SPEC.md ("Exportar").
"""

from __future__ import annotations

import csv
import io
from datetime import UTC

from fastapi import APIRouter, Request, Response

from app.ai.topics import ASSIGNMENT_TOPIC, topic_label
from app.db.gateway import Gateway, GatewayError
from app.deps import ParentalStudentDep
from app.errors import ApiError
from app.logging import get_logger, log_event
from app.report_feedback import percent
from app.routes.common import student_grade
from app.routes.progress import summarize

router = APIRouter(prefix="/v1/students", tags=["export"])
logger = get_logger("mathtutor.export")

MAX_ROWS = 5_000
_FORMULA_START = ("=", "+", "-", "@")


def safe_cell(value: object) -> str:
    """Texto de una celda sin que una hoja de cálculo lo tome por fórmula."""
    text = str(value)
    # También cuenta si antes de =, +, - o @ hay espacios o tabs; y tab o CR al inicio.
    risky = text.lstrip(" \t").startswith(_FORMULA_START) or text.startswith(("\t", "\r"))
    return "'" + text if risky else text


def build_csv(grade: int, attempts: list, truncated: bool = False) -> str:  # type: ignore[type-arg]
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    summary = summarize(attempts, grade)
    writer.writerow(["Estadísticas por habilidad"])
    writer.writerow(["Habilidad", "Ejercicios", "Aciertos", "Porcentaje"])
    for t in summary.by_topic:
        writer.writerow([safe_cell(t.label), t.total, t.correct, f"{percent(t.correct, t.total)}%"])
    writer.writerow(
        ["Total", summary.total, summary.correct, f"{percent(summary.correct, summary.total)}%"]
    )
    writer.writerow([])
    writer.writerow(["Historial (hora UTC)"])
    writer.writerow(["fecha_hora_utc", "Habilidad", "Resultado", "Segundos"])
    for a in attempts:
        when = a.answered_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M")
        label = "Tarea del tutor" if a.topic == ASSIGNMENT_TOPIC else topic_label(grade, a.topic)
        writer.writerow(
            [
                when,
                safe_cell(label),
                "Correcta" if a.correct else "Incorrecta",
                "" if a.duration_s is None else a.duration_s,
            ]
        )
    if truncated:
        writer.writerow([])
        writer.writerow([f"Se muestran solo las {MAX_ROWS} filas más recientes."])
    return out.getvalue()


@router.get("/{student_id}/export.csv")
async def export_csv(student: ParentalStudentDep, request: Request) -> Response:
    gateway: Gateway = request.app.state.gateway
    grade = await student_grade(request, student.tutor_id, student.student_id)
    try:
        # Una fila de más: así se sabe si el historial se cortó.
        attempts = await gateway.list_attempts(student.tutor_id, student.student_id, MAX_ROWS + 1)
    except GatewayError as exc:
        log_event(logger, "export.failed", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if not attempts:
        raise ApiError(404, "no_data", message="Todavía no hay datos para exportar.")
    log_event(logger, "export.generated", outcome="csv")
    return Response(
        # BOM: Excel abre bien las tildes. El archivo existe solo en esta respuesta.
        content="\ufeff" + build_csv(grade, attempts[:MAX_ROWS], len(attempts) > MAX_ROWS),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="historial.csv"',
            "Cache-Control": "no-store",
        },
    )
