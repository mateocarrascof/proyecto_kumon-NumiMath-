begin;
select plan(54);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- UUIDs de prueba:
--   tutor A = aaaaaaaa-...-0001, alumno de A = a1000000-...-0001
--   tutor B = bbbbbbbb-...-0002, alumno de B = b1000000-...-0001
--   usuario anónimo de Auth = cccccccc-...-0003
--   versiones legales vigentes: 1111...0001 (términos), ...0002 (privacidad), ...0003 (declaración)

-- Datos de prueba (como superusuario). El trigger crea las filas de tutors.
insert into auth.users (id, email, is_anonymous) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'tutor-a@test.invalid', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'tutor-b@test.invalid', false),
  ('cccccccc-0000-0000-0000-000000000003', null,                   true);

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ana',  1, true),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Beto', 3, true);

-- ===== Estructura y trigger (como superusuario) =====
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.tutors'::regclass),   'tutors: RLS activada y forzada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.students'::regclass), 'students: RLS activada y forzada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.consents'::regclass), 'consents: RLS activada y forzada');

select is(
  (select array_agg(id order by id) from public.tutors
    where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')),
  array['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002']::uuid[],
  'el trigger crea un perfil de tutor por cada usuario de Auth');
select is_empty(
  $$select 1 from public.tutors where id = 'cccccccc-0000-0000-0000-000000000003'$$,
  'el trigger no crea tutor para usuarios anónimos');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.handle_new_tutor()'::regprocedure),
  'handle_new_tutor es security definer con search_path vacío');

-- ===== Actuando como tutor A =====
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is((select array_agg(id) from public.tutors),
  array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[], 'A ve solo su propio perfil de tutor');
select is((select array_agg(id) from public.students),
  array['a1000000-0000-0000-0000-000000000001']::uuid[], 'A ve solo su alumno');
select is_empty($$select 1 from public.students where tutor_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, 'A no ve alumnos de B');
select is_empty($$select 1 from public.consents where tutor_id <> 'aaaaaaaa-0000-0000-0000-000000000001'$$, 'A no ve consentimientos de otros tutores');

-- students: aislamiento (la compuerta de consentimiento lo detiene antes que RLS)
-- El trigger rechaza de forma determinista al cliente que actúa a nombre de otro tutor.
-- (La política RLS, como defensa en profundidad, se prueba aparte en lote_a.test.sql.)
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Intruso', 2, true)$$,
  '42501', 'tutor_mismatch', 'A no puede crear alumnos a nombre de B');
select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Luis', 2, true)$$,
  'A puede crear su propio alumno');
select lives_ok(
  $$update public.students set nickname = 'Anita' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'A puede editar apodo de su propio alumno');
select is((select nickname from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  'Anita', 'la edición propia quedó aplicada');
select is_empty(
  $$update public.students set nickname = 'Hack' where id = 'b1000000-0000-0000-0000-000000000001' returning 1$$,
  'A no puede modificar alumnos de B');
select is_empty(
  $$delete from public.students where id = 'b1000000-0000-0000-0000-000000000001' returning 1$$,
  'A no puede borrar alumnos de B');
select throws_ok(
  $$update public.students set tutor_id = 'bbbbbbbb-0000-0000-0000-000000000002' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '42501', 'permission denied for table students', 'A no puede traspasar su alumno (tutor_id no es actualizable)');

-- students: columnas del servidor
select throws_ok(
  $$update public.students set created_at = now() where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '42501', 'permission denied for table students', 'created_at no es actualizable por el cliente');
select throws_ok(
  $$update public.students set id = gen_random_uuid() where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '42501', 'permission denied for table students', 'id no es actualizable por el cliente');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted, created_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pia', 1, true, '2000-01-01')$$,
  '42501', 'permission denied for table students', 'created_at no es escribible al insertar');

-- students: restricciones de datos
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pedro', 5, true)$$,
  '23514', 'new row for relation "students" violates check constraint "students_grade_range"', 'curso 5 es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pedro', 0, true)$$,
  '23514', 'new row for relation "students" violates check constraint "students_grade_range"', 'curso 0 es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pedro', null, true)$$,
  '23502', 'null value in column "grade" of relation "students" violates not-null constraint', 'curso nulo es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', '   ', 1, true)$$,
  '23514', 'new row for relation "students" violates check constraint "students_nickname_len"', 'apodo en blanco es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 31), 1, true)$$,
  '23514', 'new row for relation "students" violates check constraint "students_nickname_len"', 'apodo de 31 caracteres es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', ' Ana', 1, true)$$,
  '23514', 'new row for relation "students" violates check constraint "students_nickname_len"', 'apodo con espacios al borde es rechazado');

