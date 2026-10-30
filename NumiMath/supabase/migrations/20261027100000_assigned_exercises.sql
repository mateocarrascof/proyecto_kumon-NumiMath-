-- Ejercicios propios del tutor ("Tareas de tu tutor"). El tutor escribe un enunciado y la
-- respuesta; el niño lo responde una vez desde la práctica.
--
-- Escritura SOLO vía FastAPI (service_role), que filtra el texto antes de guardarlo (datos
-- personales, groserías, fuera de matemáticas). El tutor solo puede leer las de sus perfiles (RLS).
-- El texto nunca se envía a la IA.
--
-- Borrado: al borrar el perfil o la cuenta se borran sus tareas (ON DELETE CASCADE).
-- Inventario: docs/privacy/inventario-datos.md. Reglas: docs/SPEC.md ("Ejercicios propios").

create table public.assigned_exercises (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students (id) on delete cascade,
  tutor_id     uuid not null references public.tutors (id) on delete cascade,
  text         text not null check (char_length(text) between 1 and 200),
  answer       integer not null check (answer between 0 and 1000000),
  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  correct      boolean,
  constraint assigned_exercises_answered_consistent
    check ((answered_at is null) = (correct is null))
);

create index assigned_exercises_student_idx
  on public.assigned_exercises (student_id, answered_at nulls first, created_at desc);
create index assigned_exercises_tutor_idx on public.assigned_exercises (tutor_id);

alter table public.assigned_exercises enable row level security;
alter table public.assigned_exercises force row level security;

revoke all on public.assigned_exercises from public, anon, authenticated;
grant select on public.assigned_exercises to authenticated;

create policy assigned_exercises_select_own on public.assigned_exercises
  for select to authenticated
  using (tutor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- create_assignment: 'ok' | 'student_not_found' | 'limit' (máximo 20 pendientes por perfil).
-- Bloquea la fila del perfil para que dos altas a la vez no pasen el límite.
-- ---------------------------------------------------------------------------
create function public.create_assignment(
  p_tutor_id   uuid,
  p_student_id uuid,
  p_text       text,
  p_answer     integer
) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.students s
    where s.id = p_student_id and s.tutor_id = p_tutor_id
    for update;
  if not found then
    return 'student_not_found';
  end if;

  if (select count(*) from public.assigned_exercises a
      where a.student_id = p_student_id and a.answered_at is null) >= 20 then
    return 'limit';
  end if;

  insert into public.assigned_exercises (student_id, tutor_id, text, answer)
  values (p_student_id, p_tutor_id, p_text, p_answer);
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_assignment: borra solo una tarea PENDIENTE del tutor y perfil. 'ok' | 'not_found'.
-- ---------------------------------------------------------------------------
create function public.delete_assignment(
  p_tutor_id      uuid,
  p_student_id    uuid,
  p_assignment_id uuid
) returns text
language plpgsql
set search_path = ''
as $$
begin
  delete from public.assigned_exercises a
    where a.id = p_assignment_id
      and a.student_id = p_student_id
      and a.tutor_id = p_tutor_id
      and a.answered_at is null;
  return case when found then 'ok' else 'not_found' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- answer_assignment: en una transacción marca la tarea como respondida, guarda si acertó y
-- registra el intento (tema 'tarea_tutor') con record_attempt, que también suma a la racha.
-- Devuelve {"status": 'ok'|'duplicate'|'not_found', "correct": bool, "answer": int}.
-- ---------------------------------------------------------------------------
create function public.answer_assignment(
  p_tutor_id      uuid,
  p_student_id    uuid,
  p_assignment_id uuid,
  p_answer        integer,
  p_local_day     date default null
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
    p_answer = v_row.answer, p_local_day, 1
  );

  return jsonb_build_object(
    'status', 'ok', 'correct', p_answer = v_row.answer, 'answer', v_row.answer
  );
end;
$$;

revoke all on function public.create_assignment(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.delete_assignment(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.answer_assignment(uuid, uuid, uuid, integer, date)
  from public, anon, authenticated;
grant execute on function public.create_assignment(uuid, uuid, text, integer) to service_role;
grant execute on function public.delete_assignment(uuid, uuid, uuid) to service_role;
grant execute on function public.answer_assignment(uuid, uuid, uuid, integer, date) to service_role;
grant select on public.assigned_exercises to service_role;
