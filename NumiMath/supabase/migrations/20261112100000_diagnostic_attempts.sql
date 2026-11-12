-- CU-A2: tipo de intento. 'practice' = práctica normal y tareas del tutor (todo lo que existía);
-- 'diagnostic' = respuesta de la prueba corta inicial de una habilidad. El diagnóstico NO cuenta
-- para el bloque de 10, las medallas, los gráficos ni el informe: quien lee los intentos filtra
-- por activity = 'practice'. No es un dato nuevo del niño: solo marca de dónde vino el intento.
alter table public.student_attempts
  add column activity text not null default 'practice',
  add constraint student_attempts_activity_check check (activity in ('practice', 'diagnostic'));

-- ---------------------------------------------------------------------------
-- save_diagnostic: guarda los 6 intentos del diagnóstico y el nivel de entrada en UNA transacción.
-- Se llama solo al terminar la prueba completa: si el niño la abandona no llega nada y la
-- habilidad sigue sin intentos (nivel 1), así que la prueba se puede volver a ofrecer.
-- La corrección y el nivel los calcula FastAPI con los tokens firmados; aquí solo se guarda.
-- Devuelve 'ok', 'student_not_found' o 'not_available' (la habilidad ya tiene intentos o progreso).
-- p_attempts: arreglo JSON de 6 objetos {exercise_id, exercise, correct, level}.
-- ---------------------------------------------------------------------------
create function public.save_diagnostic(
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
  -- habilidad ya tiene cualquier intento (práctica o diagnóstico) o ya tiene progreso, no se guarda.
  if exists (
    select 1 from public.student_attempts a
    where a.student_id = p_student_id and a.topic = p_topic
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
grant execute on function public.save_diagnostic(uuid, uuid, text, integer, jsonb)
  to service_role;
