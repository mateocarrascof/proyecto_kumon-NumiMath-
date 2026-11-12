-- Docentes y administradores: base de roles y tablas.
--
-- Rol de una cuenta: `app_metadata.role` de Auth = 'teacher' o 'admin'. El usuario NO puede
-- cambiarlo (app_metadata solo lo escribe el servidor con la llave de servicio). Quien no lo
-- tiene es tutor. El administrador es solo ese rol: no hay tabla propia.
--
-- Datos personales nuevos (docs/privacy/inventario-datos.md): nombre del docente (hasta 60) y su
-- código de vínculo. El correo vive solo en Auth. El docente NO tiene acceso directo a tablas de
-- niños: todo lo suyo pasa por FastAPI y por `teacher_can_view`.
--
-- Autorización: NO hay casillas de compartir. La autorización es el VÍNCULO (`teacher_links`) que
-- el tutor crea al confirmar el aviso (T25), con fecha y versión de los términos. Un docente ve a un
-- niño solo si hay vínculo activo, el consentimiento del tutor no está revocado, el perfil no está
-- bloqueado y el docente sigue teniendo el rol verificado.

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
-- 3. teacher_links: qué alumnos ve cada docente; el vínculo ES la autorización. El tutor lee y borra;
--    el docente solo lee; los inserta únicamente el servidor (tras confirmar el tutor el nombre del
--    docente, con `accepted_at`, `terms_version_id` y `teacher_name`).
--    La FK compuesta impide vincular un alumno de otro tutor.
-- ---------------------------------------------------------------------------
alter table public.students
  add constraint students_id_tutor_unique unique (id, tutor_id);

create table public.teacher_links (
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  student_id uuid not null,
  tutor_id   uuid not null references public.tutors (id) on delete cascade,
  -- Autorización del tutor: cuándo confirmó el aviso, con qué versión de los términos (mismo patrón
  -- que `consents`) y qué nombre de docente se le mostró (si el administrador lo cambia después, se
  -- puede detectar que ya no es el que el tutor vio).
  accepted_at      timestamptz not null default now(),
  terms_version_id uuid not null references public.legal_document_versions (id),
  teacher_name     text not null
                   constraint teacher_links_teacher_name_len
                   check (char_length(teacher_name) between 1 and 60),
  primary key (teacher_id, student_id),
  foreign key (student_id, tutor_id)
    references public.students (id, tutor_id) on delete cascade
);

create index teacher_links_student_idx on public.teacher_links (student_id);
create index teacher_links_tutor_idx on public.teacher_links (tutor_id);

-- Un vínculo solo se crea con consentimiento vigente. Toma el MISMO candado por tutor que usa la
-- revocación (`on_consent_revoked`), así que no hay carrera: si el tutor revoca a la vez, o este
-- INSERT espera y ve la revocación (y falla), o la revocación espera y borra el vínculo recién creado.
-- La comprobación va en una sentencia aparte, tras obtener el candado, para leer lo ya confirmado.
create function public.teacher_links_require_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || new.tutor_id::text, 0));
  select public.has_active_consent(new.tutor_id) into v_ok;
  if not v_ok then
    raise exception 'consent_required' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.teacher_links_require_consent() from public, anon, authenticated;

create trigger teacher_links_require_consent
  before insert on public.teacher_links
  for each row execute function public.teacher_links_require_consent();

-- Revocar el consentimiento desactiva TODOS los vínculos del tutor (se borran); volver a consentir
-- NO los restaura: el tutor debe vincular de nuevo (y los datos que el docente veía dejan de ser suyos).
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
-- 4. teacher_can_view: la ÚNICA puerta de lectura del docente. Exige vínculo activo, consentimiento
--    activo del tutor (no revocado), perfil no bloqueado y rol de docente verificado.
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
    -- Sigue siendo docente: quitar el rol corta el acceso aunque su token no haya vencido.
    join auth.users u on u.id = l.teacher_id and u.raw_app_meta_data ->> 'role' = 'teacher'
    where l.teacher_id = p_teacher_id
      and l.student_id = p_student_id
      and s.blocked_at is null
      and public.has_active_consent(l.tutor_id)
  );
$$;

revoke all on function public.teacher_can_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.teacher_can_view(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Privilegios y RLS. Escritura de estas tablas: solo service_role (FastAPI); el tutor puede leer
--    sus vínculos y borrarlos (quitar al docente).
-- ---------------------------------------------------------------------------
revoke all on public.teachers, public.teacher_links from public, anon, authenticated;

grant select on public.teachers to authenticated;
grant select, delete on public.teacher_links to authenticated;

alter table public.teachers              enable row level security;
alter table public.teacher_links         enable row level security;

alter table public.teachers              force row level security;
alter table public.teacher_links         force row level security;

create policy teachers_select_own on public.teachers
  for select to authenticated
  using (id = (select auth.uid()));

create policy teacher_links_select_tutor on public.teacher_links
  for select to authenticated
  using (tutor_id = (select auth.uid()));

-- Solo con el rol vigente en el token: una cuenta a la que se le quitó el rol no sigue leyendo.
create policy teacher_links_select_teacher on public.teacher_links
  for select to authenticated
  using (
    teacher_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
  );

create policy teacher_links_delete_tutor on public.teacher_links
  for delete to authenticated
  using (tutor_id = (select auth.uid()));
