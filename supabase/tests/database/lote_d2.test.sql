begin;
select plan(43);

-- Lote D, parte 2: bloqueo individual con motivo, purga solo de bloqueados por revocación,
-- inactividad configurable, pg_cron y alertas.
-- Tutores V1..V6 = bbbb2222-0000-0000-0000-00000000000N

insert into auth.users (id, email)
select ('bbbb2222-0000-0000-0000-00000000000' || n)::uuid, 'v' || n || '@test.invalid'
from generate_series(1, 6) n;

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('bbbb2222-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 6) n;

-- V1: Uno (se bloqueará a petición del tutor) y Uno2. V2: Dos (reclamo ARCOP).
-- V3: Tres (inactivo) y Tres2 (reciente). V4: Cuatro. V5: Cinco (bloqueado e inactivo).
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('b1000000-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000001', 'Uno',    1, true),
  ('b1000000-0000-0000-0000-000000000002', 'bbbb2222-0000-0000-0000-000000000001', 'Uno2',   1, true),
  ('b2000000-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000002', 'Dos',    1, true),
  ('b3000000-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000003', 'Tres',   1, true),
  ('b3000000-0000-0000-0000-000000000002', 'bbbb2222-0000-0000-0000-000000000003', 'Tres2',  1, true),
  ('b4000000-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000004', 'Cuatro', 1, true),
  ('b5000000-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000005', 'Cinco',  1, true);

-- ===== 1. Bloqueo individual: solo servidor =====
select set_config('request.jwt.claims', '{"sub":"bbbb2222-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.block_student('bbbb2222-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'tutor_request')$$,
  '42501', 'permission denied for function block_student', 'el cliente no puede ejecutar block_student');
reset role;

