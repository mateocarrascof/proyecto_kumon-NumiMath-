-- T21, ajuste: la evidencia mínima del consentimiento (1) deja de guardar cualquier huella del
-- correo y (2) tiene un plazo de conservación por defecto de 5 años, configurable, que borra una
-- tarea de pg_cron ('privacy-purge-evidence', a diario).
--
-- Queda solo: seudónimo del tutor (HMAC del id), versión y huella de los textos aceptados, canal,
-- tipo de evento y fechas. Sin correo, sin nombre y sin datos del niño.
--
-- PROVISIONAL, sujeto a validación legal. La Ley 21.719 no fija un plazo; base: art. 7
-- (excepciones por obligación legal y defensa de reclamaciones); 5 años por la prescripción
-- general de las acciones civiles (inferencia a validar). Ver docs/privacy/pendientes-legales.md.

-- ---------------------------------------------------------------------------
-- 1. Sin huella del correo. La evidencia se localiza solo por el seudónimo del tutor.
-- ---------------------------------------------------------------------------
drop function public.archive_consent_evidence(uuid, text, text, smallint);
drop index public.consent_evidence_email_ref_idx;
alter table public.consent_evidence drop column tutor_email_ref;

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
  v_rows integer;
begin
  insert into public.consent_evidence
    (tutor_ref, hmac_key_version, event_type,
     terms_version, terms_sha256, privacy_version, privacy_sha256,
     channel, occurred_at, source_seq)
  select p_tutor_ref, p_key_version, c.event_type,
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

revoke all on function public.archive_consent_evidence(uuid, text, smallint)
  from public, anon, authenticated;
grant execute on function public.archive_consent_evidence(uuid, text, smallint) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Plazo por defecto: 5 años (1826 días: cubre un día bisiesto: nunca menos de 5 años).
--    Es la "constante configurable": cambia con
--      update public.app_settings set value = '<días>' where key = 'consent_evidence_retention_days';
--    El plazo se lee AL PURGAR y cuenta desde archived_at (la fecha en que se borró la cuenta).
--    'consent_evidence_retention_confirmed' sigue en false hasta que Legal lo valide: mientras
--    tanto privacy_config_warnings() lo señala como valor provisional.
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
    when 'inactive_profile_retention_days' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,5}$'
               then (value #>> '{}')::integer between 1 and 36500
               else false end
    when 'blocked_profile_retention_confirmed' then jsonb_typeof(value) = 'boolean'
    when 'inactive_profile_retention_confirmed' then jsonb_typeof(value) = 'boolean'
    when 'consent_evidence_retention_confirmed' then jsonb_typeof(value) = 'boolean'
    when 'student_creations_per_day' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,4}$'
               then (value #>> '{}')::integer between 1 and 1000
               else false end
    else true
  end
);

update public.app_settings set value = '1826'::jsonb
  where key = 'consent_evidence_retention_days' and value = 'null'::jsonb;
insert into public.app_settings (key, value)
  values ('consent_evidence_retention_confirmed', 'false'::jsonb);

create or replace function public.privacy_config_warnings()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  -- Evidencia de consentimiento
  select 'consent_evidence_retention_days sin definir: la evidencia de consentimiento se conserva sin plazo (pendiente legal)'::text
  from public.app_settings s
  where s.key = 'consent_evidence_retention_days' and s.value = 'null'::jsonb
  union all
  select 'consent_evidence_retention_days no existe en app_settings'::text
  where not exists (select 1 from public.app_settings s where s.key = 'consent_evidence_retention_days')
  union all
  select ('consent_evidence_retention_days = ' || (d.value #>> '{}') ||
          ' es un valor provisional: confirmar con Legal y marcar consent_evidence_retention_confirmed')::text
  from public.app_settings d
  where d.key = 'consent_evidence_retention_days' and d.value <> 'null'::jsonb
    and not exists (select 1 from public.app_settings c
                    where c.key = 'consent_evidence_retention_confirmed' and c.value = 'true'::jsonb)
  -- Perfiles bloqueados
  union all
  select 'blocked_profile_retention_days no existe en app_settings: los perfiles bloqueados no se purgan'::text
  where not exists (select 1 from public.app_settings s where s.key = 'blocked_profile_retention_days')
  union all
  select ('blocked_profile_retention_days = ' || (d.value #>> '{}') ||
          ' es un valor provisional: confirmar con Legal y marcar blocked_profile_retention_confirmed')::text
  from public.app_settings d
  where d.key = 'blocked_profile_retention_days'
    and not exists (select 1 from public.app_settings c
                    where c.key = 'blocked_profile_retention_confirmed' and c.value = 'true'::jsonb)
  -- Inactividad
  union all
  select 'inactive_profile_retention_days no existe en app_settings: los perfiles inactivos no se purgan'::text
  where not exists (select 1 from public.app_settings s where s.key = 'inactive_profile_retention_days')
  union all
  select ('inactive_profile_retention_days = ' || (d.value #>> '{}') ||
          ' es un valor provisional: confirmar con Legal y marcar inactive_profile_retention_confirmed')::text
  from public.app_settings d
  where d.key = 'inactive_profile_retention_days'
    and not exists (select 1 from public.app_settings c
                    where c.key = 'inactive_profile_retention_confirmed' and c.value = 'true'::jsonb);
$$;
