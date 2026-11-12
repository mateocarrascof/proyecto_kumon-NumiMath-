begin;
select plan(41);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- T25 y T26: el tutor vincula un docente con UN hijo y lo quita. Tutor A=...c1 (perfiles s1 y s2),
-- tutor B=...c2 (perfil s3); docentes X=...b1 (código XXXX2345) e Y=...b2 (YYYY2345).

insert into auth.users (id, email, raw_app_meta_data) values
  ('ba000000-0000-0000-0000-0000000000c1', 'a@test.invalid', '{}'),
  ('ba000000-0000-0000-0000-0000000000c2', 'b@test.invalid', '{}'),
  ('ba000000-0000-0000-0000-0000000000b1', 'x@test.invalid', '{"role":"teacher"}'),
  ('ba000000-0000-0000-0000-0000000000b2', 'y@test.invalid', '{"role":"teacher"}');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true),
  ('11111111-0000-0000-0000-000000000010', 'teacher_authorization', 'doc-0', repeat('d', 64), false),
  ('11111111-0000-0000-0000-000000000011', 'teacher_authorization', 'doc-1', repeat('e', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('ba000000-0000-0000-0000-0000000000c' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('b4000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-0000000000c1', 'Ana', 2, true),
  ('b4000000-0000-0000-0000-000000000002', 'ba000000-0000-0000-0000-0000000000c1', 'Ani', 3, true),
  ('b4000000-0000-0000-0000-000000000003', 'ba000000-0000-0000-0000-0000000000c2', 'Beto', 1, true);

set local role service_role;
insert into public.teachers (id, name, link_code) values
  ('ba000000-0000-0000-0000-0000000000b1', 'Docente X', 'XXXX2345'),
  ('ba000000-0000-0000-0000-0000000000b2', 'Docente Y', 'YYYY2345');

-- ===== el texto legal nuevo no afecta el consentimiento =====
select is(public.has_active_consent('ba000000-0000-0000-0000-0000000000c1'), true,
  'un texto legal nuevo (teacher_authorization) no altera el consentimiento vigente');
select throws_ok($$insert into public.legal_document_versions (kind, version, content_sha256)
  values ('otro_tipo', 'v', repeat('f', 64))$$, '23514', null, 'solo existen los tipos de texto conocidos');

-- ===== buscar por código =====
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', ' xxxx2345 ') ->> 'name', 'Docente X',
  'el código se busca sin distinguir mayúsculas ni espacios y devuelve el nombre');
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'XXXX2345') ->> 'terms_version', 'doc-1',
  'junto con el texto legal vigente que el tutor debe aceptar');
select is((public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'XXXX2345') - 'teacher_id' - 'terms_id' - 'terms_sha256' - 'terms_version' - 'name' - 'status'),
  '{}'::jsonb, 'y nada más: ningún dato del docente salvo su nombre');
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000003', 'XXXX2345') ->> 'status', 'student_not_found',
  'un perfil de otro tutor no se puede usar');
select is((select failed::int from public.link_code_attempts where tutor_id = 'ba000000-0000-0000-0000-0000000000c1'), 0,
  'y el éxito deja la cuenta de fallos en cero');

-- ===== límite de intentos: 5 fallos y 15 minutos =====
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'NOEXISTE') ->> 'status', 'not_found', 'un código inexistente');
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'ZZZZ2345') ->> 'status', 'not_found',
  'y otro con buen formato dan el mismo estado');
select public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001', 'AAAA2345');
select public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001', 'AAAA2346');
select public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001', 'AAAA2347');
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'XXXX2345') ->> 'status', 'locked',
  'tras 5 fallos seguidos queda bloqueado, aunque el siguiente código sea el correcto');
select ok((public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'XXXX2345') ->> 'retry_after')::int between 1 and 900,
  'y dice cuántos segundos faltan (hasta 15 minutos)');
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c2',
  'b4000000-0000-0000-0000-000000000003', 'XXXX2345') ->> 'status', 'ok',
  'el bloqueo es por tutor: otro tutor no se ve afectado');

