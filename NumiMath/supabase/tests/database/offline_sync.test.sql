begin;
select plan(24);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- CU-A13: record_offline_attempts. Permisos, orden cronológico, duplicados (mismo lote o token ya
-- respondido en línea), hora y racha del dispositivo, perfil ajeno y RLS de lo registrado.
-- Tutores: A=...0001 B=...0002 (prefijo eeeeeeee-0000-0000-0000-)

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
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Ana', 2, true),
  ('ffffffff-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002', 'Beto', 2, true);

-- Un intento del lote: n = número (define el jti), minutos atrás, acierto, nivel y fecha local.
create function pg_temp.item(n int, minutes_ago int, correct bool, lvl int default 1,
                             local_day date default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'exercise_id', ('aaaaaaaa-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'topic', '2-06', 'exercise', n || ' + 1 = ?', 'correct', correct, 'level', lvl,
    'duration_s', 30, 'answered_at', now() - make_interval(mins => minutes_ago),
    'local_day', local_day)
$$;

create function pg_temp.sync(p_tutor text, p_student text, p_items jsonb)
returns jsonb language sql as $$
  select public.record_offline_attempts(p_tutor::uuid, p_student::uuid, p_items)
$$;

-- ===== 1. Permisos =====
select ok(not has_function_privilege('authenticated',
  'public.record_offline_attempts(uuid, uuid, jsonb)', 'execute'),
  'authenticated no puede ejecutar record_offline_attempts');
select ok(not has_function_privilege('anon',
  'public.record_offline_attempts(uuid, uuid, jsonb)', 'execute'),
  'anon no puede ejecutar record_offline_attempts');
select ok(has_function_privilege('service_role',
  'public.record_offline_attempts(uuid, uuid, jsonb)', 'execute'), 'service_role sí puede');

-- ===== 2. Orden cronológico =====
-- 10 aciertos en nivel 1 y luego 1 intento en nivel 2. Llegan DESORDENADOS: el de nivel 2 primero.
-- Si se aplicaran en el orden de llegada, el de nivel 2 no contaría (el progreso aún es nivel 1).
select is(
  jsonb_array_length(pg_temp.sync('eeeeeeee-0000-0000-0000-000000000001',
    'ffffffff-0000-0000-0000-000000000001',
    jsonb_build_array(pg_temp.item(11, 5, true, 2))
      || (select jsonb_agg(pg_temp.item(g, 100 - g, true, 1)) from generate_series(1, 10) g))),
  11, 'devuelve un resultado por intento');
select is((select level::int from public.student_skill_progress
           where student_id = 'ffffffff-0000-0000-0000-000000000001' and skill_code = '2-06'),
  2, 'aplicados en orden cronológico: 10 aciertos suben a nivel 2');
select is((select block_total::int from public.student_skill_progress
           where student_id = 'ffffffff-0000-0000-0000-000000000001' and skill_code = '2-06'),
  1, 'y el intento posterior de nivel 2 cuenta en el bloque nuevo');

-- ===== 3. Hora del dispositivo =====
select ok((select answered_at < now() - interval '90 minutes' from public.student_attempts
           where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'answered_at es la hora del intento, no la de la sincronización');
select ok((select answered_at <= now() from public.student_attempts
           where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000011'),
  'nunca queda en el futuro');

-- ===== 4. Duplicados: reenviar el mismo lote no cambia nada =====
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.sync(
     'eeeeeeee-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001',
     (select jsonb_agg(pg_temp.item(g, 100 - g, true, 1)) from generate_series(1, 11) g))) r
   where r ->> 'status' = 'duplicate'),
  11, 'reenviar el lote: todos duplicate');
select is((select count(*)::int from public.student_attempts
           where student_id = 'ffffffff-0000-0000-0000-000000000001'),
  11, 'sin filas nuevas');
select is((select block_total::int from public.student_skill_progress
           where student_id = 'ffffffff-0000-0000-0000-000000000001' and skill_code = '2-06'),
  1, 'el bloque no cambia');

