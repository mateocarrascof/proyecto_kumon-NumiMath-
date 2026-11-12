begin;
select plan(46);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Lote A: frenar el flujo de eventos, tipo de versión en revocaciones, tests discriminantes
-- y casos faltantes de la revisión del Lote 2.
-- Tutores: A=...0001 B=...0002 C=...0003 F=...0006 G=...0007 H=...0008 I=...0009
--          J=...0010 K=...0011 X=...0012 Y=...0013 M=...0014   (prefijo eeeeeeee-0000-0000-0000-)
-- Versiones: terms tos-1 =1111...0001 (vigente), privacy pp-1 =1111...0002 (vigente),
--            adult_declaration ad-1 =1111...0003 (vigente), tos-0 =...0005, pp-0 =...0006 (antiguas)

insert into auth.users (id, email)
select ('eeeeeeee-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 't' || n || '@test.invalid'
from unnest(array[1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14]) as n;

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true),
  ('11111111-0000-0000-0000-000000000005', 'terms',             'tos-0', repeat('0', 64), false),
  ('11111111-0000-0000-0000-000000000006', 'privacy',           'pp-0',  repeat('1', 64), false);

-- Un grant inicial para todos salvo C (sin eventos) y F (inundación).
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('eeeeeeee-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from unnest(array[1, 2, 7, 8, 9, 10, 11, 12, 13, 14]) as n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('b2000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002', 'Beto', 3, true),
  ('c2000000-0000-0000-0000-000000000012', 'eeeeeeee-0000-0000-0000-000000000012', 'XS',   1, true),
  ('c2000000-0000-0000-0000-000000000013', 'eeeeeeee-0000-0000-0000-000000000013', 'YS',   1, true);
insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
select 'eeeeeeee-0000-0000-0000-000000000014', 'M' || g, 1, true from generate_series(1, 4) g;

-- ===== 1. Frenar el flujo de eventos =====
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'P0001', 'consent_event_redundant', 'un grant repetido con las mismas versiones es rechazado');
reset role;

select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000003', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'P0001', 'no_consent_to_revoke', 'no se puede revocar sin consentimiento previo');
reset role;

select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000001', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'una primera revocación es válida');
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000001', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'P0001', 'consent_event_redundant', 'una segunda revocación seguida es rechazada');
reset role;

select lives_ok(
  $t$do $do$ begin
      for i in 1..20 loop
        insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
        values ('eeeeeeee-0000-0000-0000-000000000006',
                case when i % 2 = 1 then 'grant' else 'revoke' end,
                '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');
      end loop;
    end $do$ $t$,
  'hasta 20 eventos alternados en 24 horas son válidos');
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000006', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'P0001', 'consent_event_rate_limited', 'el evento 21 en 24 horas es rechazado');

-- ===== 2. Tipo de documento en los eventos =====
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000007","role":"authenticated"}', true);
set local role authenticated;
-- Desde el Lote D una revocación no confía en las versiones del cliente: el trigger las
-- normaliza a las del último consentimiento (se comprueba en lote_d1.test.sql).
select lives_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000007', 'revoke', '11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'un revoke con un documento de privacidad como "términos" no contamina la evidencia (se normaliza)');
reset role;

select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000008","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000008', 'revoke', '11111111-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000006', 'web')$$,
  'un revoke siempre se acepta, aunque las versiones ya no sean las vigentes');
reset role;

select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000009', 'grant', '11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002', 'web')$$,
  '42501', 'new row violates row-level security policy for table "consents"',
  'un grant con la declaración del adulto como "términos" es rechazado');
reset role;

-- ===== 3. Un tutor no actúa a nombre de otro =====
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000002', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  '42501', 'tutor_mismatch', 'K no puede registrar una revocación a nombre de B');
reset role;
select is((select count(*) from public.students where tutor_id = 'eeeeeeee-0000-0000-0000-000000000002' and blocked_at is null),
  1::bigint, 'los alumnos de B siguen sin bloquear');

-- Defensa en profundidad: con el trigger desactivado, la política RLS por sí sola rechaza.
alter table public.consents disable trigger consents_before_insert;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('eeeeeeee-0000-0000-0000-000000000002', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  '42501', 'new row violates row-level security policy for table "consents"',
  'sin el trigger, la política RLS de consents rechaza por sí sola la revocación ajena');
reset role;
alter table public.consents enable trigger consents_before_insert;

alter table public.students disable trigger students_before_insert;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('eeeeeeee-0000-0000-0000-000000000002', 'Intruso', 1, true)$$,
  '42501', 'new row violates row-level security policy for table "students"',
  'sin el trigger, la política RLS de students rechaza por sí sola el alumno ajeno');
