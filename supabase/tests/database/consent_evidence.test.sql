begin;
select plan(35);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Evidencia mínima seudonimizada del consentimiento (Lote 2 paso 3 + Lote B).
-- UUIDs: tutor A = aaaaaaaa-...-0001, tutor B = bbbbbbbb-...-0002
-- tutor_ref / email_ref de prueba: 64 caracteres hexadecimales (en producción los calcula
-- FastAPI con HMAC-SHA256 y una clave que vive fuera de la base).

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test.invalid'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

-- A: grant + revoke (2 eventos). B: grant (1 evento).
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'grant',  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'ios'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'ios'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'grant',  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');

-- ===== Tablas: inaccesibles para cliente y anónimo =====
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$select * from public.consent_evidence$$, '42501', 'permission denied for table consent_evidence', 'authenticated no lee consent_evidence');
select throws_ok($$select * from public.app_settings$$,     '42501', 'permission denied for table app_settings',     'authenticated no lee app_settings');
select throws_ok(
  $$insert into public.consent_evidence (tutor_ref, tutor_email_ref, hmac_key_version, event_type, terms_version, terms_sha256, privacy_version, privacy_sha256, channel, occurred_at, source_seq) values (repeat('a', 64), repeat('b', 64), 1, 'grant', 'x', repeat('c', 64), 'y', repeat('d', 64), 'web', now(), 1)$$,
  '42501', 'permission denied for table consent_evidence', 'authenticated no escribe en consent_evidence');

