begin;
select plan(10);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Un token de administrador, usado directamente contra la base (como lo haría PostgREST con la llave
-- pública), NO puede leer ni escribir datos de niños. Hay datos reales sembrados para que "0 filas"
-- no sea trivial. Tutor=...c1 con perfil, intento, racha, progreso, tarea, PIN y consumo de IA.

insert into auth.users (id, email, raw_app_meta_data) values
  ('ae000000-0000-0000-0000-0000000000a1', 'admin@test.invalid', '{"role":"admin"}'),
  ('ae000000-0000-0000-0000-0000000000c1', 'tutor@test.invalid', '{}');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
values ('ae000000-0000-0000-0000-0000000000c1', 'grant',
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted)
values ('b2000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-0000000000c1', 'Ana', 2, true);

set local role service_role;
select lives_ok($$
  select public.record_attempt('ae000000-0000-0000-0000-0000000000c1',
    'b2000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001',
    '2-01', '7 + 5', true, current_date, 1, 12);
  select public.create_assignment('ae000000-0000-0000-0000-0000000000c1',
    'b2000000-0000-0000-0000-000000000001', 'Cuánto es 3 + 4', 7);
  select public.set_tutor_pin('ae000000-0000-0000-0000-0000000000c1', 'hash-de-prueba-0123456789-abcdef');
  select public.consume_usage('ae000000-0000-0000-0000-0000000000c1',
    'b2000000-0000-0000-0000-000000000001', 1, 10, 50);
$$, 'datos de prueba: intento, racha, progreso, tarea, PIN y consumo del niño');
reset role;

-- Cuenta filas visibles de una tabla; -1 si no hay permiso de lectura.
create function pg_temp.visible(p_table regclass) returns int
language plpgsql as $$
declare n int;
begin
  execute format('select count(*) from %s', p_table) into n;
  return n;
exception when insufficient_privilege then
  return -1;
end;
$$;

-- Sanidad: el propio tutor SÍ ve su perfil (por eso el 0 del administrador significa algo).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ae000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is(pg_temp.visible('public.students'), 1, 'sanidad: el tutor ve su perfil');

-- ===== Con el token del administrador =====
select set_config('request.jwt.claims',
  '{"sub":"ae000000-0000-0000-0000-0000000000a1","role":"authenticated","app_metadata":{"role":"admin"}}', true);

select is((select count(*)::int from unnest(array[
  'public.students', 'public.student_attempts', 'public.student_skill_progress',
  'public.student_daily_streaks', 'public.assigned_exercises', 'public.consents',
  'public.tutors', 'public.tutor_pins', 'public.usage_student_daily', 'public.usage_tutor_daily',
  'public.student_status_events', 'public.declaration_evidence', 'public.consent_evidence',
  'public.student_creation_log', 'public.teacher_links', 'public.teachers', 'public.admin_audit'
]::regclass[]) t where pg_temp.visible(t) > 0), 0,
  'el administrador no lee ninguna fila de tablas de niños, de tutores ni de vínculos');

select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('ae000000-0000-0000-0000-0000000000a1', 'Intruso', 1, true)$$, null, null,
  'el administrador no crea perfiles de niños');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('ae000000-0000-0000-0000-0000000000c1', 'Intruso', 1, true)$$, null, null,
  'ni perfiles a nombre de un tutor');
select throws_ok($$insert into public.student_attempts (student_id, tutor_id, exercise_id, topic, exercise, correct)
  values ('b2000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-0000000000c1',
  gen_random_uuid(), '2-01', '1 + 1', true)$$, null, null, 'ni intentos de práctica');
select throws_ok($$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
  values ('ae000000-0000-0000-0000-0000000000a1', 'grant',
  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$, null, null,
  'ni consentimientos');

-- Las funciones del servidor no están abiertas al token de usuario.
select throws_ok($$select public.record_attempt('ae000000-0000-0000-0000-0000000000c1',
  'b2000000-0000-0000-0000-000000000001', gen_random_uuid(), '2-01', '1 + 1', true)$$, null, null,
  'ni llama a las funciones del servidor que escriben datos de niños');

-- Modificar o borrar el perfil de un niño tampoco (RLS: no es su fila; no falla, afecta 0 filas).
update public.students set nickname = 'X';
select throws_ok($$delete from public.students$$, '42501', null, 'el borrado de perfiles ni siquiera es una operación del cliente');
reset role;
select is((select nickname from public.students where id = 'b2000000-0000-0000-0000-000000000001'), 'Ana',
  'ni modifica ni borra perfiles de niños');

select * from finish();
rollback;
