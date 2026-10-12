begin;
select plan(26);

-- Lote 2, paso 3: evidencia mínima seudonimizada del consentimiento.
-- UUIDs: tutor A = aaaaaaaa-...-0001, tutor B = bbbbbbbb-...-0002
-- tutor_ref de prueba: 64 caracteres hexadecimales (en producción lo calcula FastAPI con HMAC).

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
  $$insert into public.consent_evidence (tutor_ref, hmac_key_version, event_type, terms_version, privacy_version, channel, occurred_at, source_seq) values (repeat('a', 64), 1, 'grant', 'x', 'y', 'web', now(), 1)$$,
  '42501', 'permission denied for table consent_evidence', 'authenticated no escribe en consent_evidence');

-- ===== Funciones: solo servidor =====
select throws_ok(
  $$select public.archive_consent_evidence('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64), 1::smallint)$$,
  '42501', 'permission denied for function archive_consent_evidence', 'authenticated no ejecuta archive_consent_evidence');
select throws_ok($$select public.purge_expired_consent_evidence()$$,
  '42501', 'permission denied for function purge_expired_consent_evidence', 'authenticated no ejecuta purge_expired_consent_evidence');
select throws_ok($$select * from public.privacy_config_warnings()$$,
  '42501', 'permission denied for function privacy_config_warnings', 'authenticated no ejecuta privacy_config_warnings');
reset role;

set local role anon;
select throws_ok($$select * from public.consent_evidence$$, '42501', 'permission denied for table consent_evidence', 'anon no lee consent_evidence');
select throws_ok(
  $$select public.archive_consent_evidence('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64), 1::smallint)$$,
  '42501', 'permission denied for function archive_consent_evidence', 'anon no ejecuta archive_consent_evidence');
reset role;

-- ===== Archivado (como servidor) =====
set local role service_role;
select is(public.archive_consent_evidence('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64), 1::smallint),
  2, 'se archivan los 2 eventos de A');
select is((select count(*) from public.consent_evidence where tutor_ref = repeat('a', 64)),
  2::bigint, 'quedan 2 filas de evidencia para el tutor_ref de A');
select is((select array_agg(distinct terms_version || '/' || privacy_version || '/' || channel) from public.consent_evidence where tutor_ref = repeat('a', 64)),
  array['tos-1/pp-1/ios'], 'la evidencia guarda versión de términos, de política y canal');
select ok((select bool_and(retain_until is null) from public.consent_evidence where tutor_ref = repeat('a', 64)),
  'con plazo sin definir, retain_until queda nulo');

-- Idempotencia (riesgo R9)
select is(public.archive_consent_evidence('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64), 1::smallint),
  0, 'archivar dos veces no inserta de nuevo');
select is((select count(*) from public.consent_evidence where tutor_ref = repeat('a', 64)),
  2::bigint, 'sin duplicados tras reintentar');
reset role;

-- ===== Mínimo de datos: sin FK al tutor y sin columnas de datos personales =====
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'consent_evidence'),
  array['archived_at', 'channel', 'event_type', 'hmac_key_version', 'id', 'occurred_at',
        'privacy_version', 'retain_until', 'source_seq', 'terms_version', 'tutor_ref'],
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

-- ===== Plazo configurable =====
update public.app_settings set value = '30'::jsonb where key = 'consent_evidence_retention_days';
set local role service_role;
select is(public.archive_consent_evidence('bbbbbbbb-0000-0000-0000-000000000002', repeat('b', 64), 1::smallint),
  1, 'se archiva el evento de B con plazo definido');
select ok((select retain_until between now() + interval '29 days' and now() + interval '31 days'
             from public.consent_evidence where tutor_ref = repeat('b', 64)),
  'retain_until = ahora + plazo configurado');
reset role;

-- ===== Purga =====
update public.consent_evidence set retain_until = now() - interval '1 day' where tutor_ref = repeat('b', 64);
set local role service_role;
select is(public.purge_expired_consent_evidence(), 1, 'la purga elimina solo la evidencia vencida');
select is((select count(*) from public.consent_evidence where tutor_ref = repeat('a', 64)),
  2::bigint, 'la evidencia sin plazo (retain_until nulo) no se purga');
reset role;

-- ===== Alerta R8 =====
update public.app_settings set value = 'null'::jsonb where key = 'consent_evidence_retention_days';
set local role service_role;
select is((select count(*) from public.privacy_config_warnings()),
  1::bigint, 'con el plazo sin definir se emite una alerta');
reset role;
update public.app_settings set value = '365'::jsonb where key = 'consent_evidence_retention_days';
set local role service_role;
select is((select count(*) from public.privacy_config_warnings()),
  0::bigint, 'con el plazo definido no hay alerta');
reset role;

-- ===== Validaciones =====
select throws_ok(
  $$update public.app_settings set value = '-5'::jsonb where key = 'consent_evidence_retention_days'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_retention_days_valid"',
  'un plazo negativo es rechazado');
select throws_ok(
  $$select public.archive_consent_evidence('bbbbbbbb-0000-0000-0000-000000000002', 'no-es-hex', 1::smallint)$$,
  '23514', null, 'tutor_ref que no es un HMAC en hexadecimal es rechazado');

select * from finish();
rollback;
