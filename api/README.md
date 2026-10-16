# API (FastAPI)

Servidor del MVP. El contrato de seguridad está en `docs/adr/0001-contrato-fastapi-consentimiento.md`;
el plan por etapas, en el historial de commits (`api: etapa N`).

## Puesta en marcha (desarrollo)

```bash
python -m venv api/.venv                      # Python 3.12
api/.venv/Scripts/python -m pip install -r api/requirements-dev.txt   # en Linux/macOS: api/.venv/bin/python
cp api/.env.example api/.env                  # y completa los valores; .env nunca se versiona
cd api && ../api/.venv/Scripts/python -m uvicorn app.main:app --reload
```

Para usarlo con la base local: `supabase start` (desde la raíz).

## Comandos

| Qué | Comando (desde la raíz) |
|---|---|
| Lint y formato | `api/.venv/Scripts/python -m ruff check api && api/.venv/Scripts/python -m ruff format api` |
| Pruebas | `api/.venv/Scripts/python -m pytest -q api` |
| Pruebas de integración (requieren `supabase start`) | `api/.venv/Scripts/python -m pytest -q api -m integration` |
| Auditoría de dependencias (la hace el CI) | `pip-audit -r api/requirements.txt` |

## Reglas fijas

1. **Aislamiento `READ COMMITTED`**: toda conexión a la base lo usa. No es configurable: lo declara
   `app/db/isolation.py` y la base lo exige (migración `20261013100000_api_support`).
2. **Falla cerrado**: ante un error, un timeout o una respuesta inesperada, se deniega.
3. **Sin datos personales en logs**: solo códigos y campos de la lista cerrada de `app/logging.py`.
   Nunca mensajes del niño, apodos, correos, cuerpos de petición ni respuestas de la IA.
4. **La IA solo recibe** curso (leído de la base), tema (lista cerrada) y ejercicio (ya filtrado).
5. **Las claves viven solo en variables de entorno** del servidor (ver `.env.example`).

## Estado por etapas

| Etapa | Contenido | Estado |
|---|---|---|
| 0 | Migración de apoyo en la base | hecha |
| 1 | Esqueleto: configuración, logging sin datos personales, errores, `/healthz` | hecha |
| 2 | Autenticación (JWT de Supabase: JWKS o HS256, solo rol `authenticated`) | hecha |
| 3 | Acceso al perfil (`authorize_student_use`, falla cerrado, 403 genérico) | hecha |
| 4 | Filtro de entrada (datos personales, groserías, temas, manipulación, fuera de tema) | hecha |
| 5 | IA simulada (interfaz `AIProvider`), prompt, temas provisionales y filtro de salida | hecha |
| 6 | Límites de uso por perfil y por tutor (atómicos, con `Retry-After`) | hecha |
| 7 | Streaming SSE con re-chequeo de acceso cada pocos segundos | hecha |
| Recorrido real, etapa 8 | Seguridad antes de Gemini: camino de apoyo, filtros ampliados, prompt separado, límite de cuerpo, corpus adversarial | hecha |
| Recorrido real, etapa 9 | Proveedor Gemini (`AI_PROVIDER=gemini`, `GEMINI_MODEL` sin alias `-latest`) | hecha |
| PIN y borrado de cuenta | Control parental, borrado de cuenta | fuera de este recorrido |

## Probarlo sin base ni claves (demostración local)

Un solo comando levanta el servidor real con una base EN MEMORIA y la IA simulada:

```bash
cd api && .venv/Scripts/python -m app.devtools.demo
```

Variantes: `--exercise "23 - 9"`, `--exercise "me llamo pedro, 2+2"` (filtro de entrada),
`--unsafe` (la IA responde algo inseguro), `--revoke-after 3` (consentimiento revocado a mitad de
respuesta), `--requests 5 --student-limit 3` (límite diario), `--serve` (deja el servidor para
`curl`) y `--logs` (muestra los registros). Es solo para desarrollo.

## Endpoint principal

`POST /v1/students/{student_id}/explanations` con `{"topic": "<id de topics.py>", "exercise": "<texto>"}`.
Respuesta `text/event-stream` con eventos `chunk` (`{"text": ...}`), `done` o `error` (`{"code", "message"}`).
Errores antes de empezar: 401 (sesión), 403 (perfil/consentimiento), 422 (tema o mensaje rechazado),
429 (límite diario, con `Retry-After`) y 503 (no se pudo verificar: se deniega).

La lista de temas por curso es **provisional y está pendiente de revisión** (`app/ai/topics.py`).

## Gemini (prototipo operado por adultos)

Variables en `api/.env`: `AI_PROVIDER=gemini`, `GEMINI_API_KEY` y `GEMINI_MODEL` (nombre de versión
estable; **sin alias `-latest` ni valor por defecto**: ver https://ai.google.dev/gemini-api/docs/models).
Opcionales: `GEMINI_THINKING_LEVEL` (por defecto `low`; los tokens de razonamiento cuentan contra
`GEMINI_MAX_OUTPUT_TOKENS`, por defecto 1024).

Prueba real de UNA pregunta fija, sin datos personales (no imprime la clave):

```bash
api/.venv/Scripts/python api/scripts/probar_gemini.py
```

Los términos de la API de Gemini exigen 18+ y prohíben apps dirigidas a menores: ver
`docs/privacy/pendientes-legales.md`, 9.1. **No usar con niños reales.**
