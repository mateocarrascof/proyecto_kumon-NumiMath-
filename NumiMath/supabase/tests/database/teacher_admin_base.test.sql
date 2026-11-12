begin;
select plan(34);
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

-- Sin vínculo, el docente no ve al alumno.
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  false, 'sin vínculo no hay acceso');

select throws_ok($$insert into public.teacher_links (teacher_id, student_id, tutor_id, teacher_name) values
  ('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'Docente X')$$,
  '23502', null, 'el vínculo exige la versión de los términos aceptada');
select throws_ok($$insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000000', 'Docente X')$$,
  '23503', null, 'la versión de los términos debe existir en legal_document_versions');
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Docente X');
select throws_ok($$insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Docente X')$$,
  '23503', null, 'no se puede vincular un alumno de otro tutor');
select is((select terms_version_id::text from public.teacher_links where teacher_id = 'dd000000-0000-0000-0000-000000000011' and student_id = 'b1000000-0000-0000-0000-000000000001') || ' ' ||
  ((select accepted_at from public.teacher_links where teacher_id = 'dd000000-0000-0000-0000-000000000011' and student_id = 'b1000000-0000-0000-0000-000000000001') is not null)::text || ' ' ||
  (select teacher_name from public.teacher_links where teacher_id = 'dd000000-0000-0000-0000-000000000011' and student_id = 'b1000000-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000001 true Docente X',
  'el vínculo guarda la versión de los términos, la fecha de aceptación y el nombre del docente que se mostró');
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  true, 'vínculo activo + consentimiento vigente + perfil activo + rol verificado: acceso');
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000012', 'b1000000-0000-0000-0000-000000000001'),
  false, 'otro docente no ve al alumno');

-- El rol se verifica: si a la cuenta se le quita el rol de docente, el acceso se corta al instante.
reset role;
update auth.users set raw_app_meta_data = '{}' where id = 'dd000000-0000-0000-0000-000000000011';
set local role service_role;
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  false, 'sin rol de docente verificado no hay acceso');
reset role;
update auth.users set raw_app_meta_data = '{"role":"teacher"}' where id = 'dd000000-0000-0000-0000-000000000011';
set local role service_role;
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  true, 'con el rol de vuelta, vuelve el acceso');

-- Quitar el vínculo corta el acceso al instante.
delete from public.teacher_links where teacher_id = 'dd000000-0000-0000-0000-000000000011' and student_id = 'b1000000-0000-0000-0000-000000000001';
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  false, 'sin vínculo (el tutor lo quitó) no hay acceso');
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Docente X');

-- Perfil bloqueado: sin acceso.
select public.block_student('dd000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'tutor_request');
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  false, 'perfil bloqueado: sin acceso');
select public.unblock_student('dd000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001');
select is(public.teacher_can_view('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000001'),
  true, 'desbloqueado: vuelve el acceso');

-- ===== RLS (como usuario autenticado) =====
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('dd000000-0000-0000-0000-000000000012', 'b1000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Docente Y');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.teacher_links), 1, 'el tutor B solo ve sus vínculos');
select is((select count(*)::int from public.teacher_links where tutor_id = 'dd000000-0000-0000-0000-000000000001'),
  0, 'el tutor B no ve los del tutor A');
select throws_ok($$insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('dd000000-0000-0000-0000-000000000011', 'b1000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Docente X')$$,
  '42501', null, 'el tutor no inserta vínculos (solo el servidor)');
select throws_ok($$update public.teacher_links set teacher_name = 'otra'$$, '42501', null, 'el tutor no modifica vínculos (solo los lee y los borra)');
select is((select count(*)::int from public.teachers), 0, 'un tutor no lee docentes');

select set_config('request.jwt.claims', '{"sub":"dd000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select is((select count(*)::int from public.teacher_links), 0, 'sin el rol docente en el token no lee ni sus propios vínculos');
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-0000-0000-000000000012","role":"authenticated","app_metadata":{"role":"teacher"}}', true);
select is((select count(*)::int from public.teachers), 1, 'el docente lee solo su propia fila');
select is((select count(*)::int from public.teacher_links), 1, 'el docente lee solo sus vínculos');
select is((select count(*)::int from public.student_attempts) + (select count(*)::int from public.students), 0,
  'el docente no ve filas de tablas de niños (RLS por tutor)');

reset role;
-- Revocar borra los vínculos del tutor B y volver a consentir no los restaura.
select is((select count(*)::int from public.teacher_links where tutor_id = 'dd000000-0000-0000-0000-000000000002'), 1, 'antes de revocar hay vínculo');
select lives_ok($$select public.revoke_consent('dd000000-0000-0000-0000-000000000002')$$, 'el tutor B revoca su consentimiento');
select is((select count(*)::int from public.teacher_links where tutor_id = 'dd000000-0000-0000-0000-000000000002'), 0, 'revocar borra los vínculos');
select throws_ok($$insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name) values
  ('dd000000-0000-0000-0000-000000000012', 'b1000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Docente Y')$$,
  '42501', 'consent_required', 'sin consentimiento vigente no se puede crear un vínculo');

select * from finish();
rollback;
