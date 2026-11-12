begin;
select plan(22);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Diagnóstico inicial (CU-A2): columna activity, save_diagnostic, RLS y que el diagnóstico no
-- cuente para la racha ni para el bloque. Tutores: A=...0001 B=...0002 (prefijo cccccccc-0000-0000-0000-)

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

-- Los 6 intentos de un diagnóstico (2 por nivel), con `p_ok` aciertos al principio.
create function pg_temp.items(p_ok int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'exercise_id', gen_random_uuid(),
    'exercise', '2 + 3 = ?',
    'correct', i <= p_ok,
    'level', (i - 1) / 2 + 1) order by i)
  from generate_series(1, 6) i
$$;

create function pg_temp.save(p_tutor text, p_student text, p_topic text, p_level int, p_items jsonb)
returns text language sql as $$
  select public.save_diagnostic(p_tutor::uuid, p_student::uuid, p_topic, p_level, p_items)
$$;

-- ===== 1. Columna =====
select has_column('public', 'student_attempts', 'activity', 'existe student_attempts.activity');
select col_default_is('public', 'student_attempts', 'activity', 'practice'::text,
  'por defecto un intento es de práctica');

set local role service_role;
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), '1-07', '1 + 1 = ?', true,
  (now() at time zone 'utc')::date, 1), 'ok', 'una práctica se registra');
select is((select activity from public.student_attempts where topic = '1-07'), 'practice',
  'record_attempt guarda intentos de práctica');
select throws_ok($$ update public.student_attempts set activity = 'otra' where topic = '1-07' $$,
  '23514', null, 'activity solo acepta practice o diagnostic');

-- ===== 2. Guardar un diagnóstico =====
select is(pg_temp.save('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
  '1-06', 2, pg_temp.items(4)), 'ok', 'se guarda un diagnóstico completo');
select is((select count(*)::int from public.student_attempts
  where topic = '1-06' and activity = 'diagnostic'), 6, 'quedan los 6 intentos como diagnóstico');
select is((select array_agg(level::int order by level) from public.student_attempts where topic = '1-06'),
  array[1, 1, 2, 2, 3, 3], 'cada intento guarda el nivel con que se emitió');
select ok((select bool_and(duration_s is null) from public.student_attempts where topic = '1-06'),
  'el diagnóstico no guarda tiempos');
select is((select level::int from public.student_skill_progress where skill_code = '1-06'), 2,
  'la habilidad queda con el nivel de entrada');
select ok((select block_total = 0 and block_correct = 0 and mastered_at is null
  from public.student_skill_progress where skill_code = '1-06'),
  'bloque vacío y sin dominar');

-- La racha la puso la práctica de 1-07 (1 día); el diagnóstico no la toca.
select is((select current_len from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 1,
  'el diagnóstico no suma a la racha de días');

-- ===== 3. Solo antes de la primera práctica =====
select is(pg_temp.save('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
  '1-06', 3, pg_temp.items(6)), 'not_available', 'no se guarda un segundo diagnóstico');
select is(pg_temp.save('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
  '1-07', 3, pg_temp.items(6)), 'not_available', 'no hay diagnóstico si ya practicó la habilidad');
select is(pg_temp.save('cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
  '1-08', 3, pg_temp.items(6)), 'student_not_found', 'otro tutor no guarda en un perfil ajeno');
select throws_ok($$ select pg_temp.save('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', '1-08', 2, pg_temp.items(6) - 0) $$,
  '22023', null, 'una prueba sin los 6 ejercicios no se guarda');

-- ===== 4. El diagnóstico no llena el bloque de 10 =====
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), '1-06', '4 + 4 = ?', true, null, 2),
  'ok', 'practica en el nivel diagnosticado');
select is((select block_total::int from public.student_skill_progress where skill_code = '1-06'), 1,
  'el bloque cuenta solo la práctica (1), no los 6 del diagnóstico');
reset role;

-- ===== 5. Permisos y RLS =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.save_diagnostic('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', '1-09', 2, '[]'::jsonb) $$,
  '42501', null, 'la app no puede guardar un diagnóstico (solo el servidor)');
select throws_ok($$ insert into public.student_attempts
  (student_id, tutor_id, exercise_id, topic, exercise, correct, activity)
  values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
  gen_random_uuid(), '1-09', '1 + 1 = ?', true, 'diagnostic') $$,
  '42501', null, 'el tutor no escribe intentos directamente');
select is((select count(*)::int from public.student_attempts where activity = 'diagnostic'), 6,
  'el tutor dueño lee los intentos de diagnóstico de su perfil');

select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.student_attempts
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 0,
  'otro tutor no lee los intentos ajenos');
reset role;

select * from finish();
rollback;
