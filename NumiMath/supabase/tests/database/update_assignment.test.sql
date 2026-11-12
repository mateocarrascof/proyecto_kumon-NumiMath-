begin;
select plan(9);
update public.legal_document_versions set is_current = false;

-- T8. Tutor A=...a1 (perfil s1), tutor B=...a2 (perfil s3). Tarea t1 pendiente, t2 ya respondida.
insert into auth.users (id, email) values
  ('ed000000-0000-0000-0000-0000000000a1', 'a@test.invalid'), ('ed000000-0000-0000-0000-0000000000a2', 'b@test.invalid');
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('77777777-0000-0000-0000-000000000001', 'terms', 'tos-1', repeat('a', 64), true),
  ('77777777-0000-0000-0000-000000000002', 'privacy', 'pp-1', repeat('b', 64), true),
  ('77777777-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1', repeat('c', 64), true);
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('ed000000-0000-0000-0000-0000000000a' || n)::uuid, 'grant',
       '77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('ed500000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-0000000000a1', 'Ana', 1, true),
  ('ed500000-0000-0000-0000-000000000003', 'ed000000-0000-0000-0000-0000000000a2', 'Cami', 1, true);
insert into public.assigned_exercises (id, student_id, tutor_id, text, answer, answered_at, correct) values
  ('ed600000-0000-0000-0000-000000000001', 'ed500000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-0000000000a1', '1 + 1', 2, null, null),
  ('ed600000-0000-0000-0000-000000000002', 'ed500000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-0000000000a1', '2 + 2', 4, now(), true);

set local role service_role;
select is(public.update_assignment('ed000000-0000-0000-0000-0000000000a2', 'ed500000-0000-0000-0000-000000000001',
  'ed600000-0000-0000-0000-000000000001', 'HACKEADA', 9), 'not_found', 'otro tutor no edita la tarea ajena');
select is(public.update_assignment('ed000000-0000-0000-0000-0000000000a2', 'ed500000-0000-0000-0000-000000000003',
  'ed600000-0000-0000-0000-000000000001', 'HACKEADA', 9), 'not_found', 'ni usando su propio perfil con el id ajeno');
select is((select text from public.assigned_exercises where id = 'ed600000-0000-0000-0000-000000000001'), '1 + 1', 'y la tarea no cambió');
select is(public.update_assignment('ed000000-0000-0000-0000-0000000000a1', 'ed500000-0000-0000-0000-000000000001',
  'ed600000-0000-0000-0000-000000000002', '3 + 3', 6), 'answered', 'una tarea respondida no se edita');
select is((select text || answer from public.assigned_exercises where id = 'ed600000-0000-0000-0000-000000000002'), '2 + 24', 'y queda igual');
select is(public.update_assignment('ed000000-0000-0000-0000-0000000000a1', 'ed500000-0000-0000-0000-000000000001',
  'ed600000-0000-0000-0000-000000000001', '5 + 5', 10), 'ok', 'el titular edita una pendiente');
select is((select text || '|' || answer from public.assigned_exercises where id = 'ed600000-0000-0000-0000-000000000001'), '5 + 5|10', 'enunciado y respuesta cambiados');
select is(public.update_assignment('ed000000-0000-0000-0000-0000000000a1', 'ed500000-0000-0000-0000-000000000001',
  gen_random_uuid(), 'x', 1), 'not_found', 'una tarea inexistente da not_found');
select is((select count(*)::int from unnest(array['public.update_assignment(uuid,uuid,uuid,text,integer)']) f
  where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')), 0, 'solo el servidor la ejecuta');
select * from finish();
rollback;