reset role;
alter table public.students enable trigger students_before_insert;

-- ===== 4. El alumno queda ligado al ÚLTIMO consentimiento =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('eeeeeeee-0000-0000-0000-000000000009', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'),
  ('eeeeeeee-0000-0000-0000-000000000009', 'grant',  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'ios');
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;
insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
values ('eeeeeeee-0000-0000-0000-000000000009', 'Ivo', 1, true);
select is(
  (select consent_id from public.students where nickname = 'Ivo'),
  (select id from public.consents where tutor_id = 'eeeeeeee-0000-0000-0000-000000000009' and event_type = 'grant' order by seq desc limit 1),
  'consent_id es el último grant del tutor');
select isnt(
  (select consent_id from public.students where nickname = 'Ivo'),
  (select id from public.consents where tutor_id = 'eeeeeeee-0000-0000-0000-000000000009' and event_type = 'grant' order by seq asc limit 1),
  'consent_id no es el primer grant');
reset role;

-- ===== 5. Declaración del adulto: versión faltante y persistencia =====
update public.legal_document_versions set is_current = false where id = '11111111-0000-0000-0000-000000000003';
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('eeeeeeee-0000-0000-0000-000000000010', 'Sin', 1, true)$$,
  'P0001', 'declaration_version_missing', 'sin versión vigente de la declaración no se crean alumnos');
reset role;
update public.legal_document_versions set is_current = true where id = '11111111-0000-0000-0000-000000000003';

select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;
insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
values ('eeeeeeee-0000-0000-0000-000000000010', 'J1', 1, true);
reset role;
update public.legal_document_versions set is_current = false where id = '11111111-0000-0000-0000-000000000003';
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000007', 'adult_declaration', 'ad-2', repeat('d', 64), true);
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;
insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
values ('eeeeeeee-0000-0000-0000-000000000010', 'J2', 1, true);
select is((select adult_declaration_version_id from public.students where nickname = 'J1'),
  '11111111-0000-0000-0000-000000000003'::uuid, 'el alumno antiguo conserva la versión de la declaración con que se creó');
select is((select adult_declaration_version_id from public.students where nickname = 'J2'),
  '11111111-0000-0000-0000-000000000007'::uuid, 'el alumno nuevo toma la versión vigente de la declaración');
reset role;

-- ===== 6. unblock_student discrimina por tutor =====
-- X: consentimiento activo y alumno bloqueado. Y: alumno bloqueado y sin consentimiento activo.
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('eeeeeeee-0000-0000-0000-000000000012', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'),
  ('eeeeeeee-0000-0000-0000-000000000012', 'grant',  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'),
  ('eeeeeeee-0000-0000-0000-000000000013', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');

set local role service_role;
select is(public.unblock_student('eeeeeeee-0000-0000-0000-000000000012', 'c2000000-0000-0000-0000-000000000013'),
  false, 'X (consentimiento activo) no puede desbloquear el alumno bloqueado de Y');
reset role;
select ok((select blocked_at is not null from public.students where id = 'c2000000-0000-0000-0000-000000000013'),
  'el alumno de Y sigue bloqueado');
set local role service_role;
select is(public.unblock_student('eeeeeeee-0000-0000-0000-000000000012', 'c2000000-0000-0000-0000-000000000012'),
  true, 'X sí desbloquea su propio alumno (control positivo)');
select is(public.unblock_student('eeeeeeee-0000-0000-0000-000000000012', 'c2000000-0000-0000-0000-000000000012'),
  false, 'desbloquear un alumno que no está bloqueado devuelve false');
select is(public.unblock_student('eeeeeeee-0000-0000-0000-000000000012', gen_random_uuid()),
  false, 'desbloquear un alumno inexistente devuelve false');
reset role;

-- ===== 7. Tope: varias filas en una sola sentencia y tope por debajo del conteo =====
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000014","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values
      ('eeeeeeee-0000-0000-0000-000000000014', 'M5', 1, true),
      ('eeeeeeee-0000-0000-0000-000000000014', 'M6', 1, true)$$,
  'P0001', 'student_limit_reached', 'insertar varias filas en una sentencia no permite superar el tope');
select is((select count(*) from public.students where tutor_id = 'eeeeeeee-0000-0000-0000-000000000014'),
  4::bigint, 'la sentencia rechazada no insertó ninguna fila');
reset role;

update public.tutors set max_students = 2 where id = 'eeeeeeee-0000-0000-0000-000000000014';
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000014","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.students), 4::bigint,
  'bajar el tope por debajo del conteo no oculta los alumnos existentes');
