begin;
select plan(56);

-- UUIDs de prueba:
--   tutor A = aaaaaaaa-...-0001, alumno de A = a1000000-...-0001
--   tutor B = bbbbbbbb-...-0002, alumno de B = b1000000-...-0001
--   usuario anónimo de Auth = cccccccc-...-0003

-- Datos de prueba (como superusuario). El trigger crea las filas de tutors.
insert into auth.users (id, email, is_anonymous) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'tutor-a@test.invalid', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'tutor-b@test.invalid', false),
  ('cccccccc-0000-0000-0000-000000000003', null,                   true);

insert into public.students (id, tutor_id, nickname, grade) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ana',  1),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Beto', 3);

insert into public.consents (tutor_id, terms_version, privacy_version) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'tos-2026-10', 'pp-2026-10'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'tos-2026-10', 'pp-2026-10');

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

-- students: aislamiento
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Intruso', 2)$$,
  '42501', 'new row violates row-level security policy for table "students"', 'A no puede crear alumnos a nombre de B');
select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Luis', 2)$$,
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
  $$insert into public.students (tutor_id, nickname, grade, created_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pia', 1, '2000-01-01')$$,
  '42501', 'permission denied for table students', 'created_at no es escribible al insertar');

-- students: restricciones de datos
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pedro', 5)$$,
  '23514', 'new row for relation "students" violates check constraint "students_grade_range"', 'curso 5 es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pedro', 0)$$,
  '23514', 'new row for relation "students" violates check constraint "students_grade_range"', 'curso 0 es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pedro', null)$$,
  '23502', 'null value in column "grade" of relation "students" violates not-null constraint', 'curso nulo es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade) values ('aaaaaaaa-0000-0000-0000-000000000001', '   ', 1)$$,
  '23514', 'new row for relation "students" violates check constraint "students_nickname_len"', 'apodo en blanco es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade) values ('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 31), 1)$$,
  '23514', 'new row for relation "students" violates check constraint "students_nickname_len"', 'apodo de 31 caracteres es rechazado');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade) values ('aaaaaaaa-0000-0000-0000-000000000001', ' Ana', 1)$$,
  '23514', 'new row for relation "students" violates check constraint "students_nickname_len"', 'apodo con espacios al borde es rechazado');

-- consents
select lives_ok(
  $$insert into public.consents (tutor_id, terms_version, privacy_version) values ('aaaaaaaa-0000-0000-0000-000000000001', 'tos-2027-01', 'pp-2027-01')$$,
  'A puede registrar un nuevo consentimiento propio');
select throws_ok(
  $$insert into public.consents (tutor_id, terms_version, privacy_version) values ('bbbbbbbb-0000-0000-0000-000000000002', 'tos-2027-01', 'pp-2027-01')$$,
  '42501', 'new row violates row-level security policy for table "consents"', 'A no puede registrar consentimientos de B');
select throws_ok(
  $$insert into public.consents (tutor_id, terms_version, privacy_version) values ('aaaaaaaa-0000-0000-0000-000000000001', 'tos-2026-10', 'pp-2026-10')$$,
  '23505', null, 'el mismo consentimiento (mismas versiones) no se duplica');
select throws_ok(
  $$insert into public.consents (tutor_id, terms_version, privacy_version, accepted_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'tos-2028-01', 'pp-2028-01', '2000-01-01')$$,
  '42501', 'permission denied for table consents', 'el cliente no puede fijar accepted_at');
select throws_ok(
  $$update public.consents set terms_version = 'otra'$$,
  '42501', 'permission denied for table consents', 'consents es append-only: sin UPDATE');
select throws_ok(
  $$delete from public.consents$$,
  '42501', 'permission denied for table consents', 'consents es append-only: sin DELETE');
select throws_ok(
  $$insert into public.consents (tutor_id, terms_version, privacy_version) values ('aaaaaaaa-0000-0000-0000-000000000001', '', 'pp-2029-01')$$,
  '23514', 'new row for relation "consents" violates check constraint "consents_terms_version_len"', 'versión de términos vacía es rechazada');
select throws_ok(
  $$insert into public.consents (tutor_id, terms_version, privacy_version) values ('aaaaaaaa-0000-0000-0000-000000000001', 'tos-2029-01', repeat('p', 41))$$,
  '23514', 'new row for relation "consents" violates check constraint "consents_privacy_version_len"', 'versión de política de más de 40 caracteres es rechazada');

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
  $$insert into public.students (tutor_id, nickname, grade) values ('aaaaaaaa-0000-0000-0000-000000000001', 'X', 1)$$,
  '42501', 'permission denied for table students', 'anon no puede insertar en students');
select throws_ok($$update public.students set nickname = 'X'$$, '42501', 'permission denied for table students', 'anon no puede actualizar students');
select throws_ok($$delete from public.students$$,               '42501', 'permission denied for table students', 'anon no puede borrar students');
select throws_ok(
  $$insert into public.consents (tutor_id, terms_version, privacy_version) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'y')$$,
  '42501', 'permission denied for table consents', 'anon no puede insertar en consents');
select throws_ok($$update public.consents set terms_version = 'x'$$, '42501', 'permission denied for table consents', 'anon no puede actualizar consents');
select throws_ok($$delete from public.consents$$,                  '42501', 'permission denied for table consents', 'anon no puede borrar consents');
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
