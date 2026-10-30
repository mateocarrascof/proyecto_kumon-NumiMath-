-- Lote 2, paso 1: versiones de documentos legales, consents como registro de eventos,
-- compuerta de consentimiento para crear alumnos y revocación que bloquea perfiles.
-- Diseño: docs/lote-2-propuesta-consentimiento.md (secciones 1 a 3).

-- Precondición: sin datos reales. Los cambios dejan columnas NOT NULL sin backfill.
do $$
begin
  if exists (select 1 from public.consents) or exists (select 1 from public.students) then
    raise exception 'Lote 2 paso 1 requiere consents y students vacías; hace falta backfill previo';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Versiones de documentos legales (con huella del texto publicado).
-- ---------------------------------------------------------------------------
create table public.legal_document_versions (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('terms', 'privacy', 'adult_declaration')),
  version        text not null check (char_length(version) between 1 and 40),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  published_at   timestamptz not null default now(),
  is_current     boolean not null default false,
  unique (kind, version)
);

-- Una sola versión vigente por tipo de documento.
create unique index legal_document_versions_one_current_idx
  on public.legal_document_versions (kind) where is_current;

alter table public.legal_document_versions enable row level security;
alter table public.legal_document_versions force row level security;

revoke all on public.legal_document_versions from public, anon, authenticated;
grant select on public.legal_document_versions to authenticated;

-- Catálogo de textos legales: lectura abierta a cualquier autenticado a propósito
-- (no son datos personales). Escritura: solo servidor (service_role) o migraciones.
create policy legal_versions_read on public.legal_document_versions
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. consents pasa a ser un registro de eventos append-only (grant / revoke).
-- ---------------------------------------------------------------------------
alter table public.consents drop constraint consents_tutor_id_terms_version_privacy_version_key;
alter table public.consents rename column accepted_at to occurred_at;

alter table public.consents
  add column seq                bigint generated always as identity,
  add column event_type         text not null default 'grant'
             check (event_type in ('grant', 'revoke')),
  add column terms_version_id   uuid references public.legal_document_versions (id),
  add column privacy_version_id uuid references public.legal_document_versions (id),
  add column channel            text not null default 'web'
             check (channel in ('ios', 'android', 'web'));

alter table public.consents
  alter column terms_version_id   set not null,
  alter column privacy_version_id set not null,
  drop column terms_version,
  drop column privacy_version;

-- Orden estricto por seq (no por fecha: dos eventos pueden compartir instante).
create index consents_tutor_seq_idx on public.consents (tutor_id, seq desc);

