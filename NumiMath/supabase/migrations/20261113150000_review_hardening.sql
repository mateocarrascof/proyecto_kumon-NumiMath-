-- Correcciones de la revisión previa al PR (docs/plan-docente-admin.md):
--   1. `admin_is_admin`: el servidor comprueba EN LA BASE que quien borra a un docente sigue siendo
--      administrador (un admin degradado con un token vigente ya no puede hacerlo).
--   2. `save_student_sheet`: valida en SQL la respuesta del niño y la correcta (solo un número o una
--      fracción), y pone un tope de 300 hojas por perfil (se borran las más antiguas).
--   3. Límite diario de guardados por tutor: de 500 a 100.
--   4. `purge_expired_student_sheets`: la condición usa el índice de `saved_at` y borra por lotes.

-- ---------------------------------------------------------------------------
-- 1. ¿Sigue siendo administrador? (el rol en la base, no solo el del token)
-- ---------------------------------------------------------------------------
create function public.admin_is_admin(p_admin_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_admin_id and u.raw_app_meta_data ->> 'role' = 'admin'
  );
$$;

revoke all on function public.admin_is_admin(uuid) from public, anon, authenticated;
grant execute on function public.admin_is_admin(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. save_student_sheet: validación de las respuestas y tope por perfil.
--    Mismo contrato y mismos permisos que antes; `mismatch` si una respuesta no es número o fracción.
-- ---------------------------------------------------------------------------
create or replace function public.save_student_sheet(
  p_tutor_id     uuid,
  p_student_id   uuid,
  p_exercise_id  uuid,
  p_child_answer text,
  p_correct      boolean,
  p_correct_ans  text,
  p_strokes      jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.student_attempts%rowtype;
  v_task    public.assigned_exercises%rowtype;
  v_correct boolean;
  v_content jsonb;
  v_per_min integer;
  v_per_day integer;
  v_counter public.sheet_save_counters%rowtype;
  -- Hojas que se conservan por perfil: al pasarse, se borran las más antiguas (tope de almacenamiento).
  c_max_per_profile constant integer := 300;
  -- Una respuesta es un número ("47") o una fracción ("3/5"): nunca texto libre del niño.
  c_answer constant text := '^[0-9]{1,7}(/[0-9]{1,4})?$';
begin
  -- Mismo cerrojo que la revocación y los vínculos: sin carreras con "revocar consentimiento".
  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || p_tutor_id::text, 0));

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.tutor_id = p_tutor_id and s.blocked_at is null
  ) or not public.has_active_consent(p_tutor_id) then
    return 'not_found';
  end if;

  -- Solo con un docente vinculado activo cuyo texto de autorización describe las hojas.
  if not public.student_has_sheet_link(p_tutor_id, p_student_id) then
    return 'no_link';
  end if;

  select * into v_attempt from public.student_attempts a
  where a.student_id = p_student_id and a.tutor_id = p_tutor_id
    and a.exercise_id = p_exercise_id and a.activity = 'practice';
  if not found then
    return 'no_attempt';   -- la hoja se guarda DESPUÉS de responder, junto a un intento real
  end if;

  -- Defensa en profundidad: la API ya lo valida, pero la base no confía en quien la llame.
  if p_child_answer is null or p_child_answer !~ c_answer then
    return 'mismatch';
  end if;

  v_correct := p_correct;
  if v_attempt.topic = 'tarea_tutor' then
    select * into v_task from public.assigned_exercises t
    where t.id = p_exercise_id and t.student_id = p_student_id;
    if not found or p_child_answer !~ '^[0-9]{1,7}$' then
      return 'mismatch';
    end if;
    p_correct_ans := v_task.answer::text;
    v_correct := (p_child_answer::integer = v_task.answer);
  elsif p_correct_ans is null or p_correct_ans !~ c_answer then
    return 'mismatch';
  end if;
  if v_correct is distinct from v_attempt.correct then
    return 'mismatch';   -- la respuesta que llega no corresponde con el intento registrado
  end if;

  -- Límite por tutor: hojas por minuto y por día (app_settings). Cuenta solo los guardados que
  -- llegan hasta aquí (ya validados); dentro del cerrojo, así que no hay carreras.
  select (s.value #>> '{}')::integer into v_per_min from public.app_settings s
    where s.key = 'sheet_saves_per_minute';
  select (s.value #>> '{}')::integer into v_per_day from public.app_settings s
    where s.key = 'sheet_saves_per_day';
  insert into public.sheet_save_counters (tutor_id, day)
    values (p_tutor_id, (now() at time zone 'America/Santiago')::date)
    on conflict (tutor_id, day) do nothing;
  select * into v_counter from public.sheet_save_counters c
    where c.tutor_id = p_tutor_id and c.day = (now() at time zone 'America/Santiago')::date
    for update;
  if now() - v_counter.minute_start >= interval '1 minute' then
    v_counter.minute_start := now();
    v_counter.n_minute := 0;
  end if;
  if v_counter.n_minute >= coalesce(v_per_min, 30) or v_counter.n_day >= coalesce(v_per_day, 100) then
    return 'rate_limited';
  end if;
  update public.sheet_save_counters
     set n_day = n_day + 1, n_minute = v_counter.n_minute + 1, minute_start = v_counter.minute_start
   where tutor_id = p_tutor_id and day = v_counter.day;

  v_content := jsonb_build_object(
    'statement', case when v_attempt.topic = 'tarea_tutor' then 'Tarea del tutor' else v_attempt.exercise end,
    'child_answer', p_child_answer,
    'correct_answer', p_correct_ans,
    'strokes', p_strokes);

  insert into public.student_sheets (student_id, tutor_id, exercise_id, topic, correct, content)
  values (p_student_id, p_tutor_id, p_exercise_id, v_attempt.topic, v_attempt.correct, v_content)
  on conflict (student_id, exercise_id)
  do update set content = excluded.content, saved_at = now();

  -- Tope por perfil: se conservan las `c_max_per_profile` más recientes (la recién guardada es la última).
  delete from public.student_sheets
   where student_id = p_student_id
     and id in (select h.id from public.student_sheets h where h.student_id = p_student_id
                order by h.saved_at desc, h.id desc offset c_max_per_profile);
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Límite diario de guardados por tutor: 100 (lo que un niño usa de verdad es mucho menos).
-- ---------------------------------------------------------------------------
update public.app_settings set value = '100'::jsonb where key = 'sheet_saves_per_day';

-- ---------------------------------------------------------------------------
-- 4. Purga por lotes con la condición sobre `saved_at` (usa su índice) en vez de sumarle los días.
--    Mismo contrato: devuelve cuántas hojas se borraron; sin plazo definido no borra nada.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_student_sheets()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days  integer;
  v_batch integer;
  v_rows  integer := 0;
begin
  select (s.value #>> '{}')::integer into v_days
  from public.app_settings s where s.key = 'sheet_retention_days';
  if v_days is null then
    return 0;
  end if;
  loop
    delete from public.student_sheets
     where id in (select h.id from public.student_sheets h
                  where h.saved_at < now() - make_interval(days => v_days)
                  order by h.saved_at limit 5000);
    get diagnostics v_batch = row_count;
    v_rows := v_rows + v_batch;
    exit when v_batch < 5000;
  end loop;
  delete from public.sheet_save_counters where day < current_date - 2;
  return v_rows;
end;
$$;

-- Reversión manual (no se ejecuta sola): restaurar las definiciones de 20261113120000_student_sheets.sql,
--   update public.app_settings set value = '500'::jsonb where key = 'sheet_saves_per_day';
--   drop function public.admin_is_admin(uuid);
