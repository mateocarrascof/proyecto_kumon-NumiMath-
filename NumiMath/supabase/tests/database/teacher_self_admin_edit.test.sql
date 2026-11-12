begin;
select plan(33);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- D2/D3: perfil del docente. AD4/AD5: editar y eliminar. Admin=...a1; docente T=...b1 (con vínculo a un
-- niño del tutor c1) y T2=...b2; b3 sin rol; tutor c1 con un perfil, un intento y un vínculo.

insert into auth.users (id, email, raw_app_meta_data) values
  ('af000000-0000-0000-0000-0000000000a1', 'admin@test.invalid', '{"role":"admin"}'),
  ('af000000-0000-0000-0000-0000000000b1', 'uno@test.invalid',   '{"role":"teacher"}'),
  ('af000000-0000-0000-0000-0000000000b2', 'dos@test.invalid',   '{"role":"teacher"}'),
  ('af000000-0000-0000-0000-0000000000b3', 'sinrol@test.invalid', '{}'),
  ('af000000-0000-0000-0000-0000000000c1', 'tutor@test.invalid', '{}');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
values ('af000000-0000-0000-0000-0000000000c1', 'grant',
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted)
values ('b3000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-0000000000c1', 'Ana', 2, true);

set local role service_role;
insert into public.teachers (id, name, link_code) values
  ('af000000-0000-0000-0000-0000000000b1', 'Uno', 'UUUU2345'),
  ('af000000-0000-0000-0000-0000000000b2', 'Dos', 'DDDD2345');
insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name)
values ('af000000-0000-0000-0000-0000000000b1', 'b3000000-0000-0000-0000-000000000001',
  'af000000-0000-0000-0000-0000000000c1', '11111111-0000-0000-0000-000000000001', 'Uno');
select lives_ok($$select public.record_attempt('af000000-0000-0000-0000-0000000000c1',
  'b3000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', '2-01', '1 + 1', true)$$,
  'datos de prueba: un intento del niño');

-- ===== D2/D3: perfil del docente =====
select is(public.teacher_profile('af000000-0000-0000-0000-0000000000b1'),
  '{"name": "Uno", "link_code": "UUUU2345"}'::jsonb, 'el docente ve su nombre y su código');
select is(public.teacher_profile('af000000-0000-0000-0000-0000000000b3'), null, 'una cuenta sin rol de docente no tiene perfil');
select is(public.teacher_profile('af000000-0000-0000-0000-0000000000a1'), null, 'ni el administrador');
select is(public.teacher_profile('af000000-0000-0000-0000-0000000000ff'), null, 'ni un id inexistente');

-- ===== AD4: editar =====
select is(public.admin_email_in_use('DOS@test.invalid', 'af000000-0000-0000-0000-0000000000b1'), true,
  'el correo de otra cuenta está en uso (sin distinguir mayúsculas)');
select is(public.admin_email_in_use('dos@test.invalid', 'af000000-0000-0000-0000-0000000000b2'), false,
  'el correo propio no cuenta como ocupado');
select is(public.admin_email_in_use('libre@test.invalid', 'af000000-0000-0000-0000-0000000000b1'), false,
  'un correo libre no está en uso');
select is(public.admin_get_teacher('af000000-0000-0000-0000-0000000000b1') ->> 'email', 'uno@test.invalid', 'el admin lee el correo del docente');
select is(public.admin_get_teacher('af000000-0000-0000-0000-0000000000b3'), null, 'una cuenta sin rol no es un docente editable');

select is(public.admin_update_teacher('af000000-0000-0000-0000-0000000000a1',
  'af000000-0000-0000-0000-0000000000b1', 'Uno', false), 'unchanged', 'sin cambios: no se hace nada');
select is((select count(*)::int from public.admin_audit where action = 'teacher_updated'), 0, 'y no se registra');

select is(public.admin_update_teacher('af000000-0000-0000-0000-0000000000a1',
  'af000000-0000-0000-0000-0000000000b1', 'Uno Nuevo', false), 'ok', 'cambiar el nombre funciona');
select is((select name from public.teachers where id = 'af000000-0000-0000-0000-0000000000b1'), 'Uno Nuevo', 'el nombre quedó cambiado');
select is((select link_code from public.teachers where id = 'af000000-0000-0000-0000-0000000000b1'), 'UUUU2345', 'el código no cambia');
select is((select count(*)::int from public.teacher_links where teacher_id = 'af000000-0000-0000-0000-0000000000b1'), 1, 'se conservan los vínculos');
select is(public.admin_update_teacher('af000000-0000-0000-0000-0000000000a1',
  'af000000-0000-0000-0000-0000000000b2', 'Dos', true), 'ok', 'cambiar solo el correo (ya hecho en Auth) también se registra');
select is((select count(*)::int from public.admin_audit where action = 'teacher_updated'), 2, 'dos cambios, dos registros');
select throws_ok($$select public.admin_update_teacher('af000000-0000-0000-0000-0000000000b1',
  'af000000-0000-0000-0000-0000000000b2', 'X', false)$$, '42501', 'not_admin', 'solo un administrador edita');
