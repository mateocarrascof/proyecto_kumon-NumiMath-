-- Administrador: crear y listar cuentas de docentes (AD2 y AD3).
--
-- Lo llama SOLO el servidor (FastAPI, `service_role`), después de verificar el token de administrador.
-- El administrador gestiona cuentas de adultos: estas funciones no tocan ninguna tabla de niños.
--
-- `admin_audit`: registro de cada cambio del administrador (quién, qué, cuándo). Sin datos
-- personales: solo ids de cuentas de adultos (sin correo ni nombre) y el tipo de acción. De solo
-- anexar, sin permisos para el cliente y SIN FK al administrador: sobrevive si se borra esa cuenta.

create table public.admin_audit (
  seq         bigint generated always as identity primary key,
  admin_id    uuid not null,
  action      text not null check (action in ('teacher_created')),
  target_id   uuid not null,
  occurred_at timestamptz not null default now()
);

create index admin_audit_admin_idx on public.admin_audit (admin_id, seq);

create function public.admin_audit_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit es de solo anexar' using errcode = '42501';
end;
$$;

create trigger admin_audit_no_change
  before update or delete on public.admin_audit
  for each row execute function public.admin_audit_append_only();

create trigger admin_audit_no_truncate
  before truncate on public.admin_audit
  for each statement execute function public.admin_audit_append_only();

alter table public.admin_audit enable row level security;
alter table public.admin_audit force row level security;
revoke all on public.admin_audit from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin_create_teacher: crea el perfil del docente y deja constancia, en UNA transacción.
-- Comprueba en `auth.users` que quien actúa es administrador y que la cuenta nueva ya quedó con el
-- rol de docente (así, si Auth no guardó `app_metadata.role`, falla en vez de dejar una cuenta
-- sin rol). Devuelve 'ok' o 'code_taken' (el código de vínculo ya existe: se reintenta con otro).
-- ---------------------------------------------------------------------------
create function public.admin_create_teacher(
  p_admin_id   uuid,
  p_teacher_id uuid,
  p_name       text,
  p_link_code  text
)
returns text
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
  if not exists (
    select 1 from auth.users u
    where u.id = p_teacher_id and u.raw_app_meta_data ->> 'role' = 'teacher'
  ) then
    raise exception 'not_teacher' using errcode = '42501';
  end if;

  begin
    insert into public.teachers (id, name, link_code) values (p_teacher_id, p_name, p_link_code);
  exception when unique_violation then
    -- Solo el código puede repetirse; que el docente ya exista es un error real.
    if exists (select 1 from public.teachers where id = p_teacher_id) then
      raise;
    end if;
    return 'code_taken';
  end;

  insert into public.admin_audit (admin_id, action, target_id)
  values (p_admin_id, 'teacher_created', p_teacher_id);
  return 'ok';
end;
$$;

revoke all on function public.admin_create_teacher(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_create_teacher(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- admin_list_teachers: nombre, correo (vive solo en Auth) y código, en orden alfabético sin
-- distinguir mayúsculas. Solo lectura: no genera registro.
-- ---------------------------------------------------------------------------
create function public.admin_list_teachers()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'email', u.email, 'link_code', t.link_code)
         order by lower(t.name), t.name, t.id), '[]'::jsonb)
  from public.teachers t
  join auth.users u on u.id = t.id;
$$;

revoke all on function public.admin_list_teachers() from public, anon, authenticated;
grant execute on function public.admin_list_teachers() to service_role;
