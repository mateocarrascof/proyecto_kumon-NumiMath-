-- CU-A9 (RF-10): recordatorio de racha LOCAL, opcional y activado solo por el tutor (ADR 0003).
-- Se guarda solo la preferencia por perfil (sí o no). El aviso lo programa el propio dispositivo:
-- no hay servidor de notificaciones, tokens de push ni horarios en la base.
-- No es un dato del niño en sí: es una preferencia del adulto sobre el perfil. Hereda la RLS de
-- `students` (el tutor lee los suyos) y se borra con el perfil.
alter table public.students
  add column streak_reminder boolean not null default false;

-- El cliente NO puede escribirla: `authenticated` solo tiene UPDATE en (nickname, grade). Solo se
-- cambia vía FastAPI con el token parental (PIN vigente), llamando a esta función.

-- ---------------------------------------------------------------------------
-- set_streak_reminder: activa o desactiva el recordatorio de un perfil del tutor.
-- Devuelve 'ok' o 'student_not_found' (perfil ajeno o inexistente; no cambia nada).
-- Duda para Adolfo: hoy un perfil en pausa no se puede cambiar desde la API (la ruta exige perfil
-- usable). Igual no recibe avisos: la app los cancela si el perfil está en pausa.
-- ---------------------------------------------------------------------------
create function public.set_streak_reminder(
  p_tutor_id   uuid,
  p_student_id uuid,
  p_enabled    boolean
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_enabled is null then
    raise exception 'invalid_streak_reminder' using errcode = '22023';
  end if;
  update public.students s
    set streak_reminder = p_enabled
    where s.id = p_student_id and s.tutor_id = p_tutor_id;
  get diagnostics v_updated = row_count;
  return case when v_updated = 1 then 'ok' else 'student_not_found' end;
end;
$$;

revoke all on function public.set_streak_reminder(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_streak_reminder(uuid, uuid, boolean) to service_role;