select is(public.admin_update_teacher('af000000-0000-0000-0000-0000000000a1',
  'af000000-0000-0000-0000-0000000000b3', 'X', false), 'not_found', 'editar algo que no es un docente: no existe');

-- Cambiar el correo cierra las sesiones: sin sesión no hay token de refresco que renovar.
reset role;
insert into auth.sessions (id, user_id) values
  ('af000000-0000-0000-0000-0000000000e1', 'af000000-0000-0000-0000-0000000000b1'),
  ('af000000-0000-0000-0000-0000000000e2', 'af000000-0000-0000-0000-0000000000b1'),
  ('af000000-0000-0000-0000-0000000000e3', 'af000000-0000-0000-0000-0000000000b2');
insert into auth.refresh_tokens (token, user_id, session_id) values
  ('rt-uno', 'af000000-0000-0000-0000-0000000000b1', 'af000000-0000-0000-0000-0000000000e1'),
  ('rt-dos', 'af000000-0000-0000-0000-0000000000b2', 'af000000-0000-0000-0000-0000000000e3');
set local role service_role;
select throws_ok($$select public.admin_revoke_teacher_sessions('af000000-0000-0000-0000-0000000000b1',
  'af000000-0000-0000-0000-0000000000b2')$$, '42501', 'not_admin', 'solo un administrador cierra sesiones');
select is(public.admin_revoke_teacher_sessions('af000000-0000-0000-0000-0000000000a1',
  'af000000-0000-0000-0000-0000000000b1'), 2, 'se cierran las 2 sesiones del docente');
reset role;
select is((select count(*)::int from auth.refresh_tokens where user_id = 'af000000-0000-0000-0000-0000000000b1'), 0,
  'y sus tokens de refresco desaparecen (ya no puede renovar la sesión)');
select is((select count(*)::int from auth.sessions where user_id = 'af000000-0000-0000-0000-0000000000b2'), 1,
  'las sesiones de otro docente no se tocan');
set local role service_role;
select is(public.admin_revoke_teacher_sessions('af000000-0000-0000-0000-0000000000a1',
  'af000000-0000-0000-0000-0000000000b3'), 0, 'una cuenta que no es de docente no se toca');

-- ===== AD5: eliminar =====
-- Borrar la cuenta de Auth (lo hace GoTrue desde el servidor): el perfil y los vínculos caen por
-- cascada; los datos del niño NO se tocan.
reset role;
delete from auth.users where id = 'af000000-0000-0000-0000-0000000000b1';
set local role service_role;
select is((select count(*)::int from public.teachers where id = 'af000000-0000-0000-0000-0000000000b1')
  + (select count(*)::int from public.teacher_links where teacher_id = 'af000000-0000-0000-0000-0000000000b1'), 0,
  'se borran el perfil del docente y sus vínculos');
select is((select count(*)::int from public.students where id = 'b3000000-0000-0000-0000-000000000001')
  + (select count(*)::int from public.student_attempts where student_id = 'b3000000-0000-0000-0000-000000000001'), 2,
  'el perfil y los intentos del niño NO se tocan');
select is(public.teacher_profile('af000000-0000-0000-0000-0000000000b1'), null, 'el docente eliminado ya no tiene perfil');
select is(public.teacher_can_view('af000000-0000-0000-0000-0000000000b1', 'b3000000-0000-0000-0000-000000000001'), false,
  'y ya no puede ver al niño, aunque su token siguiera vigente');

select lives_ok($$select public.admin_record_teacher_deleted('af000000-0000-0000-0000-0000000000a1',
  'af000000-0000-0000-0000-0000000000b1')$$, 'el administrador deja constancia de la baja');
select is((select count(*)::int from public.admin_audit where action = 'teacher_deleted'
  and target_id = 'af000000-0000-0000-0000-0000000000b1'), 1, 'queda un registro de baja (solo ids)');

-- Permisos: ninguna de las funciones nuevas es ejecutable por el cliente (solo el servidor).
select is((select count(*)::int from unnest(array[
  'public.teacher_profile(uuid)', 'public.admin_get_teacher(uuid)',
  'public.admin_update_teacher(uuid,uuid,text,boolean)',
  'public.admin_record_teacher_deleted(uuid,uuid)', 'public.admin_email_in_use(text,uuid)',
  'public.admin_revoke_teacher_sessions(uuid,uuid)'
]) f where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')), 0,
  'anon y authenticated no ejecutan las funciones de docentes');
select is((select count(*)::int from unnest(array[
  'public.teacher_profile(uuid)', 'public.admin_get_teacher(uuid)',
  'public.admin_update_teacher(uuid,uuid,text,boolean)',
  'public.admin_record_teacher_deleted(uuid,uuid)', 'public.admin_email_in_use(text,uuid)',
  'public.admin_revoke_teacher_sessions(uuid,uuid)'
]) f where has_function_privilege('service_role', f, 'execute')), 6,
  'solo el servidor (service_role) las ejecuta');

select * from finish();
rollback;
