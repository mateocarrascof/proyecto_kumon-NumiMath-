begin;
select plan(19);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- T20: revocar el consentimiento. Desde ese momento no se usan los datos del niño, queda
-- constancia con fecha, los datos NO se borran de inmediato y el otro tutor no se ve afectado.
-- Tutores: A=...0001 (revoca), B=...0002 (control), C=...0003 (nunca aceptó).

insert into auth.users (id, email) values
  ('ee000000-0000-0000-0000-000000000001', 'a@test.invalid'),
  ('ee000000-0000-0000-0000-000000000002', 'b@test.invalid'),
  ('ee000000-0000-0000-0000-000000000003', 'c@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('ee000000-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('b0000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000001', 'Ana',  2, true),
  ('b0000000-0000-0000-0000-000000000002', 'ee000000-0000-0000-0000-000000000001', 'Ani',  3, true),
  ('b0000000-0000-0000-0000-000000000003', 'ee000000-0000-0000-0000-000000000002', 'Beto', 1, true);

set local role service_role;
select lives_ok($$select public.record_attempt('ee000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001',
  'sumas_hasta_20', '7 + 5', true)$$, 'datos de prueba: un intento del perfil de A');

-- ===== Antes de revocar =====
select is(public.consent_revocation_summary('ee000000-0000-0000-0000-000000000001')->>'last_event',
  'grant', 'antes de revocar, el último evento es la aceptación');
select is((public.consent_revocation_summary('ee000000-0000-0000-0000-000000000001')->>'profiles_active')::int,
  2, 'antes de revocar, los 2 perfiles están activos');
select is(public.authorize_student_use('ee000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'),
  'ok', 'antes de revocar, el perfil se puede usar');

-- ===== Revocar =====
select is(public.revoke_consent('ee000000-0000-0000-0000-000000000001'), 'ok', 'revocar registra el evento');
select is(public.consent_revocation_summary('ee000000-0000-0000-0000-000000000001')->>'last_event',
  'revoke', 'la constancia: el último evento es la revocación');
select ok((public.consent_revocation_summary('ee000000-0000-0000-0000-000000000001')->>'occurred_at')::timestamptz
            between now() - interval '1 minute' and now() + interval '1 minute',
  'la constancia lleva la fecha-hora del servidor');
select is((public.consent_revocation_summary('ee000000-0000-0000-0000-000000000001')->>'profiles_active')::int,
  0, 'desde ese momento no queda ningún perfil activo');
select is(public.authorize_student_use('ee000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001'),
  'student_blocked', 'desde ese momento el perfil no se puede usar (ni práctica, ni informes, ni IA)');

-- ===== Los datos NO se borran de inmediato; hay plazo =====
select is((select count(*) from public.students where tutor_id = 'ee000000-0000-0000-0000-000000000001'),
  2::bigint, 'los perfiles siguen existiendo (bloqueados), no se borraron');
select is((select count(*) from public.student_attempts where tutor_id = 'ee000000-0000-0000-0000-000000000001'),
  1::bigint, 'el progreso sigue guardado, solo bloqueado');
select is((public.consent_revocation_summary('ee000000-0000-0000-0000-000000000001')->>'purge_after_days')::int,
  30, 'el plazo de borrado es el configurado (30 días, provisional)');
select ok((public.consent_revocation_summary('ee000000-0000-0000-0000-000000000001')->>'purge_at')::timestamptz
            between now() + interval '29 days' and now() + interval '31 days',
  'la fecha de borrado es la del bloqueo más el plazo');

-- ===== Idempotencia: la fecha de la constancia no cambia =====
select is(public.revoke_consent('ee000000-0000-0000-0000-000000000001'), 'already_revoked',
  'revocar otra vez no registra un segundo evento');
select is((select count(*) from public.consents
            where tutor_id = 'ee000000-0000-0000-0000-000000000001' and event_type = 'revoke'),
  1::bigint, 'queda una sola revocación con su fecha');

-- ===== Aislamiento entre tutores =====
select is(public.authorize_student_use('ee000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003'),
  'ok', 'revocar el consentimiento de A no afecta los perfiles de B');
select is(public.consent_revocation_summary('ee000000-0000-0000-0000-000000000003')->>'last_event',
  null, 'quien nunca aceptó no tiene evento (la constancia no inventa fechas)');
reset role;

-- ===== Solo el servidor =====
set local role authenticated;
select throws_ok($$select public.consent_revocation_summary('ee000000-0000-0000-0000-000000000002')$$,
  '42501', 'permission denied for function consent_revocation_summary',
  'un tutor autenticado no puede llamar a la función (ni leer la constancia de otro)');
reset role;
set local role anon;
select throws_ok($$select public.consent_revocation_summary('ee000000-0000-0000-0000-000000000002')$$,
  '42501', 'permission denied for function consent_revocation_summary', 'anon tampoco');
reset role;

select * from finish();
rollback;
