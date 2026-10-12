-- Primera migración: tutors, students, consents con RLS por tutor.
-- Reglas (CLAUDE.md): solo el tutor tiene cuenta (Supabase Auth); del alumno solo apodo y curso.
-- Datos personales: ver docs/privacy/inventario-datos.md (actualizado en este mismo cambio).

-- ---------------------------------------------------------------------------
-- tutors: perfil 1:1 con auth.users. El correo vive solo en Auth, no se duplica.
-- ---------------------------------------------------------------------------
create table public.tutors (
  id         uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- students: perfil dependiente, sin credenciales ni email. Solo apodo y curso.
-- ---------------------------------------------------------------------------
create table public.students (
  id         uuid primary key default gen_random_uuid(),
  tutor_id   uuid not null references public.tutors (id) on delete cascade,
  nickname   text not null
             constraint students_nickname_len
             check (nickname = btrim(nickname) and char_length(nickname) between 1 and 30),
  grade      smallint not null
             constraint students_grade_range check (grade between 1 and 4),
  created_at timestamptz not null default now()
);

create index students_tutor_id_idx on public.students (tutor_id);

-- ---------------------------------------------------------------------------
-- consents: evidencia de consentimiento. Append-only para el tutor.
-- accepted_at lo fija el servidor (UTC); el cliente no puede escribirlo.
-- ---------------------------------------------------------------------------
create table public.consents (
  id            uuid primary key default gen_random_uuid(),
  tutor_id      uuid not null references public.tutors (id) on delete cascade,
  terms_version   text not null
                  constraint consents_terms_version_len check (char_length(terms_version) between 1 and 40),
  privacy_version text not null
                  constraint consents_privacy_version_len check (char_length(privacy_version) between 1 and 40),
  accepted_at   timestamptz not null default now(),
  -- El unique ya indexa por tutor_id (columna líder); no hace falta índice aparte.
  -- Reintentar el mismo consentimiento devuelve 23505: la API debe usar
  -- `on conflict do nothing` o traducir el error.
  unique (tutor_id, terms_version, privacy_version)
);

-- ---------------------------------------------------------------------------
-- Crear el perfil del tutor automáticamente al registrarse en Auth.
-- Nota: tutors tiene FORCE RLS y ninguna política de INSERT; esto funciona porque
-- el dueño de la función (postgres) tiene BYPASSRLS en Supabase. Si cambia el
-- dueño, el registro de usuarios fallaría: el test lo vigila.
-- Regla: toda columna nueva de tutors debe ser nullable o tener DEFAULT, o este
-- trigger bloquearía todos los registros.
-- Los usuarios anónimos de Auth no son tutores.
-- ---------------------------------------------------------------------------
create function public.handle_new_tutor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_anonymous then
    return new;
  end if;
  insert into public.tutors (id) values (new.id);
  return new;
end;
$$;

revoke all on function public.handle_new_tutor() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_tutor();

-- Usuarios de Auth que ya existían antes de esta migración (proyectos con datos de prueba).
insert into public.tutors (id)
select id from auth.users where not is_anonymous
on conflict do nothing;

-- Reversa (solo desarrollo; Supabase migra hacia adelante):
--   drop trigger on_auth_user_created on auth.users;
--   drop function public.handle_new_tutor();
--   drop table public.consents, public.students, public.tutors;

-- ---------------------------------------------------------------------------
-- Privilegios: mínimo necesario. anon no accede a nada.
-- ---------------------------------------------------------------------------
revoke all on public.tutors, public.students, public.consents from public, anon, authenticated;

grant select                         on public.tutors   to authenticated;
-- students: columnas gestionadas por el servidor (id, created_at) no son escribibles;
-- tutor_id solo se fija al insertar y no se puede cambiar después.
grant select, delete                      on public.students to authenticated;
grant insert (tutor_id, nickname, grade)  on public.students to authenticated;
grant update (nickname, grade)            on public.students to authenticated;

grant select                         on public.consents to authenticated;
grant insert (tutor_id, terms_version, privacy_version) on public.consents to authenticated;

-- ---------------------------------------------------------------------------
-- RLS por tutor (frontera de seguridad principal).
-- ---------------------------------------------------------------------------
alter table public.tutors   enable row level security;
alter table public.students enable row level security;
alter table public.consents enable row level security;

alter table public.tutors   force row level security;
alter table public.students force row level security;
alter table public.consents force row level security;

create policy tutors_select_own on public.tutors
  for select to authenticated
  using (id = (select auth.uid()));

create policy students_select_own on public.students
  for select to authenticated
  using (tutor_id = (select auth.uid()));

create policy students_insert_own on public.students
  for insert to authenticated
  with check (tutor_id = (select auth.uid()));

create policy students_update_own on public.students
  for update to authenticated
  using (tutor_id = (select auth.uid()))
  with check (tutor_id = (select auth.uid()));

create policy students_delete_own on public.students
  for delete to authenticated
  using (tutor_id = (select auth.uid()));

create policy consents_select_own on public.consents
  for select to authenticated
  using (tutor_id = (select auth.uid()));

create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (tutor_id = (select auth.uid()));
