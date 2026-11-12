-- CU-A13, correcciones de la revisión (scalability-reviewer):
-- 1. `record_attempt` recibe la hora del intento (`p_answered_at`, opcional: si falta, `now()` como
--    hasta ahora). Antes, la sincronización insertaba con `now()` y luego hacía un UPDATE de
--    `answered_at`: dos escrituras por intento y entradas muertas en los dos índices que usan esa
--    columna. La práctica en línea no cambia (no envía la hora).
-- 2. `record_offline_attempts` toma los bloqueos en el mismo orden que la práctica en línea.
-- Se borra y se vuelve a crear `record_attempt` porque cambia su firma (un parámetro más): con
-- `create or replace` quedarían dos versiones y las llamadas serían ambiguas.

drop function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer);

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
  p_answered_at timestamptz default null
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
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return 'student_not_found';
  end if;

  insert into public.student_attempts
    (student_id, tutor_id, exercise_id, topic, exercise, correct, level, duration_s, answered_at)
  values
    (p_student_id, p_tutor_id, p_exercise_id, p_topic, p_exercise, p_correct, p_level, p_duration_s,
     coalesce(least(p_answered_at, now()), now()))
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

  -- Progreso por habilidad (regla de bloques de 10).
  if p_topic ~ '^[1-4]-[0-9]{2}$' then
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

revoke all on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer, timestamptz)
  to service_role;

create or replace function public.record_offline_attempts(
  p_tutor_id   uuid,
  p_student_id uuid,
  p_attempts   jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item    jsonb;
  v_status  text;
  v_at      timestamptz;
  v_day     date;
  v_results jsonb := '[]'::jsonb;
begin
  if p_attempts is null or jsonb_typeof(p_attempts) <> 'array' then
    raise exception 'invalid_offline_attempts' using errcode = '22023';
  end if;
  -- Tope de defensa si se llamara con otro cliente (FastAPI envía como máximo 15 por petición).
  if jsonb_array_length(p_attempts) > 100 then
    raise exception 'offline_batch_too_large' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return to_jsonb('student_not_found'::text);
  end if;

  -- Orden fijo de bloqueos: primero la racha y después la habilidad, igual que la práctica en
  -- línea (record_attempt con fecha local). Así una respuesta en línea y una sincronización del
  -- mismo niño a la vez no se bloquean mutuamente (deadlock).
  perform 1 from public.student_daily_streaks d where d.student_id = p_student_id for update;

  for v_item in
    select a.value
    from jsonb_array_elements(p_attempts) with ordinality as a(value, n)
    order by (a.value ->> 'answered_at')::timestamptz, a.n
  loop
    -- Nunca en el futuro, aunque FastAPI ya lo acota.
    v_at := least((v_item ->> 'answered_at')::timestamptz, now());

    v_status := public.record_attempt(
      p_tutor_id,
      p_student_id,
      (v_item ->> 'exercise_id')::uuid,
      v_item ->> 'topic',
      v_item ->> 'exercise',
      (v_item ->> 'correct')::boolean,
      null,  -- la racha se aplica abajo, con la fecha local acotada a la hora del intento
      (v_item ->> 'level')::integer,
      (v_item ->> 'duration_s')::integer,
      v_at  -- hora del intento, guardada en el INSERT (sin un UPDATE posterior)
    );

    if v_status = 'ok' then
      -- Racha por día local: solo días posteriores al último registrado (no se rellenan días
      -- hacia atrás, igual que en línea). La fecha debe ser coherente con la hora del intento.
      v_day := (v_item ->> 'local_day')::date;
      if v_day is not null
         and v_day between (v_at at time zone 'utc')::date - 1 and (v_at at time zone 'utc')::date + 1
      then
        insert into public.student_daily_streaks as s (student_id, tutor_id, current_len, last_day)
        values (p_student_id, p_tutor_id, 1, v_day)
        on conflict (student_id) do update
          set current_len = case
                when excluded.last_day = s.last_day + 1 then s.current_len + 1
                else 1
              end,
              last_day   = excluded.last_day,
              updated_at = now()
          where excluded.last_day > s.last_day;
      end if;
    elsif v_status <> 'duplicate' then
      -- 'student_not_found' a mitad del lote (perfil borrado en paralelo): se deshace todo.
      raise exception 'offline_sync_student_gone' using errcode = 'P0002';
    end if;

    v_results := v_results || jsonb_build_object(
      'exercise_id', v_item ->> 'exercise_id', 'status', v_status
    );
  end loop;

  return v_results;
end;
$$;

revoke all on function public.record_offline_attempts(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_offline_attempts(uuid, uuid, jsonb) to service_role;
