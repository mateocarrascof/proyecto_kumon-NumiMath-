-- CU-A12 (ADR 0002): límite de descargas del lote para practicar sin conexión.
-- Se reutiliza el registro de uso diario por perfil (usage_student_daily), que ya tiene RLS
-- forzada, la política de lectura por tutor, la clave foránea compuesta (student_id, tutor_id)
-- con borrado en cascada y la purga de filas viejas (purge_old_usage). El lote en sí NO se guarda
-- en la base: los ejercicios van firmados y sin estado. No es un dato nuevo del niño: solo cuántas
-- veces se descargó el lote ese día.
alter table public.usage_student_daily
  add column offline_batches integer not null default 0,
  add constraint usage_student_daily_offline_batches_check check (offline_batches >= 0);

-- ---------------------------------------------------------------------------
-- consume_offline_batch: cuenta una descarga del lote. Devuelve 'ok', 'limit' (ya hubo
-- p_daily_limit descargas hoy; no se registra nada) o 'student_not_found' (perfil ajeno o
-- inexistente). El límite lo entrega FastAPI (configurable sin migración; hoy 5).
-- El día se cuenta en hora de Chile, igual que la cuota de explicaciones.
-- ---------------------------------------------------------------------------
create function public.consume_offline_batch(
  p_tutor_id    uuid,
  p_student_id  uuid,
  p_daily_limit integer
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day     date := (now() at time zone 'America/Santiago')::date;
  v_updated integer;
begin
  if p_daily_limit is null or p_daily_limit < 1 then
    raise exception 'invalid_usage_parameters' using errcode = '22023';
  end if;

  perform public.assert_read_committed();

  -- El perfil debe ser del tutor (como en consume_usage): con `on conflict do nothing` la clave
  -- foránea no basta para detectar un perfil ajeno si la fila del día ya existe.
  if not exists (select 1 from public.students s
                 where s.id = p_student_id and s.tutor_id = p_tutor_id) then
    return 'student_not_found';
  end if;

  insert into public.usage_student_daily (tutor_id, student_id, day)
  values (p_tutor_id, p_student_id, v_day)
  on conflict do nothing;

  -- Suma y compara en una sola sentencia: el bloqueo de la fila evita que dos descargas
  -- simultáneas pasen las dos con el contador en 4.
  update public.usage_student_daily
     set offline_batches = offline_batches + 1
   where student_id = p_student_id and day = v_day and offline_batches < p_daily_limit;
  get diagnostics v_updated = row_count;

  return case when v_updated = 1 then 'ok' else 'limit' end;
end;
$$;

-- Duda para revisión: el límite es solo por perfil (lo aprobado en el ADR 0002). Un tutor con
-- 5 perfiles puede descargar hasta 25 lotes al día; el alta de perfiles ya está limitada a 10 por
-- 24 h. Confirmar si hace falta además un tope por tutor.
revoke all on function public.consume_offline_batch(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_offline_batch(uuid, uuid, integer) to service_role;
