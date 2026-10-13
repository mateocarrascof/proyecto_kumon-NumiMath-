-- Lote D, parte 1 (revisión de los Lotes A y B): arreglos.
--   - el tope de eventos de consentimiento cuenta solo ACEPTACIONES; revocar nunca se frena;
--   - una revocación copia las versiones del último consentimiento (no confía en el cliente);
--   - límite de altas de perfiles por tutor cada 24 h (el borrado y la recreación en bucle
--     llenaba declaration_evidence, que es inmutable);
--   - TRUNCATE bloqueado en las tablas inmutables y DELETE de consents solo por cascada;
--   - la variable app.evidence_purge ya no basta: el borrado exige además ser el dueño;
--   - índices y purgas con condiciones indexables;
--   - la declaración archivada conserva el consentimiento ORIGINAL aunque se desbloquee.

-- ---------------------------------------------------------------------------
-- 1. Configuración: altas de perfiles por tutor cada 24 h.
-- ---------------------------------------------------------------------------
alter table public.app_settings drop constraint app_settings_values_valid;
alter table public.app_settings add constraint app_settings_values_valid check (
  case key
    when 'consent_evidence_retention_days' then
      value = 'null'::jsonb
      or (jsonb_typeof(value) = 'number'
          and case when (value #>> '{}') ~ '^[0-9]{1,5}$'
                   then (value #>> '{}')::integer between 1 and 36500
                   else false end)
    when 'blocked_profile_retention_days' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,5}$'
               then (value #>> '{}')::integer between 1 and 36500
               else false end
    when 'blocked_profile_retention_confirmed' then
      jsonb_typeof(value) = 'boolean'
    when 'student_creations_per_day' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,4}$'
               then (value #>> '{}')::integer between 1 and 1000
               else false end
    else true
  end
);

insert into public.app_settings (key, value) values ('student_creations_per_day', '10'::jsonb);

-- ---------------------------------------------------------------------------
-- 2. consents: el tope cuenta solo 'grant' y la revocación copia las versiones.
--    Máximo 10 aceptaciones por tutor cada 24 horas. Una revocación NUNCA se limita
--    (retirar el consentimiento debe ser tan fácil como darlo y el borrado de cuenta
--    empieza registrando una).
-- ---------------------------------------------------------------------------
create or replace function public.consents_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_last_type    text;
  v_last_terms   uuid;
  v_last_privacy uuid;
  v_count        integer;
begin
  if current_user = 'authenticated' and new.tutor_id is distinct from auth.uid() then
    raise exception 'tutor_mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || new.tutor_id::text, 0));

  select c.event_type, c.terms_version_id, c.privacy_version_id
    into v_last_type, v_last_terms, v_last_privacy
  from public.consents c
  where c.tutor_id = new.tutor_id
  order by c.seq desc
  limit 1;

  if v_last_type is null then
    if new.event_type = 'revoke' then
      raise exception 'no_consent_to_revoke';
    end if;
  elsif new.event_type = v_last_type
        and (new.event_type = 'revoke'
             or (new.terms_version_id = v_last_terms
                 and new.privacy_version_id = v_last_privacy)) then
    raise exception 'consent_event_redundant';
  end if;

  if new.event_type = 'grant' then
    select count(*) into v_count
    from public.consents c
    where c.tutor_id = new.tutor_id
      and c.event_type = 'grant'
      and c.occurred_at > now() - interval '24 hours';
    if v_count >= 10 then
      raise exception 'consent_event_rate_limited';
    end if;
  else
    -- Revocación: queda registrada sobre las versiones que el tutor aceptó por última vez.
    new.terms_version_id   := v_last_terms;
    new.privacy_version_id := v_last_privacy;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Altas de perfiles por tutor cada 24 h (configurable). Cuenta también los perfiles
--    ya borrados mediante un registro mínimo que se limpia solo.
-- ---------------------------------------------------------------------------
create table public.student_creation_log (
  id         bigint generated always as identity primary key,
  tutor_id   uuid not null references public.tutors (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index student_creation_log_tutor_idx on public.student_creation_log (tutor_id, created_at);

alter table public.student_creation_log enable row level security;
alter table public.student_creation_log force row level security;
revoke all on public.student_creation_log from public, anon, authenticated;

-- SECURITY DEFINER: el cliente no tiene acceso a la tabla; un trigger no exige EXECUTE.
create function public.students_creation_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  select (s.value #>> '{}')::integer into v_limit
  from public.app_settings s
  where s.key = 'student_creations_per_day';
  v_limit := coalesce(v_limit, 10);

  delete from public.student_creation_log
  where tutor_id = new.tutor_id and created_at < now() - interval '24 hours';

  select count(*) into v_count
  from public.student_creation_log
  where tutor_id = new.tutor_id;

  if v_count >= v_limit then
    raise exception 'student_create_rate_limited';
  end if;

  insert into public.student_creation_log (tutor_id) values (new.tutor_id);
  return new;
end;
$$;

revoke all on function public.students_creation_rate_limit() from public, anon, authenticated;

-- Se ejecuta después de students_before_insert (orden alfabético de triggers).
create trigger students_rate_limit
  before insert on public.students
  for each row execute function public.students_creation_rate_limit();

-- ---------------------------------------------------------------------------
-- 4. Vínculo de la declaración con el consentimiento ORIGINAL (inmutable).
-- ---------------------------------------------------------------------------
alter table public.students add column declaration_consent_seq bigint;
update public.students set declaration_consent_seq = consent_seq;
alter table public.students alter column declaration_consent_seq set not null;

create or replace function public.students_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_consent     uuid;
  v_consent_seq bigint;
  v_decl        uuid;
  v_max         smallint;
  v_count       integer;
begin
  if current_user = 'authenticated' and new.tutor_id is distinct from auth.uid() then
    raise exception 'tutor_mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || new.tutor_id::text, 0));

  if not public.has_active_consent(new.tutor_id) then
    raise exception 'consent_required';
  end if;

  select c.id, c.seq into v_consent, v_consent_seq
  from public.consents c
  where c.tutor_id = new.tutor_id
  order by c.seq desc
  limit 1;

  select v.id into v_decl
  from public.legal_document_versions v
  where v.kind = 'adult_declaration' and v.is_current;
  if v_decl is null then
    raise exception 'declaration_version_missing';
  end if;

  select t.max_students into v_max from public.tutors t where t.id = new.tutor_id;
  if v_max is null then
    raise exception 'tutor_not_found';
  end if;
  select count(*) into v_count from public.students s where s.tutor_id = new.tutor_id;
  if v_count >= v_max then
    raise exception 'student_limit_reached';
  end if;

  new.consent_id                   := v_consent;
  new.consent_seq                  := v_consent_seq;
  new.declaration_consent_seq      := v_consent_seq;   -- fijo: no cambia al desbloquear
  new.adult_declaration_version_id := v_decl;
  new.adult_declared_at            := now();
  new.blocked_at                   := null;
  return new;
end;
$$;

-- El archivo usa el consentimiento original y corre DESPUÉS del borrado: si otro trigger
-- BEFORE DELETE cancelara la operación, no quedaría evidencia de un perfil que sigue vivo.
drop trigger students_archive_declaration on public.students;

create or replace function public.archive_declaration_on_student_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.declaration_evidence
    (consent_seq, declaration_version, declaration_sha256, declared_at)
  select old.declaration_consent_seq, v.version, v.content_sha256, old.adult_declared_at
  from public.legal_document_versions v
  where v.id = old.adult_declaration_version_id;
  return old;
end;
$$;

create trigger students_archive_declaration
  after delete on public.students
  for each row execute function public.archive_declaration_on_student_delete();

-- ---------------------------------------------------------------------------
-- 5. Inmutabilidad: TRUNCATE bloqueado, DELETE de consents solo por cascada y el borrado
--    de evidencia solo desde el dueño de las funciones de purga.
-- ---------------------------------------------------------------------------
create function public.truncate_not_allowed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'truncate_not_allowed';
end;
$$;

revoke all on function public.truncate_not_allowed() from public, anon, authenticated;

create trigger consent_evidence_no_truncate
  before truncate on public.consent_evidence
  for each statement execute function public.truncate_not_allowed();
create trigger declaration_evidence_no_truncate
  before truncate on public.declaration_evidence
  for each statement execute function public.truncate_not_allowed();
create trigger legal_document_versions_no_truncate
  before truncate on public.legal_document_versions
  for each statement execute function public.truncate_not_allowed();
create trigger consents_no_truncate
  before truncate on public.consents
  for each statement execute function public.truncate_not_allowed();
create trigger student_status_events_no_truncate
  before truncate on public.student_status_events
  for each statement execute function public.truncate_not_allowed();

revoke truncate on public.consent_evidence, public.declaration_evidence,
  public.legal_document_versions, public.consents, public.student_status_events
  from public, anon, authenticated, service_role;

-- consents: solo se puede borrar un evento cuando el tutor ya no existe (cascada de cuenta).
create function public.consents_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.tutors t where t.id = old.tutor_id) then
    raise exception 'consents_are_append_only';
  end if;
  return old;
end;
$$;

revoke all on function public.consents_delete_guard() from public, anon, authenticated;

create trigger consents_no_delete
  before delete on public.consents
  for each row execute function public.consents_delete_guard();

-- La variable app.evidence_purge puede fijarla cualquier sesión; solo vale si quien
-- borra es el dueño de las funciones de purga (control no criptográfico: quien ya tiene
-- acceso de dueño a la base puede hacer lo que quiera; esto frena a service_role y a
-- cualquier cliente de la API).
create or replace function public.evidence_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.evidence_purge', true) = 'on'
     and current_user = 'postgres' then
    return old;
  end if;
  raise exception 'evidence_is_immutable';
end;
$$;

-- Funciones trigger del Lote B sin revoke (coherencia con el Lote A).
revoke all on function public.evidence_immutable()                  from public, anon, authenticated;
revoke all on function public.legal_versions_guard()                from public, anon, authenticated;
revoke all on function public.consents_append_only()                from public, anon, authenticated;
revoke all on function public.student_status_events_append_only()   from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Índices y purgas con condiciones indexables (columna sola a un lado).
-- ---------------------------------------------------------------------------
create index consent_evidence_archived_at_idx   on public.consent_evidence (archived_at);
create index declaration_evidence_archived_at_idx on public.declaration_evidence (archived_at);
create index students_blocked_at_idx on public.students (blocked_at) where blocked_at is not null;

-- legal_document_versions no admite DELETE: este índice nunca validaría una FK borrada.
drop index public.students_adult_declaration_version_id_idx;

create or replace function public.purge_expired_consent_evidence()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_a    integer;
  v_b    integer;
begin
  select (s.value #>> '{}')::integer into v_days
  from public.app_settings s
  where s.key = 'consent_evidence_retention_days';

  if v_days is null then
    return 0;   -- plazo sin definir: no se purga nada (ver privacy_config_warnings)
  end if;

  perform set_config('app.evidence_purge', 'on', true);

  delete from public.consent_evidence
  where archived_at < now() - make_interval(days => v_days);
  get diagnostics v_a = row_count;

  delete from public.declaration_evidence
  where archived_at < now() - make_interval(days => v_days);
  get diagnostics v_b = row_count;

  perform set_config('app.evidence_purge', 'off', true);
  return v_a + v_b;
end;
$$;

create or replace function public.purge_long_blocked_students()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_rows integer;
begin
  select (s.value #>> '{}')::integer into v_days
  from public.app_settings s
  where s.key = 'blocked_profile_retention_days';

  if v_days is null then
    return 0;
  end if;

  delete from public.students
  where blocked_at is not null
    and blocked_at < now() - make_interval(days => v_days);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.blocked_students_due_soon(p_within_days integer default 7)
returns table (tutor_id uuid, student_id uuid, purge_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.tutor_id, s.id, s.blocked_at + make_interval(days => d.days)
  from public.students s
  cross join (
    select (a.value #>> '{}')::integer as days
    from public.app_settings a
    where a.key = 'blocked_profile_retention_days'
  ) d
  where s.blocked_at is not null
    and s.blocked_at < now() + make_interval(days => p_within_days) - make_interval(days => d.days);
$$;

-- Reversa (solo desarrollo; Supabase migra hacia adelante):
--   drop trigger students_rate_limit on public.students; drop table public.student_creation_log;
--   drop function public.students_creation_rate_limit(), public.truncate_not_allowed(), public.consents_delete_guard();
--   drop trigger consents_no_delete on public.consents; drop trigger *_no_truncate (cinco tablas);
--   alter table public.students drop column declaration_consent_seq;
--   (restaurar consents_before_insert, students_before_insert, evidence_immutable, las purgas y los
--    triggers de archivo de la migración 20261012210000 y 20261012200000)
