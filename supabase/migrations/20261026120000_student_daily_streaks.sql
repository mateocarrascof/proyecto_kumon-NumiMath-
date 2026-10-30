-- Racha diaria ("días seguidos") de un perfil. Suma 1 el primer día (fecha local del dispositivo)
-- en que el perfil responde al menos un ejercicio; si pasa un día completo sin responder, se reinicia.
--
-- Minimización: no se guarda el historial de días, solo el largo de la racha y el último día local
-- practicado (fecha sin hora ni zona horaria). La escribe SOLO el servidor (FastAPI, service_role)
-- dentro de record_attempt; el tutor solo puede leer la de sus perfiles (RLS por tutor).
--
-- Borrado: al borrar el perfil se borra su racha (ON DELETE CASCADE).
-- Inventario: docs/privacy/inventario-datos.md. Reglas: docs/SPEC.md ("Racha diaria").

create table public.student_daily_streaks (
  student_id   uuid primary key references public.students (id) on delete cascade,
  tutor_id     uuid not null references public.tutors (id) on delete cascade,
  current_len  integer not null check (current_len >= 1),
  last_day     date not null,
  updated_at   timestamptz not null default now()
);

create index student_daily_streaks_tutor_idx on public.student_daily_streaks (tutor_id);

alter table public.student_daily_streaks enable row level security;
alter table public.student_daily_streaks force row level security;

revoke all on public.student_daily_streaks from public, anon, authenticated;
grant select on public.student_daily_streaks to authenticated;

create policy student_daily_streaks_select_own on public.student_daily_streaks
  for select to authenticated
  using (tutor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- record_attempt: ahora recibe la fecha local del dispositivo (opcional).
-- Si el intento es nuevo ('ok') y la fecha es válida, actualiza la racha en la
-- misma transacción. Fecha válida: entre la fecha UTC del servidor −1 y +1
-- (cubre UTC−12 a UTC+14). Una fecha anterior al último día no cambia nada
-- (no se pueden rellenar días perdidos). Fuera de rango: el intento se registra
-- igual y la racha no cambia.
-- ---------------------------------------------------------------------------
drop function public.record_attempt(uuid, uuid, uuid, text, text, boolean);

create function public.record_attempt(
  p_tutor_id    uuid,
  p_student_id  uuid,
  p_exercise_id uuid,
  p_topic       text,
  p_exercise    text,
  p_correct     boolean,
  p_local_day   date default null
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_inserted  integer;
  v_utc_today date := (now() at time zone 'utc')::date;
begin
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return 'student_not_found';
  end if;

  insert into public.student_attempts (student_id, tutor_id, exercise_id, topic, exercise, correct)
  values (p_student_id, p_tutor_id, p_exercise_id, p_topic, p_exercise, p_correct)
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
      -- Mismo día o un día anterior: no se toca la fila.
      where excluded.last_day > s.last_day;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date)
  from public, anon, authenticated;
grant execute on function public.record_attempt(uuid, uuid, uuid, text, text, boolean, date)
  to service_role;
