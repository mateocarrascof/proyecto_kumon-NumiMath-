-- Docentes y administradores: base de roles y tablas.
--
-- Rol de una cuenta: `app_metadata.role` de Auth = 'teacher' o 'admin'. El usuario NO puede
-- cambiarlo (app_metadata solo lo escribe el servidor con la llave de servicio). Quien no lo
-- tiene es tutor. El administrador es solo ese rol: no hay tabla propia.
--
-- Datos personales nuevos (docs/privacy/inventario-datos.md): nombre del docente (hasta 60) y su
-- código de vínculo. El correo vive solo en Auth. El docente NO tiene acceso directo a tablas de
-- niños: todo lo suyo pasa por FastAPI y por `teacher_can_view`.

-- ---------------------------------------------------------------------------
-- 1. Un docente o admin no es tutor: el trigger de alta lo deja fuera.
--    Se lee raw_app_meta_data (no raw_user_meta_data, que el usuario sí puede escribir al registrarse).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_tutor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_anonymous or coalesce(new.raw_app_meta_data ->> 'role', '') in ('teacher', 'admin') then
    return new;
  end if;
  insert into public.tutors (id) values (new.id);
  return new;
end;
$$;

-- Si GoTrue graba app_metadata DESPUÉS del insert (o se asciende a un usuario existente), el trigger
-- anterior ya lo habría hecho tutor: al recibir el rol se retira esa fila. Si ya tiene perfiles de
-- niños o consentimientos NO se borra nada: falla y alguien debe revisarlo.
create function public.drop_tutor_on_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.students where tutor_id = new.id)
     or exists (select 1 from public.consents where tutor_id = new.id) then
    raise exception 'el usuario ya es tutor con datos: no puede ser docente ni admin'
      using errcode = '42501';
  end if;
  delete from public.tutors where id = new.id;
  return new;
end;
$$;

revoke all on function public.drop_tutor_on_role() from public, anon, authenticated;

create trigger on_auth_user_role_set
  after update of raw_app_meta_data on auth.users
  for each row
  when (coalesce(new.raw_app_meta_data ->> 'role', '') in ('teacher', 'admin'))
  execute function public.drop_tutor_on_role();

-- ---------------------------------------------------------------------------
-- 2. teachers: perfil 1:1 con auth.users. Solo el servidor escribe.
-- ---------------------------------------------------------------------------
create table public.teachers (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null
             constraint teachers_name_len
             check (name = btrim(name) and char_length(name) between 1 and 60),
  -- Solo identifica al docente; el acceso a un alumno lo da el tutor al confirmar.
  link_code  text not null unique
             constraint teachers_link_code_format check (link_code ~ '^[A-Z2-9]{8}$'),
  created_at timestamptz not null default now()
);

create function public.teachers_immutable_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.link_code is distinct from old.link_code then
    raise exception 'teachers.id y teachers.link_code no se pueden cambiar'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger teachers_immutable_code
  before update on public.teachers
  for each row execute function public.teachers_immutable_code();

-- ---------------------------------------------------------------------------
-- 3. tutor_sharing: qué comparte el tutor con los docentes (dos casillas separadas, opt-in).
--    Cada cambio queda como evento con fecha UTC y versión de los términos aceptados.
-- ---------------------------------------------------------------------------
create table public.tutor_sharing (
  tutor_id      uuid primary key references public.tutors (id) on delete cascade,
  teacher_view  boolean not null default false,
  sheets        boolean not null default false,
  terms_version text constraint tutor_sharing_terms_version_len
                check (terms_version is null or char_length(terms_version) between 1 and 40),
  updated_at    timestamptz not null default now()
);

create table public.tutor_sharing_events (
  seq           bigint generated always as identity primary key,
  tutor_id      uuid not null references public.tutors (id) on delete cascade,
  setting       text not null check (setting in ('teacher_view', 'sheets')),
  enabled       boolean not null,
  terms_version text,
  occurred_at   timestamptz not null default now()
);

create index tutor_sharing_events_tutor_idx on public.tutor_sharing_events (tutor_id, seq);

create function public.tutor_sharing_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.teacher_view is distinct from old.teacher_view then
    if tg_op = 'UPDATE' or new.teacher_view then
      insert into public.tutor_sharing_events (tutor_id, setting, enabled, terms_version)
      values (new.tutor_id, 'teacher_view', new.teacher_view, new.terms_version);
    end if;
  end if;
  if tg_op = 'INSERT' or new.sheets is distinct from old.sheets then
    if tg_op = 'UPDATE' or new.sheets then
      insert into public.tutor_sharing_events (tutor_id, setting, enabled, terms_version)
      values (new.tutor_id, 'sheets', new.sheets, new.terms_version);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.tutor_sharing_log() from public, anon, authenticated;

