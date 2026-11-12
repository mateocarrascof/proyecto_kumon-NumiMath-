begin;
select plan(58);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- A22 (guardar la hoja) y D8 (el docente la ve). Tutor A=...d1 con perfiles s1 (Ana), s2 (Beto);
-- tutor B=...d2 con s3 (Cami). Docente X=...e1 vinculado a s1; docente Y=...e2 vinculado a s3.

insert into auth.users (id, email, raw_app_meta_data) values
  ('d1000000-0000-0000-0000-0000000000e3', 'z@test.invalid', '{"role":"teacher"}'),
  ('d1000000-0000-0000-0000-0000000000d1', 'a@test.invalid', '{}'),
  ('d1000000-0000-0000-0000-0000000000d2', 'b@test.invalid', '{}'),
  ('d1000000-0000-0000-0000-0000000000e1', 'x@test.invalid', '{"role":"teacher"}'),
  ('d1000000-0000-0000-0000-0000000000e2', 'y@test.invalid', '{"role":"teacher"}');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current, covers_sheets) values
  ('22222222-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true, false),
  ('22222222-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true, false),
  ('22222222-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true, false),
  -- texto vigente (describe las hojas) y un texto anterior (no las describía)
  ('22222222-0000-0000-0000-000000000011', 'teacher_authorization', 'doc-1', repeat('e', 64), true, true),
  ('22222222-0000-0000-0000-000000000012', 'teacher_authorization', 'doc-0', repeat('f', 64), false, false);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('d1000000-0000-0000-0000-0000000000d' || n)::uuid, 'grant',
       '22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000d1', 'Ana',  2, true),
  ('d5000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-0000000000d1', 'Beto', 3, true),
  ('d5000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-0000000000d2', 'Cami', 1, true),
  ('d5000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-0000000000d1', 'Dani', 2, true);

insert into public.teachers (id, name, link_code) values
  ('d1000000-0000-0000-0000-0000000000e1', 'Docente X', 'XXXX2345'),
  ('d1000000-0000-0000-0000-0000000000e2', 'Docente Y', 'YYYY2345'),
  ('d1000000-0000-0000-0000-0000000000e3', 'Docente Z', 'ZZZZ2345');
-- Z está vinculado a Dani con un texto de autorización ANTERIOR (no describía las hojas).
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('d1000000-0000-0000-0000-0000000000e3', 'd5000000-0000-0000-0000-000000000004',
   'd1000000-0000-0000-0000-0000000000d1', '22222222-0000-0000-0000-000000000012', 'Docente Z');
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('d1000000-0000-0000-0000-0000000000e1', 'd5000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-0000000000d1', '22222222-0000-0000-0000-000000000011', 'Docente X'),
  ('d1000000-0000-0000-0000-0000000000e2', 'd5000000-0000-0000-0000-000000000003',
   'd1000000-0000-0000-0000-0000000000d2', '22222222-0000-0000-0000-000000000011', 'Docente Y');

-- Intentos de Ana: e1 (generado, falló), e2 (generado, acertó), e3 (tarea del tutor con texto personal,
-- falló), e4 (diagnóstico). Beto (sin docente): e5. Cami: e6.
insert into public.student_attempts
  (student_id, tutor_id, exercise_id, topic, exercise, correct, answered_at, level, duration_s, activity) values
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-000000000001', '2-01', '7 + 5', false, now(), 1, 12, 'practice'),
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-000000000002', '2-02', '9 - 4', true,  now(), 2, 30, 'practice'),
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-000000000003', 'tarea_tutor', 'Carla vive en la calle Los Pinos 123', false, now(), 1, 20, 'practice'),
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-000000000004', '2-01', 'DIAGNÓSTICO 1 + 2', true, now(), 1, 5, 'diagnostic'),
  ('d5000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-000000000005', '2-01', '5 + 5', true, now(), 1, 7, 'practice'),
  ('d5000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-0000000000d2', 'e0000000-0000-0000-0000-000000000006', '1-01', '1 + 1', true, now(), 1, 7, 'practice'),
  ('d5000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-000000000007', '2-01', '3 + 3', true, now(), 1, 7, 'practice');
insert into public.assigned_exercises (id, student_id, tutor_id, text, answer, answered_at, correct) values
  ('e0000000-0000-0000-0000-000000000003', 'd5000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-0000000000d1', 'Carla vive en la calle Los Pinos 123', 12, now(), false);

-- Una hoja guardada ANTES del vínculo actual (otro docente o antes de aceptar): no debe verla el docente.
insert into public.student_sheets (id, student_id, tutor_id, exercise_id, topic, correct, content, saved_at) values
  ('55555555-0000-0000-0000-0000000000a0', 'd5000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-0000000000a0', '2-01', true,
   '{"statement":"ANTIGUA","child_answer":"1","correct_answer":"1","strokes":[]}', now() - interval '100 days');

set local role service_role;

-- ===== A22: guardar =====
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001', '11', false, '12',
  '[{"eraser":false,"color":"#111111","width":4,"points":[[10,10],[20,20]]}]'::jsonb), 'ok',
  'con docente vinculado y un intento real, la hoja se guarda');