-- ===== Funciones: solo servidor =====
select throws_ok(
  $$select public.archive_consent_evidence('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64), repeat('e', 64), 1::smallint)$$,
  '42501', 'permission denied for function archive_consent_evidence', 'authenticated no ejecuta archive_consent_evidence');
select throws_ok($$select public.purge_expired_consent_evidence()$$,
  '42501', 'permission denied for function purge_expired_consent_evidence', 'authenticated no ejecuta purge_expired_consent_evidence');
select throws_ok($$select * from public.privacy_config_warnings()$$,
  '42501', 'permission denied for function privacy_config_warnings', 'authenticated no ejecuta privacy_config_warnings');
reset role;

set local role anon;
select throws_ok($$select * from public.consent_evidence$$, '42501', 'permission denied for table consent_evidence', 'anon no lee consent_evidence');
select throws_ok(
  $$select public.archive_consent_evidence('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64), repeat('e', 64), 1::smallint)$$,
  '42501', 'permission denied for function archive_consent_evidence', 'anon no ejecuta archive_consent_evidence');
reset role;

-- ===== Archivado (como servidor) =====
set local role service_role;
select is(public.archive_consent_evidence('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64), repeat('e', 64), 1::smallint),
  2, 'se archivan los 2 eventos de A');
select is((select count(*) from public.consent_evidence where tutor_ref = repeat('a', 64)),
  2::bigint, 'quedan 2 filas de evidencia para el tutor_ref de A');
select is((select array_agg(distinct terms_version || '/' || privacy_version || '/' || channel) from public.consent_evidence where tutor_ref = repeat('a', 64)),
  array['tos-1/pp-1/ios'], 'la evidencia guarda versión de términos, de política y canal');
select ok((select bool_and(terms_sha256 = repeat('a', 64) and privacy_sha256 = repeat('b', 64))
             from public.consent_evidence where tutor_ref = repeat('a', 64)),
  'la evidencia guarda la huella del texto aceptado (términos y política)');
select is((select count(*) from public.consent_evidence where tutor_email_ref = repeat('e', 64)),
  2::bigint, 'la evidencia se puede localizar por el HMAC del correo');

-- Idempotencia (no depende de la clave HMAC)
select is(public.archive_consent_evidence('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64), repeat('e', 64), 1::smallint),
  0, 'archivar dos veces no inserta de nuevo');
select is(public.archive_consent_evidence('aaaaaaaa-0000-0000-0000-000000000001', repeat('f', 64), repeat('f', 64), 2::smallint),
  0, 'tras rotar la clave HMAC, reintentar tampoco duplica');
select is((select count(*) from public.consent_evidence), 2::bigint, 'sin duplicados tras reintentar');
reset role;

-- ===== Mínimo de datos: sin FK al tutor y sin columnas de datos personales =====
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'consent_evidence'),
  array['archived_at', 'channel', 'event_type', 'hmac_key_version', 'id', 'occurred_at',
        'privacy_sha256', 'privacy_version', 'source_seq', 'terms_sha256', 'terms_version',
        'tutor_email_ref', 'tutor_ref'],
  'consent_evidence solo tiene las columnas mínimas acordadas');
select is_empty(
  $$select 1 from pg_constraint where conrelid = 'public.consent_evidence'::regclass and contype = 'f'$$,
  'consent_evidence no tiene claves foráneas (sin cascada desde el tutor)');

-- ===== Sobrevive al borrado de la cuenta =====
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is_empty($$select 1 from public.consents where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'al borrar la cuenta desaparecen sus consentimientos vivos');
select is((select count(*) from public.consent_evidence where tutor_ref = repeat('a', 64)),
  2::bigint, 'la evidencia seudonimizada sobrevive al borrado de la cuenta');

-- ===== Inmutable, incluso para el servidor =====
select throws_ok(
  $$update public.consent_evidence set channel = 'web'$$,
  'P0001', 'evidence_is_immutable', 'la evidencia no se puede modificar');
select throws_ok(
  $$delete from public.consent_evidence$$,
  'P0001', 'evidence_is_immutable', 'la evidencia no se puede borrar fuera de la purga');
set local role service_role;
select throws_ok(
  $$update public.consent_evidence set channel = 'web'$$,
  'P0001', 'evidence_is_immutable', 'ni service_role puede modificar la evidencia');
reset role;

-- ===== El plazo se calcula AL PURGAR =====
-- Una fila archivada hace 40 días, cuando el plazo aún no existía.
insert into public.consent_evidence
  (tutor_ref, tutor_email_ref, hmac_key_version, event_type, terms_version, terms_sha256,
   privacy_version, privacy_sha256, channel, occurred_at, source_seq, archived_at)
values (repeat('9', 64), repeat('8', 64), 1, 'grant', 'tos-0', repeat('1', 64),
        'pp-0', repeat('2', 64), 'web', now() - interval '41 days', 900001, now() - interval '40 days');

set local role service_role;
select is(public.purge_expired_consent_evidence(), 0,
  'con el plazo sin definir no se purga nada');
reset role;
select is((select count(*) from public.consent_evidence), 3::bigint,
  'las 3 filas siguen (la antigua también) mientras el plazo no exista');

update public.app_settings set value = '30'::jsonb where key = 'consent_evidence_retention_days';
set local role service_role;
select is(public.purge_expired_consent_evidence(), 1,
  'al definir el plazo, la evidencia ya archivada pasa a vencer y se purga solo la vencida');
reset role;
select is((select count(*) from public.consent_evidence), 2::bigint,
  'la evidencia reciente se conserva');

-- ===== Alertas =====
update public.app_settings set value = 'null'::jsonb where key = 'consent_evidence_retention_days';
set local role service_role;
select is((select count(*) from public.privacy_config_warnings()), 3::bigint,
  'plazo de evidencia sin definir + plazos de bloqueados e inactividad provisionales = 3 alertas');
reset role;
update public.app_settings set value = '365'::jsonb where key = 'consent_evidence_retention_days';
set local role service_role;
select is((select count(*) from public.privacy_config_warnings()), 2::bigint,
  'con el plazo de evidencia definido quedan las alertas de los plazos provisionales');
reset role;
update public.app_settings set value = 'true'::jsonb where key = 'blocked_profile_retention_confirmed';
set local role service_role;
select is((select count(*) from public.privacy_config_warnings()), 1::bigint,
  'confirmado el plazo de bloqueados, queda la alerta de inactividad');
reset role;
update public.app_settings set value = 'true'::jsonb where key = 'inactive_profile_retention_confirmed';
set local role service_role;
select is((select count(*) from public.privacy_config_warnings()), 0::bigint,
  'con todos los plazos definidos y confirmados no hay alertas');
reset role;

-- ===== Validaciones =====
select throws_ok(
  $$update public.app_settings set value = '-5'::jsonb where key = 'consent_evidence_retention_days'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_values_valid"',
  'un plazo negativo es rechazado');
select throws_ok(
  $$update public.app_settings set value = 'null'::jsonb where key = 'blocked_profile_retention_days'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_values_valid"',
  'el plazo de perfiles bloqueados no puede quedar sin definir');
select throws_ok(
  $$select public.archive_consent_evidence('bbbbbbbb-0000-0000-0000-000000000002', 'no-es-hex', repeat('e', 64), 1::smallint)$$,
  '23514', 'new row for relation "consent_evidence" violates check constraint "consent_evidence_tutor_ref_check"',
  'tutor_ref que no es un HMAC en hexadecimal es rechazado');
select throws_ok(
  $$select public.archive_consent_evidence('bbbbbbbb-0000-0000-0000-000000000002', repeat('b', 64), 'tampoco', 1::smallint)$$,
  '23514', 'new row for relation "consent_evidence" violates check constraint "consent_evidence_email_ref_check"',
  'email_ref que no es un HMAC en hexadecimal es rechazado');

select * from finish();
rollback;