create trigger tutor_sharing_log
  after insert or update on public.tutor_sharing
  for each row execute function public.tutor_sharing_log();

-- Los eventos son evidencia: no se editan ni se borran (salvo en cascada al borrar la cuenta).
create function public.tutor_sharing_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'tutor_sharing_events es de solo anexar' using errcode = '42501';
end;
$$;

create trigger tutor_sharing_events_no_update
  before update on public.tutor_sharing_events
  for each row execute function public.tutor_sharing_events_append_only();

-- ---------------------------------------------------------------------------
-- 4. teacher_links: qué alumnos ve cada docente. El tutor lee y borra; el docente solo lee;
--    los inserta únicamente el servidor (tras confirmar el tutor el nombre del docente).
--    La FK compuesta impide vincular un alumno de otro tutor.
-- ---------------------------------------------------------------------------
alter table public.students
  add constraint students_id_tutor_unique unique (id, tutor_id);

create table public.teacher_links (
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  student_id uuid not null,
  tutor_id   uuid not null references public.tutors (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (teacher_id, student_id),
  foreign key (student_id, tutor_id)
    references public.students (id, tutor_id) on delete cascade
);

create index teacher_links_student_idx on public.teacher_links (student_id);
create index teacher_links_tutor_idx on public.teacher_links (tutor_id);

-- Revocar el consentimiento borra los vínculos; volver a consentir NO los restaura.
create function public.on_consent_revoked_unlink()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.teacher_links where tutor_id = new.tutor_id;
  return new;
end;
$$;

revoke all on function public.on_consent_revoked_unlink() from public, anon, authenticated;

create trigger consents_after_revoke_unlink
  after insert on public.consents
  for each row when (new.event_type = 'revoke')
  execute function public.on_consent_revoked_unlink();

-- ---------------------------------------------------------------------------
-- 5. teacher_can_view: la ÚNICA puerta de lectura del docente. Exige vínculo, consentimiento
--    activo del tutor, autorización activa (casilla "vista docente") y perfil no bloqueado.
-- ---------------------------------------------------------------------------
create function public.teacher_can_view(p_teacher_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teacher_links l
    join public.students s on s.id = l.student_id and s.tutor_id = l.tutor_id
    join public.tutor_sharing sh on sh.tutor_id = l.tutor_id
    -- Sigue siendo docente: quitar el rol corta el acceso aunque su token no haya vencido.
    join auth.users u on u.id = l.teacher_id and u.raw_app_meta_data ->> 'role' = 'teacher'
    where l.teacher_id = p_teacher_id
      and l.student_id = p_student_id
      and sh.teacher_view
      and s.blocked_at is null
      and public.has_active_consent(l.tutor_id)
  );
$$;

revoke all on function public.teacher_can_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.teacher_can_view(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Privilegios y RLS. Escritura de estas tablas: solo service_role (FastAPI), salvo que el
--    tutor puede leer lo suyo y borrar sus vínculos.
-- ---------------------------------------------------------------------------
revoke all on public.teachers, public.tutor_sharing, public.tutor_sharing_events,
  public.teacher_links from public, anon, authenticated;

grant select on public.teachers to authenticated;
grant select on public.tutor_sharing, public.tutor_sharing_events to authenticated;
grant select, delete on public.teacher_links to authenticated;

alter table public.teachers              enable row level security;
alter table public.tutor_sharing         enable row level security;
alter table public.tutor_sharing_events  enable row level security;
alter table public.teacher_links         enable row level security;

alter table public.teachers              force row level security;
alter table public.tutor_sharing         force row level security;
alter table public.tutor_sharing_events  force row level security;
alter table public.teacher_links         force row level security;

create policy teachers_select_own on public.teachers
  for select to authenticated
  using (id = (select auth.uid()));

create policy tutor_sharing_select_own on public.tutor_sharing
  for select to authenticated
  using (tutor_id = (select auth.uid()));

create policy tutor_sharing_events_select_own on public.tutor_sharing_events
  for select to authenticated
  using (tutor_id = (select auth.uid()));

create policy teacher_links_select_tutor on public.teacher_links
  for select to authenticated
  using (tutor_id = (select auth.uid()));

create policy teacher_links_select_teacher on public.teacher_links
  for select to authenticated
  using (teacher_id = (select auth.uid()));

create policy teacher_links_delete_tutor on public.teacher_links
  for delete to authenticated
  using (tutor_id = (select auth.uid()));
