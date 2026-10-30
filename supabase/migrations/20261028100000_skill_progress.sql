-- Progreso por habilidad del catálogo curricular (docs/habilidades_1a4_basico.csv): nivel actual
-- (1 a 3), bloque de 10 ejercicios en curso y fecha en que se dominó (nivel 3 con 8 o más
-- aciertos en un bloque).
--
-- Regla de dominio (docs/SPEC.md, "Catálogo curricular: decisiones sobre el mapa"):
--   bloques de 10 ejercicios de una habilidad en el mismo nivel; al completar el bloque,
--   8 o más aciertos sube un nivel (en nivel 3, marca la habilidad como dominada),
--   4 o menos baja un nivel (mínimo 1), 5 a 7 repite el nivel. El bloque se llena aunque el niño
--   cambie de día o salga de la app; al cambiar de nivel empieza un bloque nuevo.
--
-- No es un dato nuevo del niño en sentido estricto: se deriva de sus intentos (mismo acceso,
-- RLS por tutor, y mismo borrado: ON DELETE CASCADE con el perfil). La escribe SOLO el servidor
-- (FastAPI, service_role) dentro de record_attempt. Un futuro profesor podrá fijar el nivel a mano
-- (por eso el nivel vive aquí y no se recalcula desde los intentos).
--
-- Inventario: docs/privacy/inventario-datos.md.

create table public.student_skill_progress (
  student_id     uuid not null references public.students (id) on delete cascade,
  tutor_id       uuid not null references public.tutors (id) on delete cascade,
  skill_code     text not null check (skill_code ~ '^[1-4]-[0-9]{2}$'),
  level          smallint not null default 1 check (level between 1 and 3),
  block_total    smallint not null default 0 check (block_total between 0 and 9),
  block_correct  smallint not null default 0 check (block_correct between 0 and block_total),
  mastered_at    timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (student_id, skill_code)
);

create index student_skill_progress_tutor_idx on public.student_skill_progress (tutor_id);

alter table public.student_skill_progress enable row level security;
alter table public.student_skill_progress force row level security;

revoke all on public.student_skill_progress from public, anon, authenticated;
grant select on public.student_skill_progress to authenticated;

create policy student_skill_progress_select_own on public.student_skill_progress
  for select to authenticated
  using (tutor_id = (select auth.uid()));

-- Lectura de los ejercicios del bloque en curso (para no repetir enunciados).
create index if not exists student_attempts_student_topic_time_idx
  on public.student_attempts (student_id, topic, answered_at desc);

-- ---------------------------------------------------------------------------
-- record_attempt: mismo cuerpo que en 20261027130000_attempt_duration.sql y, si el tema es
-- un código de habilidad ("1-06"), actualiza el progreso en la misma transacción.
-- Un intento cuenta para el bloque solo si se emitió en el nivel actual de la habilidad
-- (un ejercicio emitido antes de un cambio de nivel no mezcla bloques).
-- Las tareas del tutor ("tarea_tutor") y los temas antiguos no tocan el progreso.
-- ---------------------------------------------------------------------------
create or replace function public.record_attempt(
  p_tutor_id    uuid,
  p_student_id  uuid,
  p_exercise_id uuid,
  p_topic       text,
  p_exercise    text,
  p_correct     boolean,
  p_local_day   date default null,
  p_level       integer default 1,
  p_duration_s  integer default null
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_inserted  integer;
  v_utc_today date := (now() at time zone 'utc')::date;
  v_progress  public.student_skill_progress%rowtype;
  v_total     integer;
  v_correct   integer;
  v_level     integer;
  v_mastered  timestamptz;
begin
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return 'student_not_found';
  end if;

  insert into public.student_attempts
    (student_id, tutor_id, exercise_id, topic, exercise, correct, level, duration_s)
  values
    (p_student_id, p_tutor_id, p_exercise_id, p_topic, p_exercise, p_correct, p_level, p_duration_s)
  on conflict (student_id, exercise_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    return 'duplicate';
  end if;

  if p_local_day is not null and p_local_day between v_utc_today - 1 and v_utc_today + 1 then
    insert into public.student_daily_streaks as s (student_id, tutor_id, current_len, last_day)
    values (p_student_id, p_tutor_id, 1, p_local_day)
    on conflict (student_id) do update
      set current_len = case
            when excluded.last_day = s.last_day + 1 then s.current_len + 1
            else 1
          end,
          last_day   = excluded.last_day,
          updated_at = now()
      where excluded.last_day > s.last_day;
  end if;

  -- Progreso por habilidad (regla de bloques de 10).
  if p_topic ~ '^[1-4]-[0-9]{2}$' then
    insert into public.student_skill_progress (student_id, tutor_id, skill_code)
    values (p_student_id, p_tutor_id, p_topic)
    on conflict (student_id, skill_code) do nothing;

    -- Bloqueo de la fila: dos respuestas simultáneas no pierden un conteo.
    select * into v_progress from public.student_skill_progress p
      where p.student_id = p_student_id and p.skill_code = p_topic
      for update;

    if v_progress.level = p_level then
      v_total    := v_progress.block_total + 1;
      v_correct  := v_progress.block_correct + case when p_correct then 1 else 0 end;
      v_level    := v_progress.level;
      v_mastered := v_progress.mastered_at;

      if v_total >= 10 then
        if v_correct >= 8 then
          if v_level < 3 then
            v_level := v_level + 1;
          else
            v_mastered := coalesce(v_mastered, now());
          end if;
        elsif v_correct <= 4 and v_level > 1 then
          v_level := v_level - 1;
        end if;
        v_total   := 0;
        v_correct := 0;
      end if;

      update public.student_skill_progress p
        set level         = v_level,
            block_total   = v_total,
            block_correct = v_correct,
            mastered_at   = v_mastered,
            updated_at    = now()
        where p.student_id = p_student_id and p.skill_code = p_topic;
    end if;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date, integer, integer)
  to service_role;
