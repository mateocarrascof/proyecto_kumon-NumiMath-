-- Intentos de práctica de un perfil. Los escribe SOLO el servidor (FastAPI, service_role);
-- el tutor solo puede leer los de sus perfiles (RLS por tutor).
--
-- Datos: id del ejercicio, tema, texto del ejercicio (generado por código, sin datos
-- personales), si fue correcto y la hora. Nunca la respuesta escrita ni texto libre del niño.
--
-- Borrado: al borrar el perfil se borran sus intentos (ON DELETE CASCADE). Si debe ser otra cosa
-- (p. ej. conservar agregados anónimos) está pendiente de decisión: docs/privacy/pendientes-legales.md.

create table public.student_attempts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students (id) on delete cascade,
  tutor_id     uuid not null references public.tutors (id) on delete cascade,
  exercise_id  uuid not null,
  topic        text not null check (char_length(topic) between 1 and 60),
  exercise     text not null check (char_length(exercise) between 1 and 200),
  correct      boolean not null,
  answered_at  timestamptz not null default now(),
  -- Cada ejercicio se responde UNA sola vez por perfil: repetir no cuenta dos veces.
  constraint student_attempts_once unique (student_id, exercise_id)
);

create index student_attempts_student_time_idx
  on public.student_attempts (student_id, answered_at desc);

alter table public.student_attempts enable row level security;
alter table public.student_attempts force row level security;

revoke all on public.student_attempts from public, anon, authenticated;
grant select on public.student_attempts to authenticated;

create policy student_attempts_select_own on public.student_attempts
  for select to authenticated
  using (tutor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- record_attempt: registra un intento si el perfil es del tutor. Devuelve
-- 'ok', 'duplicate' (ya respondido) o 'student_not_found'.
-- ---------------------------------------------------------------------------
create function public.record_attempt(
  p_tutor_id    uuid,
  p_student_id  uuid,
  p_exercise_id uuid,
  p_topic       text,
  p_exercise    text,
  p_correct     boolean
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return 'student_not_found';
  end if;

  insert into public.student_attempts (student_id, tutor_id, exercise_id, topic, exercise, correct)
  values (p_student_id, p_tutor_id, p_exercise_id, p_topic, p_exercise, p_correct)
  on conflict (student_id, exercise_id) do nothing;

  get diagnostics v_inserted = row_count;
  return case when v_inserted = 1 then 'ok' else 'duplicate' end;
end;
$$;

revoke all on function public.record_attempt(uuid, uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_attempt(uuid, uuid, uuid, text, text, boolean)
  to service_role;
