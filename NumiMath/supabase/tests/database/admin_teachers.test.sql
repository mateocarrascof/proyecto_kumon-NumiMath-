begin;
select plan(18);

-- AD2 y AD3: crear y listar docentes. Admin=...a1; docentes b1 (Zoe), b2 (ana), b4 (Bea); b3 sin rol;
-- tutor=...c1 (sin consentimiento: solo para probar permisos del cliente).

insert into auth.users (id, email, raw_app_meta_data) values
  ('ad000000-0000-0000-0000-0000000000a1', 'admin@test.invalid',  '{"role":"admin"}'),
  ('ad000000-0000-0000-0000-0000000000b1', 'zoe@test.invalid',    '{"role":"teacher"}'),
  ('ad000000-0000-0000-0000-0000000000b2', 'ana@test.invalid',    '{"role":"teacher"}'),
  ('ad000000-0000-0000-0000-0000000000b3', 'sinrol@test.invalid', '{}'),
  ('ad000000-0000-0000-0000-0000000000b4', 'bea@test.invalid',    '{"role":"teacher"}'),
  ('ad000000-0000-0000-0000-0000000000c1', 'tutor@test.invalid',  '{}');

set local role service_role;

select is(public.admin_list_teachers(), '[]'::jsonb, 'sin docentes, la lista está vacía');

select is(public.admin_create_teacher('ad000000-0000-0000-0000-0000000000a1',
  'ad000000-0000-0000-0000-0000000000b1', 'Zoe', 'ZZZZ2345'), 'ok', 'el admin crea un docente');
select is(public.admin_create_teacher('ad000000-0000-0000-0000-0000000000a1',
  'ad000000-0000-0000-0000-0000000000b2', 'ana', 'AAAA2345'), 'ok', 'y otro');

select is((select jsonb_agg(e ->> 'name') from jsonb_array_elements(public.admin_list_teachers()) e),
  '["ana", "Zoe"]'::jsonb, 'la lista va en orden alfabético sin distinguir mayúsculas');
select is(public.admin_list_teachers() -> 0 ->> 'email', 'ana@test.invalid', 'la lista trae el correo (de Auth)');
select is(public.admin_list_teachers() -> 0 ->> 'link_code', 'AAAA2345', 'y el código de vínculo');

select is(public.admin_create_teacher('ad000000-0000-0000-0000-0000000000a1',
  'ad000000-0000-0000-0000-0000000000b4', 'Bea', 'AAAA2345'), 'code_taken', 'un código repetido pide reintentar con otro');
select is((select count(*)::int from public.teachers where id = 'ad000000-0000-0000-0000-0000000000b4'), 0,
  'y no deja el docente creado');

select throws_ok($$select public.admin_create_teacher('ad000000-0000-0000-0000-0000000000a1',
  'ad000000-0000-0000-0000-0000000000b3', 'Sin rol', 'QQQQ2345')$$, '42501', 'not_teacher',
  'una cuenta de Auth sin rol de docente no se registra como docente');
select throws_ok($$select public.admin_create_teacher('ad000000-0000-0000-0000-0000000000b1',
  'ad000000-0000-0000-0000-0000000000b4', 'Bea', 'QQQQ2345')$$, '42501', 'not_admin',
  'quien actúa debe ser administrador (un docente no puede)');
select throws_ok($$select public.admin_create_teacher('ad000000-0000-0000-0000-0000000000a1',
  'ad000000-0000-0000-0000-0000000000b1', 'Zoe', 'WWWW2345')$$, '23505', null,
  'un docente que ya existe es un error, no un código repetido');

-- Registro de cambios: uno por cada alta correcta, solo ids (sin correo ni nombre).
select is((select count(*)::int from public.admin_audit
  where admin_id = 'ad000000-0000-0000-0000-0000000000a1' and action = 'teacher_created'), 2,
  'cada alta correcta queda registrada y las fallidas no');
select is((select array_agg(attname::text order by attnum) from pg_attribute
  where attrelid = 'public.admin_audit'::regclass and attnum > 0 and not attisdropped),
  array['seq', 'admin_id', 'action', 'target_id', 'occurred_at'],
  'el registro guarda solo quién, qué, a quién (id) y cuándo');
select throws_ok($$update public.admin_audit set action = 'teacher_created'$$, '42501', null, 'el registro no se edita');
select throws_ok($$delete from public.admin_audit$$, '42501', null, 'ni se borra');

-- Permisos del cliente: nada de esto es llamable ni legible con un token de usuario.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-0000000000a1","role":"authenticated","app_metadata":{"role":"admin"}}', true);
select throws_ok($$select public.admin_list_teachers()$$, '42501', null, 'el cliente no llama a admin_list_teachers');
select throws_ok($$select count(*) from public.admin_audit$$, '42501', null, 'el cliente no lee el registro');
select is((select count(*)::int from public.students) + (select count(*)::int from public.student_attempts), 0,
  'el administrador no ve datos de niños');

select * from finish();
rollback;
