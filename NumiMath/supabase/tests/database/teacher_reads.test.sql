begin;
select plan(43);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- D4, D5, D7 (docente) y T5 (tutor). Tutor A=...c1 con perfiles s1 (Ana) y s2 (Beto); tutor B=...c2 con s3.
-- Docente X=...b1 vinculado SOLO a s1; docente Y=...b2 sin vínculos.

insert into auth.users (id, email, raw_app_meta_data) values
  ('bc000000-0000-0000-0000-0000000000c1', 'a@test.invalid', '{}'),
  ('bc000000-0000-0000-0000-0000000000c2', 'b@test.invalid', '{}'),
  ('bc000000-0000-0000-0000-0000000000b1', 'x@test.invalid', '{"role":"teacher"}'),
  ('bc000000-0000-0000-0000-0000000000b2', 'y@test.invalid', '{"role":"teacher"}');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true),
  ('11111111-0000-0000-0000-000000000011', 'teacher_authorization', 'doc-1', repeat('e', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('bc000000-0000-0000-0000-0000000000c' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('b5000000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-0000000000c1', 'Ana',  2, true),
  ('b5000000-0000-0000-0000-000000000002', 'bc000000-0000-0000-0000-0000000000c1', 'Beto', 3, true),
  ('b5000000-0000-0000-0000-000000000003', 'bc000000-0000-0000-0000-0000000000c2', 'Cami', 1, true);

insert into public.teachers (id, name, link_code) values
  ('bc000000-0000-0000-0000-0000000000b1', 'Docente X', 'XXXX2345'),
  ('bc000000-0000-0000-0000-0000000000b2', 'Docente Y', 'YYYY2345');
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name)
values ('bc000000-0000-0000-0000-0000000000b1', 'b5000000-0000-0000-0000-000000000001',
        'bc000000-0000-0000-0000-0000000000c1', '11111111-0000-0000-0000-000000000011', 'Docente X');

-- Intentos de Ana (s1): ANTES del vínculo, DESPUÉS (generados, con duración), una tarea del tutor con
-- texto personal, y uno del diagnóstico. Todo se compara con `accepted_at` = now().
insert into public.student_attempts
  (student_id, tutor_id, exercise_id, topic, exercise, correct, answered_at, level, duration_s, activity) values
  ('b5000000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-01', 'ANTES 1 + 1', true,  now() - interval '2 days', 1, 9, 'practice'),
  ('b5000000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-01', '7 + 5',        false, now() + interval '1 minute',  1, 12, 'practice'),
  ('b5000000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-02', '9 - 4',        true,  now() + interval '2 minutes', 2, 30, 'practice'),
  ('b5000000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 'tarea_tutor', 'Carla vive en la calle Los Pinos 123', false, now() + interval '3 minutes', 1, 20, 'practice'),
  ('b5000000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-01', 'DIAGNÓSTICO 1 + 2', true, now() + interval '4 minutes', 1, 5, 'diagnostic'),
  ('b5000000-0000-0000-0000-000000000002', 'bc000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-01', 'DE BETO 5 + 5', true, now() + interval '1 minute', 1, 7, 'practice');
insert into public.student_skill_progress (student_id, tutor_id, skill_code, level, block_total, block_correct, mastered_at) values
  ('b5000000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-0000000000c1', '2-01', 2, 3, 2, null),
  ('b5000000-0000-0000-0000-000000000001', 'bc000000-0000-0000-0000-0000000000c1', '2-02', 3, 0, 0, now()),
  ('b5000000-0000-0000-0000-000000000002', 'bc000000-0000-0000-0000-0000000000c1', '2-01', 1, 1, 1, null);

set local role service_role;

-- ===== D4: alumnos vinculados =====
select is(public.teacher_students('bc000000-0000-0000-0000-0000000000b1'),
  '[{"student_id": "b5000000-0000-0000-0000-000000000001", "nickname": "Ana", "grade": 2}]'::jsonb,
  'el docente ve solo a su alumno vinculado, y de él solo apodo y curso');
select is(public.teacher_students('bc000000-0000-0000-0000-0000000000b2'), '[]'::jsonb, 'otro docente no ve a nadie');
select is(public.teacher_students('bc000000-0000-0000-0000-0000000000c1'), '[]'::jsonb, 'un tutor no es docente: lista vacía');
select is(public.teacher_students('bc000000-0000-0000-0000-0000000000ff'), '[]'::jsonb, 'ni un id inexistente');

-- ===== D5: progreso por habilidad =====
select is(jsonb_array_length(public.teacher_student_progress('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001') -> 'skills'), 2, 've el estado actual de las 2 habilidades practicadas');
select is((public.teacher_student_progress('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001') -> 'skills' -> 0),
  '{"code": "2-01", "level": 2, "mastered": false, "block_total": 3, "block_correct": 2}'::jsonb,
  'con nivel, avance del bloque y dominada, y nada más (sin tiempo típico ni racha)');
select is(public.teacher_student_progress('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000002'), null, 'sin vínculo con ese niño: null (aunque sea del mismo tutor)');
select is(public.teacher_student_progress('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000003'), null, 'ni con un niño de otro tutor');
select is(public.teacher_student_progress('bc000000-0000-0000-0000-0000000000b2',
  'b5000000-0000-0000-0000-000000000001'), null, 'otro docente: null');
select is(public.teacher_student_progress('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-0000000000ff'), null, 'y un niño que no existe da lo mismo: null');

-- ===== D7: historial desde accepted_at =====
select is(jsonb_array_length(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 30) -> 'items'), 3,
  've los 3 intentos de práctica posteriores al vínculo (no el anterior ni el diagnóstico)');
select is(((public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 30)::text) ~ 'ANTES|DIAGNÓSTICO|DE BETO'), false,
  'nada anterior a accepted_at, ni del diagnóstico, ni de otro niño');
select is((select jsonb_agg(i ->> 'topic') from jsonb_array_elements(public.teacher_student_history(
  'bc000000-0000-0000-0000-0000000000b1', 'b5000000-0000-0000-0000-000000000001', 0, 30) -> 'items') i),
  '["tarea_tutor", "2-02", "2-01"]'::jsonb, 'del más reciente al más antiguo');
select is((select count(*)::int from jsonb_array_elements(public.teacher_student_history(
  'bc000000-0000-0000-0000-0000000000b1', 'b5000000-0000-0000-0000-000000000001', 0, 30) -> 'items') i
  where i ->> 'topic' = 'tarea_tutor' and i -> 'exercise' = 'null'::jsonb and (i ->> 'correct') = 'false'), 1,
  'de la tarea del tutor solo se sabe que lo fue y si acertó: sin su texto');
select is(((public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 30)::text) ~ 'Carla|Pinos'), false,
  'el texto personal de la tarea del tutor no aparece en ninguna parte');
