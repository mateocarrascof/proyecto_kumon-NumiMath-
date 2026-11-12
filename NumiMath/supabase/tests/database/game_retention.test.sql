begin;
select plan(11);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- CU-A21: plazo propio de 90 días para los intentos de juego. Borra solo juegos viejos; nunca
-- práctica ni diagnóstico, ni juegos recientes. Permisos, programación en pg_cron y alerta.
-- Tutor A=...0001 (prefijo eeeeeeee-0000-0000-0000-)

insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-000000000001', 'a@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
values ('eeeeeeee-0000-0000-0000-000000000001', 'grant',
        '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Ana', 1, true);

-- Un intento con la actividad y la antigüedad (en días) indicadas.
create function pg_temp.attempt(n int, act text, days_ago int) returns void language sql as $$
  insert into public.student_attempts
    (student_id, tutor_id, exercise_id, topic, exercise, correct, activity, game_kind, answered_at)
  values ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
          ('aaaaaaaa-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '1-03', 'x', true, act,
          case when act = 'game' then 'mayor-1' end, now() - make_interval(days => days_ago))
$$;

select pg_temp.attempt(1, 'game', 91);
select pg_temp.attempt(2, 'game', 120);
select pg_temp.attempt(3, 'game', 89);
select pg_temp.attempt(4, 'practice', 400);
select pg_temp.attempt(5, 'diagnostic', 400);

-- ===== 1. Permisos, índice y programación =====
select ok(not has_function_privilege('authenticated', 'public.purge_old_game_attempts()', 'execute'),
  'authenticated no puede purgar');
select ok(not has_function_privilege('anon', 'public.purge_old_game_attempts()', 'execute'),
  'anon no puede purgar');
select ok(has_function_privilege('service_role', 'public.purge_old_game_attempts()', 'execute'),
  'service_role sí');
select has_index('public', 'student_attempts', 'student_attempts_game_time_idx',
  'índice parcial de juegos por fecha');
select is((select command from cron.job where jobname = 'privacy-purge-games'),
  'select public.purge_old_game_attempts()', 'la purga de juegos está programada en pg_cron');

-- ===== 2. Purga =====
set local role service_role;
select is(public.purge_old_game_attempts(), 2, 'borra los 2 juegos de más de 90 días');
reset role;
select is((select count(*)::int from public.student_attempts
           where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 1,
  'el juego de hace 89 días se conserva');
select is((select count(*)::int from public.student_attempts
           where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000004'), 1,
  'la práctica antigua NO se toca');
select is((select count(*)::int from public.student_attempts
           where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000005'), 1,
  'el diagnóstico antiguo NO se toca');
set local role service_role;
select is(public.purge_old_game_attempts(), 0, 'volver a correrla no borra nada más');
select ok(exists (select 1 from public.privacy_job_warnings() w where w like '%privacy-purge-games%'),
  'la alerta de trabajos vigila la purga de juegos');
reset role;

select * from finish();
rollback;
