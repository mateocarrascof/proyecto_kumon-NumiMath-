-- Lote D, parte 2 (decisiones del usuario):
--   - bloqueo individual de perfiles con motivo (tutor_request, arcop_claim); la purga
--     automática solo afecta a los bloqueados por revocación del consentimiento;
--   - inactividad: 12 meses PROVISIONALES, configurable (pendiente legal);
--   - purgas programadas con pg_cron (+ alertas si no corren);
--   - alertas de configuración completas (claves ausentes y plazos provisionales).

-- ---------------------------------------------------------------------------
-- 1. Configuración: plazos de inactividad.
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
    when 'student_creations_per_day' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,4}$'
               then (value #>> '{}')::integer between 1 and 1000
               else false end
    else true
  end
);

-- PROVISIONAL (pendiente legal): 12 meses sin uso. Mientras 'confirmed' sea false,
-- privacy_config_warnings() lo señala.
insert into public.app_settings (key, value) values
  ('inactive_profile_retention_days', '365'::jsonb),
  ('inactive_profile_retention_confirmed', 'false'::jsonb);

-- ---------------------------------------------------------------------------
-- 2. students: motivo del bloqueo y última actividad.
-- ---------------------------------------------------------------------------
alter table public.students
  add column blocked_reason text
    constraint students_blocked_reason_valid
    check (blocked_reason in ('consent_revoked', 'tutor_request', 'arcop_claim')),
  add column last_active_at timestamptz not null default now();

update public.students set blocked_reason = 'consent_revoked' where blocked_at is not null;

-- Un perfil bloqueado siempre tiene motivo, y viceversa.
alter table public.students add constraint students_blocked_reason_consistent
  check ((blocked_at is null) = (blocked_reason is null));

create index students_last_active_at_idx on public.students (last_active_at);

-- ---------------------------------------------------------------------------
-- 3. Historial: nuevos motivos.
-- ---------------------------------------------------------------------------
alter table public.student_status_events drop constraint student_status_events_reason_check;
alter table public.student_status_events add constraint student_status_events_reason_check
  check (reason in ('consent_revoked', 'tutor_request', 'arcop_claim', 'manual_unblock'));

create or replace function public.audit_student_blocking()
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
    values (new.id, new.tutor_id, 'blocked', new.blocked_reason, v_seq);
  elsif old.blocked_at is not null and new.blocked_at is null then
    insert into public.student_status_events (student_id, tutor_id, event_type, reason, consent_seq)
    values (new.id, new.tutor_id, 'unblocked', 'manual_unblock', v_seq);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Revocar bloquea con motivo; el motivo previo de un perfil ya bloqueado se respeta.
-- ---------------------------------------------------------------------------
create or replace function public.on_consent_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || new.tutor_id::text, 0));
  update public.students
     set blocked_at = now(),
         blocked_reason = 'consent_revoked'
   where tutor_id = new.tutor_id and blocked_at is null;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Bloqueo individual (solo servidor; FastAPI tras verificar el control parental).