-- consents (registro de eventos)
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('aaaaaaaa-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'ios')$$,
  'P0001', 'consent_event_redundant', 'un grant repetido sobre las mismas versiones es rechazado');
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('bbbbbbbb-0000-0000-0000-000000000002', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  '42501', 'tutor_mismatch', 'A no puede registrar consentimientos de B');
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel, occurred_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web', '2000-01-01')$$,
  '42501', 'permission denied for table consents', 'el cliente no puede fijar occurred_at');
select throws_ok(
  $$update public.consents set channel = 'web'$$,
  '42501', 'permission denied for table consents', 'consents es append-only: sin UPDATE');
select throws_ok(
  $$delete from public.consents$$,
  '42501', 'permission denied for table consents', 'consents es append-only: sin DELETE');

-- tutors: solo lectura para el cliente
select throws_ok(
  $$insert into public.tutors (id) values (gen_random_uuid())$$,
  '42501', 'permission denied for table tutors', 'authenticated no puede insertar en tutors');
select throws_ok(
  $$update public.tutors set created_at = now()$$,
  '42501', 'permission denied for table tutors', 'authenticated no puede actualizar tutors');
select throws_ok(
  $$delete from public.tutors$$,
  '42501', 'permission denied for table tutors', 'authenticated no puede borrar tutors');

-- función del trigger no invocable por el cliente
select throws_ok(
  $$select public.handle_new_tutor()$$,
  '42501', 'permission denied for function handle_new_tutor', 'authenticated no puede ejecutar handle_new_tutor');

-- ===== Verificación como superusuario: nada de B cambió =====
reset role;
select is((select nickname from public.students where id = 'b1000000-0000-0000-0000-000000000001'),
  'Beto', 'el alumno de B sigue intacto tras los intentos de A');
select is_empty($$select 1 from public.students where nickname = 'Intruso'$$,
  'el alumno "Intruso" no llegó a insertarse');

-- ===== Actuando como tutor B (simetría) =====
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is((select array_agg(id) from public.tutors),
  array['bbbbbbbb-0000-0000-0000-000000000002']::uuid[], 'B ve solo su propio perfil de tutor');
select is_empty($$select 1 from public.students where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 'B no ve alumnos de A');
select is_empty($$select 1 from public.consents where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 'B no ve consentimientos de A');

-- ===== Actuando como anónimo =====
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok($$select * from public.students$$, '42501', 'permission denied for table students', 'anon no puede leer students');
select throws_ok($$select * from public.consents$$, '42501', 'permission denied for table consents', 'anon no puede leer consents');
select throws_ok($$select * from public.tutors$$,   '42501', 'permission denied for table tutors',   'anon no puede leer tutors');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'X', 1, true)$$,
  '42501', 'permission denied for table students', 'anon no puede insertar en students');
select throws_ok($$update public.students set nickname = 'X'$$, '42501', 'permission denied for table students', 'anon no puede actualizar students');
select throws_ok($$delete from public.students$$,               '42501', 'permission denied for table students', 'anon no puede borrar students');
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002')$$,
  '42501', 'permission denied for table consents', 'anon no puede insertar en consents');
select throws_ok($$update public.consents set channel = 'web'$$, '42501', 'permission denied for table consents', 'anon no puede actualizar consents');
select throws_ok($$delete from public.consents$$,                 '42501', 'permission denied for table consents', 'anon no puede borrar consents');
select throws_ok($$select public.handle_new_tutor()$$, '42501', 'permission denied for function handle_new_tutor', 'anon no puede ejecutar handle_new_tutor');

-- ===== Cascada de supresión (como superusuario) =====
reset role;
delete from auth.users where id = 'bbbbbbbb-0000-0000-0000-000000000002';

select is_empty($$select 1 from public.tutors   where id       = 'bbbbbbbb-0000-0000-0000-000000000002'$$, 'borrar la cuenta elimina el tutor');
select is_empty($$select 1 from public.students where tutor_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, 'borrar la cuenta elimina sus alumnos');
select is_empty($$select 1 from public.consents where tutor_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, 'borrar la cuenta elimina sus consentimientos');
select is((select count(*) from public.students where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2::bigint, 'la supresión de B no toca los alumnos de A');

select * from finish();
rollback;