select is((select jsonb_agg(i ->> 'exercise') from jsonb_array_elements(public.teacher_student_history(
  'bc000000-0000-0000-0000-0000000000b1', 'b5000000-0000-0000-0000-000000000001', 0, 30) -> 'items') i
  where i ->> 'topic' <> 'tarea_tutor'), '["9 - 4", "7 + 5"]'::jsonb,
  'de los ejercicios generados por la app sí ve el enunciado');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(i) k from jsonb_array_elements(
  public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 30) -> 'items') i) keys),
  array['correct', 'day', 'exercise', 'level', 'topic'],
  'cada intento trae solo habilidad, enunciado, resultado, nivel y día: sin duración ni hora ni respuestas');
select is((select count(*)::int from jsonb_array_elements(public.teacher_student_history(
  'bc000000-0000-0000-0000-0000000000b1', 'b5000000-0000-0000-0000-000000000001', 0, 30) -> 'items') i
  where (i ->> 'day') ~ '^\d{4}-\d{2}-\d{2}$'), 3, 'la fecha es solo el día (AAAA-MM-DD)');
select is(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 2) -> 'has_more', 'true'::jsonb, 'paginado: con límite 2 hay más');
select is(jsonb_array_length(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 2) -> 'items'), 2, 'la primera página trae 2');
select is((public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 2, 2) -> 'items' -> 0 ->> 'topic', public.teacher_student_history(
  'bc000000-0000-0000-0000-0000000000b1', 'b5000000-0000-0000-0000-000000000001', 2, 2) -> 'has_more')::text,
  '(2-01,false)', 'la segunda página trae el último y ya no hay más');
select is(jsonb_array_length(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 999) -> 'items'), 3, 'el límite máximo se acota (50)');
select is(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000002', 0, 30), null, 'historial de un niño no vinculado: null');
select is(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b2',
  'b5000000-0000-0000-0000-000000000001', 0, 30), null, 'historial con otro docente: null');
select is(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-0000000000ff', 0, 30), null, 'y con un niño que no existe: lo mismo');

-- ===== un vínculo nuevo (otra fecha) solo ve desde SU accepted_at =====
reset role;
update public.teacher_links set accepted_at = now() + interval '150 seconds'
  where teacher_id = 'bc000000-0000-0000-0000-0000000000b1';
set local role service_role;
select is(jsonb_array_length(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 30) -> 'items'), 1,
  'con otra fecha de aceptación solo se ven los intentos desde esa fecha');
