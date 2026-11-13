begin;
select plan(11);
update public.legal_document_versions set is_current = false;

-- Tutor A=...a1 (perfil s1), tutor B=...a2 (perfil s2).
insert into auth.users (id, email) values
  ('dd000000-0000-0000-0000-0000000000a1', 'a@test.invalid'), ('dd000000-0000-0000-0000-0000000000a2', 'b@test.invalid');
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('dd777777-0000-0000-0000-000000000001', 'terms', 'tos-1', repeat('a', 64), true),
  ('dd777777-0000-0000-0000-000000000002', 'privacy', 'pp-1', repeat('b', 64), true),
  ('dd777777-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1', repeat('c', 64), true);
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('dd000000-0000-0000-0000-0000000000a' || n)::uuid, 'grant',
       'dd777777-0000-0000-0000-000000000001', 'dd777777-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('dd500000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-0000000000a1', 'Ana', 1, true),
  ('dd500000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-0000000000a2', 'Cami', 1, true);

set local role service_role;
select is(public.decline_diagnostic('dd000000-0000-0000-0000-0000000000a1', 'dd500000-0000-0000-0000-000000000001', '1-03'),
  'ok', 'el titular rechaza el test de un tema');
select is(public.decline_diagnostic('dd000000-0000-0000-0000-0000000000a1', 'dd500000-0000-0000-0000-000000000001', '1-03'),
  'ok', 'rechazar otra vez no es error (idempotente)');
select is((select count(*)::int from public.diagnostic_declines), 1, 'y queda una sola fila');
select is(public.decline_diagnostic('dd000000-0000-0000-0000-0000000000a2', 'dd500000-0000-0000-0000-000000000001', '1-04'),
  'student_not_found', 'otro tutor no rechaza por un perfil ajeno');
select is(public.decline_diagnostic('dd000000-0000-0000-0000-0000000000a1', 'dd500000-0000-0000-0000-000000000001', 'x'),
  'invalid', 'un código de habilidad inválido no se guarda');
select is((select count(*)::int from unnest(array['public.decline_diagnostic(uuid,uuid,text)']) f
  where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')), 0,
  'solo el servidor ejecuta la función');

-- RLS: cada tutor ve solo lo suyo y nadie escribe directo.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.diagnostic_declines), 1, 'el titular ve su rechazo');
select set_config('request.jwt.claims', '{"sub":"dd000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.diagnostic_declines), 0, 'otro tutor no lo ve');
select throws_ok($$insert into public.diagnostic_declines (student_id, tutor_id, skill_code)
  values ('dd500000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-0000000000a2', '1-05')$$,
  '42501', null, 'ni el tutor escribe directo (solo el servidor)');
select throws_ok($$delete from public.diagnostic_declines$$, '42501', null,
  'y no se puede borrar para volver a habilitarlo');

-- Cascada: al borrar el perfil se borra su rechazo.
reset role;
delete from public.students where id = 'dd500000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.diagnostic_declines), 0, 'se borra junto con el perfil');
select * from finish();
rollback;