reset role;
update public.link_code_attempts set locked_until = now() - interval '1 minute'
  where tutor_id = 'ba000000-0000-0000-0000-0000000000c1';
set local role service_role;
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'XXXX2345') ->> 'status', 'ok', 'vencido el bloqueo, vuelve a funcionar');
select is((select failed::int from public.link_code_attempts where tutor_id = 'ba000000-0000-0000-0000-0000000000c1'), 0,
  'y parte de cero');

-- Un docente al que se le quitó el rol no se encuentra por su código.
reset role;
update auth.users set raw_app_meta_data = '{}' where id = 'ba000000-0000-0000-0000-0000000000b2';
set local role service_role;
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'YYYY2345') ->> 'status', 'not_found', 'sin rol de docente, el código ya no sirve');
reset role;
update auth.users set raw_app_meta_data = '{"role":"teacher"}' where id = 'ba000000-0000-0000-0000-0000000000b2';
set local role service_role;

-- ===== crear el vínculo (cada hijo por separado) =====
select is(public.create_teacher_link('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001',
  'ba000000-0000-0000-0000-0000000000b1', 'Docente X', '11111111-0000-0000-0000-000000000011'), 'ok', 'el tutor vincula al docente con un hijo');
select is((select terms_version_id::text || ' ' || teacher_name || ' ' || (accepted_at is not null)::text
  from public.teacher_links where student_id = 'b4000000-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000011 Docente X true', 'queda la versión aceptada, el nombre mostrado y la fecha');
select is(public.create_teacher_link('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001',
  'ba000000-0000-0000-0000-0000000000b1', 'Docente X', '11111111-0000-0000-0000-000000000011'), 'already_linked', 'no se duplica');
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'XXXX2345') ->> 'status', 'already_linked', 'y la búsqueda avisa que ya estaba vinculado');
select is((select count(*)::int from public.teacher_links where student_id = 'b4000000-0000-0000-0000-000000000002'), 0,
  'el otro hijo del mismo tutor NO queda vinculado');
select is(public.create_teacher_link('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000002',
  'ba000000-0000-0000-0000-0000000000b1', 'Docente X', '11111111-0000-0000-0000-000000000011'), 'ok', 'cada hijo se vincula por separado');
select is(public.create_teacher_link('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000003',
  'ba000000-0000-0000-0000-0000000000b1', 'Docente X', '11111111-0000-0000-0000-000000000011'), 'student_not_found',
  'no se vincula un perfil de otro tutor');
select is(public.create_teacher_link('ba000000-0000-0000-0000-0000000000c2', 'b4000000-0000-0000-0000-000000000003',
  'ba000000-0000-0000-0000-0000000000b1', 'Otro nombre', '11111111-0000-0000-0000-000000000011'), 'name_changed',
  'si el nombre ya no es el que se mostró, hay que volver a buscar');
select is(public.create_teacher_link('ba000000-0000-0000-0000-0000000000c2', 'b4000000-0000-0000-0000-000000000003',
  'ba000000-0000-0000-0000-0000000000b1', 'Docente X', '11111111-0000-0000-0000-000000000010'), 'terms_outdated',
  'un texto que ya no es el vigente no sirve');

-- ===== listar y quitar =====
select is((select jsonb_agg(e ->> 'name') from jsonb_array_elements(
  public.list_student_teachers('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001')) e),
  '["Docente X"]'::jsonb, 'el tutor ve los docentes vinculados a su hijo (con el nombre, nunca el correo)');
select is(public.list_student_teachers('ba000000-0000-0000-0000-0000000000c2', 'b4000000-0000-0000-0000-000000000001'), null,
  'y no los de un perfil ajeno');
select is(public.remove_teacher_link('ba000000-0000-0000-0000-0000000000c2', 'b4000000-0000-0000-0000-000000000001',
  'ba000000-0000-0000-0000-0000000000b1'), 'not_found', 'otro tutor no puede quitar el vínculo');
