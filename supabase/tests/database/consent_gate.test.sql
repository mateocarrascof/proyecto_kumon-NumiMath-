begin;
select plan(47);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Lote 2, paso 1: versiones legales, compuerta de consentimiento, revocación y desbloqueo.
-- UUIDs: tutor A = aaaaaaaa-...-0001, tutor B = bbbbbbbb-...-0002, tutor D = dddddddd-...-0004
--        términos tos-1 = 1111...0001, privacidad pp-1 = 1111...0002,
--        declaración ad-1 = 1111...0003, términos tos-2 = 1111...0004 (nueva vigente)

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test.invalid'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test.invalid'),
  ('dddddddd-0000-0000-0000-000000000004', 'd@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

-- B tiene consentimiento y un alumno desde el inicio; A y D aún no.
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Beto', 3, true);

-- ===== 1. Sin consentimiento no se crea alumno (ni siquiera el servidor) =====
set local role service_role;
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Ana', 1, true)$$,
  'P0001', 'consent_required', 'sin consentimiento, ni service_role puede crear alumnos');
reset role;

-- ===== 2. Con consentimiento vigente el alumno se crea y queda ligado =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Ana', 1, true)$$,
  'con consentimiento vigente A crea su alumno');

-- El cliente no fija id; lo normalizamos como superusuario para referirnos a él en el resto del test.
reset role;
update public.students set id = 'a1000000-0000-0000-0000-000000000001'
 where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000001' and nickname = 'Ana';
set local role authenticated;

select is(
  (select consent_id from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  (select id from public.consents where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by seq desc limit 1),
  'el alumno queda ligado al consentimiento vigente al crearse');
select is(
  (select adult_declaration_version_id from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000003'::uuid,
  'el servidor registra la versión vigente de la declaración del adulto');
select ok(
  (select adult_declared_at is not null from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  'el servidor fija la fecha de la declaración');
select ok(
  (select blocked_at is null from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  'el alumno nuevo no nace bloqueado');

-- ===== 3. Declaración del adulto obligatoria =====
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Sin', 1, false)$$,
  '23514', 'new row for relation "students" violates check constraint "students_adult_declaration_required"',
  'declaración en false es rechazada');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Sin', 1)$$,
  '23514', 'new row for relation "students" violates check constraint "students_adult_declaration_required"',
  'omitir la declaración es rechazado');

-- ===== 4. El cliente no escribe las columnas del servidor =====
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted, consent_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'X', 1, true, gen_random_uuid())$$,
  '42501', 'permission denied for table students', 'el cliente no puede fijar consent_id');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted, adult_declared_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'X', 1, true, now())$$,
  '42501', 'permission denied for table students', 'el cliente no puede fijar adult_declared_at');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted, adult_declaration_version_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'X', 1, true, gen_random_uuid())$$,
  '42501', 'permission denied for table students', 'el cliente no puede fijar la versión de la declaración');
select throws_ok(
  $$update public.students set blocked_at = null where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '42501', 'permission denied for table students', 'el cliente no puede desbloquear por su cuenta');

-- ===== 5. Catálogo de versiones: solo lectura para el cliente =====
select throws_ok(
  $$insert into public.legal_document_versions (kind, version, content_sha256) values ('terms', 'tos-x', repeat('f', 64))$$,
  '42501', 'permission denied for table legal_document_versions', 'el cliente no puede publicar versiones');
select throws_ok(
  $$update public.legal_document_versions set is_current = true$$,
  '42501', 'permission denied for table legal_document_versions', 'el cliente no puede cambiar la versión vigente');
select throws_ok(
  $$delete from public.legal_document_versions$$,
  '42501', 'permission denied for table legal_document_versions', 'el cliente no puede borrar versiones');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.legal_document_versions$$,
  '42501', 'permission denied for table legal_document_versions', 'anon no lee el catálogo de versiones');
reset role;

-- ===== 6. Una sola versión vigente por tipo =====
select throws_ok(
  $$insert into public.legal_document_versions (kind, version, content_sha256, is_current) values ('terms', 'tos-dup', repeat('e', 64), true)$$,
  '23505', 'duplicate key value violates unique constraint "legal_document_versions_one_current_idx"', 'no puede haber dos versiones vigentes del mismo tipo');

-- ===== 7. Cambia la versión vigente: hay que volver a aceptar =====
update public.legal_document_versions set is_current = false where id = '11111111-0000-0000-0000-000000000001';
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000004', 'terms', 'tos-2', repeat('d', 64), true);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.has_active_consent('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'al cambiar la versión de los términos, el consentimiento deja de estar activo');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Nuevo', 1, true)$$,
  'P0001', 'consent_required', 'sin aceptar la nueva versión no se crean alumnos');