set local role service_role;
select throws_ok(
  $$select public.block_student('bbbb2222-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'consent_revoked')$$,
  '22023', 'invalid_block_reason', 'el motivo "consent_revoked" no se puede pedir manualmente');
select is(public.block_student('bbbb2222-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'tutor_request'),
  true, 'se bloquea un perfil a petición del tutor');
select is(public.block_student('bbbb2222-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'tutor_request'),
  false, 'bloquear de nuevo no hace nada');
select is(public.block_student('bbbb2222-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'tutor_request'),
  false, 'no se puede bloquear el perfil de otro tutor');
select is(public.block_student('bbbb2222-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'arcop_claim'),
  true, 'se bloquea un perfil por un reclamo ARCOP');
reset role;

select is((select blocked_reason from public.students where id = 'b1000000-0000-0000-0000-000000000001'),
  'tutor_request', 'queda registrado el motivo del bloqueo');
select is((select count(*) from public.student_status_events
            where student_id = 'b1000000-0000-0000-0000-000000000001' and event_type = 'blocked' and reason = 'tutor_request'),
  1::bigint, 'el historial registra el motivo');
select is(public.has_active_consent('bbbb2222-0000-0000-0000-000000000001'), true,
  'bloquear un perfil no revoca el consentimiento de la cuenta');

-- ===== 2. Revocar respeta el motivo previo =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('bbbb2222-0000-0000-0000-000000000001', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');
select is((select blocked_reason from public.students where id = 'b1000000-0000-0000-0000-000000000002'),
  'consent_revoked', 'el perfil activo queda bloqueado por la revocación');
select is((select blocked_reason from public.students where id = 'b1000000-0000-0000-0000-000000000001'),
  'tutor_request', 'el perfil ya bloqueado conserva su motivo original');

-- ===== 3. La purga automática solo afecta a los bloqueados por revocación =====
update public.students set blocked_at = now() - interval '40 days'
 where id in ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001');

set local role service_role;
select is((select count(*) from public.blocked_students_due_soon(0)), 1::bigint,
  'solo el perfil bloqueado por revocación figura como próximo a purgarse');
select is(public.purge_long_blocked_students(), 1, 'la purga elimina solo el bloqueado por revocación');
reset role;
select is_empty($$select 1 from public.students where id = 'b1000000-0000-0000-0000-000000000002'$$,
  'el bloqueado por revocación fue purgado');
select is((select count(*) from public.students
            where id in ('b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001')),
  2::bigint, 'los bloqueados a petición del tutor y por reclamo ARCOP se conservan');

-- ===== 4. Desbloquear limpia el motivo =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('bbbb2222-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'ios');
set local role service_role;
select is(public.unblock_student('bbbb2222-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'),
  true, 'se desbloquea el perfil bloqueado a petición del tutor');
reset role;
select ok((select blocked_at is null and blocked_reason is null from public.students where id = 'b1000000-0000-0000-0000-000000000001'),
  'el desbloqueo limpia fecha y motivo');
select is((select count(*) from public.student_status_events
            where student_id = 'b1000000-0000-0000-0000-000000000001' and event_type = 'unblocked' and reason = 'manual_unblock'),
  1::bigint, 'el desbloqueo queda en el historial');

-- ===== 5. Coherencia del motivo =====
select throws_ok(
  $$update public.students set blocked_at = now() where id = 'b1000000-0000-0000-0000-000000000001'$$,
  '23514', 'new row for relation "students" violates check constraint "students_blocked_reason_consistent"',
  'un bloqueo sin motivo es rechazado');
select throws_ok(
  $$update public.students set blocked_at = now(), blocked_reason = 'otro' where id = 'b1000000-0000-0000-0000-000000000001'$$,
  '23514', 'new row for relation "students" violates check constraint "students_blocked_reason_valid"',
  'un motivo desconocido es rechazado');

-- ===== 6. Inactividad =====
update public.students set last_active_at = now() - interval '400 days'
 where id in ('b3000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001');
update public.students set last_active_at = now() - interval '3 days'
 where id = 'b4000000-0000-0000-0000-000000000001';

set local role service_role;
select is(public.block_student('bbbb2222-0000-0000-0000-000000000005', 'b5000000-0000-0000-0000-000000000001', 'tutor_request'),
  true, 'V5 bloquea su perfil inactivo');
select is((select count(*) from public.inactive_students_due_soon(0)), 1::bigint,
  'solo el perfil activo-no-bloqueado con más de 12 meses sin uso está por vencer');
select is((select count(*) from public.inactive_students_due_soon(400)), 4::bigint,
  'con un aviso de 400 días figuran todos los perfiles no bloqueados que vencerán');
reset role;

select is(
  (select count(*) from public.declaration_evidence), 1::bigint,
  'hasta aquí solo existe la declaración archivada por la purga de bloqueados');
set local role service_role;
select is(public.purge_inactive_students(), 1, 'la purga por inactividad elimina un perfil');
reset role;
select is_empty($$select 1 from public.students where id = 'b3000000-0000-0000-0000-000000000001'$$,
  'el perfil inactivo fue suprimido');
select is((select count(*) from public.students
            where id in ('b3000000-0000-0000-0000-000000000002', 'b5000000-0000-0000-0000-000000000001')),
  2::bigint, 'el perfil reciente y el bloqueado (aunque inactivo) se conservan');
select is((select count(*) from public.declaration_evidence), 2::bigint,
  'al suprimir por inactividad se archivó la declaración');

set local role service_role;
select is(public.touch_student_activity('bbbb2222-0000-0000-0000-000000000004', 'b4000000-0000-0000-0000-000000000001'),
  true, 'registrar actividad actualiza el perfil');
select is(public.touch_student_activity('bbbb2222-0000-0000-0000-000000000004', 'b4000000-0000-0000-0000-000000000001'),
  false, 'una segunda marca el mismo día no escribe (como máximo una por día)');
select is(public.touch_student_activity('bbbb2222-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001'),
  false, 'no se puede marcar actividad de un perfil ajeno');
select is(public.touch_student_activity('bbbb2222-0000-0000-0000-000000000005', 'b5000000-0000-0000-0000-000000000001'),
  false, 'un perfil bloqueado no registra actividad');
reset role;

-- Cuentas inactivas
update auth.users set last_sign_in_at = now() - interval '400 days'
 where id = 'bbbb2222-0000-0000-0000-000000000006';
update public.tutors set created_at = now() - interval '400 days'
 where id = 'bbbb2222-0000-0000-0000-000000000006';
update auth.users set last_sign_in_at = now() where id = 'bbbb2222-0000-0000-0000-000000000004';
set local role service_role;
select is((select count(*) from public.inactive_tutors_due_soon(0) where tutor_id = 'bbbb2222-0000-0000-0000-000000000006'),
  1::bigint, 'una cuenta sin inicio de sesión ni perfiles en 12 meses figura como inactiva');
select is((select count(*) from public.inactive_tutors_due_soon(0) where tutor_id = 'bbbb2222-0000-0000-0000-000000000004'),
  0::bigint, 'una cuenta con actividad reciente no figura');
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.purge_inactive_students()', 'execute')
  and not has_function_privilege('authenticated', 'public.touch_student_activity(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.inactive_students_due_soon(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.inactive_tutors_due_soon(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.privacy_job_warnings()', 'execute'),
  'solo el servidor ejecuta las funciones de inactividad y de alertas de trabajos');

-- ===== 7. Validación de los plazos nuevos =====
select throws_ok($$update public.app_settings set value = '0'::jsonb where key = 'inactive_profile_retention_days'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_values_valid"',
  'un plazo de inactividad de 0 días es rechazado');
select throws_ok($$update public.app_settings set value = '"si"'::jsonb where key = 'inactive_profile_retention_confirmed'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_values_valid"',
  'la confirmación debe ser booleana');

-- ===== 8. pg_cron =====
select is((select count(*) from cron.job
            where jobname in ('privacy-purge-evidence', 'privacy-purge-blocked', 'privacy-purge-inactive')),
  3::bigint, 'las tres purgas están programadas en pg_cron');
select is((select command from cron.job where jobname = 'privacy-purge-blocked'),
  'select public.purge_long_blocked_students()', 'cada trabajo ejecuta la función de purga correspondiente');

set local role service_role;
select is((select count(*) from public.privacy_job_warnings()), 3::bigint,
  'mientras ningún trabajo haya corrido, hay una alerta por trabajo');
reset role;

select cron.unschedule('privacy-purge-blocked');
set local role service_role;
select is((select count(*) from public.privacy_job_warnings() as w where w like '%privacy-purge-blocked no está programado'),
  1::bigint, 'un trabajo que se quita de la programación genera su propia alerta');
reset role;

-- ===== 9. Alertas de configuración =====
set local role service_role;
select is((select count(*) from public.privacy_config_warnings()), 3::bigint,
  'con la configuración inicial hay 3 alertas (evidencia sin plazo y dos plazos provisionales)');
reset role;

delete from public.app_settings where key in ('blocked_profile_retention_days', 'inactive_profile_retention_days');
set local role service_role;
select is((select count(*) from public.privacy_config_warnings() as w where w like '%no existe%'), 2::bigint,
  'si faltan las claves de bloqueados e inactividad se avisa de ambas');
reset role;

select * from finish();
rollback;
