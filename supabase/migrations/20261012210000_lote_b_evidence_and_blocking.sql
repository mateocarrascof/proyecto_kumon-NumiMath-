-- Lote B (revisión del Lote 2): evidencia vinculable e inmutable, plazos calculados al purgar,
-- plazo máximo de perfiles bloqueados, archivo de la declaración del adulto, historial de
-- bloqueos y desbloqueos, y rectificación en perfiles bloqueados.
--
-- Decisiones del usuario:
--  #3 la evidencia guarda también un HMAC del correo del tutor (clave fuera de la base);
--  #2 el plazo de conservación de la evidencia se calcula AL PURGAR (no al archivar);
--  #4 plazo máximo de perfiles bloqueados configurable: 30 días PROVISIONALES (pendiente legal).

-- Precondición: sin evidencia previa (se añaden columnas NOT NULL sin backfill).
do $$
begin
  if exists (select 1 from public.consent_evidence) then
    raise exception 'Lote B requiere consent_evidence vacía; hace falta backfill previo';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Configuración: validar los nuevos ajustes y sembrar el plazo provisional.
-- ---------------------------------------------------------------------------
alter table public.app_settings drop constraint app_settings_retention_days_valid;
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
    else true
  end
);

-- PROVISIONAL (pendiente legal): 30 días. Mientras 'confirmed' sea false,
-- privacy_config_warnings() lo señala como alerta.
insert into public.app_settings (key, value) values
  ('blocked_profile_retention_days', '30'::jsonb),
  ('blocked_profile_retention_confirmed', 'false'::jsonb);

-- ---------------------------------------------------------------------------
-- 2. consent_evidence: vinculable (HMAC del correo), con huella del texto, sin
--    retain_until (el plazo se calcula al purgar) e idempotente por source_seq.
-- ---------------------------------------------------------------------------
drop function public.archive_consent_evidence(uuid, text, smallint);

alter table public.consent_evidence drop column retain_until;  -- elimina también su índice

alter table public.consent_evidence
  add column tutor_email_ref text not null
             constraint consent_evidence_email_ref_check check (tutor_email_ref ~ '^[0-9a-f]{64}$'),
  add column terms_sha256   text not null
             constraint consent_evidence_terms_sha_check check (terms_sha256 ~ '^[0-9a-f]{64}$'),
  add column privacy_sha256 text not null
             constraint consent_evidence_privacy_sha_check check (privacy_sha256 ~ '^[0-9a-f]{64}$');

-- source_seq es único global (identity): la idempotencia no depende de la clave HMAC.
alter table public.consent_evidence drop constraint consent_evidence_tutor_ref_source_seq_key;
alter table public.consent_evidence add constraint consent_evidence_source_seq_key unique (source_seq);
create index consent_evidence_tutor_ref_idx on public.consent_evidence (tutor_ref);
create index consent_evidence_email_ref_idx on public.consent_evidence (tutor_email_ref);

-- ---------------------------------------------------------------------------
-- 3. Inmutabilidad de la evidencia y de los textos legales (también frente a
--    service_role por la API REST). El único borrado permitido es el de las funciones
--    de purga, que activan app.evidence_purge solo durante su ejecución.
-- ---------------------------------------------------------------------------
create function public.evidence_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.evidence_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'evidence_is_immutable';
end;
$$;

create trigger consent_evidence_immutable
  before update or delete on public.consent_evidence
  for each row execute function public.evidence_immutable();

create function public.legal_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'legal_versions_are_permanent';
  end if;
  -- Solo is_current puede cambiar: el texto publicado y su huella son definitivos.
  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.version is distinct from old.version
     or new.content_sha256 is distinct from old.content_sha256
     or new.published_at is distinct from old.published_at then
    raise exception 'legal_versions_are_immutable';
  end if;
  return new;
end;
$$;

create trigger legal_document_versions_guard
  before update or delete on public.legal_document_versions
  for each row execute function public.legal_versions_guard();

-- consents es append-only para todos los roles (el borrado en cascada de la cuenta sigue).
create function public.consents_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'consents_are_append_only';
end;
$$;

create trigger consents_no_update
  before update on public.consents
  for each row execute function public.consents_append_only();

-- ---------------------------------------------------------------------------
-- 4. students: orden del consentimiento (para archivar sin depender de consents) y
--    rectificación permitida en perfiles bloqueados.
-- ---------------------------------------------------------------------------
alter table public.students add column consent_seq bigint;
update public.students s set consent_seq = c.seq from public.consents c where c.id = s.consent_id;
alter table public.students alter column consent_seq set not null;

