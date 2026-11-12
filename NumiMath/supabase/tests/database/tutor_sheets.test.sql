begin;
select plan(32);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- T27: el tutor ve y borra las hojas de su hijo. Tutor A=...f1 con perfiles s1 (Ana) y s2 (Beto); tutor B=...f2
-- con s3 (Cami). Docente X=...f5 vinculado a s1 con un texto que describe las hojas.

insert into auth.users (id, email, raw_app_meta_data) values
  ('f1000000-0000-0000-0000-0000000000f1', 'a@test.invalid', '{}'),
  ('f1000000-0000-0000-0000-0000000000f2', 'b@test.invalid', '{}'),
  ('f1000000-0000-0000-0000-0000000000f5', 'x@test.invalid', '{"role":"teacher"}');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current, covers_sheets) values
  ('33333333-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true, false),
  ('33333333-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true, false),
  ('33333333-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true, false),
  ('33333333-0000-0000-0000-000000000011', 'teacher_authorization', 'doc-1', repeat('e', 64), true, true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('f1000000-0000-0000-0000-0000000000f' || n)::uuid, 'grant',
       '33333333-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('f5000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000f1', 'Ana',  2, true),
  ('f5000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-0000000000f1', 'Beto', 3, true),
  ('f5000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-0000000000f2', 'Cami', 1, true);

insert into public.teachers (id, name, link_code) values
  ('f1000000-0000-0000-0000-0000000000f5', 'Docente X', 'XXXX2345');
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('f1000000-0000-0000-0000-0000000000f5', 'f5000000-0000-0000-0000-000000000001',
   'f1000000-0000-0000-0000-0000000000f1', '33333333-0000-0000-0000-000000000011', 'Docente X');

-- Hojas: dos de Ana (una de la app, una tarea del tutor), una de Beto y una de Cami.
insert into public.student_sheets (id, student_id, tutor_id, exercise_id, topic, correct, content, saved_at) values
  ('66666666-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000f1',
   gen_random_uuid(), '2-01', false, '{"statement":"7 + 5","child_answer":"11","correct_answer":"12","strokes":[{"eraser":false,"color":"#2b2d42","width":4,"points":[[1,1],[2,2]]}]}', now() + interval '1 minute'),
  ('66666666-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000f1',
   gen_random_uuid(), 'tarea_tutor', true, '{"statement":"Tarea del tutor","child_answer":"3","correct_answer":"3","strokes":[]}', now() + interval '2 minutes'),
  ('66666666-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-0000000000f1',
   gen_random_uuid(), '2-02', true, '{"statement":"9 - 4","child_answer":"5","correct_answer":"5","strokes":[]}', now() + interval '3 minutes'),
  ('66666666-0000-0000-0000-000000000004', 'f5000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-0000000000f2',
   gen_random_uuid(), '1-01', true, '{"statement":"1 + 1","child_answer":"2","correct_answer":"2","strokes":[]}', now() + interval '4 minutes');

set local role service_role;

-- ===== listar =====
select is(public.list_student_sheets('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 0, 30) -> 'total',
  '2'::jsonb, 'el tutor ve el total de hojas del perfil');
select is((select jsonb_agg(i ->> 'id') from jsonb_array_elements(public.list_student_sheets(
  'f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 0, 30) -> 'items') i),
  '["66666666-0000-0000-0000-000000000002", "66666666-0000-0000-0000-000000000001"]'::jsonb,
  'de la más reciente a la más antigua');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(i) k from jsonb_array_elements(
  public.list_student_sheets('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 0, 30) -> 'items') i) keys),
  array['correct', 'id', 'saved_at', 'statement', 'topic'], 'la lista trae habilidad, ejercicio, resultado y fecha-hora, sin trazos');
select is((public.list_student_sheets('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 0, 30)
  -> 'items' -> 1 ->> 'statement'), '7 + 5', 'el ejercicio generado por la app se ve');
select is((public.list_student_sheets('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 0, 30)
  -> 'items' -> 0 ->> 'statement'), 'Tarea del tutor', 'de las tareas del tutor solo "Tarea del tutor"');
select is(public.list_student_sheets('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 0, 1) -> 'has_more',
  'true'::jsonb, 'paginado: con límite 1 hay más');
select is(public.list_student_sheets('f1000000-0000-0000-0000-0000000000f2', 'f5000000-0000-0000-0000-000000000001', 0, 30), null,
  'otro tutor no lista las hojas de un perfil ajeno');
select is(public.list_student_sheets('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-0000000000ff', 0, 30), null,
  'ni de un perfil que no existe (mismo resultado)');

-- ===== ver una =====
select is((public.get_student_sheet('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001') -> 'content' ->> 'child_answer'), '11', 'el tutor abre una hoja con su contenido');
select is(jsonb_array_length(public.get_student_sheet('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001') -> 'content' -> 'strokes'), 1, 'con sus trazos');
select is(public.get_student_sheet('f1000000-0000-0000-0000-0000000000f2', 'f5000000-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001'), null, 'otro tutor no la abre ni sabiendo su id');
select is(public.get_student_sheet('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000002',
  '66666666-0000-0000-0000-000000000001'), null, 'ni la pide bajo otro perfil propio');

-- ===== el docente la ve antes de borrar =====
select is(jsonb_array_length(public.teacher_student_sheets('f1000000-0000-0000-0000-0000000000f5',
  'f5000000-0000-0000-0000-000000000001', 0, 30) -> 'items'), 2, 'antes de borrar, el docente ve las 2 hojas');

-- ===== borrar una =====
select is(public.delete_student_sheet('f1000000-0000-0000-0000-0000000000f2', 'f5000000-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001'), 'not_found', 'otro tutor no puede borrar la hoja ajena');
select is((select count(*)::int from public.student_sheets where student_id = 'f5000000-0000-0000-0000-000000000001'), 2,
  'y no se borró nada');
select is(public.delete_student_sheet('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000002',
  '66666666-0000-0000-0000-000000000001'), 'not_found', 'ni se borra pidiéndola bajo otro perfil');
select is(public.delete_student_sheet('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001'), 'ok', 'el tutor titular borra una hoja');
select is(public.delete_student_sheet('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001'), 'not_found', 'borrar de nuevo la misma da not_found');
select is((select count(*)::int from public.student_sheets where student_id = 'f5000000-0000-0000-0000-000000000001'), 1,
  'solo desapareció esa hoja');
select is((select count(*)::int from public.student_sheets where id = '66666666-0000-0000-0000-000000000003'), 1,
  'las de otros perfiles siguen');
select is(jsonb_array_length(public.teacher_student_sheets('f1000000-0000-0000-0000-0000000000f5',
  'f5000000-0000-0000-0000-000000000001', 0, 30) -> 'items'), 1, 'el docente deja de ver la hoja borrada de inmediato');
select is(public.teacher_student_sheet('f1000000-0000-0000-0000-0000000000f5', 'f5000000-0000-0000-0000-000000000001',
  '66666666-0000-0000-0000-000000000001'), null, 'y no la abre ni con su id');

-- ===== borrar todas =====
select is(public.delete_student_sheets('f1000000-0000-0000-0000-0000000000f2', 'f5000000-0000-0000-0000-000000000001'), null,
  'otro tutor no borra las hojas de un perfil ajeno');
select is((select count(*)::int from public.student_sheets where student_id = 'f5000000-0000-0000-0000-000000000001'), 1,
  'y no se borró nada');
select is(public.delete_student_sheets('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001'), 1,
  'el tutor borra todas las del perfil y se informa cuántas fueron');
select is(jsonb_array_length(public.teacher_student_sheets('f1000000-0000-0000-0000-0000000000f5',
  'f5000000-0000-0000-0000-000000000001', 0, 30) -> 'items'), 0, 'el docente ya no ve ninguna');
select is((select count(*)::int from public.student_sheets where tutor_id = 'f1000000-0000-0000-0000-0000000000f1'), 1,
  'las de Beto (otro perfil del mismo tutor) siguen');

-- ===== derecho del titular: aunque el consentimiento esté revocado =====
select lives_ok($$select public.revoke_consent('f1000000-0000-0000-0000-0000000000f1')$$, 'el tutor A revoca su consentimiento');
reset role;
insert into public.student_sheets (id, student_id, tutor_id, exercise_id, topic, correct, content) values
  ('66666666-0000-0000-0000-000000000005', 'f5000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-0000000000f1',
   gen_random_uuid(), '2-02', true, '{"statement":"3 + 3","child_answer":"6","correct_answer":"6","strokes":[]}');
set local role service_role;
select is(public.list_student_sheets('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000002', 0, 30) -> 'total',
  '1'::jsonb, 'sin consentimiento vigente el tutor igual puede ver las hojas de su hijo');
select is(public.delete_student_sheet('f1000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000002',
  '66666666-0000-0000-0000-000000000005'), 'ok', 'y borrarlas');

-- ===== permisos y RLS =====
select is((select count(*)::int from unnest(array[
  'public.list_student_sheets(uuid,uuid,integer,integer)', 'public.get_student_sheet(uuid,uuid,uuid)',
  'public.delete_student_sheet(uuid,uuid,uuid)', 'public.delete_student_sheets(uuid,uuid)']) f
  where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')), 0,
  'ni anon ni authenticated ejecutan estas funciones (solo el servidor, con el PIN verificado)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
select throws_ok($$delete from public.student_sheets$$, '42501', null, 'RLS: el cliente no borra hojas directo, ni las propias');

select * from finish();
rollback;
