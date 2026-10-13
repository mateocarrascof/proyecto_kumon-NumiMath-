# API (FastAPI)

Servidor del MVP. El contrato de seguridad está en `docs/adr/0001-contrato-fastapi-consentimiento.md`;
el plan por etapas, en el historial de commits (`api: etapa N`).

## Puesta en marcha (desarrollo)

```bash
python -m venv api/.venv                      # Python 3.12
api/.venv/Scripts/python -m pip install -r api/requirements-dev.txt   # en Linux/macOS: api/.venv/bin/python
cp api/env.example api/.env                   # y completa los valores; .env nunca se versiona
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
5. **Las claves viven solo en variables de entorno** del servidor (ver `env.example`).

## Nota sobre `env.example`

La plantilla debería llamarse `.env.example`, pero una regla de permisos del proyecto
(`Read(./.env.*)` en `.claude/settings.json`) bloquea escribir archivos `.env.*`. Para dejarla con
su nombre estándar: `git mv api/env.example api/.env.example` (el hook `protect-secrets.sh` ya
permite explícitamente `.env.example`).

## Estado por etapas

| Etapa | Contenido | Estado |
|---|---|---|
| 0 | Migración de apoyo en la base | hecha |
| 1 | Esqueleto: configuración, logging sin datos personales, errores, `/healthz` | hecha |
| 2 | Autenticación (JWT de Supabase: JWKS o HS256, solo rol `authenticated`) | hecha |
| 3 | Acceso al perfil (`authorize_student_use`) | pendiente |
| 4 a 10 | Filtros, IA simulada, límites, streaming, control parental, borrado de cuenta, cierre | pendientes |