-- Corregir apodo y curso (rectificación) no reanuda ningún tratamiento: se permite
-- también con el perfil bloqueado. blocked_at sigue sin ser escribible por el cliente.
drop policy students_update_own on public.students;
create policy students_update_own on public.students
  for update to authenticated
  using (tutor_id = (select auth.uid()))
  with check (tutor_id = (select auth.uid()));

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
  new.adult_declaration_version_id := v_decl;
  new.adult_declared_at            := now();
  new.blocked_at                   := null;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Archivo de la declaración del adulto al borrar un perfil (por cualquier vía, incluido
--    el borrado en cascada de la cuenta). Sin datos del niño: sin apodo, curso ni id.
-- ---------------------------------------------------------------------------
create table public.declaration_evidence (
  id                  uuid primary key default gen_random_uuid(),
  consent_seq         bigint not null,   -- enlaza con consent_evidence.source_seq
  declaration_version text not null,
  declaration_sha256  text not null check (declaration_sha256 ~ '^[0-9a-f]{64}$'),
  declared_at         timestamptz not null,
  archived_at         timestamptz not null default now()
);
create index declaration_evidence_consent_seq_idx on public.declaration_evidence (consent_seq);

alter table public.declaration_evidence enable row level security;
alter table public.declaration_evidence force row level security;
revoke all on public.declaration_evidence from public, anon, authenticated;

create trigger declaration_evidence_immutable
  before update or delete on public.declaration_evidence
  for each row execute function public.evidence_immutable();

create function public.archive_declaration_on_student_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.declaration_evidence
    (consent_seq, declaration_version, declaration_sha256, declared_at)
  select old.consent_seq, v.version, v.content_sha256, old.adult_declared_at
  from public.legal_document_versions v
  where v.id = old.adult_declaration_version_id;
  return old;
end;
$$;

revoke all on function public.archive_declaration_on_student_delete() from public, anon, authenticated;

create trigger students_archive_declaration
  before delete on public.students
  for each row execute function public.archive_declaration_on_student_delete();

-- ---------------------------------------------------------------------------
-- 6. Historial de bloqueos y desbloqueos por perfil (solo altas; lectura por tutor).
--    Se borra junto con el perfil.
-- ---------------------------------------------------------------------------
create table public.student_status_events (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null,
  tutor_id    uuid not null,
  event_type  text not null check (event_type in ('blocked', 'unblocked')),
  reason      text not null check (reason in ('consent_revoked', 'manual_unblock')),
  consent_seq bigint,
  occurred_at timestamptz not null default now(),
  foreign key (student_id, tutor_id) references public.students (id, tutor_id) on delete cascade
);
create index student_status_events_student_idx on public.student_status_events (student_id, occurred_at desc);
create index student_status_events_tutor_idx on public.student_status_events (tutor_id);

alter table public.student_status_events enable row level security;
alter table public.student_status_events force row level security;
revoke all on public.student_status_events from public, anon, authenticated;
grant select on public.student_status_events to authenticated;

create policy status_events_select_own on public.student_status_events
  for select to authenticated
  using (tutor_id = (select auth.uid()));

create function public.student_status_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'status_events_are_append_only';
end;
$$;

create trigger student_status_events_no_update
  before update on public.student_status_events
  for each row execute function public.student_status_events_append_only();

create function public.audit_student_blocking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq bigint;
begin
  select c.seq into v_seq
  from public.consents c
  where c.tutor_id = new.tutor_id
  order by c.seq desc
  limit 1;

  if old.blocked_at is null and new.blocked_at is not null then
    insert into public.student_status_events (student_id, tutor_id, event_type, reason, consent_seq)
    values (new.id, new.tutor_id, 'blocked', 'consent_revoked', v_seq);
  elsif old.blocked_at is not null and new.blocked_at is null then
    insert into public.student_status_events (student_id, tutor_id, event_type, reason, consent_seq)
    values (new.id, new.tutor_id, 'unblocked', 'manual_unblock', v_seq);
  end if;
  return new;
end;
$$;

revoke all on function public.audit_student_blocking() from public, anon, authenticated;

create trigger students_audit_blocking
  after update of blocked_at on public.students
  for each row when (old.blocked_at is distinct from new.blocked_at)
  execute function public.audit_student_blocking();

-- ---------------------------------------------------------------------------
-- 7. Desbloqueo: el perfil reactivado queda ligado al consentimiento vigente.
-- ---------------------------------------------------------------------------
create or replace function public.unblock_student(p_tutor_id uuid, p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consent     uuid;
  v_consent_seq bigint;
  v_rows        integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || p_tutor_id::text, 0));

  if not public.has_active_consent(p_tutor_id) then
    return false;
  end if;

  select c.id, c.seq into v_consent, v_consent_seq
  from public.consents c
  where c.tutor_id = p_tutor_id
  order by c.seq desc
  limit 1;

  update public.students
     set blocked_at = null,
         consent_id = v_consent,
         consent_seq = v_consent_seq
   where id = p_student_id and tutor_id = p_tutor_id and blocked_at is not null;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Archivar la evidencia de un tutor (FastAPI, ANTES de borrar la cuenta).