select is((select count(*)::int from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000001'), 1,
  'queda una fila');
select is((select content ->> 'statement' from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000001'),
  '7 + 5', 'el enunciado sale del intento registrado, no del cliente');
select is((select content ->> 'child_answer' from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000001'),
  '11', 'la respuesta del niño va dentro de la hoja');
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001', '11', false, '12',
  '[{"eraser":false,"color":"#111111","width":4,"points":[[10,10],[20,20]]},{"eraser":true,"color":"#fff","width":26,"points":[[1,1]]}]'::jsonb), 'ok',
  'guardar de nuevo (manual tras el automático) no falla');
select is((select count(*)::int from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000001'), 1,
  'upsert: sigue siendo una sola hoja por ejercicio');
select is((select jsonb_array_length(content -> 'strokes') from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000001'),
  2, 'y quedó la versión más reciente');

select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000003', '10', null, null, '[]'::jsonb), 'ok', 'también se guarda la hoja de una tarea del tutor');
select is((select content ->> 'statement' from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000003'),
  'Tarea del tutor', 'de la tarea del tutor se guarda solo "Tarea del tutor"');
select is((select content::text ~ 'Carla|Pinos' from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000003'),
  false, 'el texto de la tarea del tutor no aparece en ninguna parte de la hoja');
select is((select content ->> 'correct_answer' from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000003'),
  '12', 'la respuesta correcta de la tarea la pone la base');

select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000003', '12', null, null, '[]'::jsonb), 'mismatch',
  'una respuesta que no corresponde con el intento de la tarea se rechaza');
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001', '12', true, '12', '[]'::jsonb), 'mismatch',
  'ni un "acertó" que no coincide con el intento registrado');
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000004', '3', true, '3', '[]'::jsonb), 'no_attempt', 'el diagnóstico no tiene hoja');
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-0000000000ff', '3', true, '3', '[]'::jsonb), 'no_attempt', 'sin intento previo no se guarda');
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000005', '10', true, '10', '[]'::jsonb), 'no_link', 'sin docente vinculado no se guarda');
select is((select count(*)::int from public.student_sheets where student_id = 'd5000000-0000-0000-0000-000000000002'), 0,
  'y no queda ninguna fila');
-- R35: un vínculo con un texto de autorización anterior (que no describía las hojas) no guarda ni muestra hojas.
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000004',
  'e0000000-0000-0000-0000-000000000007', '6', true, '6', '[]'::jsonb), 'no_link',
  'R35: con un vínculo de un texto anterior no se guarda');
select is(public.student_has_sheet_link('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000004'), false,
  'R35: el chequeo "hay vínculo" para hojas da falso con ese vínculo');
select is(public.student_has_sheet_link('d1000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-000000000001'), true,
  'y verdadero con un vínculo del texto vigente');
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d2', 'd5000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001', '11', false, '12', '[]'::jsonb), 'not_found',
  'otro tutor no puede guardar hojas del perfil ajeno');
select throws_ok($$select public.save_student_sheet('d1000000-0000-0000-0000-0000000000d1',
  'd5000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '11', false, '12',
  (select jsonb_agg(i) from generate_series(1, 70000) i))$$, '23514', null, 'el tope de tamaño lo impone la base');

-- ===== D8: lectura del docente =====
select is(jsonb_array_length(public.teacher_student_sheets('d1000000-0000-0000-0000-0000000000e1',
  'd5000000-0000-0000-0000-000000000001', 0, 30) -> 'items'), 2,
  'el docente ve las 2 hojas guardadas desde su vínculo (no la anterior)');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(i) k from jsonb_array_elements(
  public.teacher_student_sheets('d1000000-0000-0000-0000-0000000000e1', 'd5000000-0000-0000-0000-000000000001', 0, 30) -> 'items') i) keys),
  array['correct', 'day', 'id', 'topic'], 'la lista trae solo habilidad, resultado, día e id (sin trazos)');
