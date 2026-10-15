begin;
select plan(45);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Migración de apoyo del servidor: authorize_student_use, consumo diario y PIN.
-- Tutores T1..T4 = cccc3333-0000-0000-0000-00000000000N
-- Perfiles: S1, S1b (T1) · S2 (T2) · S3 (T3, bloqueado y sin consentimiento activo)

insert into auth.users (id, email)
select ('cccc3333-0000-0000-0000-00000000000' || n)::uuid, 'c' || n || '@test.invalid'
from generate_series(1, 4) n;

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('cccc3333-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 4) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('d1000000-0000-0000-0000-000000000001', 'cccc3333-0000-0000-0000-000000000001', 'S1',  1, true),
  ('d1000000-0000-0000-0000-000000000002', 'cccc3333-0000-0000-0000-000000000001', 'S1b', 2, true),
  ('d2000000-0000-0000-0000-000000000001', 'cccc3333-0000-0000-0000-000000000002', 'S2',  3, true),
  ('d3000000-0000-0000-0000-000000000001', 'cccc3333-0000-0000-0000-000000000003', 'S3',  1, true);

-- T3: revoca (su perfil queda bloqueado y sin consentimiento activo).
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('cccc3333-0000-0000-0000-000000000003', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');

-- ===== 1. authorize_student_use =====
set local role service_role;
select is(public.authorize_student_use('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001'),
  'ok', 'un perfil propio, no bloqueado y con consentimiento activo se autoriza');
select is(public.authorize_student_use('cccc3333-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001'),
  'student_not_found', 'el perfil de otro tutor se trata como inexistente');
select is(public.authorize_student_use('cccc3333-0000-0000-0000-000000000001', gen_random_uuid()),
  'student_not_found', 'un perfil inexistente se rechaza');
select is(public.authorize_student_use('cccc3333-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000001'),
  'student_blocked', 'un perfil bloqueado se rechaza (antes que la falta de consentimiento)');
reset role;

select set_config('request.jwt.claims', '{"sub":"cccc3333-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.authorize_student_use('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001')$$,
  '42501', 'permission denied for function authorize_student_use', 'el cliente no ejecuta authorize_student_use');
select throws_ok(
  $$select public.consume_usage('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 1, 3, 5)$$,
  '42501', 'permission denied for function consume_usage', 'el cliente no ejecuta consume_usage');
reset role;

-- ===== 2. consume_usage =====
set local role service_role;
select is(public.consume_usage('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 1, 3, 5),
  'ok', 'la primera explicación consume cuota');
reset role;
select is(
  (select requests || '/' || cost_units from public.usage_student_daily where student_id = 'd1000000-0000-0000-0000-000000000001'),
  '1/1', 'el contador del perfil registra 1 petición y 1 unidad');
select is(
  (select requests || '/' || cost_units from public.usage_tutor_daily where tutor_id = 'cccc3333-0000-0000-0000-000000000001'),
  '1/1', 'el contador del tutor registra 1 petición y 1 unidad');

set local role service_role;
select lives_ok($$select public.consume_usage('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 1, 3, 5)$$,
  'la segunda explicación consume cuota');
select lives_ok($$select public.consume_usage('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 1, 3, 5)$$,
  'la tercera explicación consume cuota');
select is(public.consume_usage('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 1, 3, 5),
  'student_limit', 'la cuarta explicación supera el límite del perfil (3)');
reset role;
select is(
  (select cost_units from public.usage_student_daily where student_id = 'd1000000-0000-0000-0000-000000000001'),
  3, 'una petición rechazada no consume cuota');

set local role service_role;
select is(public.consume_usage('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 2, 3, 5),
  'ok', 'otro perfil del mismo tutor usa cuota propia, pero comparte la del tutor (3 + 2 = 5)');
select is(public.consume_usage('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 1, 3, 5),
  'tutor_limit', 'la cuota del tutor (5) se agota aunque el perfil tenga cupo');
reset role;

-- Crear y borrar perfiles no reinicia la cuota del tutor.
delete from public.students where id = 'd1000000-0000-0000-0000-000000000001';
select is(
  (select cost_units from public.usage_tutor_daily where tutor_id = 'cccc3333-0000-0000-0000-000000000001'),
  5, 'borrar un perfil conserva el consumo del tutor');
select is_empty($$select 1 from public.usage_student_daily where student_id = 'd1000000-0000-0000-0000-000000000001'$$,
  'el consumo del perfil borrado desaparece con él');

set local role service_role;
select is(public.consume_usage('cccc3333-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 1, 3, 5),
  'ok', 'la cuota de otro tutor es independiente');
select throws_ok(
  $$select public.consume_usage('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 0, 3, 5)$$,
  '22023', 'invalid_usage_parameters', 'un costo de 0 es inválido');
select throws_ok(
  $$select public.consume_usage('cccc3333-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 1, 3, 5)$$,
  'P0001', 'student_not_found', 'no se puede consumir cuota de un perfil ajeno');
reset role;
select is(
  (select cost_units from public.usage_student_daily where student_id = 'd2000000-0000-0000-0000-000000000001'),
  1, 'el intento con un perfil ajeno no tocó el consumo del dueño');
select is(
  (select cost_units from public.usage_tutor_daily where tutor_id = 'cccc3333-0000-0000-0000-000000000001'),
  5, 'ni el consumo del tutor que lo intentó');
select is(
  (select day from public.usage_student_daily where student_id = 'd1000000-0000-0000-0000-000000000002'),
  (now() at time zone 'America/Santiago')::date, 'el día se cuenta en hora de Chile');

-- ===== 3. RLS de las tablas de consumo =====
select set_config('request.jwt.claims', '{"sub":"cccc3333-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(distinct tutor_id) from public.usage_student_daily),
  array['cccc3333-0000-0000-0000-000000000001']::uuid[], 'T1 ve solo el consumo de sus perfiles');
select is((select array_agg(distinct tutor_id) from public.usage_tutor_daily),
  array['cccc3333-0000-0000-0000-000000000001']::uuid[], 'T1 ve solo el consumo de su cuenta');
select throws_ok(
  $$insert into public.usage_tutor_daily (tutor_id, day) values ('cccc3333-0000-0000-0000-000000000001', current_date + 1)$$,
  '42501', 'permission denied for table usage_tutor_daily', 'el cliente no escribe consumo');
select throws_ok($$update public.usage_tutor_daily set cost_units = 0$$,
  '42501', 'permission denied for table usage_tutor_daily', 'el cliente no puede reiniciar su cuota');
select throws_ok($$delete from public.usage_student_daily$$,
  '42501', 'permission denied for table usage_student_daily', 'el cliente no borra consumo');
reset role;
set local role anon;
select throws_ok($$select * from public.usage_tutor_daily$$,
  '42501', 'permission denied for table usage_tutor_daily', 'anon no lee el consumo');
reset role;

-- ===== 4. PIN y bloqueo por intentos =====
set local role service_role;
select lives_ok($$select public.set_tutor_pin('cccc3333-0000-0000-0000-000000000001', repeat('h', 40))$$,
  'el servidor fija el hash del PIN');
select is((select pin_hash from public.get_tutor_pin_state('cccc3333-0000-0000-0000-000000000001')),
  repeat('h', 40), 'el servidor lee el hash para verificar');
select is((select locked_until from public.register_pin_attempt('cccc3333-0000-0000-0000-000000000001', false)),
  null::timestamptz, 'un primer fallo no bloquea');
select lives_ok($$select * from public.register_pin_attempt('cccc3333-0000-0000-0000-000000000001', false)$$,
  'segundo fallo de PIN');
select lives_ok($$select * from public.register_pin_attempt('cccc3333-0000-0000-0000-000000000001', false)$$,
  'tercer fallo de PIN');
select is((select failed_attempts from public.register_pin_attempt('cccc3333-0000-0000-0000-000000000001', false)),
  4::smallint, 'cuatro fallos seguidos se cuentan');
select ok((select locked_until > now() from public.register_pin_attempt('cccc3333-0000-0000-0000-000000000001', false)),
  'el quinto fallo bloquea por 15 minutos');
select ok((select locked_until > now() from public.register_pin_attempt('cccc3333-0000-0000-0000-000000000001', true)),
  'un acierto durante el bloqueo no lo levanta');
reset role;

update public.tutor_pins set locked_until = now() - interval '1 minute'
 where tutor_id = 'cccc3333-0000-0000-0000-000000000001';
set local role service_role;
select is((select failed_attempts from public.register_pin_attempt('cccc3333-0000-0000-0000-000000000001', false)),
  1::smallint, 'vencido el bloqueo, un fallo vuelve a contar desde 1');
select is((select failed_attempts from public.register_pin_attempt('cccc3333-0000-0000-0000-000000000001', true)),
  0::smallint, 'un acierto reinicia los intentos');
select throws_ok($$select * from public.register_pin_attempt('cccc3333-0000-0000-0000-000000000002', false)$$,
  'P0001', 'pin_not_set', 'sin PIN configurado no hay intentos que registrar');
reset role;

select set_config('request.jwt.claims', '{"sub":"cccc3333-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.tutor_pins$$,
  '42501', 'permission denied for table tutor_pins', 'ningún cliente (ni otro tutor) lee los PIN');
reset role;

-- ===== 5. Limpieza del consumo y trabajos =====
insert into public.usage_tutor_daily (tutor_id, day, requests, cost_units) values
  ('cccc3333-0000-0000-0000-000000000004', (now() at time zone 'America/Santiago')::date - 40, 1, 1),
  ('cccc3333-0000-0000-0000-000000000004', (now() at time zone 'America/Santiago')::date - 10, 1, 1);
set local role service_role;
select is(public.purge_old_usage(), 1, 'la limpieza elimina solo el consumo de hace más de 35 días');
select is((select count(*) from public.privacy_job_warnings()), 4::bigint,
  'privacy_job_warnings vigila también el trabajo de limpieza del consumo');
reset role;
select is((select count(*) from cron.job where jobname = 'privacy-purge-usage'), 1::bigint,
  'la limpieza del consumo está programada en pg_cron');

-- ===== 6. Cambiar la versión vigente quita la autorización =====
update public.legal_document_versions set is_current = false where id = '11111111-0000-0000-0000-000000000001';
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000004', 'terms', 'tos-2', repeat('d', 64), true);
set local role service_role;
select is(public.authorize_student_use('cccc3333-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'),
  'consent_required', 'al cambiar la versión de los términos se exige aceptar la nueva');
reset role;

select * from finish();
rollback;