--    FastAPI calcula con la clave que vive fuera de la base:
--      p_tutor_ref = HMAC-SHA256(clave, tutor_id)
--      p_email_ref = HMAC-SHA256(clave, lower(trim(correo)))
--    Idempotente por source_seq. Devuelve filas nuevas.
-- ---------------------------------------------------------------------------
create function public.archive_consent_evidence(
  p_tutor_id    uuid,
  p_tutor_ref   text,
  p_email_ref   text,
  p_key_version smallint
) returns integer
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
  where s.key = 'consent_evidence_retention_days';

  if v_days is null then
    raise warning 'consent_evidence_retention_days no definido: la evidencia se conserva sin plazo';
  end if;

  insert into public.consent_evidence
    (tutor_ref, tutor_email_ref, hmac_key_version, event_type,
     terms_version, terms_sha256, privacy_version, privacy_sha256,
     channel, occurred_at, source_seq)
  select p_tutor_ref, p_email_ref, p_key_version, c.event_type,
         t.version, t.content_sha256, p.version, p.content_sha256,
         c.channel, c.occurred_at, c.seq
  from public.consents c
  join public.legal_document_versions t on t.id = c.terms_version_id
  join public.legal_document_versions p on p.id = c.privacy_version_id
  where c.tutor_id = p_tutor_id
  on conflict (source_seq) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.archive_consent_evidence(uuid, text, text, smallint)
  from public, anon, authenticated;
grant execute on function public.archive_consent_evidence(uuid, text, text, smallint)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. Purgas. El plazo se lee AL PURGAR: si Legal lo define después, lo ya archivado
--    pasa a vencer según ese plazo contado desde archived_at.
-- ---------------------------------------------------------------------------
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
  where archived_at + make_interval(days => v_days) < now();
  get diagnostics v_a = row_count;

  delete from public.declaration_evidence
  where archived_at + make_interval(days => v_days) < now();
  get diagnostics v_b = row_count;

  perform set_config('app.evidence_purge', 'off', true);
  return v_a + v_b;
end;
$$;

-- Perfiles bloqueados más allá del plazo máximo. El borrado archiva la declaración
-- (trigger) y elimina el historial de estado en cascada.
create function public.purge_long_blocked_students()
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
    and blocked_at + make_interval(days => v_days) < now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.purge_long_blocked_students() from public, anon, authenticated;
grant execute on function public.purge_long_blocked_students() to service_role;

-- Para avisar al tutor antes de la purga: solo ids (sin datos personales).
create function public.blocked_students_due_soon(p_within_days integer default 7)
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
    and s.blocked_at + make_interval(days => d.days) < now() + make_interval(days => p_within_days);
$$;

revoke all on function public.blocked_students_due_soon(integer) from public, anon, authenticated;
grant execute on function public.blocked_students_due_soon(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Alertas de configuración (riesgo R8 y plazo provisional de bloqueados).
-- ---------------------------------------------------------------------------
create or replace function public.privacy_config_warnings()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select 'consent_evidence_retention_days sin definir: la evidencia de consentimiento se conserva sin plazo (pendiente legal)'::text
  from public.app_settings s
  where s.key = 'consent_evidence_retention_days' and s.value = 'null'::jsonb
  union all
  select 'consent_evidence_retention_days no existe en app_settings'::text
  where not exists (select 1 from public.app_settings s where s.key = 'consent_evidence_retention_days')
  union all
  select ('blocked_profile_retention_days = ' || (d.value #>> '{}') ||
          ' es un valor provisional: confirmar con Legal y marcar blocked_profile_retention_confirmed')::text
  from public.app_settings d
  where d.key = 'blocked_profile_retention_days'
    and not exists (select 1 from public.app_settings c
                    where c.key = 'blocked_profile_retention_confirmed'
                      and c.value = 'true'::jsonb);
$$;

-- Reversa (solo desarrollo; hay columnas NOT NULL y tablas nuevas):
--   drop trigger students_audit_blocking on public.students; drop trigger students_archive_declaration on public.students;
--   drop table public.student_status_events, public.declaration_evidence;
--   drop function public.audit_student_blocking(), public.archive_declaration_on_student_delete(),
--                 public.purge_long_blocked_students(), public.blocked_students_due_soon(integer),
--                 public.evidence_immutable(), public.legal_versions_guard(), public.consents_append_only(),
--                 public.student_status_events_append_only();
--   (restaurar consent_evidence, funciones y políticas de la migración 20261012190200 y Lote A)
