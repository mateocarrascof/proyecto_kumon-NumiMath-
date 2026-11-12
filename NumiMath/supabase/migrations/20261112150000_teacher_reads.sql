-- Lecturas del docente (D4 alumnos vinculados, D5 progreso por habilidad, D7 historial) y del tutor
-- (T5 historial del hijo).
--
-- Solo las llama el servidor (`service_role`), después de verificar el JWT. Las del DOCENTE pasan SIEMPRE
-- por `teacher_can_view` (vínculo activo + consentimiento vigente + perfil no bloqueado + rol docente
-- verificado) y devuelven `null` si no hay acceso: la API responde el mismo 404 haya o no un niño con ese id.
-- El docente solo lee: ninguna función escribe.
--
-- Reglas de privacidad del docente (docs/privacy/inventario-datos.md, "Lectura del docente"):
--   - D4: solo apodo y curso.
--   - D5: estado actual por habilidad (nivel, avance del bloque, dominada). Sin tiempo típico ni racha.
--   - D7: solo intentos de práctica DESDE `accepted_at` del vínculo; fecha sin hora (hora de Chile) y sin
--     segundos de respuesta; el texto de las tareas del tutor NO se entrega (solo que fue una tarea y si
--     acertó). Sin el diagnóstico inicial. Los intentos no guardan lo que respondió el niño.

-- ---------------------------------------------------------------------------
-- D4. Alumnos vinculados: apodo y curso, en orden alfabético.
-- ---------------------------------------------------------------------------
create function public.teacher_students(p_teacher_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_id', s.id, 'nickname', s.nickname, 'grade', s.grade)
         order by lower(s.nickname), s.nickname, s.id), '[]'::jsonb)
  from public.teacher_links l
  join public.students s on s.id = l.student_id and s.tutor_id = l.tutor_id
  where l.teacher_id = p_teacher_id
    and public.teacher_can_view(l.teacher_id, l.student_id);
$$;

revoke all on function public.teacher_students(uuid) from public, anon, authenticated;
grant execute on function public.teacher_students(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- D5. Progreso por habilidad de un alumno vinculado (solo las habilidades ya practicadas).
-- ---------------------------------------------------------------------------
create function public.teacher_student_progress(p_teacher_id uuid, p_student_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.teacher_can_view(p_teacher_id, p_student_id) then null else (
    select jsonb_build_object(
      'nickname', s.nickname,
      'grade', s.grade,
      'skills', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'code', p.skill_code, 'level', p.level, 'block_total', p.block_total,
                 'block_correct', p.block_correct, 'mastered', p.mastered_at is not null)
               order by p.skill_code)
        from public.student_skill_progress p
        where p.student_id = s.id), '[]'::jsonb))
    from public.students s where s.id = p_student_id) end;
$$;

revoke all on function public.teacher_student_progress(uuid, uuid) from public, anon, authenticated;
grant execute on function public.teacher_student_progress(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- D7. Historial de ejercicios de un alumno vinculado, paginado, del más reciente al más antiguo.
--     Solo desde `accepted_at` del vínculo vigente. `exercise` es null en las tareas del tutor.
-- ---------------------------------------------------------------------------
create function public.teacher_student_history(
  p_teacher_id uuid,
  p_student_id uuid,
  p_offset     integer,
  p_limit      integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from   timestamptz;
  v_tutor  uuid;
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items  jsonb;
  v_count  integer;
begin
  if not public.teacher_can_view(p_teacher_id, p_student_id) then
    return null;
  end if;
  select l.accepted_at, l.tutor_id into v_from, v_tutor
  from public.teacher_links l
  where l.teacher_id = p_teacher_id and l.student_id = p_student_id;
  if not found then
    return null;  -- el tutor quitó el vínculo justo ahora: mismo resultado que sin acceso
  end if;

  with page as (
    select a.topic, a.exercise, a.correct, a.level, a.answered_at, a.id
    from public.student_attempts a
    where a.student_id = p_student_id
      and a.tutor_id = v_tutor
      and a.activity = 'practice'
      and a.answered_at >= v_from
    order by a.answered_at desc, a.id desc
    offset v_offset limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'topic', topic,
           'exercise', case when topic = 'tarea_tutor' then null else exercise end,
           'correct', correct,
           'level', level,
           'day', to_char((answered_at at time zone 'America/Santiago')::date, 'YYYY-MM-DD'))
         order by answered_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         count(*)::integer
    into v_items, v_count
  from (select page.*, row_number() over (order by answered_at desc, id desc) as rn from page) numbered;

  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit);
end;
$$;

revoke all on function public.teacher_student_history(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.teacher_student_history(uuid, uuid, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- T5. Historial del hijo para el TUTOR: habilidad, resultado, nivel y hora de cada intento de práctica,
--     paginado. `null` si el perfil no es del tutor. No lee texto de enunciados ni respuestas.
-- ---------------------------------------------------------------------------
create function public.list_student_attempts(
  p_tutor_id   uuid,
  p_student_id uuid,
  p_offset     integer,
  p_limit      integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items  jsonb;
  v_count  integer;
begin
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return null;
  end if;

  with page as (
    select a.topic, a.correct, a.level, a.answered_at, a.id
    from public.student_attempts a
    where a.student_id = p_student_id and a.tutor_id = p_tutor_id and a.activity = 'practice'
    order by a.answered_at desc, a.id desc
    offset v_offset limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'topic', topic, 'correct', correct, 'level', level, 'answered_at', answered_at)
         order by answered_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         count(*)::integer
    into v_items, v_count
  from (select page.*, row_number() over (order by answered_at desc, id desc) as rn from page) numbered;

  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit);
end;
$$;

revoke all on function public.list_student_attempts(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.list_student_attempts(uuid, uuid, integer, integer) to service_role;
