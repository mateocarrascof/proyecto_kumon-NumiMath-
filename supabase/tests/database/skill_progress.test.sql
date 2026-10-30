begin;
select plan(24);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Progreso por habilidad: regla de bloques de 10 en record_attempt, RLS por tutor y escritura
-- solo del servidor. Tutores: A=...0001 B=...0002 (prefijo cccccccc-0000-0000-0000-)

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001', 'a@test.invalid'),
  ('cccccccc-0000-0000-0000-000000000002', 'b@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('cccccccc-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Ana', 1, true),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 'Beto', 1, true);

-- Responde un bloque: `p_ok` aciertos y `p_total - p_ok` errores, en el nivel dado.
create function pg_temp.answer(p_skill text, p_level int, p_ok int, p_total int)
returns void language plpgsql as $$
begin
  for i in 1..p_total loop
    perform public.record_attempt('cccccccc-0000-0000-0000-000000000001',
      'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), p_skill, '1 + 1 = ?',
      i <= p_ok, null, p_level);
  end loop;
end $$;

create function pg_temp.level(p_skill text) returns int language sql as $$
  select level::int from public.student_skill_progress
  where student_id = 'dddddddd-0000-0000-0000-000000000001' and skill_code = p_skill
$$;

create function pg_temp.block(p_skill text) returns int language sql as $$
  select block_total::int from public.student_skill_progress
  where student_id = 'dddddddd-0000-0000-0000-000000000001' and skill_code = p_skill
$$;

select has_table('public', 'student_skill_progress', 'existe student_skill_progress');

-- ===== 1. Regla de bloques =====
set local role service_role;

do $$ begin perform pg_temp.answer('1-06', 1, 4, 4); end $$;
select is(pg_temp.level('1-06'), 1, 'con 4 intentos el bloque sigue abierto');
select is(pg_temp.block('1-06'), 4, 'el bloque lleva 4 de 10');

-- Completa el bloque otro "día" (el bloque no depende del día): 8 de 10 → sube.
do $$ begin perform pg_temp.answer('1-06', 1, 4, 6); end $$;
select is(pg_temp.level('1-06'), 2, '8 de 10 aciertos sube al nivel 2');
select is(pg_temp.block('1-06'), 0, 'al cambiar de nivel empieza un bloque nuevo');

-- 7 de 10 en nivel 2 → repite.
do $$ begin perform pg_temp.answer('1-06', 2, 7, 10); end $$;
select is(pg_temp.level('1-06'), 2, '7 de 10 repite el nivel');

-- 4 de 10 → baja.
do $$ begin perform pg_temp.answer('1-06', 2, 4, 10); end $$;
select is(pg_temp.level('1-06'), 1, '4 de 10 baja un nivel');

-- 5 de 10 → repite (no baja).
do $$ begin perform pg_temp.answer('1-06', 1, 5, 10); end $$;
select is(pg_temp.level('1-06'), 1, '5 de 10 repite el nivel');

-- En nivel 1 no baja más.
do $$ begin perform pg_temp.answer('1-06', 1, 0, 10); end $$;
select is(pg_temp.level('1-06'), 1, 'el nivel 1 es el piso');

-- Hasta nivel 3 y dominar.
do $$ begin perform pg_temp.answer('1-06', 1, 10, 10); end $$;
do $$ begin perform pg_temp.answer('1-06', 2, 8, 10); end $$;
select is(pg_temp.level('1-06'), 3, 'llega al nivel 3');
select ok((select mastered_at is null from public.student_skill_progress
  where student_id = 'dddddddd-0000-0000-0000-000000000001' and skill_code = '1-06'),
  'llegar al nivel 3 todavía no es dominar');
do $$ begin perform pg_temp.answer('1-06', 3, 9, 10); end $$;
select ok((select mastered_at is not null from public.student_skill_progress
  where student_id = 'dddddddd-0000-0000-0000-000000000001' and skill_code = '1-06'),
  '8 o más en nivel 3 domina la habilidad');
select is(pg_temp.level('1-06'), 3, 'el nivel 3 es el techo');

-- Un ejercicio emitido en otro nivel (antes de un cambio) no cuenta para el bloque.
do $$ begin perform pg_temp.answer('1-07', 1, 2, 2); end $$;
do $$ begin perform pg_temp.answer('1-07', 2, 1, 1); end $$;
select is(pg_temp.block('1-07'), 2, 'un intento de otro nivel no suma al bloque');

-- Tareas del tutor y temas antiguos no crean progreso.
do $$ begin perform pg_temp.answer('tarea_tutor', 1, 1, 1); end $$;
do $$ begin perform pg_temp.answer('sumas_hasta_20', 1, 1, 1); end $$;
select is((select count(*)::int from public.student_skill_progress
  where student_id = 'dddddddd-0000-0000-0000-000000000001'
    and skill_code not in ('1-06', '1-07')), 0,
  'tareas del tutor y temas antiguos no tocan el progreso');

-- Un intento repetido (mismo ejercicio) no cuenta dos veces.
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', '1-08',
  '5 + 6 = ?', true, null, 1), 'ok', 'se registra un ejercicio de 1-08');
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', '1-08',
  '5 + 6 = ?', true, null, 1), 'duplicate', 'el mismo ejercicio no se registra dos veces');
select is(pg_temp.block('1-08'), 1, 'el duplicado no suma al bloque');

-- El tutor B no puede sumar progreso a un perfil de A.
select is(public.record_attempt('cccccccc-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000001', gen_random_uuid(), '1-08', '5 + 6 = ?', true, null, 1),
  'student_not_found', 'otro tutor no registra intentos en un perfil ajeno');
select is(pg_temp.block('1-08'), 1, 'y el progreso no cambia');
reset role;

-- ===== 2. RLS =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.student_skill_progress
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 0,
  'otro tutor no lee el progreso ajeno');

select throws_ok($$ insert into public.student_skill_progress (student_id, tutor_id, skill_code)
  values ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', '1-06') $$,
  '42501', null, 'un tutor no escribe progreso directamente (ni en sus perfiles)');

select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.student_skill_progress
  where student_id = 'dddddddd-0000-0000-0000-000000000001'), 3,
  'el tutor dueño lee el progreso de su perfil');
select throws_ok($$ update public.student_skill_progress set level = 3
  where student_id = 'dddddddd-0000-0000-0000-000000000001' $$, '42501', null,
  'el tutor dueño tampoco puede cambiar el nivel a mano');
reset role;

select * from finish();
rollback;
