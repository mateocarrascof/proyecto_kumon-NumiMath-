begin;
select plan(17);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- CU-A12: límite de descargas del lote sin conexión (consume_offline_batch), RLS de la fila de
-- uso y que otro tutor no pueda leer ni escribir. Tutores: A=...0001 B=...0002
-- (prefijo eeeeeeee-0000-0000-0000-)

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
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Ana', 1, true),
  ('ffffffff-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002', 'Beto', 1, true);

create function pg_temp.take(p_tutor text, p_student text, p_limit int default 5)
returns text language sql as $$
  select public.consume_offline_batch(p_tutor::uuid, p_student::uuid, p_limit)
$$;

-- ===== 1. Columna y permisos =====
select has_column('public', 'usage_student_daily', 'offline_batches', 'existe offline_batches');
select col_default_is('public', 'usage_student_daily', 'offline_batches', 0, 'parte en 0');
select ok(not has_function_privilege('authenticated',
  'public.consume_offline_batch(uuid, uuid, integer)', 'execute'),
  'authenticated no puede ejecutar consume_offline_batch');
select ok(not has_function_privilege('anon',
  'public.consume_offline_batch(uuid, uuid, integer)', 'execute'),
  'anon no puede ejecutar consume_offline_batch');
select ok(has_function_privilege('service_role',
  'public.consume_offline_batch(uuid, uuid, integer)', 'execute'),
  'service_role sí puede');

-- ===== 2. Límite diario =====
set local role service_role;
select is(pg_temp.take('eeeeeeee-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001'),
  'ok', 'primera descarga');
select is((select count(*)::int from (
  select pg_temp.take('eeeeeeee-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001') r
  from generate_series(2, 5)) s where r = 'ok'), 4, 'descargas 2 a 5 aceptadas');
select is((select offline_batches from public.usage_student_daily
  where student_id = 'ffffffff-0000-0000-0000-000000000001'), 5, 'cuenta 5 descargas');
select is(pg_temp.take('eeeeeeee-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001'),
  'limit', 'la sexta del día se rechaza');
select is((select offline_batches from public.usage_student_daily
  where student_id = 'ffffffff-0000-0000-0000-000000000001'), 5, 'al rechazar no se registra nada');
select is((select cost_units from public.usage_student_daily
  where student_id = 'ffffffff-0000-0000-0000-000000000001'), 0,
  'no gasta la cuota de explicaciones de la IA');
select throws_ok($$ select pg_temp.take('eeeeeeee-0000-0000-0000-000000000001',
  'ffffffff-0000-0000-0000-000000000001', 0) $$, '22023', null, 'límite inválido');

-- ===== 3. Perfil ajeno =====
select is(pg_temp.take('eeeeeeee-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001'),
  'student_not_found', 'B no puede descargar con el perfil de A');
select is(pg_temp.take('eeeeeeee-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000002'),
  'ok', 'B sí con su propio perfil (el límite es por perfil)');
reset role;

-- ===== 4. RLS: otro tutor no lee ni escribe =====
set local role authenticated;
set local request.jwt.claims = '{"sub": "eeeeeeee-0000-0000-0000-000000000002", "role": "authenticated"}';
select is((select count(*)::int from public.usage_student_daily
  where student_id = 'ffffffff-0000-0000-0000-000000000001'), 0, 'B no ve el uso del perfil de A');
select throws_ok($$ update public.usage_student_daily set offline_batches = 0
  where student_id = 'ffffffff-0000-0000-0000-000000000001' $$, '42501', null,
  'B no puede reiniciar el contador de A');
set local request.jwt.claims = '{"sub": "eeeeeeee-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok($$ update public.usage_student_daily set offline_batches = 0 $$, '42501', null,
  'ni el propio tutor puede reiniciar su contador desde el cliente');
reset role;

select * from finish();
rollback;