-- El cliente solo escribe estas columnas; occurred_at y seq los fija el servidor.
revoke insert on public.consents from authenticated;
grant insert (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
  on public.consents to authenticated;

-- Un 'grant' solo es válido sobre las versiones vigentes; un 'revoke' siempre se acepta.
drop policy consents_insert_own on public.consents;
create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (
    tutor_id = (select auth.uid())
    and (
      event_type = 'revoke'
      or (
        exists (select 1 from public.legal_document_versions v
                where v.id = terms_version_id and v.kind = 'terms' and v.is_current)
        and exists (select 1 from public.legal_document_versions v
                    where v.id = privacy_version_id and v.kind = 'privacy' and v.is_current)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. ¿El tutor tiene consentimiento vigente?
--    Último evento = grant, sobre las versiones vigentes de términos y de política.
--    Si cambia la versión vigente, deja de estar activo hasta que vuelva a aceptar.
--    SECURITY INVOKER: bajo RLS un tutor solo "ve" sus propios eventos.
-- ---------------------------------------------------------------------------
create function public.has_active_consent(p_tutor_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select last.event_type = 'grant' and t.is_current and p.is_current
    from (
      select c.event_type, c.terms_version_id, c.privacy_version_id
      from public.consents c
      where c.tutor_id = p_tutor_id
      order by c.seq desc
      limit 1
    ) last
    join public.legal_document_versions t on t.id = last.terms_version_id
    join public.legal_document_versions p on p.id = last.privacy_version_id
  ), false);
$$;

revoke all on function public.has_active_consent(uuid) from public, anon;
grant execute on function public.has_active_consent(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. students: alumno ligado al consentimiento con que se creó + declaración del adulto.
--    blocked_at: perfil bloqueado (se lee y se borra, pero no se edita).
-- ---------------------------------------------------------------------------
alter table public.students
  add column consent_id                   uuid not null references public.consents (id),
  add column adult_declaration_accepted   boolean not null default false
             constraint students_adult_declaration_required check (adult_declaration_accepted),
  add column adult_declaration_version_id uuid not null references public.legal_document_versions (id),
  add column adult_declared_at            timestamptz not null,
  add column blocked_at                   timestamptz;

-- consent_id, adult_declaration_version_id, adult_declared_at y blocked_at los fija
-- el servidor (trigger); el cliente solo aporta la aceptación de la declaración.
grant insert (adult_declaration_accepted) on public.students to authenticated;

create function public.students_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_consent uuid;
  v_decl    uuid;
begin
  -- Serializa altas/revocaciones del mismo tutor.
  perform pg_advisory_xact_lock(hashtextextended(new.tutor_id::text, 0));

  if not public.has_active_consent(new.tutor_id) then
    raise exception 'consent_required';
  end if;

  select c.id into v_consent
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

  new.consent_id                   := v_consent;
  new.adult_declaration_version_id := v_decl;
  new.adult_declared_at            := now();
  new.blocked_at                   := null;
  return new;
end;
$$;

-- También se ejecuta para service_role (que se salta RLS, pero no los triggers).
create trigger students_before_insert
  before insert on public.students
  for each row execute function public.students_before_insert();

drop policy students_insert_own on public.students;
create policy students_insert_own on public.students
  for insert to authenticated
  with check (
    tutor_id = (select auth.uid())
    and public.has_active_consent((select auth.uid()))
  );

-- Un perfil bloqueado se puede leer y borrar, pero no editar.
drop policy students_update_own on public.students;
create policy students_update_own on public.students
  for update to authenticated
  using (tutor_id = (select auth.uid()) and blocked_at is null)
  with check (tutor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Revocar bloquea todos los perfiles del tutor (misma transacción).
--    Volver a consentir NO desbloquea: el desbloqueo es manual (ver unblock_student).
-- ---------------------------------------------------------------------------
create function public.on_consent_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tutor_id::text, 0));
  update public.students
     set blocked_at = now()
   where tutor_id = new.tutor_id and blocked_at is null;
  return new;
end;
$$;

revoke all on function public.on_consent_revoked() from public, anon, authenticated;

create trigger consents_after_revoke
  after insert on public.consents
  for each row when (new.event_type = 'revoke')
  execute function public.on_consent_revoked();

-- ---------------------------------------------------------------------------
-- 6. Desbloqueo manual: solo servidor. FastAPI lo invoca desde la zona del tutor,
--    tras verificar el control parental (PIN o pregunta de adulto). Requiere
--    consentimiento activo y que el alumno pertenezca al tutor.
-- ---------------------------------------------------------------------------
create function public.unblock_student(p_tutor_id uuid, p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tutor_id::text, 0));

  if not public.has_active_consent(p_tutor_id) then
    return false;
  end if;

  update public.students
     set blocked_at = null
   where id = p_student_id and tutor_id = p_tutor_id and blocked_at is not null;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.unblock_student(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unblock_student(uuid, uuid) to service_role;

-- Reversa (solo desarrollo; Supabase migra hacia adelante):
--   drop trigger consents_after_revoke on public.consents;
--   drop trigger students_before_insert on public.students;
--   drop function public.unblock_student(uuid, uuid), public.on_consent_revoked(),
--                 public.students_before_insert(), public.has_active_consent(uuid);
--   (revertir columnas de consents/students y drop table public.legal_document_versions)
