-- CU-A21 (RF-41), parte 1: intentos de JUEGOS de refuerzo (1° y 2° básico).
-- Sin tablas nuevas ni datos nuevos del niño: un intento de juego es una fila más de
-- `student_attempts`, marcada `activity = 'game'` y con `game_kind` = id del juego del catálogo en
-- código (p. ej. 'mayor-1'). Las lecturas de progreso, informe y gráfico siguen filtrando
-- `activity = 'practice'`: los juegos no entran ahí (decisión del dueño).
-- Idempotente: se puede volver a aplicar sin error.

-- 1. `activity` admite 'game'.
alter table public.student_attempts drop constraint if exists student_attempts_activity_check;
alter table public.student_attempts
  add constraint student_attempts_activity_check
  check (activity in ('practice', 'diagnostic', 'game'));

-- 2. `game_kind`: obligatorio en los juegos y nulo en lo demás. Id corto en minúsculas (no es texto
-- libre ni dato del niño).
alter table public.student_attempts add column if not exists game_kind text;
alter table public.student_attempts drop constraint if exists student_attempts_game_kind_check;
alter table public.student_attempts
  add constraint student_attempts_game_kind_check
  check (
    -- `is not null` explícito: con nulo, `~` da nulo y un CHECK nulo deja pasar la fila.
    (activity = 'game' and game_kind is not null and game_kind ~ '^[a-z0-9-]{1,40}$')
    or (activity <> 'game' and game_kind is null)
  );

-- 3. `record_attempt` recibe `p_activity` ('practice' por defecto) y `p_game_kind`. Cambia su
-- firma: se borra y se vuelve a crear (con `create or replace` quedarían dos versiones y las llamadas
-- serían ambiguas). La siguen usando igual, sin cambios: la práctica en línea (FastAPI) y
-- `record_offline_attempts` (CU-A13, por posición, con los parámetros nuevos en su valor por defecto).
-- El diagnóstico no la usa (tiene `save_diagnostic`).
drop function if exists public.record_attempt(
  uuid, uuid, uuid, text, text, boolean, date, integer, integer, timestamptz
);
drop function if exists public.record_attempt(
  uuid, uuid, uuid, text, text, boolean, date, integer, integer, timestamptz, text, text
);

create function public.record_attempt(
  p_tutor_id    uuid,
  p_student_id  uuid,
  p_exercise_id uuid,
  p_topic       text,
  p_exercise    text,
  p_correct     boolean,
  p_local_day   date default null,
  p_level       integer default 1,
  p_duration_s  integer default null,
  p_answered_at timestamptz default null,
  p_activity    text default 'practice',
  p_game_kind   text default null
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_inserted  integer;
  v_utc_today date := (now() at time zone 'utc')::date;
  v_progress  public.student_skill_progress%rowtype;
  v_total     integer;
  v_correct   integer;
  v_level     integer;
  v_mastered  timestamptz;
begin
  -- Solo práctica y juegos pasan por aquí (el diagnóstico tiene su propia función).
  if p_activity is null or p_activity not in ('practice', 'game') then
    raise exception 'invalid_activity' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return 'student_not_found';
  end if;

  insert into public.student_attempts
    (student_id, tutor_id, exercise_id, topic, exercise, correct, level, duration_s, answered_at,
     activity, game_kind)
  values
    (p_student_id, p_tutor_id, p_exercise_id, p_topic, p_exercise, p_correct, p_level, p_duration_s,
     coalesce(least(p_answered_at, now()), now()),
     p_activity, case when p_activity = 'game' then p_game_kind end)
  on conflict (student_id, exercise_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    return 'duplicate';
  end if;

  if p_local_day is not null and p_local_day between v_utc_today - 1 and v_utc_today + 1 then
    insert into public.student_daily_streaks as s (student_id, tutor_id, current_len, last_day)
    values (p_student_id, p_tutor_id, 1, p_local_day)
    on conflict (student_id) do update
      set current_len = case
            when excluded.last_day = s.last_day + 1 then s.current_len + 1
            else 1
          end,
          last_day   = excluded.last_day,
          updated_at = now()
      where excluded.last_day > s.last_day;
  end if;

  -- Progreso por habilidad (regla de bloques de 10). Los JUEGOS no tocan el bloque ni el nivel:
  -- con 2 a 4 opciones se aciertan al azar con facilidad e inflarían el progreso real (CU-A21).
  -- Solo registran el intento y suman a la racha diaria (arriba).
  if p_activity = 'practice' and p_topic ~ '^[1-4]-[0-9]{2}$' then
    insert into public.student_skill_progress (student_id, tutor_id, skill_code)
    values (p_student_id, p_tutor_id, p_topic)
    on conflict (student_id, skill_code) do nothing;

    -- Bloqueo de la fila: dos respuestas simultáneas no pierden un conteo.
    select * into v_progress from public.student_skill_progress p
      where p.student_id = p_student_id and p.skill_code = p_topic
      for update;

    if v_progress.level = p_level then
      v_total    := v_progress.block_total + 1;
      v_correct  := v_progress.block_correct + case when p_correct then 1 else 0 end;
      v_level    := v_progress.level;
      v_mastered := v_progress.mastered_at;

      if v_total >= 10 then
        if v_correct >= 8 then
          if v_level < 3 then
            v_level := v_level + 1;
          else
            v_mastered := coalesce(v_mastered, now());
          end if;
        elsif v_correct <= 4 and v_level > 1 then
          v_level := v_level - 1;
        end if;
        v_total   := 0;
        v_correct := 0;
      end if;

      update public.student_skill_progress p
        set level         = v_level,
            block_total   = v_total,
            block_correct = v_correct,
            mastered_at   = v_mastered,
            updated_at    = now()
        where p.student_id = p_student_id and p.skill_code = p_topic;
    end if;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.record_attempt(
  uuid, uuid, uuid, text, text, boolean, date, integer, integer, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.record_attempt(
  uuid, uuid, uuid, text, text, boolean, date, integer, integer, timestamptz, text, text
) to service_role;
