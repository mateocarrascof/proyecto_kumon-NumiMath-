# ADR 0004: Intentos de juego, plazo y estabilidad (CU-A21)

**Estado:** aceptado (2026-11-12) · **Alcance:** CU-A21 "Jugar un juego de refuerzo" (RF-41)

## Contexto

Los juegos de refuerzo (1° y 2° básico) guardan cada respuesta en `student_attempts`
(`activity = 'game'`, `game_kind` = id del juego). Una ronda dura segundos, así que crecen mucho más
rápido que la práctica, y no entran al progreso, al informe ni al gráfico. Además, la corrección
depende de regenerar el ejercicio desde la semilla del token: si un generador cambia, el ejercicio
regenerado ya no coincide.

## Decisión

1. **Plazo de 90 días** para los intentos de juego. La purga diaria `purge_old_game_attempts`
   (pg_cron `privacy-purge-games`, solo `service_role`, por lotes de 5.000, con un índice parcial
   por fecha) borra los juegos de hace más de 90 días. **No toca práctica ni diagnóstico.** La
   alerta `privacy_job_warnings` la vigila. Sin tope diario de intentos (pendiente).
2. **Estabilidad de generadores.** Un juego publicado **no se edita**: cambiar su generador (rangos,
   textos, emoji disponibles, orden de las opciones) obliga a crear un juego con **id nuevo** o a
   subir la versión del token de juegos. Los ids de juego son permanentes (las filas guardan
   `game_kind`). `api/tests/test_games_golden.py` guarda las salidas de los 9 juegos para 3
   semillas y falla si alguno cambia (también si cambia `random` al subir de versión de Python).
3. **Orden de despliegue:** primero las migraciones y después la API. **Sin vuelta atrás** una vez
   que existan filas `activity = 'game'`: la restricción anterior no las admite.

## Consecuencias

- Menos volumen y minimización de datos (Ley 21.719): un dato de juego vive como máximo 90 días.
- El historial del tutor (CU-T5, rama de Adolfo) mostrará solo los últimos 90 días de juegos.
- Agregar figuras SVG (parte 3) o un emoji nuevo = juego nuevo con otro id.
