begin;
select plan(31);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Base de docentes y administradores. Tutores A=...01 y B=...02; docentes X=...11 e Y=...12;
-- admin Z=...21. Alumno de A: b1..01; alumno de B: b1..02.

insert into auth.users (id, email, raw_app_meta_data) values
  ('dd000000-0000-0000-0000-000000000001', 'a@test.invalid', '{}'),
  ('dd000000-0000-0000-0000-000000000002', 'b@test.invalid', '{}'),
  ('dd000000-0000-0000-0000-000000000011', 'x@test.invalid', '{"role":"teacher"}'),
  ('dd000000-0000-0000-0000-000000000012', 'y@test.invalid', '{"role":"teacher"}'),
  ('dd000000-0000-0000-0000-000000000021', 'z@test.invalid', '{"role":"admin"}');
-- El rol de user_metadata (editable por el usuario) NO cuenta: sigue siendo tutor.
insert into auth.users (id, email, raw_user_meta_data) values
  ('dd000000-0000-0000-0000-000000000031', 'w@test.invalid', '{"role":"admin"}');

select is((select count(*)::int from public.tutors where id in (
  'dd000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000002',
  'dd000000-0000-0000-0000-000000000031')), 3, 'usuarios sin rol (o con rol solo en user_metadata) son tutores');
select is((select count(*)::int from public.tutors where id in (
  'dd000000-0000-0000-0000-000000000011', 'dd000000-0000-0000-0000-000000000012',
  'dd000000-0000-0000-0000-000000000021')), 0, 'docentes y admin NO se convierten en tutores');

-- Camino real de GoTrue (insert sin rol y luego UPDATE de app_metadata): no queda como tutor.
insert into auth.users (id, email) values ('dd000000-0000-0000-0000-000000000041', 'u@test.invalid');
select is((select count(*)::int from public.tutors where id = 'dd000000-0000-0000-0000-000000000041'), 1, 'sin rol, al insertar, es tutor');
update auth.users set raw_app_meta_data = '{"role":"teacher"}' where id = 'dd000000-0000-0000-0000-000000000041';
select is((select count(*)::int from public.tutors where id = 'dd000000-0000-0000-0000-000000000041'), 0, 'al recibir el rol por UPDATE se retira de tutors');
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('dd000000-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into auth.users (id, email) values ('dd000000-0000-0000-0000-000000000042', 'v@test.invalid');
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
values ('dd000000-0000-0000-0000-000000000042', 'grant',
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('b1000000-0000-0000-0000-000000000042', 'dd000000-0000-0000-0000-000000000042', 'Zoe', 1, true);
select throws_ok($$update auth.users set raw_app_meta_data = '{"role":"admin"}' where id = 'dd000000-0000-0000-0000-000000000042'$$,
  '42501', null, 'un tutor con datos no se convierte en admin en silencio');

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('b1000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'Ana',  2, true),
  ('b1000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000002', 'Beto', 1, true);

set local role service_role;
insert into public.teachers (id, name, link_code) values
  ('dd000000-0000-0000-0000-000000000011', 'Docente X', 'ABCD2345'),
  ('dd000000-0000-0000-0000-000000000012', 'Docente Y', 'WXYZ6789');

select throws_ok($$insert into public.teachers (id, name, link_code)
  values ('dd000000-0000-0000-0000-000000000021', 'Otro', 'ABCD2345')$$, '23505', null, 'el código de vínculo es único');
select throws_ok($$insert into public.teachers (id, name, link_code)
  values ('dd000000-0000-0000-0000-000000000021', 'Otro', 'abc')$$, '23514', null, 'el código tiene 8 caracteres sin ambiguos');
select throws_ok($$insert into public.teachers (id, name, link_code)
  values ('dd000000-0000-0000-0000-000000000021', repeat('n', 61), 'QRST2345')$$, '23514', null, 'el nombre admite hasta 60');
select throws_ok($$update public.teachers set link_code = 'QRST2345'
  where id = 'dd000000-0000-0000-0000-000000000011'$$, '42501', null, 'el código es inmutable');

-- Sin vínculo ni autorización, el docente no ve al alumno.
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  false, 'sin vínculo no hay acceso');

insert into public.teacher_links (teacher_id, student_id, tutor_id) values
  ('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001');
select throws_ok($$insert into public.teacher_links (teacher_id, student_id, tutor_id) values
  ('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000001')$$,
  '23503', null, 'no se puede vincular un alumno de otro tutor');
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  false, 'vínculo sin autorización activa: sin acceso');

insert into public.tutor_sharing (tutor_id, teacher_view, terms_version)
values ('dd000000-0000-0000-0000-000000000001', true, 'tos-2');
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  true, 'vínculo + consentimiento + autorización + perfil activo: acceso');
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000012', 'b1000000-0000-0000-0000-000000000001'),
  false, 'otro docente no ve al alumno');