reset role;
set local role service_role;
select is(public.delete_student('eeeeeeee-0000-0000-0000-000000000014',
  (select id from public.students where tutor_id = 'eeeeeeee-0000-0000-0000-000000000014' and nickname = 'M1')),
  'ok', 'sí se pueden borrar alumnos (vía servidor)');
set local role authenticated;
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('eeeeeeee-0000-0000-0000-000000000014', 'M7', 1, true)$$,
  'P0001', 'student_limit_reached', 'con el conteo sobre el tope solo se bloquean las altas');
reset role;

-- ===== 8. Validación del plazo y de la clave de evidencia =====
select throws_ok($$update public.app_settings set value = '0'::jsonb     where key = 'consent_evidence_retention_days'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_values_valid"', 'plazo 0 es rechazado');
select throws_ok($$update public.app_settings set value = '36501'::jsonb where key = 'consent_evidence_retention_days'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_values_valid"', 'plazo 36501 es rechazado');
select throws_ok($$update public.app_settings set value = '"30"'::jsonb  where key = 'consent_evidence_retention_days'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_values_valid"', 'plazo como texto es rechazado');
select throws_ok($$update public.app_settings set value = '30.5'::jsonb  where key = 'consent_evidence_retention_days'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_values_valid"', 'plazo decimal es rechazado');
select lives_ok($$update public.app_settings set value = 'null'::jsonb   where key = 'consent_evidence_retention_days'$$,
  'plazo nulo (sin definir) es aceptado');
select throws_ok(
  $$insert into public.consent_evidence (tutor_ref, hmac_key_version, event_type, terms_version, terms_sha256, privacy_version, privacy_sha256, channel, occurred_at, source_seq) values (repeat('a', 64), 0, 'grant', 'x', repeat('c', 64), 'y', repeat('d', 64), 'web', now(), 1)$$,
  '23514', 'new row for relation "consent_evidence" violates check constraint "consent_evidence_hmac_key_version_check"',
  'una versión de clave HMAC no positiva es rechazada');

set local role service_role;
select is(public.archive_consent_evidence('eeeeeeee-0000-0000-0000-000000000003', repeat('c', 64), 1::smallint),
  0, 'archivar un tutor sin eventos devuelve 0 y no falla');
reset role;

-- ===== 9. Privilegios =====
select ok(not has_function_privilege('authenticated', 'public.on_consent_revoked()', 'execute'),
  'authenticated no ejecuta on_consent_revoked');
select ok(not has_function_privilege('authenticated', 'public.archive_consent_evidence(uuid, text, smallint)', 'execute'),
  'authenticated no ejecuta archive_consent_evidence');
select ok(not has_function_privilege('authenticated', 'public.privacy_config_warnings()', 'execute'),
  'authenticated no ejecuta privacy_config_warnings');
select ok(not has_function_privilege('authenticated', 'public.students_before_insert()', 'execute'),
  'authenticated no ejecuta students_before_insert');
select ok(not has_function_privilege('authenticated', 'public.consents_before_insert()', 'execute'),
  'authenticated no ejecuta consents_before_insert');
select ok(not has_function_privilege('anon', 'public.students_before_insert()', 'execute'),
  'anon no ejecuta students_before_insert');
select ok(not has_sequence_privilege('authenticated', 'public.consents_seq_seq', 'usage'),
  'authenticated no tiene USAGE sobre la secuencia de consents');

-- ===== 10. has_active_consent no es un oráculo y no depende de la caché =====
select is(public.has_active_consent('eeeeeeee-0000-0000-0000-000000000002'), true,
  'como superusuario, B tiene consentimiento activo');
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000012","role":"authenticated"}', true);
set local role authenticated;
select is(public.has_active_consent('eeeeeeee-0000-0000-0000-000000000002'), false,
  'en la misma transacción, X preguntando por B recibe false (sin caché del superusuario)');
select is(public.has_active_consent('eeeeeeee-0000-0000-0000-000000000012'), true,
  'X preguntando por sí mismo recibe true');
reset role;

-- ===== 11. Un cambio de versión de política también quita el consentimiento =====
update public.legal_document_versions set is_current = false where id = '11111111-0000-0000-0000-000000000002';
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000008', 'privacy', 'pp-2', repeat('e', 64), true);
select is(public.has_active_consent('eeeeeeee-0000-0000-0000-000000000011'), false,
  'al cambiar la versión de la política, el consentimiento deja de estar activo');

select * from finish();
rollback;