-- tos-1 ya no es vigente. Un grant idéntico al último sería "redundante" antes de llegar
-- a RLS, así que se usa una versión antigua distinta (tos-0) para ejercitar la política.
reset role;
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000005', 'terms', 'tos-0', repeat('0', 64), false);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('aaaaaaaa-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000002', 'web')$$,
  '42501', 'new row violates row-level security policy for table "consents"', 'no se puede aceptar una versión que ya no es la vigente');
select lives_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('aaaaaaaa-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'aceptar la nueva versión vigente es válido');
select is(public.has_active_consent('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'tras aceptar la nueva versión el consentimiento vuelve a estar activo');

-- ===== 8. Revocación: bloquea los perfiles del tutor y solo los suyos =====
select lives_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('aaaaaaaa-0000-0000-0000-000000000001', 'revoke', '11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'A puede revocar su consentimiento');

reset role;
select is((select count(*) from public.students where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000001' and blocked_at is null),
  0::bigint, 'revocar bloquea todos los alumnos del tutor');
select is((select count(*) from public.students where tutor_id = 'bbbbbbbb-0000-0000-0000-000000000002' and blocked_at is null),
  1::bigint, 'revocar no afecta a los alumnos de otro tutor');

-- ===== 9. Efectos de la revocación para el tutor =====
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.has_active_consent('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'tras revocar, el consentimiento no está activo');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Otro', 1, true)$$,
  'P0001', 'consent_required', 'tras revocar no se crean alumnos');
select is((select count(*) from public.students where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1::bigint, 'un perfil bloqueado sigue siendo legible (derecho de acceso)');
-- Rectificación: corregir apodo y curso está permitido aunque el perfil esté bloqueado.
select lives_ok(
  $$update public.students set nickname = 'Cambio', grade = 2 where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'un perfil bloqueado sí se puede rectificar (apodo y curso)');
select is((select nickname || '/' || grade from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  'Cambio/2', 'la rectificación quedó aplicada');
select throws_ok(
  $$update public.students set blocked_at = null where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '42501', 'permission denied for table students', 'rectificar no permite desbloquear');

-- ===== 10. Volver a consentir NO desbloquea =====
select lives_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('aaaaaaaa-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'A vuelve a consentir');
select is(public.has_active_consent('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'tras volver a consentir, el consentimiento está activo');

reset role;
select ok((select blocked_at is not null from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  'volver a consentir no desbloquea el perfil');

-- ===== 11. Desbloqueo manual: solo servidor =====
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.unblock_student('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  '42501', 'permission denied for function unblock_student', 'el cliente no puede ejecutar unblock_student');
reset role;

set local role service_role;
select is(public.unblock_student('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
  true, 'el servidor desbloquea el perfil con consentimiento activo');
select ok((select blocked_at is null from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  'el perfil quedó desbloqueado');
select is(public.unblock_student('aaaaaaaa-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'),
  false, 'no se puede desbloquear el alumno de otro tutor');
reset role;

-- ===== 12. Sin consentimiento activo no se desbloquea =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'revoke', '11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000002', 'web');

set local role service_role;
select is(public.unblock_student('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
  false, 'sin consentimiento activo no se desbloquea');
reset role;
select ok((select blocked_at is not null from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  'el perfil sigue bloqueado tras la segunda revocación');

-- ===== 13. Un perfil bloqueado se puede borrar =====
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$delete from public.students where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'un perfil bloqueado se puede borrar (derecho de supresión)');
select is_empty($$select 1 from public.students where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'el perfil borrado ya no existe');

-- ===== 14. consents sigue siendo append-only =====
select throws_ok(
  $$update public.consents set channel = 'ios'$$,
  '42501', 'permission denied for table consents', 'consents no admite UPDATE');
reset role;

-- ===== 15. Orden estricto de eventos (mismo instante de transacción) =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('dddddddd-0000-0000-0000-000000000004', 'grant',  '11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000002', 'web'),
  ('dddddddd-0000-0000-0000-000000000004', 'revoke', '11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000002', 'web');
select is(public.has_active_consent('dddddddd-0000-0000-0000-000000000004'), false,
  'grant seguido de revoke en el mismo instante: manda el último (por seq)');
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('dddddddd-0000-0000-0000-000000000004', 'grant', '11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000002', 'web');
select is(public.has_active_consent('dddddddd-0000-0000-0000-000000000004'), true,
  'un nuevo grant posterior vuelve a activar el consentimiento');

-- ===== 16. anon no ejecuta funciones sensibles =====
set local role anon;
select throws_ok(
  $$select public.has_active_consent('aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501', 'permission denied for function has_active_consent', 'anon no puede ejecutar has_active_consent');
select throws_ok(
  $$select public.unblock_student('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  '42501', 'permission denied for function unblock_student', 'anon no puede ejecutar unblock_student');
reset role;

select * from finish();
rollback;
