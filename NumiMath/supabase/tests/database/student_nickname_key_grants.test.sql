begin;
select plan(7);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Permisos de student_nickname_key (ADR 0005): anon no; authenticated y service_role sí.

insert into auth.users (id, email) values
  ('fc000000-0000-0000-0000-000000000001', 'g@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('fc100000-0000-0000-0000-000000000001', 'terms',             'tos-g', repeat('a', 64), true),
  ('fc100000-0000-0000-0000-000000000002', 'privacy',           'pp-g',  repeat('b', 64), true),
  ('fc100000-0000-0000-0000-000000000003', 'adult_declaration', 'ad-g',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
values ('fc000000-0000-0000-0000-000000000001', 'grant',
        'fc100000-0000-0000-0000-000000000001', 'fc100000-0000-0000-0000-000000000002', 'web');

select ok(not has_function_privilege('anon', 'public.student_nickname_key(text)', 'execute'),
  'anon no puede ejecutarla (no hay RPC sin sesión)');
select ok(not has_function_privilege('public', 'public.student_nickname_key(text)', 'execute'),
  'public no tiene execute');
select ok(has_function_privilege('authenticated', 'public.student_nickname_key(text)', 'execute'),
  'authenticated sí (lo exige el índice al insertar)');

-- Como anon (lo que hace PostgREST con /rpc sin sesión).
set local role anon;
select throws_ok($$select public.student_nickname_key('Juanito')$$,
  '42501', null, 'anon: llamarla falla con permiso denegado');
reset role;

-- El tutor autenticado sigue pudiendo crear perfiles (el índice evalúa la función con su rol).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"fc000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'Juanito', 1, true)$$,
  'tutor autenticado: crea un perfil');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'JUANITO', 1, true)$$,
  '23505', null, 'tutor autenticado: la regla de apodos sigue funcionando');
reset role;

-- service_role (servidor) también inserta.
set local role service_role;
select lives_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'Pepa', 2, true)$$,
  'service_role: inserta un alumno');
reset role;

select * from finish();
rollback;
