-- Dificultad progresiva: cada intento guarda el nivel (1 fácil, 2 medio, 3 difícil) con que se
-- emitió el ejercicio. El servidor (FastAPI) lee los últimos intentos del perfil en un tema para
-- decidir el nivel del siguiente. No es un dato nuevo del niño: es parte del intento, con el mismo
-- acceso (RLS por tutor, ya existente), plazo y borrado (ON DELETE CASCADE con el perfil).
--
-- Inventario: docs/privacy/inventario-datos.md. Reglas: docs/SPEC.md ("Dificultad progresiva").

alter table public.student_attempts
  add column level smallint not null default 1
  constraint student_attempts_level_range check (level between 1 and 3);

-- Lectura por tema para decidir el nivel (últimos 3 intentos del perfil en el tema).
create index student_attempts_student_topic_time_idx
  on public.student_attempts (student_id, topic, answered_at desc);

-- ---------------------------------------------------------------------------
-- record_attempt: ahora también recibe el nivel (opcional, por defecto 1).
-- Mismo cuerpo que en 20261026120000_student_daily_streaks.sql + columna level.
-- ---------------------------------------------------------------------------
drop function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date);

create function public.record_attempt(
  p_tutor_id    uuid,
  p_student_id  uuid,
  p_exercise_id uuid,
  p_topic       text,
  p_exercise    text,
  p_correct     boolean,
  p_local_day   date default null,
  p_level       integer default 1
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
    (student_id, tutor_id, exercise_id, topic, exercise, correct, level)
  values
    (p_student_id, p_tutor_id, p_exercise_id, p_topic, p_exercise, p_correct, p_level)
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

revoke all on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer)
  from public, anon, authenticated;
grant execute on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer)
  to service_role;
