-- Borrar un perfil solo desde la zona del tutor (con PIN), vía FastAPI.
--
-- Antes el cliente borraba directo (`grant delete` + política students_delete_own). Ahora:
--   - el rol `authenticated` ya no puede borrar alumnos;
--   - FastAPI comprueba el JWT y el token parental (PIN verificado) y llama a delete_student.
-- Los triggers siguen igual: al borrar se archiva la declaración del adulto y se borran en cascada
-- intentos, racha diaria y tareas. Borrar sigue disponible aunque el perfil esté bloqueado
-- (derecho de supresión). Reglas: docs/SPEC.md ("Perfiles").

drop policy students_delete_own on public.students;
revoke delete on public.students from authenticated;

-- 'ok' | 'not_found' (no existe o no es de ese tutor).
create function public.delete_student(p_tutor_id uuid, p_student_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
begin
  delete from public.students s
    where s.id = p_student_id and s.tutor_id = p_tutor_id;
  return case when found then 'ok' else 'not_found' end;
end;
$$;

revoke all on function public.delete_student(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_student(uuid, uuid) to service_role;
