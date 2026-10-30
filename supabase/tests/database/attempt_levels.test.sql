begin;
select plan(9);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Dificultad progresiva: nivel guardado en cada intento, rango 1–3, RLS por tutor.
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
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Ana', 1, true),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 'Beto', 1, true);

select has_column('public', 'student_attempts', 'level', 'student_attempts tiene la columna level');

-- ===== 1. record_attempt guarda el nivel =====
set local role service_role;

select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
  'sumas_hasta_20', '7 + ? = 12', true, null, 3), 'ok', 'se registra un intento de nivel 3');
select is((select level::int from public.student_attempts
  where exercise_id = 'eeeeeeee-0000-0000-0000-000000000001'), 3, 'el intento guarda su nivel');

-- Sin nivel (llamada vieja de 7 argumentos): nivel 1.
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002',
  'sumas_hasta_20', '1 + 1 = ?', true, null), 'ok', 'sin nivel también se registra');
select is((select level::int from public.student_attempts
  where exercise_id = 'eeeeeeee-0000-0000-0000-000000000002'), 1, 'sin nivel se guarda 1');

-- Fuera de rango: la base lo rechaza.
select throws_ok($$ select public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'sumas_hasta_20', '2 + 2 = ?',
  true, null, 4) $$, '23514', null, 'un nivel 4 se rechaza');
select throws_ok($$ select public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'sumas_hasta_20', '2 + 2 = ?',
  true, null, 0) $$, '23514', null, 'un nivel 0 se rechaza');
reset role;

-- ===== 2. RLS: el tutor B no ve los niveles de A, y nadie escribe directo =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.student_attempts
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 0,
  'otro tutor no lee los intentos (ni sus niveles)');

select throws_ok($$ update public.student_attempts set level = 3
  where student_id = 'dddddddd-0000-0000-0000-000000000001' $$, '42501', null,
  'un tutor no puede cambiar el nivel de un intento');
reset role;

select * from finish();
rollback;
