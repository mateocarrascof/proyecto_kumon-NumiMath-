begin;
select plan(9);
update public.legal_document_versions set is_current = false;

-- D6. Tutor A=...c1 (perfiles s1 Ana, s2 Beto). Docente X=...b1 vinculado a s1; Y=...b2 sin vínculos.
insert into auth.users (id, email, raw_app_meta_data) values
  ('ee000000-0000-0000-0000-0000000000c1', 'a@test.invalid', '{}'),
  ('ee000000-0000-0000-0000-0000000000b1', 'x@test.invalid', '{"role":"teacher"}'),
  ('ee000000-0000-0000-0000-0000000000b2', 'y@test.invalid', '{"role":"teacher"}');
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current, covers_sheets) values
  ('66666666-0000-0000-0000-000000000001', 'terms', 'tos-1', repeat('a', 64), true, false),
  ('66666666-0000-0000-0000-000000000002', 'privacy', 'pp-1', repeat('b', 64), true, false),
  ('66666666-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1', repeat('c', 64), true, false),
  ('66666666-0000-0000-0000-000000000011', 'teacher_authorization', 'doc-1', repeat('e', 64), true, true);
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('ee000000-0000-0000-0000-0000000000c1', 'grant', '66666666-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000002', 'web');
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('ee500000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-0000000000c1', 'Ana', 2, true),
  ('ee500000-0000-0000-0000-000000000002', 'ee000000-0000-0000-0000-0000000000c1', 'Beto', 2, true);
insert into public.teachers (id, name, link_code) values
  ('ee000000-0000-0000-0000-0000000000b1', 'X', 'XXXX2345'), ('ee000000-0000-0000-0000-0000000000b2', 'Y', 'YYYY2345');
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('ee000000-0000-0000-0000-0000000000b1', 'ee500000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-0000000000c1', '66666666-0000-0000-0000-000000000011', 'X');

-- Ana: antes del vínculo (no cuenta), 3 de práctica ahora (2 correctas, una es tarea del tutor), un juego y un diagnóstico.
insert into public.student_attempts (student_id, tutor_id, exercise_id, topic, exercise, correct, answered_at, level, duration_s, activity, game_kind) values
  ('ee500000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-01', 'ANTES', true, now() - interval '3 days', 1, 9, 'practice', null),
  ('ee500000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-01', '7 + 5', true, now() + interval '1 second', 1, 9, 'practice', null),
  ('ee500000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-01', '9 - 4', false, now() + interval '2 seconds', 1, 9, 'practice', null),
  ('ee500000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 'tarea_tutor', 'Carla vive en Los Pinos', true, now() + interval '3 seconds', 1, 9, 'practice', null),
  ('ee500000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-01', 'JUEGO', true, now() + interval '4 seconds', 1, 9, 'game', 'mayor-1'),
  ('ee500000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '2-01', 'DIAG', true, now() + interval '5 seconds', 1, 9, 'diagnostic', null);

set local role service_role;
select is(jsonb_array_length(public.teacher_student_evolution('ee000000-0000-0000-0000-0000000000b1', 'ee500000-0000-0000-0000-000000000001') -> 'weeks'), 8, 'siempre 8 semanas');
select is((select sum((w ->> 'total')::int) from jsonb_array_elements(public.teacher_student_evolution('ee000000-0000-0000-0000-0000000000b1', 'ee500000-0000-0000-0000-000000000001') -> 'weeks') w), 3::bigint,
  'cuenta solo práctica desde el vínculo (sin antes, juego ni diagnóstico)');
select is((select sum((w ->> 'correct')::int) from jsonb_array_elements(public.teacher_student_evolution('ee000000-0000-0000-0000-0000000000b1', 'ee500000-0000-0000-0000-000000000001') -> 'weeks') w), 2::bigint, 'y sus aciertos');
select is((public.teacher_student_evolution('ee000000-0000-0000-0000-0000000000b1', 'ee500000-0000-0000-0000-000000000001') -> 'weeks' -> 7 ->> 'total'), '3', 'quedan en la semana actual (la última)');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(w) k from jsonb_array_elements(public.teacher_student_evolution('ee000000-0000-0000-0000-0000000000b1', 'ee500000-0000-0000-0000-000000000001') -> 'weeks') w) x),
  array['correct', 'start', 'total'], 'solo fecha de inicio y totales: sin duración, hora ni textos');
select is(public.teacher_student_evolution('ee000000-0000-0000-0000-0000000000b1', 'ee500000-0000-0000-0000-000000000001')::text ~ 'Carla|ANTES|JUEGO', false, 'sin textos');
select is(public.teacher_student_evolution('ee000000-0000-0000-0000-0000000000b2', 'ee500000-0000-0000-0000-000000000001'), null, 'otro docente: null');
select is(public.teacher_student_evolution('ee000000-0000-0000-0000-0000000000b1', 'ee500000-0000-0000-0000-000000000002'), null, 'niño sin vínculo: null');
select is((select count(*)::int from unnest(array['public.teacher_student_evolution(uuid,uuid)']) f
  where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')), 0, 'solo el servidor la ejecuta');
select * from finish();
rollback;
