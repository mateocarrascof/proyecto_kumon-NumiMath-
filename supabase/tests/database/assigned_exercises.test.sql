begin;
select plan(18);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Ejercicios propios del tutor: escritura solo del servidor, RLS por tutor, límite, respuesta única.
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

-- ===== 1. Alta =====
set local role service_role;

select is(public.create_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'Tienes 3 dulces y te dan 4. ¿Cuántos tienes?', 7),
  'ok', 'el tutor crea una tarea para su perfil');
select is(public.create_assignment('cccccccc-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000001', '1 + 1', 2),
  'student_not_found', 'un tutor no crea tareas en un perfil ajeno');
select throws_ok($$ select public.create_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', '', 2) $$, '23514', null, 'el enunciado no puede ir vacío');
select throws_ok($$ select public.create_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', '1 + 1', -1) $$, '23514', null,
  'la respuesta no puede ser negativa');

-- Límite: 20 pendientes.
do $$ begin
  for n in 1..19 loop
    perform public.create_assignment('cccccccc-0000-0000-0000-000000000001',
      'dddddddd-0000-0000-0000-000000000001', n || ' + 100', n + 100);
  end loop;
end $$;
select is(public.create_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', '5 + 5', 10), 'limit', 'no se pasa de 20 pendientes');

-- ===== 2. Responder =====
select is((public.answer_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  (select id from public.assigned_exercises where answer = 7), 7,
  (now() at time zone 'utc')::date))->>'status', 'ok', 'el niño responde su tarea');
select ok((select correct from public.assigned_exercises where answer = 7), 'se guarda que acertó');
select is((select count(*)::int from public.student_attempts
  where student_id = 'dddddddd-0000-0000-0000-000000000001' and topic = 'tarea_tutor'), 1,
  'la respuesta registra un intento de tarea');
select is((select current_len from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 1, 'la tarea suma a la racha diaria');
select is((public.answer_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  (select id from public.assigned_exercises where answer = 7), 7, null))->>'status',
  'duplicate', 'una tarea se responde una sola vez');
select is((public.answer_assignment('cccccccc-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000002',
  (select id from public.assigned_exercises where answer = 101), 101, null))->>'status',
  'not_found', 'otro tutor no responde tareas ajenas');

-- Responder libera cupo.
select is(public.create_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', '5 + 5', 10), 'ok', 'responder libera un cupo');

-- ===== 3. Borrar =====
select is(public.delete_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  (select id from public.assigned_exercises where answer = 7)), 'not_found',
  'una tarea respondida no se borra');
select is(public.delete_assignment('cccccccc-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000001',
  (select id from public.assigned_exercises where answer = 10)), 'not_found',
  'otro tutor no borra tareas ajenas');
select is(public.delete_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  (select id from public.assigned_exercises where answer = 10)), 'ok', 'el tutor borra una pendiente');
reset role;

-- ===== 4. RLS =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.assigned_exercises), 0, 'otro tutor no lee tareas ajenas');
select throws_ok($$ insert into public.assigned_exercises (student_id, tutor_id, text, answer)
  values ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', '1+1', 2) $$,
  '42501', null, 'un tutor no inserta directo (sin filtro)');
reset role;

-- ===== 5. Cascada =====
delete from public.students where id = 'dddddddd-0000-0000-0000-000000000001';
select is((select count(*)::int from public.assigned_exercises
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 0, 'al borrar el perfil se borran sus tareas');

select * from finish();
rollback;
