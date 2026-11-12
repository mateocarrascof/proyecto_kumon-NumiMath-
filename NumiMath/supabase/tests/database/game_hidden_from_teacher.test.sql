begin;
select plan(7);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Los intentos de juego (activity = 'game', CU-A21) NO se muestran al docente (D7) ni generan hojas (A22).
-- Tutor A=...a1, perfil s1 (Ana), docente X=...a5 vinculado a s1 con un texto que describe las hojas.

insert into auth.users (id, email, raw_app_meta_data) values
  ('a9000000-0000-0000-0000-0000000000a1', 'a@test.invalid', '{}'),
  ('a9000000-0000-0000-0000-0000000000a5', 'x@test.invalid', '{"role":"teacher"}');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current, covers_sheets) values
  ('44444444-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true, false),
  ('44444444-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true, false),
  ('44444444-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true, false),
  ('44444444-0000-0000-0000-000000000011', 'teacher_authorization', 'doc-1', repeat('e', 64), true, true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('a9000000-0000-0000-0000-0000000000a1', 'grant',
   '44444444-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', 'web');

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('a9500000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-0000000000a1', 'Ana', 1, true);

insert into public.teachers (id, name, link_code) values
  ('a9000000-0000-0000-0000-0000000000a5', 'Docente X', 'XXXX2345');
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('a9000000-0000-0000-0000-0000000000a5', 'a9500000-0000-0000-0000-000000000001',
   'a9000000-0000-0000-0000-0000000000a1', '44444444-0000-0000-0000-000000000011', 'Docente X');

-- Un intento de práctica y uno de juego, los dos posteriores al vínculo.
insert into public.student_attempts
  (student_id, tutor_id, exercise_id, topic, exercise, correct, answered_at, level, duration_s, activity, game_kind) values
  ('a9500000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-0000000000a1', 'a9a00000-0000-0000-0000-000000000001',
   '1-03', 'PRÁCTICA 2 + 3', true, now() + interval '1 minute', 1, 8, 'practice', null),
  ('a9500000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-0000000000a1', 'a9a00000-0000-0000-0000-000000000002',
   '1-03', 'JUEGO 4 + 4', true, now() + interval '2 minutes', 1, 8, 'game', 'mayor-1');

set local role service_role;

select is(jsonb_array_length(public.teacher_student_history('a9000000-0000-0000-0000-0000000000a5',
  'a9500000-0000-0000-0000-000000000001', 0, 30) -> 'items'), 1,
  'el historial del docente solo trae el intento de práctica');
select is(public.teacher_student_history('a9000000-0000-0000-0000-0000000000a5',
  'a9500000-0000-0000-0000-000000000001', 0, 30)::text ~ 'JUEGO|mayor-1|game', false,
  'y nada del intento de juego (ni su enunciado ni su id de juego)');
select is((public.teacher_student_history('a9000000-0000-0000-0000-0000000000a5',
  'a9500000-0000-0000-0000-000000000001', 0, 30) -> 'items' -> 0 ->> 'exercise'), 'PRÁCTICA 2 + 3',
  'el de práctica sí se ve');

select is(public.save_student_sheet('a9000000-0000-0000-0000-0000000000a1', 'a9500000-0000-0000-0000-000000000001',
  'a9a00000-0000-0000-0000-000000000002', '8', true, '8', '[]'::jsonb), 'no_attempt',
  'un intento de juego no genera hoja (aunque haya docente vinculado)');
select is(public.save_student_sheet('a9000000-0000-0000-0000-0000000000a1', 'a9500000-0000-0000-0000-000000000001',
  'a9a00000-0000-0000-0000-000000000001', '5', true, '5', '[]'::jsonb), 'ok',
  'el de práctica sí la genera');
select is((select count(*)::int from public.student_sheets where student_id = 'a9500000-0000-0000-0000-000000000001'), 1,
  'queda solo la hoja del intento de práctica');
select is(jsonb_array_length(public.teacher_student_sheets('a9000000-0000-0000-0000-0000000000a5',
  'a9500000-0000-0000-0000-000000000001', 0, 30) -> 'items'), 1, 'y el docente ve una sola hoja');

select * from finish();
rollback;
