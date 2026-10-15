"""Demostración local del servidor, SOLO PARA DESARROLLO. No usa la base ni claves reales.

    cd api
    .venv/Scripts/python -m app.devtools.demo                       # una explicación por streaming
    .venv/Scripts/python -m app.devtools.demo --exercise "23 - 9"
    .venv/Scripts/python -m app.devtools.demo --exercise "me llamo pedro, 2+2"   # filtro de entrada
    .venv/Scripts/python -m app.devtools.demo --unsafe              # la IA responde algo inseguro
    .venv/Scripts/python -m app.devtools.demo --revoke-after 3      # se revoca el consentimiento
    .venv/Scripts/python -m app.devtools.demo --requests 5 --student-limit 3   # límite diario
    .venv/Scripts/python -m app.devtools.demo --serve               # deja el servidor para curl

Levanta el servidor real (todas las rutas, filtros, límites y streaming) con un tutor, un perfil y
una base EN MEMORIA, y una IA simulada. El token se firma con un secreto aleatorio de esta corrida.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import socket
import sys
import time
import uuid

import httpx
import jwt
import uvicorn

from app.ai.mock_provider import MockProvider
from app.ai.provider import AIProvider
from app.ai.topics import topics_for_grade
from app.config import Settings
from app.main import create_app

TUTOR_ID = uuid.UUID("00000000-0000-0000-0000-00000000d3a0")
STUDENT_ID = uuid.UUID("00000000-0000-0000-0000-0000000d3a01")

UNSAFE_SCRIPT = [
    "¡Vamos a resolver el ejercicio! ",
    "Primero cuéntame algo: ¿cómo te llamas? ",
    "Después seguimos con la suma. ",
]


class DemoGateway:
    """Base en memoria: un tutor, un perfil, contadores de uso y una revocación opcional."""

    def __init__(self, grade: int, revoke_after: float | None) -> None:
        self._grade = grade
        self._revoke_after = revoke_after
        self._started: float | None = None
        self.student_used = 0
        self.tutor_used = 0

    async def authorize_student_use(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> str:
        if (tutor_id, student_id) != (TUTOR_ID, STUDENT_ID):
            return "student_not_found"
        if self._revoke_after is not None:
            if self._started is None:
                self._started = time.monotonic()
            if time.monotonic() - self._started >= self._revoke_after:
                return "consent_required"
        return "ok"

    async def get_student_grade(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> int | None:
        return self._grade if (tutor_id, student_id) == (TUTOR_ID, STUDENT_ID) else None

    async def consume_usage(
        self,
        tutor_id: uuid.UUID,
        student_id: uuid.UUID,
        cost: int,
        student_limit: int,
        tutor_limit: int,
    ) -> str:
        if self.student_used + cost > student_limit:
            return "student_limit"
        if self.tutor_used + cost > tutor_limit:
            return "tutor_limit"
        self.student_used += cost
        self.tutor_used += cost
        return "ok"

    async def touch_student_activity(self, tutor_id: uuid.UUID, student_id: uuid.UUID) -> bool:
        return True

    async def assert_read_committed(self) -> None:
        return None

    async def aclose(self) -> None:
        return None


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _token(secret: str) -> str:
    now = int(time.time())
    claims = {
        "sub": str(TUTOR_ID),
        "aud": "authenticated",
        "iss": "http://127.0.0.1:54321/auth/v1",
        "role": "authenticated",
        "exp": now + 3600,
    }
    return jwt.encode(claims, secret, algorithm="HS256")


async def _one_request(
    client: httpx.AsyncClient, base: str, token: str, topic: str, exercise: str, number: int
) -> None:
    print(f"\n── Petición {number} " + "─" * 50)
    print(f"   curso/tema: {topic}   ejercicio: {exercise!r}")
    url = f"{base}/v1/students/{STUDENT_ID}/explanations"
    started = time.monotonic()
    async with client.stream(
        "POST",
        url,
        json={"topic": topic, "exercise": exercise},
        headers={"Authorization": f"Bearer {token}"},
    ) as response:
        if response.status_code != 200:
            body = json.loads((await response.aread()).decode())
            error = body["error"]
            extra = {k: v for k, v in error.items() if k not in ("message", "request_id")}
            print(f"   HTTP {response.status_code}  {extra}")
            print(f"   mensaje: {error['message']}")
            if "retry-after" in response.headers:
                print(f"   Retry-After: {response.headers['retry-after']} s")
            return
        event = ""
        async for line in response.aiter_lines():
            if line.startswith("event: "):
                event = line.removeprefix("event: ")
            elif line.startswith("data: "):
                data = json.loads(line.removeprefix("data: "))
                elapsed = time.monotonic() - started
                if event == "chunk":
                    print(f"   [{elapsed:4.1f}s] {data['text']}")
                elif event == "done":
                    print(f"   [{elapsed:4.1f}s] ✓ fin de la respuesta")
                elif event == "error":
                    print(f"   [{elapsed:4.1f}s] ✗ CORTADA ({data['code']}): {data['message']}")


async def _main(args: argparse.Namespace) -> int:
    if os.environ.get("APP_ENV") == "production":
        print("Esta demostración es solo para desarrollo.")
        return 2

    secret = secrets.token_urlsafe(48)
    settings = Settings(
        _env_file=None,
        app_env="local",
        supabase_jwt_secret=secret,
        student_daily_limit=args.student_limit,
        tutor_daily_limit=max(args.student_limit * 3, 3),
        stream_recheck_seconds=1,
        stream_max_seconds=60,
    )
    gateway = DemoGateway(args.grade, args.revoke_after)
    provider: AIProvider = (
        MockProvider(script=UNSAFE_SCRIPT, chunk_delay=args.delay)
        if args.unsafe
        else MockProvider(chunk_delay=args.delay)
    )
    app = create_app(settings, gateway=gateway, provider=provider)

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    server_task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)

    base = f"http://127.0.0.1:{port}"
    token = _token(secret)
    topic = args.topic or topics_for_grade(args.grade)[0].id
    print(
        f"Servidor de demostración en {base}  (curso {args.grade}°, IA simulada, base en memoria)"
    )
    try:
        if args.serve:
            print("\nPara probarlo con curl (Ctrl+C para terminar):\n")
            payload = json.dumps({"topic": topic, "exercise": args.exercise}, ensure_ascii=False)
            print(
                f"curl -N -X POST {base}/v1/students/{STUDENT_ID}/explanations \\\n"
                f'  -H "Authorization: Bearer {token}" -H "Content-Type: application/json" \\\n'
                f"  -d '{payload}'"
            )
            print(f"\nDocumentación interactiva: {base}/docs")
            await server_task
            return 0

        async with httpx.AsyncClient(timeout=30) as client:
            for number in range(1, args.requests + 1):
                await _one_request(client, base, token, topic, args.exercise, number)
        return 0
    finally:
        server.should_exit = True
        await server_task


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="Demostración local del servidor (solo desarrollo)."
    )
    parser.add_argument("--exercise", default="¿Cuánto es 7 + 5?", help="texto del niño")
    parser.add_argument(
        "--grade", type=int, default=1, choices=[1, 2, 3, 4], help="curso del perfil"
    )
    parser.add_argument(
        "--topic", default=None, help="id del tema (por defecto, el primero del curso)"
    )
    parser.add_argument(
        "--unsafe", action="store_true", help="la IA simulada responde algo inseguro"
    )
    parser.add_argument(
        "--revoke-after",
        type=float,
        default=None,
        metavar="SEGUNDOS",
        help="revoca el consentimiento pasados N segundos",
    )
    parser.add_argument("--delay", type=float, default=0.4, help="segundos entre fragmentos")
    parser.add_argument("--requests", type=int, default=1, help="cuántas peticiones hacer")
    parser.add_argument("--student-limit", type=int, default=30, help="límite diario del perfil")
    parser.add_argument("--serve", action="store_true", help="deja el servidor en marcha para curl")
    raise SystemExit(asyncio.run(_main(parser.parse_args())))


if __name__ == "__main__":
    main()