--    No exige consentimiento activo: bloquear siempre debe ser posible.
-- ---------------------------------------------------------------------------
create function public.block_student(p_tutor_id uuid, p_student_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_reason is null or p_reason not in ('tutor_request', 'arcop_claim') then
    raise exception 'invalid_block_reason' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || p_tutor_id::text, 0));

  update public.students
     set blocked_at = now(),
         blocked_reason = p_reason
   where id = p_student_id and tutor_id = p_tutor_id and blocked_at is null;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.block_student(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.block_student(uuid, uuid, text) to service_role;

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
         blocked_reason = null,
         consent_id = v_consent,
         consent_seq = v_consent_seq
   where id = p_student_id and tutor_id = p_tutor_id and blocked_at is not null;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. La purga automática solo afecta a perfiles bloqueados por revocación.
--    Los bloqueados a petición del tutor o por un reclamo ARCOP se conservan.
-- ---------------------------------------------------------------------------
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
    and blocked_reason = 'consent_revoked'
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
    and s.blocked_reason = 'consent_revoked'
    and s.blocked_at < now() + make_interval(days => p_within_days) - make_interval(days => d.days);
$$;

-- ---------------------------------------------------------------------------
-- 7. Inactividad.
--    - touch_student_activity: FastAPI la llama al usar el perfil (como máximo una
--      escritura al día por perfil);
--    - purge_inactive_students: suprime perfiles sin uso más allá del plazo (los
--      bloqueados quedan fuera: tienen su propia regla);
--    - *_due_soon: listas de ids para que FastAPI avise antes de suprimir;
--    - inactive_tutors_due_soon: cuentas sin inicio de sesión ni uso. La cuenta NO se
--      borra desde la base: FastAPI sigue el orden del ADR 0001 (HMAC y evidencia).
-- ---------------------------------------------------------------------------
create function public.touch_student_activity(p_tutor_id uuid, p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.students
     set last_active_at = now()
   where id = p_student_id
     and tutor_id = p_tutor_id
     and blocked_at is null
     and last_active_at < now() - interval '1 day';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create function public.purge_inactive_students()
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
  where s.key = 'inactive_profile_retention_days';

  if v_days is null then
    return 0;
  end if;

  delete from public.students
  where blocked_at is null
    and last_active_at < now() - make_interval(days => v_days);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create function public.inactive_students_due_soon(p_within_days integer default 30)
returns table (tutor_id uuid, student_id uuid, purge_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.tutor_id, s.id, s.last_active_at + make_interval(days => d.days)
  from public.students s
  cross join (
    select (a.value #>> '{}')::integer as days
    from public.app_settings a
    where a.key = 'inactive_profile_retention_days'
  ) d
  where s.blocked_at is null
    and s.last_active_at < now() + make_interval(days => p_within_days) - make_interval(days => d.days);
$$;

create function public.inactive_tutors_due_soon(p_within_days integer default 30)
returns table (tutor_id uuid, due_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         greatest(coalesce(u.last_sign_in_at, t.created_at),
                  coalesce((select max(s.last_active_at) from public.students s where s.tutor_id = t.id), t.created_at))
           + make_interval(days => d.days)
  from public.tutors t
  join auth.users u on u.id = t.id
  cross join (
    select (a.value #>> '{}')::integer as days
    from public.app_settings a
    where a.key = 'inactive_profile_retention_days'
  ) d
  where greatest(coalesce(u.last_sign_in_at, t.created_at),
                 coalesce((select max(s.last_active_at) from public.students s where s.tutor_id = t.id), t.created_at))
        < now() + make_interval(days => p_within_days) - make_interval(days => d.days);
$$;

revoke all on function public.touch_student_activity(uuid, uuid)       from public, anon, authenticated;
revoke all on function public.purge_inactive_students()                from public, anon, authenticated;
revoke all on function public.inactive_students_due_soon(integer)      from public, anon, authenticated;
revoke all on function public.inactive_tutors_due_soon(integer)        from public, anon, authenticated;
grant execute on function public.touch_student_activity(uuid, uuid)    to service_role;
grant execute on function public.purge_inactive_students()             to service_role;
grant execute on function public.inactive_students_due_soon(integer)   to service_role;
grant execute on function public.inactive_tutors_due_soon(integer)     to service_role;

-- ---------------------------------------------------------------------------
-- 8. Alertas de configuración (claves ausentes y plazos provisionales).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 9. Purgas programadas con pg_cron (UTC). Si la extensión no está disponible en el
--    entorno, la migración continúa y privacy_job_warnings() lo reporta.
--    Los avisos al tutor (blocked_students_due_soon, inactive_*_due_soon) los envía
--    FastAPI: la base no tiene cómo mandar correos.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('privacy-purge-evidence', '10 3 * * *',
                          'select public.purge_expired_consent_evidence()');
    perform cron.schedule('privacy-purge-blocked',  '20 3 * * *',
                          'select public.purge_long_blocked_students()');
    perform cron.schedule('privacy-purge-inactive', '30 3 * * *',
                          'select public.purge_inactive_students()');
  else
    raise notice 'pg_cron no está disponible: las purgas deben programarse por otro medio';
  end if;
end $$;

-- Alertas de trabajos: no programado, o sin una ejecución correcta en las últimas 48 h.
create function public.privacy_job_warnings()
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job  text;
  v_last timestamptz;
begin
  if to_regclass('cron.job') is null then
    return next 'pg_cron no está instalado: las purgas de privacidad no están programadas';
    return;
  end if;

  foreach v_job in array array['privacy-purge-evidence', 'privacy-purge-blocked', 'privacy-purge-inactive']
  loop
    if not exists (select 1 from cron.job j where j.jobname = v_job) then
      return next 'trabajo ' || v_job || ' no está programado';
    else
      select max(d.start_time) into v_last
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where j.jobname = v_job and d.status = 'succeeded';

      if v_last is null or v_last < now() - interval '48 hours' then
        return next 'trabajo ' || v_job || ' sin ejecución correcta en las últimas 48 horas';
      end if;
    end if;
  end loop;
  return;
end;
$$;

revoke all on function public.privacy_job_warnings() from public, anon, authenticated;
grant execute on function public.privacy_job_warnings() to service_role;

-- Reversa (solo desarrollo):
--   select cron.unschedule('privacy-purge-evidence'); select cron.unschedule('privacy-purge-blocked');
--   select cron.unschedule('privacy-purge-inactive');
--   drop function public.block_student(uuid, uuid, text), public.touch_student_activity(uuid, uuid),
--                 public.purge_inactive_students(), public.inactive_students_due_soon(integer),
--                 public.inactive_tutors_due_soon(integer), public.privacy_job_warnings();
--   alter table public.students drop column blocked_reason, drop column last_active_at;
--   (restaurar on_consent_revoked, unblock_student, purgas, audit_student_blocking, privacy_config_warnings)
