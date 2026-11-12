"""Juegos de refuerzo (CU-A21, RF-41), parte 1: catálogo, ejercicio y respuesta.

Solo perfiles de 1° o 2° básico. `AuthorizedStudentDep` exige además que el perfil sea del tutor,
no esté en pausa y tenga consentimiento vigente. El curso se lee de la base, nunca del cliente.

Corrección como en la práctica: el servidor regenera el ejercicio desde el token firmado (dominio
propio de juegos) y compara. Cada token se responde una sola vez (`jti` único). Lo correcto viaja
SOLO en la respuesta, después de contestar.

El intento queda en `student_attempts` con `activity = 'game'` y `game_kind` = id del juego: suma
a la racha diaria, pero NO al bloque de 10 ni al nivel (decisión del dueño: las opciones se
aciertan al azar con facilidad). Tampoco entra al progreso, informe ni gráfico (leen solo
`practice`). Las medallas las cuenta la app (aciertos seguidos).
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.exercises.games import GAME_GRADES, GAME_MESSAGES, GAMES, games_for_grade
from app.exercises.tickets import duration_since
from app.exercises.tokens import InvalidExercise, issue_game, verify_game
from app.logging import get_logger, log_event
from app.routes.common import signing_key, student_grade
from app.streaks import parse_local_day

router = APIRouter(prefix="/v1/students", tags=["games"])
logger = get_logger("mathtutor.games")

# Mismos textos que la práctica: sin culpa.
_EXPIRED = "Este ejercicio ya no es válido. Pide uno nuevo."
_ALREADY = "Ya respondiste este ejercicio."


class GameOut(BaseModel):
    id: str
    name: str
    kind: Literal["choice", "order"]


class GameGroupOut(BaseModel):
    module: str
    games: list[GameOut]


class GameListOut(BaseModel):
    grade: int
    groups: list[GameGroupOut]


class GameOptionOut(BaseModel):
    id: str
    kind: Literal["number", "emoji", "symbol"]
    label: str


class GameExerciseOut(BaseModel):
    token: str
    game_id: str
    kind: Literal["choice", "order"]
    text: str
    # En el orden en que se muestran. Sin marcar cuál es la correcta.
    options: list[GameOptionOut]


class GameAnswerIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    token: Annotated[str, Field(min_length=10, max_length=1000)]
    # `choice`: un id. `order`: todos los ids, en el orden que dejó el niño.
    answer: Annotated[
        list[Annotated[str, Field(min_length=3, max_length=40)]], Field(min_length=1, max_length=6)
    ]
    local_date: date | None = None


class GameAnswerOut(BaseModel):
    correct: bool
    # Solo después de responder (el token ya no se puede volver a usar).
    correct_answer: list[str]
    message: str


async def _game_grade(request: Request, student: AuthorizedStudentDep) -> int:
    grade = await student_grade(request, student.tutor_id, student.student_id)
    if grade not in GAME_GRADES:
        log_event(logger, "game.denied", code="grade_not_allowed")
        raise ApiError(403, "game_grade_not_allowed", message="Los juegos son para 1° y 2° básico.")
    return grade


@router.get("/{student_id}/games")
async def list_games(student: AuthorizedStudentDep, request: Request) -> GameListOut:
    grade = await _game_grade(request, student)
    groups: dict[str, list[GameOut]] = {}
    for g in games_for_grade(grade):
        groups.setdefault(g.module, []).append(GameOut(id=g.id, name=g.name, kind=g.kind))
    return GameListOut(
        grade=grade,
        groups=[GameGroupOut(module=m, games=games) for m, games in groups.items()],
    )


@router.post("/{student_id}/games/{game_id}/exercise")
async def new_game_exercise(
    game_id: str, student: AuthorizedStudentDep, request: Request
) -> GameExerciseOut:
    key = signing_key(request)
    grade = await _game_grade(request, student)
    game = GAMES.get(game_id)
    if game is None or game.grade != grade:
        raise ApiError(404, "game_not_found")
    issued = issue_game(
        key, student.student_id, game, request.app.state.settings.exercise_token_ttl_seconds
    )
    return GameExerciseOut(
        token=issued.token,
        game_id=game.id,
        kind=issued.exercise.kind,
        text=issued.exercise.text,
        options=[
            GameOptionOut(id=o.id, kind=o.kind, label=o.label) for o in issued.exercise.options
        ],
    )


@router.post("/{student_id}/games/answer")
async def answer_game(
    body: GameAnswerIn, student: AuthorizedStudentDep, request: Request
) -> GameAnswerOut:
    key = signing_key(request)
    await _game_grade(request, student)
    try:
        verified = verify_game(key, body.token, student.student_id)
    except InvalidExercise:
        log_event(logger, "game.denied", stage="token", code="invalid_or_expired")
        raise ApiError(422, "exercise_invalid", message=_EXPIRED) from None

    exercise = verified.exercise
    shown = [o.id for o in exercise.options]
    if exercise.kind == "choice":
        valid = len(body.answer) == 1 and body.answer[0] in shown
    else:
        # Orden: todas las tarjetas, cada una una vez.
        valid = len(body.answer) == len(shown) and sorted(body.answer) == sorted(shown)
    if not valid:
        raise ApiError(422, "invalid_request")
    correct = tuple(body.answer) == exercise.solution

    gateway: Gateway = request.app.state.gateway
    try:
        outcome = await gateway.record_attempt(
            student.tutor_id,
            student.student_id,
            verified.exercise_id,
            verified.game.skill,
            exercise.text,
            correct,
            parse_local_day(body.local_date),
            1,  # los juegos no tienen nivel propio ni lo cambian
            duration_since(verified.issued_at),
            activity="game",
            game_kind=verified.game.id,
        )
    except GatewayError as exc:
        log_event(logger, "game.denied", stage="record", code=f"gateway_{exc.reason}")
        raise ApiError(503, "service_unavailable") from None
    if outcome == "duplicate":
        raise ApiError(409, "already_answered", message=_ALREADY)
    if outcome != "ok":
        raise ApiError(403, "forbidden")

    try:
        await gateway.touch_student_activity(student.tutor_id, student.student_id)
    except GatewayError as exc:
        log_event(logger, "game.touch_failed", code=f"gateway_{exc.reason}")
    if correct:
        message = GAME_MESSAGES["correct"]
    else:
        message = GAME_MESSAGES["choice_wrong" if exercise.kind == "choice" else "order_wrong"]
    return GameAnswerOut(correct=correct, correct_answer=list(exercise.solution), message=message)