select is(public.teacher_student_sheets('d1000000-0000-0000-0000-0000000000e1',
  'd5000000-0000-0000-0000-000000000001', 0, 30)::text ~ 'ANTIGUA|Carla|Pinos', false,
  'ni lo anterior al vínculo ni el texto de la tarea del tutor');
select is((public.teacher_student_sheet('d1000000-0000-0000-0000-0000000000e1', 'd5000000-0000-0000-0000-000000000001',
  (select id from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000001')) -> 'content' ->> 'statement'),
  '7 + 5', 'el detalle trae el contenido de la hoja');
select is(public.teacher_student_sheet('d1000000-0000-0000-0000-0000000000e1', 'd5000000-0000-0000-0000-000000000001',
  '55555555-0000-0000-0000-0000000000a0'), null, 'la hoja anterior al vínculo no se abre ni por su id');
select is(public.teacher_student_sheets('d1000000-0000-0000-0000-0000000000e2',
  'd5000000-0000-0000-0000-000000000001', 0, 30), null, 'otro docente: null');
select is(public.teacher_student_sheet('d1000000-0000-0000-0000-0000000000e2', 'd5000000-0000-0000-0000-000000000001',
  (select id from public.student_sheets where exercise_id = 'e0000000-0000-0000-0000-000000000001')), null,
  'otro docente no abre la hoja ni sabiendo su id');
select is(public.teacher_student_sheets('d1000000-0000-0000-0000-0000000000e1',
  'd5000000-0000-0000-0000-000000000002', 0, 30), null, 'un niño sin vínculo con ese docente: null');
select is(public.teacher_student_sheets('d1000000-0000-0000-0000-0000000000e1',
  'd5000000-0000-0000-0000-000000000003', 0, 30), null, 'ni un niño de otro tutor');

-- R35: el docente del texto anterior sigue viendo al alumno (historial y progreso no cambian), pero no sus hojas.
select is(public.teacher_student_sheets('d1000000-0000-0000-0000-0000000000e3',
  'd5000000-0000-0000-0000-000000000004', 0, 30), null, 'R35: sus hojas no se listan');
select isnt(public.teacher_student_history('d1000000-0000-0000-0000-0000000000e3',
  'd5000000-0000-0000-0000-000000000004', 0, 30), null, 'R35: el historial sigue igual (la regla es solo para hojas)');
select is(jsonb_array_length(public.teacher_students('d1000000-0000-0000-0000-0000000000e3')), 1,
  'R35: y la lista de alumnos tampoco cambia');

-- ===== permisos y RLS =====
select is((select count(*)::int from unnest(array[
  'public.save_student_sheet(uuid,uuid,uuid,text,boolean,text,jsonb)',
  'public.teacher_student_sheets(uuid,uuid,integer,integer)', 'public.teacher_student_sheet(uuid,uuid,uuid)',
  'public.purge_expired_student_sheets()', 'public.student_has_sheet_link(uuid,uuid)']) f
  where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')), 0,
  'ni anon ni authenticated ejecutan estas funciones');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select is((select count(*)::int from public.student_sheets), 0, 'RLS: el tutor B no lee las hojas del tutor A');
select throws_ok($$select count(*) from public.sheet_save_counters$$, '42501', null,
  'RLS: el cliente no lee los contadores de guardado (solo el servidor)');
select throws_ok($$insert into public.student_sheets (student_id, tutor_id, exercise_id, topic, correct, content)
  values ('d5000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-0000000000d2', gen_random_uuid(), '1-01', true,
  '{"strokes":[]}')$$, '42501', null, 'RLS: el cliente no escribe hojas (solo el servidor)');
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select is((select count(*)::int from public.student_sheets), 3, 'RLS: el tutor A lee las de sus perfiles (incluida la antigua)');
reset role;
set local role service_role;

-- ===== plazo de conservación y purga =====
select is((select value from public.app_settings where key = 'sheet_retention_days'), '90'::jsonb, 'plazo provisional de 90 días');
select is((select value from public.app_settings where key = 'sheet_retention_confirmed'), 'false'::jsonb, 'marcado como NO confirmado');
select throws_ok($$update public.app_settings set value = '"x"'::jsonb where key = 'sheet_retention_days'$$, '23514', null,
  'el plazo solo acepta un número de días válido');
select is(public.purge_expired_student_sheets(), 1, 'la purga borra solo la hoja de 100 días');
select is((select count(*)::int from public.student_sheets where student_id = 'd5000000-0000-0000-0000-000000000001'), 2,
  'y conserva las recientes');

-- ===== quitar el vínculo o al docente NO borra las hojas =====
reset role;
delete from public.teacher_links where teacher_id = 'd1000000-0000-0000-0000-0000000000e1';
set local role service_role;
select is((select count(*)::int from public.student_sheets where student_id = 'd5000000-0000-0000-0000-000000000001'), 2,
  'al quitar el vínculo las hojas siguen guardadas');
select is(public.teacher_student_sheets('d1000000-0000-0000-0000-0000000000e1',
  'd5000000-0000-0000-0000-000000000001', 0, 30), null, 'pero ese docente ya no las ve');

-- ===== T20: revocar el consentimiento borra las hojas (solo las de ese tutor) =====
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d2', 'd5000000-0000-0000-0000-000000000003',
  'e0000000-0000-0000-0000-000000000006', '2', true, '2', '[]'::jsonb), 'ok', 'el tutor B guarda una hoja de Cami (docente Y vinculado)');
-- ===== M1: límite por tutor (por minuto y por día, desde app_settings) =====
select lives_ok($$update public.app_settings set value = '1'::jsonb where key = 'sheet_saves_per_minute'$$,
  'el límite por minuto se cambia en app_settings');
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d2', 'd5000000-0000-0000-0000-000000000003',
  'e0000000-0000-0000-0000-000000000006', '2', true, '2', '[]'::jsonb), 'rate_limited',
  'el segundo guardado del mismo minuto se rechaza');
