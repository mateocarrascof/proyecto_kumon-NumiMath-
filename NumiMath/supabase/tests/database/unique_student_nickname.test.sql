begin;
select plan(24);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Apodos únicos por tutor y curso (ADR 0005). Tutores A=...0001 y B=...0002.

insert into auth.users (id, email) values
  ('fa000000-0000-0000-0000-000000000001', 'a@test.invalid'),
  ('fa000000-0000-0000-0000-000000000002', 'b@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('fa100000-0000-0000-0000-000000000001', 'terms',             'tos-u', repeat('a', 64), true),
  ('fa100000-0000-0000-0000-000000000002', 'privacy',           'pp-u',  repeat('b', 64), true),
  ('fa100000-0000-0000-0000-000000000003', 'adult_declaration', 'ad-u',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('fa000000-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       'fa100000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

-- Tope de perfiles más alto para el tutor A: aquí se prueban varios apodos.
update public.tutors set max_students = 10 where id = 'fa000000-0000-0000-0000-000000000001';

-- ===== La función: IMMUTABLE, search_path fijo, sin extensiones =====
select is((select provolatile from pg_proc where oid = 'public.student_nickname_key(text)'::regprocedure),
  'i'::"char", 'student_nickname_key es IMMUTABLE');
select ok((select proconfig @> array['search_path=pg_catalog'] from pg_proc
           where oid = 'public.student_nickname_key(text)'::regprocedure),
  'student_nickname_key tiene search_path fijo');
select is((select count(*)::int from pg_depend d join pg_extension e on e.oid = d.refobjid
           where d.objid = 'public.student_nickname_key(text)'::regprocedure),
  0, 'student_nickname_key no depende de extensiones');
select has_index('public', 'students', 'students_tutor_grade_nickname_uk', 'existe el índice único');

-- ===== Normalización (también con mayúsculas acentuadas, por si el locale no las baja) =====
select is(public.student_nickname_key(' JUANITO  '), 'juanito', 'mayúsculas y espacios al borde');
select is(public.student_nickname_key('Juan   Pablo'), 'juan pablo', 'espacios repetidos por dentro');
select is(public.student_nickname_key('ÁNGEL'), public.student_nickname_key('angel'), 'ÁNGEL = angel');
select is(public.student_nickname_key('JUANÍTO'), public.student_nickname_key('juanito'), 'JUANÍTO = juanito');
select is(public.student_nickname_key('ÉÍÓÚÜ'), 'eiouu', 'É Í Ó Ú Ü mayúsculas sin tilde');
select isnt(public.student_nickname_key('Toño'), public.student_nickname_key('Tono'), 'Toño ≠ Tono (ñ distinta de n)');
select is(public.student_nickname_key('TOÑO'), public.student_nickname_key('toño'), 'TOÑO = toño');

-- ===== Altas =====
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('fb000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001', 'Juanito', 1, true);

select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fa000000-0000-0000-0000-000000000001', 'juanito', 1, true)$$,
  '23505', null, 'mismo tutor y curso: "juanito" choca con "Juanito"');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fa000000-0000-0000-0000-000000000001', 'JUANÍTO', 1, true)$$,
  '23505', null, 'mismo tutor y curso: "JUANÍTO" choca (tilde y mayúsculas)');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fa000000-0000-0000-0000-000000000001', 'Juanito  ', 1, true)$$,
  '23514', null, 'espacios al final: ya los rechaza students_nickname_len (la app recorta)');
select lives_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fa000000-0000-0000-0000-000000000001', 'Juanito', 2, true)$$,
  'mismo tutor, otro curso: se permite');
select lives_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fa000000-0000-0000-0000-000000000002', 'JUANITO', 1, true)$$,
  'otro tutor, mismo curso y apodo: se permite');

-- Ñ distinta de N en el mismo tutor y curso.
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('fb000000-0000-0000-0000-000000000003', 'fa000000-0000-0000-0000-000000000001', 'Toño', 3, true),
  ('fb000000-0000-0000-0000-000000000004', 'fa000000-0000-0000-0000-000000000001', 'Pepe', 1, true);
select lives_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fa000000-0000-0000-0000-000000000001', 'Tono', 3, true)$$,
  '"Tono" no choca con "Toño"');

-- ===== Como el tutor (rol authenticated, con RLS): alta, renombrar y cambiar de curso =====
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fa000000-0000-0000-0000-000000000001', ' Juan  Ito ', 1, true)$$,
  '23514', null, 'como tutor: espacios al borde los rechaza el check (la app los recorta antes)');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fa000000-0000-0000-0000-000000000001', 'JUANITO', 1, true)$$,
  '23505', 'duplicate key value violates unique constraint "students_tutor_grade_nickname_uk"',
  'como tutor: el error nombra el índice (la app lo traduce a un mensaje amable)');
select throws_ok($$update public.students set nickname = 'JUANITO'
  where id = 'fb000000-0000-0000-0000-000000000004'$$,
  '23505', null, 'renombrar "Pepe" (1°) a "JUANITO": choca con "Juanito" de 1°');
select throws_ok($$update public.students set nickname = 'tono'
  where id = 'fb000000-0000-0000-0000-000000000003'$$,
  '23505', null, 'renombrar "Toño" a "tono" en 3°: choca con "Tono"');
select throws_ok($$update public.students set grade = 1
  where nickname = 'Juanito' and grade = 2$$,
  '23505', null, 'cambiar de curso a uno donde ya está ese apodo: no');
select lives_ok($$update public.students set nickname = 'Juanito 2', grade = 1
  where nickname = 'Juanito' and grade = 2$$,
  'cambiar curso y apodo a la vez sin chocar: sí');
select is((select count(*)::int from public.students
           where public.student_nickname_key(nickname) = 'juanito'),
  1, 'el tutor A ve un solo "Juanito" (el de B no se ve ni influye en el error)');

reset role;
select * from finish();
rollback;
