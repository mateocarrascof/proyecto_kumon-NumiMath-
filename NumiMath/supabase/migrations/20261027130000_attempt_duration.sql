-- Tiempo por ejercicio: cada intento guarda cuántos segundos tardó el niño en responder.
-- Lo mide el SERVIDOR (FastAPI) con la hora firmada en el token del ejercicio o en el ticket de la
-- tarea: la app no envía tiempos. Tope de 600 s (lo que dura un ejercicio). Null si no se pudo medir.
-- Mismo acceso (RLS por tutor), plazo y borrado que el intento. No llega a la IA.
-- Inventario: docs/privacy/inventario-datos.md. Reglas: docs/SPEC.md ("Tiempo por ejercicio").

alter table public.student_attempts
  add column duration_s smallint
  constraint student_attempts_duration_range check (duration_s between 0 and 600);

-- ---------------------------------------------------------------------------
-- record_attempt: igual que en 20261026130000_attempt_levels.sql + p_duration_s.
-- ---------------------------------------------------------------------------
drop function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer);

create function public.record_attempt(
  p_tutor_id    uuid,
  p_student_id  uuid,
  p_exercise_id uuid,
  p_topic       text,
  p_exercise    text,
  p_correct     boolean,
  p_local_day   date default null,
  p_level       integer default 1,
  p_duration_s  integer default null
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_inserted  integer;
  v_utc_today date := (now() at time zone 'utc')::date;
begin
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return 'student_not_found';
  end if;

  insert into public.student_attempts
    (student_id, tutor_id, exercise_id, topic, exercise, correct, level, duration_s)
  values
    (p_student_id, p_tutor_id, p_exercise_id, p_topic, p_exercise, p_correct, p_level, p_duration_s)
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

  return 'ok';
end;
$$;

revoke all on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- answer_assignment: igual que en 20261027100000_assigned_exercises.sql + p_duration_s.
-- ---------------------------------------------------------------------------
drop function public.answer_assignment(uuid, uuid, uuid, integer, date);

create function public.answer_assignment(
  p_tutor_id      uuid,
  p_student_id    uuid,
  p_assignment_id uuid,
  p_answer        integer,
  p_local_day     date default null,
  p_duration_s    integer default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.assigned_exercises%rowtype;
begin
  select * into v_row from public.assigned_exercises a
    where a.id = p_assignment_id and a.student_id = p_student_id and a.tutor_id = p_tutor_id
    for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_row.answered_at is not null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  update public.assigned_exercises
    set answered_at = now(), correct = (p_answer = v_row.answer)
    where id = v_row.id;

  perform public.record_attempt(
    p_tutor_id, p_student_id, v_row.id, 'tarea_tutor', v_row.text,
    p_answer = v_row.answer, p_local_day, 1, p_duration_s
  );

  return jsonb_build_object(
    'status', 'ok', 'correct', p_answer = v_row.answer, 'answer', v_row.answer
  );
end;
$$;

revoke all on function public.answer_assignment(uuid, uuid, uuid, integer, date, integer)
  from public, anon, authenticated;
grant execute on function public.answer_assignment(uuid, uuid, uuid, integer, date, integer)
  to service_role;
