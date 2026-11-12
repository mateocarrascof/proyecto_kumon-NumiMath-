begin;
select plan(13);
-- T21, ajuste: la evidencia mínima no lleva correo y se conserva 5 años (provisional),
-- con una tarea de pg_cron que la borra pasado el plazo.

-- ===== Sin correo =====
select hasnt_column('public', 'consent_evidence', 'tutor_email_ref',
  'la evidencia ya no guarda ninguna huella del correo');
select has_function('public', 'archive_consent_evidence', array['uuid', 'text', 'smallint'],
  'archivar recibe solo el id, el seudónimo y la versión de clave');
select hasnt_function('public', 'archive_consent_evidence', array['uuid', 'text', 'text', 'smallint'],
  'ya no existe la versión que recibía la huella del correo');

-- ===== Plazo por defecto: 5 años, provisional =====
select is((select (value #>> '{}')::integer from public.app_settings where key = 'consent_evidence_retention_days'),
  1826, 'el plazo por defecto es de 5 años (1826 días)');
select is((select value from public.app_settings where key = 'consent_evidence_retention_confirmed'),
  'false'::jsonb, 'el plazo está marcado como no confirmado por Legal');
set local role service_role;
select ok(exists (select 1 from public.privacy_config_warnings() w
                   where w like 'consent_evidence_retention_days = 1826%provisional%'),
  'mientras no se confirme, privacy_config_warnings() lo señala como provisional');
reset role;

-- ===== La tarea de pg_cron =====
select is((select count(*) from cron.job where jobname = 'privacy-purge-evidence'), 1::bigint,
  'la purga de evidencia está programada en pg_cron');
select is((select command from cron.job where jobname = 'privacy-purge-evidence'),
  'select public.purge_expired_consent_evidence()',
  'la tarea ejecuta la purga de evidencia vencida');

-- ===== La purga con el plazo por defecto (lo que ejecuta la tarea) =====
insert into public.consent_evidence
  (tutor_ref, hmac_key_version, event_type, terms_version, terms_sha256,
   privacy_version, privacy_sha256, channel, occurred_at, source_seq, archived_at)
values
  (repeat('a', 64), 1, 'grant', 'tos-0', repeat('1', 64), 'pp-0', repeat('2', 64), 'web',
   now() - interval '2000 days', 930001, now() - interval '1827 days'),   -- vencida
  (repeat('b', 64), 1, 'grant', 'tos-0', repeat('1', 64), 'pp-0', repeat('2', 64), 'web',
   now() - interval '1900 days', 930002, now() - interval '1825 days');   -- aún dentro de los 5 años
insert into public.declaration_evidence (consent_seq, declaration_version, declaration_sha256, declared_at, archived_at)
values (930001, 'ad-0', repeat('3', 64), now() - interval '2000 days', now() - interval '1827 days'),
       (930002, 'ad-0', repeat('3', 64), now() - interval '1900 days', now() - interval '1825 days');

select is((select command from cron.job where jobname = 'privacy-purge-evidence'),
  'select public.purge_expired_consent_evidence()', 'se ejecuta exactamente el comando programado');
set local role service_role;
select is(public.purge_expired_consent_evidence(), 2,
  'la tarea borra la evidencia y la declaración con más de 5 años');
reset role;
select is((select array_agg(tutor_ref order by tutor_ref) from public.consent_evidence
            where source_seq in (930001, 930002)),
  array[repeat('b', 64)], 'la evidencia dentro del plazo se conserva');

-- ===== El plazo es configurable =====
update public.app_settings set value = '365'::jsonb where key = 'consent_evidence_retention_days';
set local role service_role;
select is(public.purge_expired_consent_evidence(), 2,
  'con un plazo de 365 días se purga también lo archivado hace 1825 días (evidencia y declaración)');
reset role;
select is((select count(*) from public.consent_evidence where source_seq in (930001, 930002)), 0::bigint,
  'no queda evidencia vencida');

select * from finish();
rollback;
