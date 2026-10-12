-- Lote 2, paso 3: evidencia mínima seudonimizada del consentimiento, sin FK al tutor.
-- Diseño: docs/lote-2-propuesta-consentimiento.md (sección 4).
--
-- Qué se conserva al borrar la cuenta: tipo de evento, versión de términos y de política,
-- canal, fecha-hora y un identificador del tutor calculado con HMAC-SHA256 con una clave
-- que vive FUERA de la base (la calcula FastAPI). Nada del niño ni del correo del tutor.
-- Seudonimizado NO es anonimizado: sigue siendo dato personal mientras exista la clave.

-- ---------------------------------------------------------------------------
-- Configuración de servidor (solo service_role).
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key   text primary key,
  value jsonb not null,
  constraint app_settings_retention_days_valid check (
    case when key = 'consent_evidence_retention_days' then
      value = 'null'::jsonb
      or (jsonb_typeof(value) = 'number'
          and case when (value #>> '{}') ~ '^[0-9]{1,5}$'
                   then (value #>> '{}')::integer between 1 and 36500
                   else false end)
    else true end
  )
);

-- PENDIENTE LEGAL: 'null' = plazo sin definir. Mientras sea null la evidencia NO se purga
-- (conservación indefinida). privacy_config_warnings() lo señala como alerta (riesgo R8).
insert into public.app_settings (key, value)
values ('consent_evidence_retention_days', 'null'::jsonb);

-- ---------------------------------------------------------------------------
-- Evidencia: sin FK a tutors (sobrevive al borrado de la cuenta).
-- ---------------------------------------------------------------------------
create table public.consent_evidence (
  id               uuid primary key default gen_random_uuid(),
  tutor_ref        text not null check (tutor_ref ~ '^[0-9a-f]{64}$'),  -- HMAC-SHA256 en hex
  hmac_key_version smallint not null check (hmac_key_version > 0),
  event_type       text not null check (event_type in ('grant', 'revoke')),
  terms_version    text not null,
  privacy_version  text not null,
  channel          text not null check (channel in ('ios', 'android', 'web')),
  occurred_at      timestamptz not null,
  source_seq       bigint not null,        -- orden original; hace idempotente el archivo
  archived_at      timestamptz not null default now(),
  retain_until     timestamptz,            -- null = plazo aún no definido por Legal
  unique (tutor_ref, source_seq)
);

create index consent_evidence_retain_until_idx
  on public.consent_evidence (retain_until) where retain_until is not null;

-- Sin políticas y sin grants para anon/authenticated: solo service_role (backend).
alter table public.app_settings     enable row level security;
alter table public.app_settings     force row level security;
alter table public.consent_evidence enable row level security;
alter table public.consent_evidence force row level security;
revoke all on public.app_settings, public.consent_evidence from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Archivar la evidencia de un tutor (lo llama FastAPI ANTES de borrar la cuenta).
-- FastAPI calcula tutor_ref = HMAC-SHA256(clave_fuera_de_la_BD, tutor_id).
-- Idempotente: repetir la llamada no duplica filas. Devuelve filas nuevas.
-- ---------------------------------------------------------------------------
create function public.archive_consent_evidence(
  p_tutor_id    uuid,
  p_tutor_ref   text,
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
    -- Sin datos personales en el mensaje (solo la configuración).
    raise warning 'consent_evidence_retention_days no definido: la evidencia se conserva sin plazo';
  end if;

  insert into public.consent_evidence
    (tutor_ref, hmac_key_version, event_type, terms_version, privacy_version,
     channel, occurred_at, source_seq, retain_until)
  select p_tutor_ref, p_key_version, c.event_type, t.version, p.version,
         c.channel, c.occurred_at, c.seq,
         case when v_days is null then null else now() + make_interval(days => v_days) end
  from public.consents c
  join public.legal_document_versions t on t.id = c.terms_version_id
  join public.legal_document_versions p on p.id = c.privacy_version_id
  where c.tutor_id = p_tutor_id
  on conflict (tutor_ref, source_seq) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.archive_consent_evidence(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.archive_consent_evidence(uuid, text, smallint) to service_role;

-- ---------------------------------------------------------------------------
-- Purga de evidencia vencida (la ejecuta un job: pg_cron o FastAPI). Devuelve filas borradas.
-- Con plazo null no se borra nada (retain_until es null).
-- ---------------------------------------------------------------------------
create function public.purge_expired_consent_evidence()
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (
    delete from public.consent_evidence
    where retain_until is not null and retain_until < now()
    returning 1
  )
  select count(*)::integer from d;
$$;

revoke all on function public.purge_expired_consent_evidence() from public, anon, authenticated;
grant execute on function public.purge_expired_consent_evidence() to service_role;

-- ---------------------------------------------------------------------------
-- Alertas de configuración de privacidad (riesgo R8). FastAPI la consulta al arrancar
-- y en su chequeo de salud; si devuelve filas, debe registrarlas como advertencia
-- (sin datos personales) y alertar antes de cualquier lanzamiento.
-- ---------------------------------------------------------------------------
create function public.privacy_config_warnings()
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
  where not exists (select 1 from public.app_settings s where s.key = 'consent_evidence_retention_days');
$$;

revoke all on function public.privacy_config_warnings() from public, anon, authenticated;
grant execute on function public.privacy_config_warnings() to service_role;

-- Reversa (solo desarrollo):
--   drop function public.privacy_config_warnings(), public.purge_expired_consent_evidence(),
--                 public.archive_consent_evidence(uuid, text, smallint);
--   drop table public.consent_evidence, public.app_settings;