select is((select count(*)::int from public.tutor_sharing_events
  where tutor_id = 'dd000000-0000-0000-0000-000000000001' and setting = 'teacher_view' and enabled and terms_version = 'tos-2'),
  1, 'activar la vista docente deja un evento con la versión');
update public.tutor_sharing set teacher_view = false where tutor_id = 'dd000000-0000-0000-0000-000000000001';
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  false, 'apagar la casilla corta el acceso al instante');
select is((select count(*)::int from public.tutor_sharing_events
  where tutor_id = 'dd000000-0000-0000-0000-000000000001' and not enabled), 1, 'apagarla deja otro evento');
select throws_ok($$update public.tutor_sharing_events set enabled = true$$, '42501', null, 'los eventos no se editan');
update public.tutor_sharing set teacher_view = true where tutor_id = 'dd000000-0000-0000-0000-000000000001';

-- Perfil bloqueado: sin acceso.
select public.block_student('dd000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'tutor_request');
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  false, 'perfil bloqueado: sin acceso');
select public.unblock_student('dd000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001');
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  true, 'desbloqueado: vuelve el acceso');

-- ===== RLS (como usuario autenticado) =====
insert into public.teacher_links (teacher_id, student_id, tutor_id) values
  ('dd000000-0000-0000-0000-000000000012', 'b1000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.teacher_links), 1, 'el tutor B solo ve sus vínculos');
select is((select count(*)::int from public.teacher_links where tutor_id = 'dd000000-0000-0000-0000-000000000001'),
  0, 'el tutor B no ve los del tutor A');
select throws_ok($$insert into public.teacher_links (teacher_id, student_id, tutor_id) values
  ('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'el tutor no inserta vínculos (solo el servidor)');
select throws_ok($$update public.tutor_sharing set sheets = true$$, '42501', null, 'el tutor no escribe su autorización por la base (solo el servidor)');
select is((select count(*)::int from public.teachers), 0, 'un tutor no lee docentes');

select set_config('request.jwt.claims', '{"sub":"dd000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select is((select count(*)::int from public.teachers), 1, 'el docente lee solo su propia fila');
select is((select count(*)::int from public.teacher_links), 1, 'el docente lee solo sus vínculos');
select is((select count(*)::int from public.student_attempts) + (select count(*)::int from public.students), 0,
  'el docente no ve filas de tablas de niños (RLS por tutor)');

reset role;
-- Revocar borra los vínculos del tutor B y volver a consentir no los restaura.
select is((select count(*)::int from public.teacher_links where tutor_id = 'dd000000-0000-0000-0000-000000000002'), 1, 'antes de revocar hay vínculo');
select lives_ok($$select public.revoke_consent('dd000000-0000-0000-0000-000000000002')$$, 'el tutor B revoca su consentimiento');
select is((select count(*)::int from public.teacher_links where tutor_id = 'dd000000-0000-0000-0000-000000000002'), 0, 'revocar borra los vínculos');

select * from finish();
rollback;
