begin;
select plan(14);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- CU-A9: preferencia de recordatorio de racha. Columna, permisos, función solo para el servidor y
-- RLS (otro tutor no puede leer ni escribir). Tutores: A=...0001 B=...0002
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

-- ===== 1. Columna =====
select has_column('public', 'students', 'streak_reminder', 'existe streak_reminder');
select col_default_is('public', 'students', 'streak_reminder', 'false', 'desactivado por defecto');
select col_not_null('public', 'students', 'streak_reminder', 'nunca nulo');

-- ===== 2. Permisos =====
select ok(not has_column_privilege('authenticated', 'public.students', 'streak_reminder', 'update'),
  'el cliente no puede cambiarlo directo');
select ok(not has_function_privilege('authenticated',
  'public.set_streak_reminder(uuid, uuid, boolean)', 'execute'), 'authenticated no ejecuta la función');
select ok(not has_function_privilege('anon',
  'public.set_streak_reminder(uuid, uuid, boolean)', 'execute'), 'anon no ejecuta la función');
select ok(has_function_privilege('service_role',
  'public.set_streak_reminder(uuid, uuid, boolean)', 'execute'), 'service_role sí');

-- ===== 3. Función =====
select is(public.set_streak_reminder('eeeeeeee-0000-0000-0000-000000000001',
  'ffffffff-0000-0000-0000-000000000001', true), 'ok', 'el tutor lo activa en su perfil');
select is((select streak_reminder from public.students
           where id = 'ffffffff-0000-0000-0000-000000000001'), true, 'quedó activado');
select is(public.set_streak_reminder('eeeeeeee-0000-0000-0000-000000000002',
  'ffffffff-0000-0000-0000-000000000001', false), 'student_not_found', 'perfil ajeno: no se cambia');
select is((select streak_reminder from public.students
           where id = 'ffffffff-0000-0000-0000-000000000001'), true, 'sigue activado');
select throws_ok($$ select public.set_streak_reminder('eeeeeeee-0000-0000-0000-000000000001',
  'ffffffff-0000-0000-0000-000000000001', null) $$, '22023', 'invalid_streak_reminder', 'nulo: error');

-- ===== 4. RLS: otro tutor no lee ni escribe =====
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.students
           where id = 'ffffffff-0000-0000-0000-000000000001'), 0, 'otro tutor no ve el perfil ni su preferencia');
select throws_ok($$ update public.students set streak_reminder = true
                    where id = 'ffffffff-0000-0000-0000-000000000002' $$,
  '42501', null, 'ni el propio tutor puede escribirla directo (solo vía FastAPI con PIN)');
reset role;

select * from finish();
rollback;
