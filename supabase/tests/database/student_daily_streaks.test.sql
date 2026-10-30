begin;
select plan(19);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Racha diaria: lógica en record_attempt, RLS por tutor, escritura solo del servidor.
-- Tutores: A=...0001 B=...0002  (prefijo cccccccc-0000-0000-0000-)
-- "hoy" = fecha UTC del servidor; la fecha local válida está entre hoy−1 y hoy+1.

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

-- ===== 1. Lógica de la racha =====
set local role service_role;

select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'sumas_hasta_20', '7 + 5', true,
  (now() at time zone 'utc')::date), 'ok', 'el primer intento del día se registra');
select is((select current_len from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 1, 'el primer día deja la racha en 1');

select 1 where public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'sumas_hasta_20', '1 + 1', false,
  (now() at time zone 'utc')::date) is null;
select is((select current_len from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 1, 'otro ejercicio el mismo día no suma');

-- Un día anterior al último no cambia nada (no se rellenan días perdidos).
select 1 where public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'sumas_hasta_20', '2 + 2', true,
  (now() at time zone 'utc')::date - 1) is null;
select is((select (current_len, last_day)::text from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000001'),
  (1, (now() at time zone 'utc')::date)::text, 'una fecha anterior al último día se ignora');
reset role;

-- Simula que la última práctica fue ayer: hoy suma 1.
update public.student_daily_streaks set current_len = 4, last_day = (now() at time zone 'utc')::date - 1
  where student_id = 'dddddddd-0000-0000-0000-000000000001';
set local role service_role;
select 1 where public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'sumas_hasta_20', '3 + 3', true,
  (now() at time zone 'utc')::date) is null;
select is((select current_len from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 5, 'practicar el día siguiente suma 1');
reset role;

-- Simula un hueco de dos días: la racha vuelve a 1.
update public.student_daily_streaks set current_len = 5, last_day = (now() at time zone 'utc')::date - 2
  where student_id = 'dddddddd-0000-0000-0000-000000000001';
set local role service_role;
select 1 where public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'sumas_hasta_20', '4 + 4', true,
  (now() at time zone 'utc')::date) is null;
select is((select current_len from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 1, 'saltarse un día reinicia la racha en 1');

-- Un intento repetido no suma aunque traiga un día nuevo.
select 1 where public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'sumas_hasta_20', '5 + 5', true,
  (now() at time zone 'utc')::date) is null;
reset role;
update public.student_daily_streaks set last_day = (now() at time zone 'utc')::date - 1
  where student_id = 'dddddddd-0000-0000-0000-000000000001';
set local role service_role;
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'sumas_hasta_20', '5 + 5', true,
  (now() at time zone 'utc')::date), 'duplicate', 'el intento repetido se rechaza');
select is((select (current_len, last_day)::text from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000001'),
  (1, (now() at time zone 'utc')::date - 1)::text, 'un intento repetido no mueve la racha');

-- Fechas fuera de rango o ausentes: el intento se registra y la racha no se crea.
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000002', gen_random_uuid(), 'sumas_hasta_20', '6 + 6', true,
  (now() at time zone 'utc')::date + 2), 'ok', 'una fecha fuera de rango no impide registrar el intento');
select 1 where public.record_attempt('cccccccc-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000002', gen_random_uuid(), 'sumas_hasta_20', '7 + 7', true,
  (now() at time zone 'utc')::date - 2) is null;
select 1 where public.record_attempt('cccccccc-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000002', gen_random_uuid(), 'sumas_hasta_20', '8 + 8', true) is null;
select is((select count(*) from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000002'), 0::bigint,
  'fechas fuera de ±1 día o ausentes no crean racha');

-- Un tutor no puede crear racha en el perfil de otro.
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000002', gen_random_uuid(), 'sumas_hasta_20', '9 + 9', true,
  (now() at time zone 'utc')::date), 'student_not_found', 'perfil ajeno rechazado');
select is((select count(*) from public.student_daily_streaks
  where student_id = 'dddddddd-0000-0000-0000-000000000002'), 0::bigint,
  'un perfil ajeno no recibe racha');

-- B practica hoy (para probar que A no la ve).
select 1 where public.record_attempt('cccccccc-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000002', gen_random_uuid(), 'sumas_hasta_20', '1 + 2', true,
  (now() at time zone 'utc')::date + 1) is null;
reset role;

-- ===== 2. RLS por tutor =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.student_daily_streaks), 1::bigint, 'A ve solo su racha');
select is((select count(*) from public.student_daily_streaks where tutor_id = 'cccccccc-0000-0000-0000-000000000002'),
  0::bigint, 'A no ve la racha de B');

select throws_ok(
  $$insert into public.student_daily_streaks (student_id, tutor_id, current_len, last_day)
    values ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 99, current_date)$$,
  '42501', 'permission denied for table student_daily_streaks', 'el cliente no puede crear rachas');
select throws_ok(
  $$update public.student_daily_streaks set current_len = 99$$,
  '42501', 'permission denied for table student_daily_streaks', 'el cliente no puede modificar su racha');
select throws_ok(
  $$delete from public.student_daily_streaks$$,
  '42501', 'permission denied for table student_daily_streaks', 'el cliente no puede borrar rachas');
reset role;

set local role anon;
select throws_ok($$select * from public.student_daily_streaks$$,
  '42501', 'permission denied for table student_daily_streaks', 'anon no puede leer rachas');
reset role;

-- ===== 3. Borrar el perfil borra su racha =====
delete from public.students where id = 'dddddddd-0000-0000-0000-000000000001';
select is((select count(*) from public.student_daily_streaks where student_id = 'dddddddd-0000-0000-0000-000000000001'),
  0::bigint, 'al borrar el perfil se borra su racha');

select * from finish();
rollback;
