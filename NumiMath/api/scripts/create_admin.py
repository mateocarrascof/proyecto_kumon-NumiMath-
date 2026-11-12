"""Crea la cuenta de un ADMINISTRADOR en Supabase Auth (la crea la empresa; la app no la registra).

    api/.venv/Scripts/python api/scripts/create_admin.py correo@empresa.cl

Pide la contraseña por teclado (no se ve ni se guarda) y la repite para confirmarla. Usa la llave de
servicio de `api/.env` (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY): nunca se imprime ni se acepta
por argumento. Crea el usuario ya confirmado con `app_metadata.role = admin`; el trigger de alta
no lo convierte en tutor. Si el correo ya existe, no cambia nada.
"""

from __future__ import annotations

import getpass
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402

MIN_LEN = 8
MAX_LEN = 72


def main(argv: list[str]) -> int:
    if len(argv) != 2 or "@" not in argv[1]:
        print("Uso: create_admin.py correo@empresa.cl")
        return 2
    email = argv[1].strip().lower()

    settings = Settings()
    key = settings.supabase_service_role_key.get_secret_value()
    if not key:
        print("Falta SUPABASE_SERVICE_ROLE_KEY en api/.env.")
        return 2

    password = getpass.getpass("Contraseña del administrador (no se muestra): ")
    if getpass.getpass("Repite la contraseña: ") != password:
        print("Las contraseñas no coinciden. No se creó nada.")
        return 1
    if not MIN_LEN <= len(password) <= MAX_LEN or len(password.encode()) > MAX_LEN:
        print(f"La contraseña debe tener entre {MIN_LEN} y {MAX_LEN} caracteres.")
        return 1

    try:
        response = httpx.post(
            settings.supabase_url.rstrip("/") + "/auth/v1/admin/users",
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
                "app_metadata": {"role": "admin"},
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )
    except httpx.HTTPError:
        print("No se pudo conectar con Supabase. ¿Está en marcha (supabase start)?")
        return 1
    if response.status_code not in (200, 201):
        # Solo el código de estado: el cuerpo podría repetir datos.
        try:
            error_code = response.json().get("error_code")
        except (ValueError, AttributeError):
            error_code = None
        if error_code in ("email_exists", "user_already_exists"):
            print("Ese correo ya tiene una cuenta. No se cambió nada.")
        elif error_code == "weak_password":
            print("La contraseña no cumple las reglas de Supabase. Prueba con una más larga.")
        else:
            print(f"No se pudo crear la cuenta (estado {response.status_code}).")
        return 1
    print(f"Administrador creado: {email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
