begin;
select plan(9);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Borrar perfiles: el cliente ya no puede; solo el servidor (delete_student, tras el PIN).
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

-- Datos que deben irse con el perfil.
set local role service_role;
select 1 where public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), 'sumas_hasta_20', '1 + 1 = ?', true,
  (now() at time zone 'utc')::date, 1) is null;
select 1 where public.create_assignment('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', '2 + 2 = ?', 4) is null;
reset role;

-- ===== 1. El cliente no borra, ni siquiera sus propios perfiles =====
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$delete from public.students where id = 'dddddddd-0000-0000-0000-000000000001'$$,
  '42501', 'permission denied for table students', 'el tutor no borra directo su propio perfil');
select throws_ok(
  $$select public.delete_student('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001')$$,
  '42501', null, 'el cliente no puede llamar a delete_student');
reset role;

-- ===== 2. El servidor borra solo perfiles del tutor =====
set local role service_role;
select is(public.delete_student('cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001'),
  'not_found', 'un tutor no borra perfiles ajenos');
select is(public.delete_student('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001'),
  'ok', 'el tutor borra su perfil (vía servidor)');
select is(public.delete_student('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001'),
  'not_found', 'borrar dos veces no hace nada');
reset role;

-- ===== 3. Se va todo lo del perfil y se archiva la declaración =====
select is((select count(*)::int from public.students where id = 'dddddddd-0000-0000-0000-000000000001'), 0,
  'el perfil ya no existe');
select is((select count(*)::int from public.student_attempts where student_id = 'dddddddd-0000-0000-0000-000000000001')
  + (select count(*)::int from public.student_daily_streaks where student_id = 'dddddddd-0000-0000-0000-000000000001')
  + (select count(*)::int from public.assigned_exercises where student_id = 'dddddddd-0000-0000-0000-000000000001'),
  0, 'se borran intentos, racha y tareas');
select ok((select count(*) from public.declaration_evidence) >= 1, 'se archivó la declaración del adulto');
select is((select count(*)::int from public.students where id = 'dddddddd-0000-0000-0000-000000000002'), 1,
  'el perfil del otro tutor sigue intacto');

select * from finish();
rollback;
