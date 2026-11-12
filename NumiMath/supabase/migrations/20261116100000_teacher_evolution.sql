-- D6: evolución del progreso de un alumno vinculado, semana a semana (últimas 8 semanas).
-- Solo `service_role`. Pasa por `teacher_can_view` (`null` si no hay acceso: el mismo 404). Cuenta solo
-- intentos de PRÁCTICA (sin diagnóstico ni juegos) hechos desde `accepted_at` del vínculo. Solo totales
-- por semana: sin duración, hora ni texto de ejercicios (ni de tareas del tutor).
create function public.teacher_student_evolution(p_teacher_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from  timestamptz;
  v_tutor uuid;
  v_today date := (now() at time zone 'America/Santiago')::date;
  v_first date := v_today - 55;
begin
  if not public.teacher_can_view(p_teacher_id, p_student_id) then
    return null;
  end if;
  select l.accepted_at, l.tutor_id into v_from, v_tutor
  from public.teacher_links l
  where l.teacher_id = p_teacher_id and l.student_id = p_student_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object('weeks', (
    select jsonb_agg(jsonb_build_object(
             'start', to_char(v_first + 7 * w.i, 'YYYY-MM-DD'),
             'total', coalesce(c.total, 0), 'correct', coalesce(c.correct, 0))
           order by w.i)
    from generate_series(0, 7) as w(i)
    left join (
      select ((a.answered_at at time zone 'America/Santiago')::date - v_first) / 7 as i,
             count(*)::int as total, count(*) filter (where a.correct)::int as correct
      from public.student_attempts a
      where a.student_id = p_student_id and a.tutor_id = v_tutor and a.activity = 'practice'
        and a.answered_at >= v_from
        and (a.answered_at at time zone 'America/Santiago')::date between v_first and v_today
      group by 1
    ) c on c.i = w.i));
end;
$$;

revoke all on function public.teacher_student_evolution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.teacher_student_evolution(uuid, uuid) to service_role;
