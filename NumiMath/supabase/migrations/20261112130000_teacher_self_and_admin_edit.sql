-- Docente: ver su perfil y su código (D2, D3). Administrador: editar y eliminar docentes (AD4, AD5).
--
-- Solo las llama el servidor (`service_role`). Ninguna lee tablas de niños. Los cambios del
-- administrador quedan en `admin_audit` (solo ids, sin correo ni nombre).

alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit
  add constraint admin_audit_action_check
  check (action in ('teacher_created', 'teacher_updated', 'teacher_deleted'));

-- ---------------------------------------------------------------------------
-- teacher_profile: nombre y código del docente. `null` si la cuenta NO es de docente o ya no
-- tiene perfil (p. ej. fue eliminada: su token puede seguir vigente unos minutos, pero no
-- encuentra perfil y el servidor lo rechaza).
-- ---------------------------------------------------------------------------
create function public.teacher_profile(p_teacher_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('name', t.name, 'link_code', t.link_code)
  from public.teachers t
  join auth.users u on u.id = t.id and u.raw_app_meta_data ->> 'role' = 'teacher'
  where t.id = p_teacher_id;
$$;

revoke all on function public.teacher_profile(uuid) from public, anon, authenticated;
grant execute on function public.teacher_profile(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- admin_get_teacher: un docente con su correo (que vive solo en Auth). `null` si no existe.
-- ---------------------------------------------------------------------------
create function public.admin_get_teacher(p_teacher_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'name', t.name, 'email', u.email, 'link_code', t.link_code)
  from public.teachers t
  join auth.users u on u.id = t.id and u.raw_app_meta_data ->> 'role' = 'teacher'
  where t.id = p_teacher_id;
$$;

revoke all on function public.admin_get_teacher(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_teacher(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- admin_update_teacher: cambia el nombre y deja constancia en una transacción. El correo ya se
-- cambió en Auth (`p_email_changed`). El código y los vínculos NO se tocan.
-- Devuelve 'ok', 'unchanged' (ni nombre ni correo cambian: no se registra nada) o 'not_found'.
-- ---------------------------------------------------------------------------
create function public.admin_update_teacher(
  p_admin_id      uuid,
  p_teacher_id    uuid,
  p_name          text,
  p_email_changed boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = p_admin_id and u.raw_app_meta_data ->> 'role' = 'admin'
  ) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select t.name into v_old
  from public.teachers t
  join auth.users u on u.id = t.id and u.raw_app_meta_data ->> 'role' = 'teacher'
  where t.id = p_teacher_id
  for update of t;
  if not found then
    return 'not_found';
  end if;

  if v_old is not distinct from p_name and not p_email_changed then
    return 'unchanged';
  end if;
  if v_old is distinct from p_name then
    update public.teachers set name = p_name where id = p_teacher_id;
  end if;
  insert into public.admin_audit (admin_id, action, target_id)
  values (p_admin_id, 'teacher_updated', p_teacher_id);
  return 'ok';
end;
$$;

revoke all on function public.admin_update_teacher(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_update_teacher(uuid, uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- admin_record_teacher_deleted: constancia de la baja (la cuenta de Auth ya se borró; el perfil y
-- los vínculos cayeron por cascada. Los perfiles, intentos y hojas de niños no se tocan).
-- ---------------------------------------------------------------------------
create function public.admin_record_teacher_deleted(p_admin_id uuid, p_teacher_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = p_admin_id and u.raw_app_meta_data ->> 'role' = 'admin'
  ) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  insert into public.admin_audit (admin_id, action, target_id)
  values (p_admin_id, 'teacher_deleted', p_teacher_id);
end;
$$;

revoke all on function public.admin_record_teacher_deleted(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_record_teacher_deleted(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- admin_email_in_use: ¿otra cuenta ya usa este correo? Se consulta ANTES de cambiarlo en Auth, porque
-- la API de administración de Auth responde un error genérico (500) al chocar con un correo ajeno.
-- ---------------------------------------------------------------------------
create function public.admin_email_in_use(p_email text, p_except_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(p_email) and u.id <> p_except_id
  );
$$;

revoke all on function public.admin_email_in_use(text, uuid) from public, anon, authenticated;
grant execute on function public.admin_email_in_use(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- admin_revoke_teacher_sessions: cierra todas las sesiones del docente (borra sus filas de
-- `auth.sessions`; los tokens de refresco caen por cascada). Se usa al cambiar su correo: quien tenía
-- la sesión abierta no puede renovarla. El token de acceso ya emitido vence solo (minutos).
-- Devuelve cuántas sesiones se cerraron.
-- ---------------------------------------------------------------------------
create function public.admin_revoke_teacher_sessions(p_admin_id uuid, p_teacher_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = p_admin_id and u.raw_app_meta_data ->> 'role' = 'admin'
  ) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_teacher_id and u.raw_app_meta_data ->> 'role' = 'teacher'
  ) then
    return 0;
  end if;
  delete from auth.sessions where user_id = p_teacher_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_revoke_teacher_sessions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_teacher_sessions(uuid, uuid) to service_role;
