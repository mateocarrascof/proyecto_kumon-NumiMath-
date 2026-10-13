begin;
select plan(14);

-- Lote 2, paso 2: tope de alumnos por tutor (5 por defecto, los bloqueados cuentan)
-- y clave única (id, tutor_id).
-- UUIDs: tutor A = aaaaaaaa-...-0001, tutor B = bbbbbbbb-...-0002, tutor D = dddddddd-...-0004

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test.invalid'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test.invalid'),
  ('dddddddd-0000-0000-0000-000000000004', 'd@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select t, 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from unnest(array[
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000004']::uuid[]) as t;

-- A parte con 4 alumnos; B con 1.
insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'Alumno' || g, 1, true from generate_series(1, 4) g;
insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Beto', 2, true);

-- ===== Tope por defecto =====
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Quinto', 1, true)$$,
  'el quinto alumno (límite por defecto) se crea');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Sexto', 1, true)$$,
  'P0001', 'student_limit_reached', 'el sexto alumno es rechazado');

-- ===== Los bloqueados cuentan =====
reset role;
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'grant',  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Otro', 1, true)$$,
  'P0001', 'student_limit_reached', 'los perfiles bloqueados cuentan para el tope');

-- ===== Borrar libera cupo =====
select lives_ok(
  $$delete from public.students where tutor_id = 'aaaaaaaa-0000-0000-0000-000000000001' and nickname = 'Alumno1'$$,
  'A borra un perfil (aunque esté bloqueado)');
select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Reemplazo', 1, true)$$,
  'al borrar uno queda cupo para crear otro');

-- ===== El cliente no puede cambiar su propio tope =====
select throws_ok(
  $$update public.tutors set max_students = 20$$,
  '42501', 'permission denied for table tutors', 'el cliente no puede cambiar max_students');
reset role;

-- ===== Rango del tope =====
select throws_ok(
  $$update public.tutors set max_students = 21 where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', 'new row for relation "tutors" violates check constraint "tutors_max_students_range"', 'max_students > 20 es rechazado');
select throws_ok(
  $$update public.tutors set max_students = 0 where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514', 'new row for relation "tutors" violates check constraint "tutors_max_students_range"', 'max_students = 0 es rechazado');

-- ===== Tope distinto para un tutor (lo fija el servidor) =====
update public.tutors set max_students = 2 where id = 'dddddddd-0000-0000-0000-000000000004';

select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('dddddddd-0000-0000-0000-000000000004', 'D1', 1, true)$$,
  'tutor con tope 2: primer alumno');
select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('dddddddd-0000-0000-0000-000000000004', 'D2', 1, true)$$,
  'tutor con tope 2: segundo alumno');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('dddddddd-0000-0000-0000-000000000004', 'D3', 1, true)$$,
  'P0001', 'student_limit_reached', 'tutor con tope 2: el tercero es rechazado');
reset role;

-- ===== El tope de un tutor no afecta a otro =====
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Bea', 1, true)$$,
  'el tope lleno de A no afecta a B');
reset role;

-- ===== Clave (id, tutor_id) y FK compuesta =====
select ok(
  exists (select 1 from pg_constraint
           where conrelid = 'public.students'::regclass
             and conname = 'students_id_tutor_uk' and contype = 'u'),
  'existe la clave única (id, tutor_id) en students');

create table public.zz_child_probe (
  student_id uuid not null,
  tutor_id   uuid not null,
  foreign key (student_id, tutor_id) references public.students (id, tutor_id)
);
select throws_ok(
  $$insert into public.zz_child_probe (student_id, tutor_id)
    select id, 'bbbbbbbb-0000-0000-0000-000000000002'
    from public.students where nickname = 'Alumno2'$$,
  '23503', 'insert or update on table "zz_child_probe" violates foreign key constraint "zz_child_probe_student_id_tutor_id_fkey"', 'la FK compuesta impide ligar un alumno de A con el tutor B');

select * from finish();
rollback;
