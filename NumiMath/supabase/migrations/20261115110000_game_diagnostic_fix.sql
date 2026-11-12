-- CU-A21, correcciones de la revisión.
-- 1. (code-reviewer, alta) Un intento de juego no debe impedir el
-- diagnóstico inicial de la habilidad. Antes, `save_diagnostic` rechazaba la habilidad si tenía
-- CUALQUIER intento, y los juegos registran intentos con `topic` = habilidad (sin crear progreso).
-- Misma firma: `create or replace` conserva los permisos (se repiten abajo por claridad).

create or replace function public.save_diagnostic(
  p_tutor_id   uuid,
  p_student_id uuid,
  p_topic      text,
  p_level      integer,
  p_attempts   jsonb
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  -- Solo habilidades del catálogo ("1-06"): las tareas del tutor y los temas antiguos no tienen
  -- diagnóstico. El nivel de entrada va de 1 a 3 y la prueba tiene siempre 6 ejercicios.
  if p_topic is null or p_topic !~ '^[1-4]-[0-9]{2}$'
     or p_level is null or p_level not between 1 and 3
     or jsonb_typeof(p_attempts) is distinct from 'array'
     or jsonb_array_length(p_attempts) <> 6 then
    raise exception 'invalid_diagnostic' using errcode = '22023';
  end if;

  -- Se bloquea la fila del perfil: dos envíos simultáneos del mismo diagnóstico (doble toque,
  -- dos pestañas) se atienden uno tras otro y el segundo ve los intentos del primero.
  perform 1 from public.students s
    where s.id = p_student_id and s.tutor_id = p_tutor_id
    for update;
  if not found then
    return 'student_not_found';
  end if;

  -- El diagnóstico solo existe ANTES de la primera práctica (precondición de CU-A2): si la
  -- habilidad ya tiene un intento de práctica o de diagnóstico, o ya tiene progreso, no se guarda.
  -- Los JUEGOS no cuentan (CU-A21): no crean progreso, así que la API ofrece el diagnóstico, y
  -- contarlos aquí haría perder las 6 respuestas al guardar.
  if exists (
    select 1 from public.student_attempts a
    where a.student_id = p_student_id and a.topic = p_topic and a.activity <> 'game'
  ) or exists (
    select 1 from public.student_skill_progress p
    where p.student_id = p_student_id and p.skill_code = p_topic
  ) then
    return 'not_available';
  end if;

  -- duration_s queda nulo: el servidor recibe las 6 respuestas juntas al final, así que no sabe
  -- cuánto tardó en cada una. Tampoco cuentan para el "tiempo típico" del informe.
  for v_item in select value from jsonb_array_elements(p_attempts) loop
    insert into public.student_attempts
      (student_id, tutor_id, exercise_id, topic, exercise, correct, level, activity)
    values (
      p_student_id,
      p_tutor_id,
      (v_item ->> 'exercise_id')::uuid,
      p_topic,
      v_item ->> 'exercise',
      (v_item ->> 'correct')::boolean,
      (v_item ->> 'level')::smallint,
      'diagnostic'
    );
  end loop;

  -- Nivel de entrada con el bloque de 10 vacío: la práctica (CU-A1) empieza en ese nivel.
  -- Nunca deja la habilidad "dominada": para eso hay que completar un bloque en nivel 3.
  insert into public.student_skill_progress (student_id, tutor_id, skill_code, level)
  values (p_student_id, p_tutor_id, p_topic, p_level);

  -- REVISAR: el diagnóstico NO suma a la racha de días (student_daily_streaks). Se decidió así
  -- por defecto porque no es práctica; si se quiere que el día cuente, este es el lugar para
  -- hacerlo (con la misma regla de record_attempt y la fecha local validada a ±1 día).

  return 'ok';
end;
$$;

revoke all on function public.save_diagnostic(uuid, uuid, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_diagnostic(uuid, uuid, text, integer, jsonb) to service_role;

-- Corrección de la revisión (scalability-reviewer): validar aquí las restricciones agregadas
-- `not valid` en 20261115100000 (toma un bloqueo que no impide leer ni escribir).
alter table public.student_attempts validate constraint student_attempts_activity_check;
alter table public.student_attempts validate constraint student_attempts_game_kind_check;

-- Índices parciales de PRÁCTICA: las lecturas frecuentes (ejercicios recientes del bloque y
-- progreso, informe y gráfico) filtran `activity = 'practice'`; sin esto, cada fila de juego más
-- nueva se lee y se descarta. El índice general se mantiene (historial del tutor, CU-T5).
-- Hoy la tabla es chica; con una tabla grande, crearlos `concurrently` fuera de una transacción.
create index if not exists student_attempts_practice_topic_time_idx
  on public.student_attempts (student_id, topic, answered_at desc)
  where activity = 'practice';
create index if not exists student_attempts_practice_time_idx
  on public.student_attempts (student_id, answered_at desc)
  where activity = 'practice';