select is(public.remove_teacher_link('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001',
  'ba000000-0000-0000-0000-0000000000b1'), 'ok', 'el tutor quita el vínculo');
select is((select count(*)::int from public.students where id = 'b4000000-0000-0000-0000-000000000001')
  + (select count(*)::int from public.teacher_links where student_id = 'b4000000-0000-0000-0000-000000000002'), 2,
  'quitarlo no toca al niño y el otro vínculo sigue');
select is(public.teacher_can_view('ba000000-0000-0000-0000-0000000000b1', 'b4000000-0000-0000-0000-000000000001'), false,
  'sin vínculo el docente ya no puede ver al niño');

-- ===== consentimiento revocado =====
select lives_ok($$select public.revoke_consent('ba000000-0000-0000-0000-0000000000c2')$$, 'el tutor B revoca su consentimiento');
select is(public.create_teacher_link('ba000000-0000-0000-0000-0000000000c2', 'b4000000-0000-0000-0000-000000000003',
  'ba000000-0000-0000-0000-0000000000b1', 'Docente X', '11111111-0000-0000-0000-000000000011'), 'student_not_found',
  'sin consentimiento vigente (el perfil queda bloqueado) no se crea ningún vínculo');
select lives_ok($$select public.revoke_consent('ba000000-0000-0000-0000-0000000000c1')$$, 'el tutor A revoca el suyo');
select is((select count(*)::int from public.teacher_links where tutor_id = 'ba000000-0000-0000-0000-0000000000c1'), 0,
  'revocar el consentimiento borra los vínculos del tutor');
select is(public.remove_teacher_link('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001',
  'ba000000-0000-0000-0000-0000000000b1'), 'not_found', 'quitar un vínculo ya borrado no falla');

-- ===== el contador no se reinicia con un acierto =====
insert into public.link_code_attempts (tutor_id, failed) values ('ba000000-0000-0000-0000-0000000000c1', 0)
  on conflict (tutor_id) do update set failed = 0, locked_until = null;
select public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001', 'AAAA2345');
select public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001', 'AAAA2346');
select public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001', 'AAAA2347');
select public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001', 'XXXX2345');
select is((select failed::int from public.link_code_attempts where tutor_id = 'ba000000-0000-0000-0000-0000000000c1'), 3,
  'un código válido (aunque ya esté vinculado) no reinicia los fallos');
select public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001', 'AAAA2348');
select public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1', 'b4000000-0000-0000-0000-000000000001', 'AAAA2349');
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'YYYY2345') ->> 'status', 'locked',
  'intercalar un código válido no evita el bloqueo');
reset role;
update public.link_code_attempts set locked_until = null, failed = 4, updated_at = now() - interval '20 minutes'
  where tutor_id = 'ba000000-0000-0000-0000-0000000000c1';
set local role service_role;
select is(public.teacher_link_lookup('ba000000-0000-0000-0000-0000000000c1',
  'b4000000-0000-0000-0000-000000000001', 'YYYY2345') ->> 'status', 'ok', '15 minutos sin fallos y la cuenta vuelve a cero');
select is((select failed::int from public.link_code_attempts where tutor_id = 'ba000000-0000-0000-0000-0000000000c1'), 0,
  'y queda en cero');

-- ===== quitar solo por el servidor =====
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ba000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select throws_ok($$delete from public.teacher_links$$, '42501', null,
  'el tutor no puede borrar vínculos directo desde el cliente (solo con PIN, por el servidor)');
reset role;

-- ===== permisos =====
select is((select count(*)::int from unnest(array[
  'public.teacher_link_lookup(uuid,uuid,text)', 'public.create_teacher_link(uuid,uuid,uuid,text,uuid)',
  'public.list_student_teachers(uuid,uuid)', 'public.remove_teacher_link(uuid,uuid,uuid)'
]) f where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')), 0,
  'ni anon ni authenticated ejecutan las funciones de vínculos');

select * from finish();
rollback;
