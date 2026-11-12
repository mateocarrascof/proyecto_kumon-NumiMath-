-- Apoyo de la base para dos casos de la zona del tutor (solo los llama el servidor):
--   - T20 revocar el consentimiento y
--   - T21 eliminar la cuenta (ADR 0001, decisión 3).
--
-- Nada de esto lo puede llamar el cliente: solo `service_role`, y FastAPI ya verificó antes la
-- identidad del tutor y su confirmación (PIN o contraseña reciente).

-- ---------------------------------------------------------------------------
-- revoke_consent: registra una REVOCACIÓN con las mismas versiones del último consentimiento.
-- Los triggers existentes bloquean todos los perfiles del tutor y dejan constancia con fecha-hora
-- (`consents.occurred_at`, fijada por el servidor). Las revocaciones nunca se limitan.
--   'ok'              → se registró la revocación
--   'already_revoked' → el último evento ya era una revocación (nada que hacer)
--   'no_consent'      → el tutor nunca aceptó (nada que revocar)
-- ---------------------------------------------------------------------------
create function public.revoke_consent(p_tutor_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last record;
begin
  select c.event_type, c.terms_version_id, c.privacy_version_id
    into v_last
  from public.consents c
  where c.tutor_id = p_tutor_id
  order by c.seq desc
  limit 1;

  if not found then
    return 'no_consent';
  end if;
  if v_last.event_type = 'revoke' then
    return 'already_revoked';
  end if;

  insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
  values (p_tutor_id, 'revoke', v_last.terms_version_id, v_last.privacy_version_id, 'web');
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- consent_evidence_is_complete: ¿cada consentimiento vivo del tutor ya tiene su evidencia archivada?
-- Se comprueba por `source_seq` (la clave única de la evidencia), NO por la huella del tutor: así
-- sigue siendo correcto aunque la clave HMAC haya cambiado entre dos intentos de borrado.
-- Si falta alguno, FastAPI NO borra la cuenta (ADR 0001, paso 3).
-- ---------------------------------------------------------------------------
create function public.consent_evidence_is_complete(p_tutor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.consents c
    where c.tutor_id = p_tutor_id
      and not exists (select 1 from public.consent_evidence e where e.source_seq = c.seq)
  );
$$;

-- tutor_exists: paso 6 del ADR (verificar que ya no queda el tutor) y reintentos idempotentes.
create function public.tutor_exists(p_tutor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.tutors t where t.id = p_tutor_id);
$$;

-- ---------------------------------------------------------------------------
-- purge_auth_audit: Auth (GoTrue) guarda en `auth.audit_log_entries` el correo y la IP de cada
-- inicio de sesión, recuperación, cambio de contraseña y también del propio borrado. Tras eliminar
-- la cuenta se borran esas filas del tutor: si no, el correo seguiría en la base. FastAPI la llama
-- DESPUÉS de borrar el usuario (el borrado también deja una fila). Devuelve cuántas filas borró.
-- ---------------------------------------------------------------------------
create function public.purge_auth_audit(p_tutor_id uuid, p_email text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  -- Por id (inicio de sesión, recuperación, el propio borrado) y por correo (intentos fallidos o
  -- eventos que solo traen el correo).
  delete from auth.audit_log_entries a
  where a.payload ->> 'actor_id' = p_tutor_id::text
     or a.payload #>> '{traits,user_id}' = p_tutor_id::text
     or (p_email is not null
         and (lower(a.payload ->> 'actor_username') = lower(p_email)
              or lower(a.payload #>> '{traits,user_email}') = lower(p_email)));
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.revoke_consent(uuid) from public, anon, authenticated;
revoke all on function public.consent_evidence_is_complete(uuid) from public, anon, authenticated;
revoke all on function public.tutor_exists(uuid) from public, anon, authenticated;
revoke all on function public.purge_auth_audit(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_consent(uuid) to service_role;
grant execute on function public.consent_evidence_is_complete(uuid) to service_role;
grant execute on function public.tutor_exists(uuid) to service_role;
grant execute on function public.purge_auth_audit(uuid, text) to service_role;
