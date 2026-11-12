-- T8: el tutor corrige el enunciado o la respuesta de una tarea PENDIENTE.
-- Solo `service_role` (FastAPI, que ya filtró el texto y exigió el PIN recién verificado).
-- 'ok' | 'not_found' (no es de ese tutor y perfil, o no existe) | 'answered' (ya fue respondida).
-- Bloquea la fila: no compite con el niño respondiendo a la vez.
create function public.update_assignment(
  p_tutor_id      uuid,
  p_student_id    uuid,
  p_assignment_id uuid,
  p_text          text,
  p_answer        integer
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_answered timestamptz;
begin
  select a.answered_at into v_answered from public.assigned_exercises a
   where a.id = p_assignment_id and a.student_id = p_student_id and a.tutor_id = p_tutor_id
   for update;
  if not found then
    return 'not_found';
  end if;
  if v_answered is not null then
    return 'answered';
  end if;
  update public.assigned_exercises set text = p_text, answer = p_answer where id = p_assignment_id;
  return 'ok';
end;
$$;

revoke all on function public.update_assignment(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.update_assignment(uuid, uuid, uuid, text, integer) to service_role;