select lives_ok($$update public.app_settings set value = '30'::jsonb where key = 'sheet_saves_per_minute';
  update public.app_settings set value = '1'::jsonb where key = 'sheet_saves_per_day'$$, 'ahora el límite diario es 1');
select is(public.save_student_sheet('d1000000-0000-0000-0000-0000000000d2', 'd5000000-0000-0000-0000-000000000003',
  'e0000000-0000-0000-0000-000000000006', '2', true, '2', '[]'::jsonb), 'rate_limited', 'el límite diario también se aplica');
select is((select n_day from public.sheet_save_counters where tutor_id = 'd1000000-0000-0000-0000-0000000000d1'), 3,
  'el contador es por tutor y solo cuenta los guardados aceptados (no los rechazados por mismatch, no_link ni no_attempt)');
select lives_ok($$update public.app_settings set value = '500'::jsonb where key = 'sheet_saves_per_day'$$, 'se restablece el límite diario');
select throws_ok($$update public.app_settings set value = '0'::jsonb where key = 'sheet_saves_per_minute'$$, '23514', null,
  'los límites solo aceptan valores válidos');

select lives_ok($$select public.revoke_consent('d1000000-0000-0000-0000-0000000000d2')$$, 'el tutor B revoca su consentimiento');
select is((select count(*)::int from public.student_sheets where tutor_id = 'd1000000-0000-0000-0000-0000000000d2'), 0,
  'T20: sus hojas se borraron');
select is((select count(*)::int from public.student_sheets where tutor_id = 'd1000000-0000-0000-0000-0000000000d1'), 2,
  'y las del tutor A siguen');

-- ===== T21: borrar el perfil borra sus hojas =====
reset role;
delete from public.students where id = 'd5000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.student_sheets where tutor_id = 'd1000000-0000-0000-0000-0000000000d1'), 0,
  'T21: al borrar el perfil se borran sus hojas');

select * from finish();
rollback;