reset role;
update public.teacher_links set accepted_at = now() where teacher_id = 'bc000000-0000-0000-0000-0000000000b1';
set local role service_role;

-- ===== T5: historial del hijo para el tutor =====
select is(jsonb_array_length(public.list_student_attempts('bc000000-0000-0000-0000-0000000000c1',
  'b5000000-0000-0000-0000-000000000001', 0, 30) -> 'items'), 4,
  'el tutor ve todos los intentos de práctica de su hijo (4; no el diagnóstico)');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(i) k from jsonb_array_elements(
  public.list_student_attempts('bc000000-0000-0000-0000-0000000000c1',
  'b5000000-0000-0000-0000-000000000001', 0, 30) -> 'items') i) keys),
  array['answered_at', 'correct', 'level', 'topic'], 'con habilidad, resultado, nivel y hora');
select is(public.list_student_attempts('bc000000-0000-0000-0000-0000000000c2',
  'b5000000-0000-0000-0000-000000000001', 0, 30), null, 'otro tutor no ve el historial: null');
select is(public.list_student_attempts('bc000000-0000-0000-0000-0000000000c1',
  'b5000000-0000-0000-0000-000000000003', 0, 30), null, 'ni el de un niño ajeno');
select is(public.list_student_attempts('bc000000-0000-0000-0000-0000000000c2',
  'b5000000-0000-0000-0000-000000000003', 0, 30) -> 'items', '[]'::jsonb, 'un perfil sin intentos devuelve la lista vacía');

-- ===== se corta el acceso del docente =====
-- Perfil bloqueado.
select public.block_student('bc000000-0000-0000-0000-0000000000c1', 'b5000000-0000-0000-0000-000000000001', 'tutor_request');
select is(public.teacher_student_progress('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001'), null, 'perfil bloqueado: el docente ya no ve nada');
select public.unblock_student('bc000000-0000-0000-0000-0000000000c1', 'b5000000-0000-0000-0000-000000000001');
-- Rol docente retirado.
reset role;
update auth.users set raw_app_meta_data = '{}' where id = 'bc000000-0000-0000-0000-0000000000b1';
set local role service_role;
select is(public.teacher_students('bc000000-0000-0000-0000-0000000000b1'), '[]'::jsonb, 'sin el rol de docente: lista vacía');
select is(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 30), null, 'y sin historial');
reset role;
update auth.users set raw_app_meta_data = '{"role":"teacher"}' where id = 'bc000000-0000-0000-0000-0000000000b1';
set local role service_role;
-- El tutor quita el vínculo.
select is(public.remove_teacher_link('bc000000-0000-0000-0000-0000000000c1', 'b5000000-0000-0000-0000-000000000001',
  'bc000000-0000-0000-0000-0000000000b1'), 'ok', 'el tutor quita el vínculo');
select is(public.teacher_students('bc000000-0000-0000-0000-0000000000b1'), '[]'::jsonb, 'tras quitarlo, la lista queda vacía');
select is(public.teacher_student_progress('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001'), null, 'sin progreso');
select is(public.teacher_student_history('bc000000-0000-0000-0000-0000000000b1',
  'b5000000-0000-0000-0000-000000000001', 0, 30), null, 'ni historial');

-- ===== permisos y solo lectura =====
select is((select count(*)::int from unnest(array[
  'public.teacher_students(uuid)', 'public.teacher_student_progress(uuid,uuid)',
  'public.teacher_student_history(uuid,uuid,integer,integer)', 'public.list_student_attempts(uuid,uuid,integer,integer)'
]) f where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')), 0,
  'ni anon ni authenticated ejecutan las lecturas (solo el servidor)');
select is((select count(*)::int from public.student_attempts where student_id = 'b5000000-0000-0000-0000-000000000001'), 5,
  'leer no escribe nada: los 5 intentos siguen ahí');

-- Consentimiento revocado (otro caso, tutor B con vínculo propio).
reset role;
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name)
values ('bc000000-0000-0000-0000-0000000000b2', 'b5000000-0000-0000-0000-000000000003',
        'bc000000-0000-0000-0000-0000000000c2', '11111111-0000-0000-0000-000000000011', 'Docente Y');
set local role service_role;
select is(jsonb_array_length(public.teacher_students('bc000000-0000-0000-0000-0000000000b2')), 1, 'el otro docente ve a su alumno');
select lives_ok($$select public.revoke_consent('bc000000-0000-0000-0000-0000000000c2')$$, 'el tutor B revoca su consentimiento');
select is(public.teacher_students('bc000000-0000-0000-0000-0000000000b2'), '[]'::jsonb,
  'con el consentimiento revocado el docente ya no ve nada');

select * from finish();
rollback;
