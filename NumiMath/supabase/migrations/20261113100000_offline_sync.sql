-- CU-A13: sincronizar los intentos hechos sin conexión (ADR 0002). No hay tabla nueva ni dato
-- nuevo del niño: los intentos van a `student_attempts` como los de la práctica en línea.
--
-- Por qué una función aparte y no `record_attempt` directo:
-- - `answered_at` debe ser la hora del dispositivo (acotada por FastAPI a la vida del token), no
--   `now()`: el gráfico semanal y el informe del tutor ordenan por esa fecha;
-- - la fecha local para la racha se acepta dentro de la vida del token (puede ser de días
--   atrás), no solo ±1 día de hoy como en línea;
-- - todo el lote va en UNA llamada y UNA transacción (un solo viaje a la base por sincronización).
-- La regla del bloque de 10 NO se duplica: cada intento pasa por `record_attempt`, la misma de la
-- práctica en línea. Así el servidor sigue siendo la única fuente de verdad del nivel.

-- ---------------------------------------------------------------------------
-- record_offline_attempts: aplica los intentos EN ORDEN CRONOLÓGICO (answered_at y, a igual hora,
-- el orden en que vienen) sobre el progreso actual del servidor.
--
-- p_attempts: arreglo JSON de objetos con exercise_id (jti del token), topic, exercise (enunciado
-- regenerado por el servidor), correct (corregido por el servidor), level (del token),
-- duration_s, answered_at y local_day. FastAPI ya verificó el token y volvió a corregir: nada de
-- esto viene del cliente sin pasar por ahí.
--
-- Devuelve 'student_not_found' (perfil ajeno o inexistente, no se registra nada) o un arreglo JSON
-- con {exercise_id, status} por intento: 'ok' o 'duplicate' (ese jti ya estaba: reenviar el mismo
-- lote, o un token ya respondido, no cambia nada gracias a `student_attempts_once`).
--
-- Si otro equipo practicó en línea mientras tanto y el nivel de la habilidad cambió, un intento
-- con un nivel que ya no coincide se guarda pero no cuenta para el bloque (regla de
-- `record_attempt`). Duda para Adolfo: ¿se acepta así o se quiere rehacer el historial completo?
-- ---------------------------------------------------------------------------
create function public.record_offline_attempts(
  p_tutor_id   uuid,
  p_student_id uuid,
  p_attempts   jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item    jsonb;
  v_status  text;
  v_at      timestamptz;
  v_day     date;
  v_results jsonb := '[]'::jsonb;
begin
  if p_attempts is null or jsonb_typeof(p_attempts) <> 'array' then
    raise exception 'invalid_offline_attempts' using errcode = '22023';
  end if;
  -- Tope de defensa si se llamara con otro cliente (FastAPI envía como máximo 15 por petición).
  if jsonb_array_length(p_attempts) > 100 then
    raise exception 'offline_batch_too_large' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return to_jsonb('student_not_found'::text);
  end if;

  for v_item in
    select a.value
    from jsonb_array_elements(p_attempts) with ordinality as a(value, n)
    order by (a.value ->> 'answered_at')::timestamptz, a.n
  loop
    -- Nunca en el futuro, aunque FastAPI ya lo acota.
    v_at := least((v_item ->> 'answered_at')::timestamptz, now());

    v_status := public.record_attempt(
      p_tutor_id,
      p_student_id,
      (v_item ->> 'exercise_id')::uuid,
      v_item ->> 'topic',
      v_item ->> 'exercise',
      (v_item ->> 'correct')::boolean,
      null,  -- la racha se aplica abajo, con la fecha local acotada a la hora del intento
      (v_item ->> 'level')::integer,
      (v_item ->> 'duration_s')::integer
    );

    if v_status = 'ok' then
      update public.student_attempts a
        set answered_at = v_at
        where a.student_id = p_student_id
          and a.exercise_id = (v_item ->> 'exercise_id')::uuid;

      -- Racha por día local: solo días posteriores al último registrado (no se rellenan días
      -- hacia atrás, igual que en línea). La fecha debe ser coherente con la hora del intento.
      v_day := (v_item ->> 'local_day')::date;
      if v_day is not null
         and v_day between (v_at at time zone 'utc')::date - 1 and (v_at at time zone 'utc')::date + 1
      then
        insert into public.student_daily_streaks as s (student_id, tutor_id, current_len, last_day)
        values (p_student_id, p_tutor_id, 1, v_day)
        on conflict (student_id) do update
          set current_len = case
                when excluded.last_day = s.last_day + 1 then s.current_len + 1
                else 1
              end,
              last_day   = excluded.last_day,
              updated_at = now()
          where excluded.last_day > s.last_day;
      end if;
    elsif v_status <> 'duplicate' then
      -- 'student_not_found' a mitad del lote (perfil borrado en paralelo): se deshace todo.
      raise exception 'offline_sync_student_gone' using errcode = 'P0002';
    end if;

    v_results := v_results || jsonb_build_object(
      'exercise_id', v_item ->> 'exercise_id', 'status', v_status
    );
  end loop;

  return v_results;
end;
$$;

revoke all on function public.record_offline_attempts(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_offline_attempts(uuid, uuid, jsonb) to service_role;
