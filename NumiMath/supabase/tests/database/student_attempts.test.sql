begin;
select plan(15);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Intentos de práctica: RLS por tutor, escritura solo del servidor, un intento por ejercicio.
-- Tutores: A=...0001 B=...0002  (prefijo cccccccc-0000-0000-0000-)

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001', 'a@test.invalid'),
  ('cccccccc-0000-0000-0000-000000000002', 'b@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('cccccccc-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Ana', 2, true),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 'Beto', 3, true);

-- ===== 1. El servidor registra; un perfil ajeno no =====
set local role service_role;
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'sumas_hasta_20', '7 + 5', true),
  'ok', 'el servidor registra un intento del perfil');
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'sumas_hasta_20', '7 + 5', true),
  'duplicate', 'responder dos veces el mismo ejercicio no cuenta dos veces');
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'sumas_hasta_20', '7 + 5', false),
  'duplicate', 'cambiar la respuesta tampoco reemplaza el intento');
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002', 'sumas_hasta_20', '1 + 1', true),
  'student_not_found', 'un tutor no puede registrar intentos en el perfil de otro');
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000003', 'tablas_de_multiplicar', '3 × 4', false),
  'ok', 'otro tutor registra en su propio perfil');
reset role;

select is((select count(*) from public.student_attempts), 2::bigint, 'solo hay 2 intentos guardados');
select is((select correct from public.student_attempts where exercise_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  true, 'el primer resultado es el que queda');

-- ===== 2. RLS por tutor =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.student_attempts), 1::bigint, 'A ve solo sus intentos');
select is((select count(*) from public.student_attempts where tutor_id = 'cccccccc-0000-0000-0000-000000000002'),
  0::bigint, 'A no ve los intentos de B');

select throws_ok(
  $$insert into public.student_attempts (student_id, tutor_id, exercise_id, topic, exercise, correct)
    values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
            gen_random_uuid(), 'sumas_hasta_20', '1 + 1', true)$$,
  '42501', 'permission denied for table student_attempts', 'el cliente no puede escribir intentos');
select throws_ok(
  $$update public.student_attempts set correct = false$$,
  '42501', 'permission denied for table student_attempts', 'el cliente no puede modificar intentos');
select throws_ok(
  $$delete from public.student_attempts$$,
  '42501', 'permission denied for table student_attempts', 'el cliente no puede borrar intentos');
select throws_ok(
  $$select public.record_attempt('cccccccc-0000-0000-0000-000000000001',
    'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'x', 'y', true)$$,
  '42501', 'permission denied for function record_attempt', 'el cliente no puede llamar a record_attempt');
reset role;

set local role anon;
select throws_ok($$select * from public.student_attempts$$,
  '42501', 'permission denied for table student_attempts', 'anon no puede leer intentos');
reset role;

-- ===== 3. Borrar el perfil borra sus intentos =====
delete from public.students where id = 'dddddddd-0000-0000-0000-000000000001';
select is((select count(*) from public.student_attempts where student_id = 'dddddddd-0000-0000-0000-000000000001'),
  0::bigint, 'al borrar el perfil se borran sus intentos');

select * from finish();
rollback;
