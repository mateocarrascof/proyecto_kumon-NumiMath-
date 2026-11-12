begin;
select plan(19);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- CU-A21: intentos de juego. Restricciones, permisos, que un juego registre el intento y sume a la
-- racha SIN tocar el bloque ni el nivel, que la práctica siga igual, que la sincronización (CU-A13)
-- siga funcionando y RLS. Tutores: A=...0001 B=...0002 (prefijo eeeeeeee-0000-0000-0000-)

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'a@test.invalid'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'b@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('eeeeeeee-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Ana', 1, true);

create function pg_temp.game(n int, correct bool, kind text default 'mayor-1', lvl int default 1)
returns text language sql as $$
  select public.record_attempt(
    'eeeeeeee-0000-0000-0000-000000000001'::uuid, 'ffffffff-0000-0000-0000-000000000001'::uuid,
    ('aaaaaaaa-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '1-03', 'juego', correct,
    (now() at time zone 'utc')::date, lvl, 5, null, 'game', kind)
$$;

-- ===== 1. Columna y restricciones =====
select has_column('public', 'student_attempts', 'game_kind', 'existe game_kind');
select col_is_null('public', 'student_attempts', 'game_kind', 'game_kind admite nulo (fuera de juegos)');
select lives_ok($$ select pg_temp.game(1, true) $$, 'un intento de juego se registra');
select is((select activity || '|' || game_kind from public.student_attempts
           where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'game|mayor-1',
  'queda como game con el id del juego');
select throws_ok($$ select pg_temp.game(2, true, null) $$, '23514', null,
  'un juego sin game_kind no se acepta');
select throws_ok($$ select pg_temp.game(3, true, 'Juego Con Espacios') $$, '23514', null,
  'game_kind con formato raro no se acepta');
select throws_ok($$ insert into public.student_attempts
    (student_id, tutor_id, exercise_id, topic, exercise, correct, activity)
  values ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
          gen_random_uuid(), '1-03', 'x', true, 'otro') $$, '23514', null,
  'activity distinta de practice, diagnostic o game no se acepta');
select throws_ok($$ select public.record_attempt(
    'eeeeeeee-0000-0000-0000-000000000001'::uuid, 'ffffffff-0000-0000-0000-000000000001'::uuid,
    gen_random_uuid(), '1-03', 'x', true, null, 1, null, null, 'diagnostic', null) $$,
  '22023', 'invalid_activity', 'record_attempt solo acepta practice o game');

-- ===== 2. Juegos: suman a la racha, NO tocan bloque ni nivel =====
select is((select current_len from public.student_daily_streaks
           where student_id = 'ffffffff-0000-0000-0000-000000000001')::int, 1,
  'el juego suma a la racha diaria');
select is((select count(*)::int from public.student_skill_progress
           where student_id = 'ffffffff-0000-0000-0000-000000000001'), 0,
  'el juego no crea progreso de la habilidad');
-- 10 aciertos de juego seguidos: con la regla del bloque subirían de nivel; aquí no.
select lives_ok($$ select pg_temp.game(100 + g, true) from generate_series(1, 10) g $$, '10 aciertos de juego');
select is((select count(*)::int from public.student_skill_progress
           where student_id = 'ffffffff-0000-0000-0000-000000000001'), 0,
  'ni el bloque ni el nivel cambian con juegos');
select is(pg_temp.game(1, true), 'duplicate', 'el mismo ejercicio de juego no se registra dos veces');

-- ===== 3. La práctica sigue igual =====
select is(public.record_attempt('eeeeeeee-0000-0000-0000-000000000001'::uuid,
  'ffffffff-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000200'::uuid,
  '1-03', 'practica', true, null, 1, 5), 'ok', 'la práctica en línea (sin los parámetros nuevos)');
select is((select block_total from public.student_skill_progress
           where student_id = 'ffffffff-0000-0000-0000-000000000001' and skill_code = '1-03')::int, 1,
  'la práctica sí avanza el bloque');
select is((select activity from public.student_attempts
           where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000200'), 'practice',
  'y queda como practice, sin game_kind');

-- ===== 4. La sincronización sin conexión (CU-A13) sigue funcionando =====
select is(public.record_offline_attempts('eeeeeeee-0000-0000-0000-000000000001',
  'ffffffff-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object(
    'exercise_id', 'aaaaaaaa-0000-0000-0000-000000000300', 'topic', '1-03', 'exercise', 'x',
    'correct', true, 'level', 1, 'duration_s', 5, 'answered_at', now(), 'local_day', null)))
  -> 0 ->> 'status', 'ok', 'record_offline_attempts sigue usando record_attempt');

-- ===== 5. Permisos y RLS =====
select ok(not has_function_privilege('authenticated',
  'public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer, timestamptz, text, text)',
  'execute'), 'authenticated no ejecuta record_attempt');
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.student_attempts
           where student_id = 'ffffffff-0000-0000-0000-000000000001'), 0,
  'otro tutor no ve los intentos de juego');
reset role;

select * from finish();
rollback;
