begin;
select plan(7);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Tiempo por ejercicio: lo guarda el servidor en cada intento, con tope de 600 s.
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
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Ana', 1, true);

set local role service_role;

select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
  'sumas_hasta_20', '7 + 5 = ?', true, null, 1, 42), 'ok', 'se registra un intento con su tiempo');
select is((select duration_s::int from public.student_attempts
  where exercise_id = 'eeeeeeee-0000-0000-0000-000000000001'), 42, 'el intento guarda los segundos');

select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002',
  'sumas_hasta_20', '1 + 1 = ?', true, null, 1), 'ok', 'sin tiempo también se registra');
select ok((select duration_s is null from public.student_attempts
  where exercise_id = 'eeeeeeee-0000-0000-0000-000000000002'), 'sin tiempo queda vacío');

select throws_ok($$ select public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'sumas_hasta_20', '2 + 2 = ?',
  true, null, 1, 601) $$, '23514', null, 'más de 600 s se rechaza');

-- Las tareas del tutor pasan el tiempo al intento.
select 1 where public.create_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', '3 + 4 = ?', 7) is null;
select 1 where public.answer_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  (select id from public.assigned_exercises where answer = 7 and student_id = 'dddddddd-0000-0000-0000-000000000001'), 7, null, 95) is null;
select is((select duration_s::int from public.student_attempts where topic = 'tarea_tutor' and student_id = 'dddddddd-0000-0000-0000-000000000001'), 95,
  'la tarea guarda su tiempo en el intento');
reset role;

-- RLS: otro tutor no ve los tiempos.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.student_attempts), 0, 'otro tutor no lee intentos ni tiempos');
reset role;

select * from finish();
rollback;
