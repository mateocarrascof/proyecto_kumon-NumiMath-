begin;
select plan(20);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Correcciones de la revisión previa al PR: rol de administrador en la base, validación SQL de las
-- respuestas de una hoja, tope por perfil, límite diario y purga por lotes.
-- Tutor=...b1, perfil s1, docente=...b5 vinculado (texto que cubre las hojas), admin=...ad, degradado=...ae.

insert into auth.users (id, email, raw_app_meta_data) values
  ('b9000000-0000-0000-0000-0000000000b1', 't@test.invalid', '{}'),
  ('b9000000-0000-0000-0000-0000000000b5', 'x@test.invalid', '{"role":"teacher"}'),
  ('b9000000-0000-0000-0000-0000000000ad', 'ad@test.invalid', '{"role":"admin"}'),
  ('b9000000-0000-0000-0000-0000000000ae', 'ae@test.invalid', '{"role":"admin"}');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current, covers_sheets) values
  ('55555555-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true, false),
  ('55555555-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true, false),
  ('55555555-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true, false),
  ('55555555-0000-0000-0000-000000000011', 'teacher_authorization', 'doc-1', repeat('e', 64), true, true);
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('b9000000-0000-0000-0000-0000000000b1', 'grant',
   '55555555-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'web');
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('b9500000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-0000000000b1', 'Ana', 2, true);
insert into public.teachers (id, name, link_code) values
  ('b9000000-0000-0000-0000-0000000000b5', 'Docente X', 'XXXX2345');
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('b9000000-0000-0000-0000-0000000000b5', 'b9500000-0000-0000-0000-000000000001',
   'b9000000-0000-0000-0000-0000000000b1', '55555555-0000-0000-0000-000000000011', 'Docente X');

-- Un intento de práctica correcto para las pruebas de validación (e1) y otro para el tope (e2).
insert into public.student_attempts
  (student_id, tutor_id, exercise_id, topic, exercise, correct, answered_at, level, duration_s, activity) values
  ('b9500000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-0000000000b1', 'b9a00000-0000-0000-0000-000000000001', '2-01', '3/5 + 0', true, now(), 1, 8, 'practice'),
  ('b9500000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-0000000000b1', 'b9a00000-0000-0000-0000-000000000002', '2-01', '1 + 1', true, now(), 1, 8, 'practice');

-- El administrador degradado: el token que tenía todavía diría "admin", pero en la base ya no lo es.
update auth.users set raw_app_meta_data = '{}' where id = 'b9000000-0000-0000-0000-0000000000ae';

set local role service_role;

-- ===== 1. Rol de administrador en la base =====
select is(public.admin_is_admin('b9000000-0000-0000-0000-0000000000ad'), true, 'un administrador vigente lo es');
select is(public.admin_is_admin('b9000000-0000-0000-0000-0000000000ae'), false, 'un administrador al que se le quitó el rol ya no lo es');
select is(public.admin_is_admin('b9000000-0000-0000-0000-0000000000b5'), false, 'un docente no es administrador');
select is(public.admin_is_admin('b9000000-0000-0000-0000-0000000000b1'), false, 'un tutor tampoco');
select is(public.admin_is_admin('b9000000-0000-0000-0000-0000000000ff'), false, 'ni una cuenta que no existe');
select is((select count(*)::int from unnest(array['public.admin_is_admin(uuid)']) f
  where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')), 0,
  'ni anon ni authenticated ejecutan admin_is_admin');

-- ===== 2. Las respuestas de la hoja solo son un número o una fracción =====
select is(public.save_student_sheet('b9000000-0000-0000-0000-0000000000b1', 'b9500000-0000-0000-0000-000000000001',
  'b9a00000-0000-0000-0000-000000000001', 'me llamo Ana', true, '5', '[]'::jsonb), 'mismatch',
  'texto libre como respuesta del niño: se rechaza');
select is(public.save_student_sheet('b9000000-0000-0000-0000-0000000000b1', 'b9500000-0000-0000-0000-000000000001',
  'b9a00000-0000-0000-0000-000000000001', '12abc', true, '5', '[]'::jsonb), 'mismatch', 'un número con letras: se rechaza');
select is(public.save_student_sheet('b9000000-0000-0000-0000-0000000000b1', 'b9500000-0000-0000-0000-000000000001',
  'b9a00000-0000-0000-0000-000000000001', '1/2/3', true, '5', '[]'::jsonb), 'mismatch', 'dos barras: se rechaza');
select is(public.save_student_sheet('b9000000-0000-0000-0000-0000000000b1', 'b9500000-0000-0000-0000-000000000001',
  'b9a00000-0000-0000-0000-000000000001', null, true, '5', '[]'::jsonb), 'mismatch', 'sin respuesta: se rechaza');
select is(public.save_student_sheet('b9000000-0000-0000-0000-0000000000b1', 'b9500000-0000-0000-0000-000000000001',
  'b9a00000-0000-0000-0000-000000000001', '5', true, 'teléfono 9 1234 5678', '[]'::jsonb), 'mismatch',
  'texto libre como respuesta correcta: se rechaza');
select is((select count(*)::int from public.student_sheets), 0, 'y no se guardó nada');
select is(public.save_student_sheet('b9000000-0000-0000-0000-0000000000b1', 'b9500000-0000-0000-0000-000000000001',
  'b9a00000-0000-0000-0000-000000000001', '3/5', true, '3/5', '[]'::jsonb), 'ok', 'una fracción sí se guarda');

-- ===== 3. Límite diario por tutor y tope de hojas por perfil =====
select is((select value from public.app_settings where key = 'sheet_saves_per_day'), '100'::jsonb,
  'el límite diario por tutor es 100');
reset role;
-- 300 hojas ya guardadas del perfil (la primera es la más antigua); con la fracción de arriba son 301 y,
-- al guardar una nueva, debe quedar el tope de 300.
delete from public.student_sheets;
insert into public.student_sheets (student_id, tutor_id, exercise_id, topic, correct, content, saved_at)
select 'b9500000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-0000000000b1', gen_random_uuid(), '2-01', true,
       '{"statement":"x","child_answer":"1","correct_answer":"1","strokes":[]}', now() - make_interval(mins => n + 10)
from generate_series(1, 300) n;
set local role service_role;
select is(public.save_student_sheet('b9000000-0000-0000-0000-0000000000b1', 'b9500000-0000-0000-0000-000000000001',
  'b9a00000-0000-0000-0000-000000000002', '2', true, '2', '[]'::jsonb), 'ok', 'se guarda la hoja número 301');
select is((select count(*)::int from public.student_sheets where student_id = 'b9500000-0000-0000-0000-000000000001'), 300,
  'el perfil conserva solo 300 hojas');
select is((select count(*)::int from public.student_sheets where exercise_id = 'b9a00000-0000-0000-0000-000000000002'), 1,
  'la recién guardada se conserva');
select is((select min(saved_at) > now() - make_interval(mins => 310) from public.student_sheets
  where student_id = 'b9500000-0000-0000-0000-000000000001'), true, 'y se borró la más antigua');

-- ===== 4. Purga por lotes =====
reset role;
delete from public.student_sheets;
insert into public.student_sheets (student_id, tutor_id, exercise_id, topic, correct, content, saved_at)
select 'b9500000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-0000000000b1', gen_random_uuid(), '2-01', true,
       '{"statement":"x","child_answer":"1","correct_answer":"1","strokes":[]}', now() - interval '100 days'
from generate_series(1, 5005);
insert into public.student_sheets (student_id, tutor_id, exercise_id, topic, correct, content) values
  ('b9500000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-0000000000b1', gen_random_uuid(), '2-01', true,
   '{"statement":"x","child_answer":"1","correct_answer":"1","strokes":[]}');
set local role service_role;
select is(public.purge_expired_student_sheets(), 5005, 'la purga borra las 5005 vencidas (más de un lote de 5000)');
select is((select count(*)::int from public.student_sheets), 1, 'y conserva la reciente');

select * from finish();
rollback;
