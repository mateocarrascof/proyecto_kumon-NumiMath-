begin;
select plan(19);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Formato del apodo (migración 20261118120000_student_nickname_format): una sola palabra, solo
-- letras (tildes, ü y ñ), sin números ni símbolos. Tutor propio fc...0001; cada conteo filtra por
-- ese tutor, así la prueba no depende de que la base esté vacía.

insert into auth.users (id, email) values
  ('fc000000-0000-0000-0000-000000000001', 'formato@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('fc100000-0000-0000-0000-000000000001', 'terms',             'tos-f', repeat('a', 64), true),
  ('fc100000-0000-0000-0000-000000000002', 'privacy',           'pp-f',  repeat('b', 64), true),
  ('fc100000-0000-0000-0000-000000000003', 'adult_declaration', 'ad-f',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
values ('fc000000-0000-0000-0000-000000000001', 'grant',
        'fc100000-0000-0000-0000-000000000001', 'fc100000-0000-0000-0000-000000000002', 'web');

update public.tutors set max_students = 10 where id = 'fc000000-0000-0000-0000-000000000001';

-- ===== Estructura =====
select has_trigger('public', 'students', 'students_nickname_format', 'existe el trigger de formato');
select ok(not has_function_privilege('anon', 'public.students_nickname_format()', 'execute'),
  'anon no puede ejecutar la función del trigger');
select ok(not has_function_privilege('authenticated', 'public.students_nickname_format()', 'execute'),
  'authenticated no puede llamarla directo');

-- Un perfil "antiguo" con apodo de dos palabras, creado antes de la regla (se simula apagando
-- solo este trigger dentro de la transacción).
alter table public.students disable trigger students_nickname_format;
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('fd000000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000001', 'Viejo Apellido', 1, true);
alter table public.students enable trigger students_nickname_format;

-- ===== Como el tutor (rol authenticated, con RLS) =====
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"fc000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Altas válidas: tildes, ü, ñ y mayúsculas.
select lives_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'Toño', 1, true)$$, 'acepta ñ');
select lives_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'ÁNGELA', 1, true)$$, 'acepta mayúsculas con tilde');
select lives_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'Pingüino', 2, true)$$, 'acepta ü');

-- Altas rechazadas, todas con 23514 y el nombre de la regla.
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'Pedro González', 1, true)$$,
  '23514', 'students_nickname_format', 'rechaza nombre y apellido (dos palabras)');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'Ana2', 1, true)$$,
  '23514', 'students_nickname_format', 'rechaza números');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', '+56912345678', 1, true)$$,
  '23514', 'students_nickname_format', 'rechaza un teléfono');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'ana@correo.cl', 1, true)$$,
  '23514', 'students_nickname_format', 'rechaza un correo');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'Juan-Pablo', 1, true)$$,
  '23514', 'students_nickname_format', 'rechaza guiones y otros símbolos');
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', repeat('a', 31), 1, true)$$,
  '23514', 'students_nickname_format', 'rechaza más de 30 letras');
select is((select count(*)::int from public.students where tutor_id = 'fc000000-0000-0000-0000-000000000001'),
  4, 'solo quedaron las 3 altas válidas y el perfil antiguo');

-- La unicidad (ADR 0005) sigue igual.
select throws_ok($$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
  values ('fc000000-0000-0000-0000-000000000001', 'TOÑO', 1, true)$$,
  '23505', null, 'la unicidad sigue igual: "TOÑO" choca con "Toño" en el mismo curso');

-- ===== El perfil antiguo con apodo inválido =====
select lives_ok($$update public.students set grade = 2
  where id = 'fd000000-0000-0000-0000-000000000001'$$,
  'perfil antiguo: cambiar otra columna (curso) sigue funcionando');
select lives_ok($$update public.students set nickname = nickname
  where id = 'fd000000-0000-0000-0000-000000000001'$$,
  'perfil antiguo: reescribir el mismo apodo no se valida');
reset role;
set local role service_role;
select lives_ok($$update public.students set last_active_at = now()
  where id = 'fd000000-0000-0000-0000-000000000001'$$,
  'perfil antiguo: el servidor puede marcar actividad');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"fc000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$update public.students set nickname = 'Otro Apellido'
  where id = 'fd000000-0000-0000-0000-000000000001'$$,
  '23514', 'students_nickname_format', 'perfil antiguo: renombrarlo a otro apodo inválido se rechaza');
select lives_ok($$update public.students set nickname = 'Viejito'
  where id = 'fd000000-0000-0000-0000-000000000001'$$,
  'perfil antiguo: renombrarlo a un apodo válido sí se puede');

reset role;
select * from finish();
rollback;