-- Un token ya respondido en línea (mismo jti) no se puede volver a registrar como sin conexión.
select is(public.record_attempt('eeeeeeee-0000-0000-0000-000000000001'::uuid,
  'ffffffff-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000099'::uuid,
  '2-06', '99 + 1 = ?', true, null, 2, 10), 'ok', 'respondido en línea');
select is(pg_temp.sync('eeeeeeee-0000-0000-0000-000000000001',
  'ffffffff-0000-0000-0000-000000000001', jsonb_build_array(pg_temp.item(99, 1, true, 2)))
  -> 0 ->> 'status', 'duplicate', 'el mismo jti sin conexión es duplicate');

-- ===== 5. Racha por día local =====
select pg_temp.sync('eeeeeeee-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000002',
  jsonb_build_array(
    pg_temp.item(201, 3 * 1440, true, 1, (now() at time zone 'utc')::date - 3),
    pg_temp.item(202, 2 * 1440, true, 1, (now() at time zone 'utc')::date - 2),
    pg_temp.item(203, 1 * 1440, true, 1, (now() at time zone 'utc')::date - 1)));
select is((select current_len::int from public.student_daily_streaks
           where student_id = 'ffffffff-0000-0000-0000-000000000002'),
  3, 'tres días seguidos sin conexión: racha de 3');
-- Una fecha local que no calza con la hora del intento no mueve la racha.
select pg_temp.sync('eeeeeeee-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000002',
  jsonb_build_array(pg_temp.item(204, 10, true, 1, (now() at time zone 'utc')::date + 5)));
select is((select last_day from public.student_daily_streaks
           where student_id = 'ffffffff-0000-0000-0000-000000000002'),
  (now() at time zone 'utc')::date - 1, 'fecha local incoherente: la racha no cambia');

-- ===== 6. Perfil ajeno =====
select is(pg_temp.sync('eeeeeeee-0000-0000-0000-000000000002',
  'ffffffff-0000-0000-0000-000000000001', jsonb_build_array(pg_temp.item(300, 1, true))),
  to_jsonb('student_not_found'::text), 'perfil de otro tutor: student_not_found');
select is((select count(*)::int from public.student_attempts
           where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000300'),
  0, 'y no registra nada');

-- ===== 7. Tamaño del lote =====
select throws_ok(
  $$ select pg_temp.sync('eeeeeeee-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001',
       (select jsonb_agg(pg_temp.item(1000 + g, 1, true)) from generate_series(1, 101) g)) $$,
  '22023', 'offline_batch_too_large', 'más de 100 intentos: se rechaza');

-- ===== 7b. record_attempt con hora del intento (corrección de la revisión) =====
select ok(not has_function_privilege('authenticated',
  'public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer, timestamptz)',
  'execute'), 'authenticated no puede ejecutar record_attempt (firma nueva)');
select ok(has_function_privilege('service_role',
  'public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer, timestamptz)',
  'execute'), 'service_role sí puede');
select is(public.record_attempt('eeeeeeee-0000-0000-0000-000000000001'::uuid,
  'ffffffff-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000500'::uuid,
  '2-06', '5 + 1 = ?', true, null, 2, 10), 'ok', 'sin hora (práctica en línea) sigue funcionando');
select ok((select answered_at = now() from public.student_attempts
           where exercise_id = 'aaaaaaaa-0000-0000-0000-000000000500'),
  'sin hora usa now(), como antes');

-- ===== 8. RLS: lo registrado sin conexión sigue siendo solo del tutor =====
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.student_attempts
           where student_id = 'ffffffff-0000-0000-0000-000000000001'),
  0, 'otro tutor no ve los intentos sincronizados');
select is((select count(*)::int from public.student_skill_progress
           where student_id = 'ffffffff-0000-0000-0000-000000000001'),
  0, 'ni el progreso recalculado');
reset role;

select * from finish();
rollback;
