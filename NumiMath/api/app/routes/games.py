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
from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.db.gateway import Gateway, GatewayError
from app.deps import AuthorizedStudentDep
from app.errors import ApiError
from app.exercises.games import (
    GAME_GRADES,
    GAME_MESSAGES,
    GAMES,
    GameKind,
    OptionKind,
    games_for_grade,
    valid_answer,
)
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
    kind: GameKind


class GameGroupOut(BaseModel):
    module: str
    games: list[GameOut]


class GameListOut(BaseModel):
    grade: int
    groups: list[GameGroupOut]


class GameOptionOut(BaseModel):
    id: str
    kind: OptionKind
    label: str


class GameScenePlaceOut(BaseModel):
    position: str
    id: str


class GameSceneOut(BaseModel):
    center: str
    center_name: str
    places: list[GameScenePlaceOut]


class GamePictoRowOut(BaseModel):
    glyph: str
    name: str
    count: int


class GameMeasureOut(BaseModel):
    thing: str
    name: str
    unit: str
    glyph: str
    length: int


class GameExerciseOut(BaseModel):
    token: str
    game_id: str
    kind: GameKind
    text: str
    # En el orden en que se muestran. Sin marcar cuál es la correcta.
    options: list[GameOptionOut]
    # Solo `fill`: la secuencia con las tarjetas fijas y `None` en los huecos.
    slots: list[str | None] | None = None
    # Parte 3: lo que se dibuja encima de las opciones (a lo más uno por juego).
    pattern: list[GameOptionOut] | None = None
    scene: GameSceneOut | None = None
    picto: list[GamePictoRowOut] | None = None
    measure: GameMeasureOut | None = None


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
    ex = issued.exercise
    return GameExerciseOut(
        token=issued.token,
        game_id=game.id,
        kind=ex.kind,
        text=ex.text,
        options=[GameOptionOut(id=o.id, kind=o.kind, label=o.label) for o in ex.options],
        slots=list(ex.slots) if ex.slots is not None else None,
        pattern=(
            [GameOptionOut(id=o.id, kind=o.kind, label=o.label) for o in ex.pattern]
            if ex.pattern is not None
            else None
        ),
        scene=(
            GameSceneOut(
                center=ex.scene.center,
                center_name=ex.scene.center_name,
                places=[GameScenePlaceOut(position=p, id=i) for p, i in ex.scene.places],
            )
            if ex.scene is not None
            else None
        ),
        picto=(
            [GamePictoRowOut(glyph=r.glyph, name=r.name, count=r.count) for r in ex.picto]
            if ex.picto is not None
            else None
        ),
        measure=(
            GameMeasureOut(
                thing=ex.measure.thing,
                name=ex.measure.name,
                unit=ex.measure.unit,
                glyph=ex.measure.glyph,
                length=ex.measure.length,
            )
            if ex.measure is not None
            else None
        ),
    )


@router.post("/{student_id}/games/answer")
async def answer_game(
    body: GameAnswerIn, student: AuthorizedStudentDep, request: Request
) -> GameAnswerOut:
    key = signing_key(request)
    # Primero el token (CPU, sin ir a la base): uno inválido no cuesta una lectura del curso.
    try:
        verified = verify_game(key, body.token, student.student_id)
    except InvalidExercise:
        log_event(logger, "game.denied", stage="token", code="invalid_or_expired")
        raise ApiError(422, "exercise_invalid", message=_EXPIRED) from None
    await _game_grade(request, student)

    exercise = verified.exercise
    # Forma de la respuesta por tipo (en `fill`, las tarjetas fijas no se pueden mover ni faltar).
    if not valid_answer(exercise, body.answer):
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
    message = GAME_MESSAGES["correct" if correct else f"{exercise.kind}_wrong"]
    return GameAnswerOut(correct=correct, correct_answer=list(exercise.solution), message=message)
