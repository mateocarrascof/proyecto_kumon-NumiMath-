-- CU-A21: plazo propio de 90 días para los intentos de JUEGO (decisión del dueño, ADR 0004).
-- Una ronda de juego dura segundos y cada respuesta es una fila en `student_attempts`; los juegos
-- no entran al progreso, informe ni gráfico (la racha vive en `student_daily_streaks`). Pasados 90
-- días se borran: menos volumen y minimización de datos. NO toca práctica ni diagnóstico.
-- Sin tope diario (pendiente en el SPEC). Idempotente.

-- Índice parcial para que la purga encuentre los juegos viejos sin recorrer la tabla.
create index if not exists student_attempts_game_time_idx
  on public.student_attempts (answered_at)
  where activity = 'game';

-- ---------------------------------------------------------------------------
-- purge_old_game_attempts: borra los intentos de juego de hace más de 90 días, por lotes de 5.000
-- (cada lote es corto: no retiene bloqueos sobre la tabla que más crece). Devuelve cuántos borró.
-- Duda para Adolfo: el historial del tutor (CU-T5) mostrará solo los últimos 90 días de juegos.
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_game_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
  v_batch  integer;
  v_total  integer := 0;
begin
  loop
    delete from public.student_attempts a
    where a.ctid in (
      select b.ctid from public.student_attempts b
      where b.activity = 'game' and b.answered_at < v_cutoff
      limit 5000
    );
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch < 5000;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.purge_old_game_attempts() from public, anon, authenticated;
grant execute on function public.purge_old_game_attempts() to service_role;

-- Programada cada día con pg_cron (si existe), como las demás purgas.
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.schedule('privacy-purge-games', '50 3 * * *',
                          'select public.purge_old_game_attempts()');
  else
    raise notice 'pg_cron no está disponible: la purga de juegos debe programarse por otro medio';
  end if;
end $$;

-- La alerta de trabajos vigila también esta purga.
create or replace function public.privacy_job_warnings()
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job  text;
  v_last timestamptz;
begin
  if to_regclass('cron.job') is null then
    return next 'pg_cron no está instalado: las purgas de privacidad no están programadas';
    return;
  end if;

  foreach v_job in array array['privacy-purge-evidence', 'privacy-purge-blocked',
                               'privacy-purge-inactive', 'privacy-purge-usage',
                               'privacy-purge-games']
  loop
    if not exists (select 1 from cron.job j where j.jobname = v_job) then
      return next 'trabajo ' || v_job || ' no está programado';
    else
      select max(d.start_time) into v_last
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where j.jobname = v_job and d.status = 'succeeded';

      if v_last is null or v_last < now() - interval '48 hours' then
        return next 'trabajo ' || v_job || ' sin ejecución correcta en las últimas 48 horas';
      end if;
    end if;
  end loop;
  return;
end;
$$;
