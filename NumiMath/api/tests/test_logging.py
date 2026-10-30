from __future__ import annotations

import io
import json
import logging

from fastapi.testclient import TestClient

from app.logging import ALLOWED_FIELDS, JsonFormatter, log_event, redact


def _last_json(stream: io.StringIO) -> dict[str, object]:
    return json.loads(stream.getvalue().strip().splitlines()[-1])


def test_log_event_descarta_campos_fuera_de_la_lista_cerrada(log_stream: io.StringIO) -> None:
    logger = logging.getLogger("mathtutor.test")
    log_event(logger, "prueba", code="ok", nickname="Ana", correo="ana@example.com", mensaje="hola")
    payload = _last_json(log_stream)
    assert payload["code"] == "ok"
    for prohibido in ("nickname", "correo", "mensaje"):
        assert prohibido not in payload


def test_el_formateador_redacta_datos_personales_en_el_mensaje(log_stream: io.StringIO) -> None:
    logger = logging.getLogger("mathtutor.test")
    logger.info("contacto ana@example.com o +56 9 1234 5678 rut 12.345.678-5 https://x.cl/a")
    event = str(_last_json(log_stream)["event"])
    for dato in ("ana@example.com", "1234 5678", "12.345.678-5", "https://x.cl"):
        assert dato not in event


def test_redact_deja_pasar_texto_sin_datos_personales() -> None:
    assert redact("request.completed") == "request.completed"


def test_el_formateador_no_vuelca_el_texto_de_las_excepciones() -> None:
    record = logging.LogRecord("t", logging.ERROR, __file__, 1, "fallo", None, None)
    try:
        raise ValueError("secreto ana@example.com")
    except ValueError:
        import sys

        record.exc_info = sys.exc_info()
    output = JsonFormatter().format(record)
    assert "ana@example.com" not in output
    assert json.loads(output)["exc_type"] == "ValueError"


def test_la_peticion_registra_solo_campos_permitidos_y_no_la_consulta(
    client: TestClient, log_stream: io.StringIO
) -> None:
    client.get("/healthz?correo=ana@example.com&q=texto-del-nino")
    logs = log_stream.getvalue()
    assert "ana@example.com" not in logs
    assert "texto-del-nino" not in logs
    payload = _last_json(log_stream)
    assert payload["event"] == "request.completed"
    assert payload["route"] == "/healthz"
    extras = set(payload) - {"ts", "level", "event", "exc_type"}
    assert extras <= ALLOWED_FIELDS
