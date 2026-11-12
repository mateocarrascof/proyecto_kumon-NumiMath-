-- T20, revocar el consentimiento: constancia con fecha y lo que pasa con los datos.
--
-- La revocación en sí ya existe (`revoke_consent`, migración 20261111120000): registra un evento
-- `revoke` con fecha-hora del servidor y los triggers bloquean los perfiles del tutor
-- (`authorize_student_use` los rechaza: sin práctica, sin informes y sin IA). Esta función solo LEE,
-- para que el servidor pueda comprobar el resultado y mostrarle al tutor la constancia.
--
-- Sin datos nuevos: todo sale de tablas existentes. Solo la llama `service_role`; FastAPI ya
-- verificó la identidad del tutor y su PIN.
--   last_event       último evento de consentimiento ('grant' | 'revoke'; null si nunca aceptó)
--   occurred_at      fecha-hora UTC de ese evento (la constancia)
--   profiles_total   perfiles del tutor
--   profiles_active  perfiles que aún pueden usarse (0 tras revocar)
--   purge_after_days plazo, en días, tras el cual se borran los perfiles bloqueados por revocación
--                    (`blocked_profile_retention_days`, PROVISIONAL: pendientes-legales 10)
--   purge_at         cuándo se borraría el primero (null si no hay perfiles bloqueados por revocación)
create function public.consent_revocation_summary(p_tutor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'last_event',
      (select c.event_type from public.consents c
        where c.tutor_id = p_tutor_id order by c.seq desc limit 1),
    'occurred_at',
      (select c.occurred_at from public.consents c
        where c.tutor_id = p_tutor_id order by c.seq desc limit 1),
    'profiles_total',
      (select count(*) from public.students s where s.tutor_id = p_tutor_id),
    'profiles_active',
      (select count(*) from public.students s
        where s.tutor_id = p_tutor_id and s.blocked_at is null),
    'purge_after_days',
      (select (a.value #>> '{}')::integer from public.app_settings a
        where a.key = 'blocked_profile_retention_days'),
    'purge_at',
      (select min(s.blocked_at) from public.students s
        where s.tutor_id = p_tutor_id and s.blocked_reason = 'consent_revoked')
      + make_interval(days => (select (a.value #>> '{}')::integer from public.app_settings a
                                where a.key = 'blocked_profile_retention_days'))
  );
$$;

revoke all on function public.consent_revocation_summary(uuid) from public, anon, authenticated;
grant execute on function public.consent_revocation_summary(uuid) to service_role;
