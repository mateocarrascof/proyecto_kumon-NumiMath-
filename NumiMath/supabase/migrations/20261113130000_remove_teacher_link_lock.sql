-- Quitar un vínculo toma el mismo cerrojo del tutor que revocar el consentimiento, crear vínculos y
-- guardar hojas (`save_student_sheet`): un guardado concurrente ya no puede quedar guardado sin un
-- docente vinculado activo (revisión de seguridad, B1). Mismo resultado y mismos permisos que antes.
create or replace function public.remove_teacher_link(p_tutor_id uuid, p_student_id uuid, p_teacher_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || p_tutor_id::text, 0));
  delete from public.teacher_links
   where tutor_id = p_tutor_id and student_id = p_student_id and teacher_id = p_teacher_id;
  if not found then
    return 'not_found';
  end if;
  return 'ok';
end;
$$;
