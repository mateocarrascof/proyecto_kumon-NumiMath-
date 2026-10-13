-- Migración de apoyo para el servidor FastAPI (docs/adr/0001-contrato-fastapi-consentimiento.md).
--   - assert_read_committed(): la regla de aislamiento deja de ser solo documentación;
--   - authorize_student_use(): comprobaciones 2 y 3 del ADR en un solo viaje y una transacción;
--   - usage_*_daily + consume_usage(): límites por perfil/día y por tutor/día (la cuota por
--     tutor sobrevive al borrado de perfiles, para que crear y borrar no la reinicie);
--   - tutor_pins + funciones: control parental verificado en el servidor, con bloqueo por intentos.
-- Datos nuevos: contadores de uso por perfil y por tutor, y el hash del PIN del tutor
-- (ver docs/privacy/inventario-datos.md).

-- ---------------------------------------------------------------------------
-- 1. Regla de aislamiento READ COMMITTED.
--    Las rutas que toman el bloqueo por tutor son correctas solo bajo READ COMMITTED
--    (con REPEATABLE READ el conteo del tope y el estado del consentimiento se leen con
--    la vista del inicio de la transacción). Se exige con triggers de sentencia, que
--    corren antes de los triggers por fila y no obligan a redefinir las funciones.
-- ---------------------------------------------------------------------------
create function public.assert_read_committed()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'isolation_level_not_allowed';
  end if;
end;
$$;

revoke all on function public.assert_read_committed() from public, anon, authenticated;
grant execute on function public.assert_read_committed() to service_role;

-- El trigger corre con los permisos de quien ejecuta la sentencia (incluido el cliente),
-- por eso comprueba el nivel directamente en vez de llamar a assert_read_committed().
create function public.enforce_read_committed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'isolation_level_not_allowed';
  end if;
  return null;
end;
$$;

revoke all on function public.enforce_read_committed() from public, anon, authenticated;

-- Altas de perfiles y cambios de bloqueo (block_student, unblock_student, revocación).
create trigger students_enforce_read_committed
  before insert or update of blocked_at on public.students
  for each statement execute function public.enforce_read_committed();

-- Eventos de consentimiento.
create trigger consents_enforce_read_committed
  before insert on public.consents
  for each statement execute function public.enforce_read_committed();

-- ---------------------------------------------------------------------------
-- 2. Autorización de uso de un perfil (comprobaciones 2 y 3 del ADR, en ese orden).
--    Devuelve un código; el servidor traduce todo lo que no sea 'ok' a una respuesta
--    genérica. SECURITY DEFINER: solo la ejecuta service_role.
-- ---------------------------------------------------------------------------
create function public.authorize_student_use(p_tutor_id uuid, p_student_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_blocked_at timestamptz;
begin
  select s.blocked_at into v_blocked_at
  from public.students s
  where s.id = p_student_id and s.tutor_id = p_tutor_id;

  if not found then
    return 'student_not_found';
  end if;

  if v_blocked_at is not null then
    return 'student_blocked';
  end if;

  if not public.has_active_consent(p_tutor_id) then
    return 'consent_required';
  end if;

  return 'ok';
end;
$$;

revoke all on function public.authorize_student_use(uuid, uuid) from public, anon, authenticated;
grant execute on function public.authorize_student_use(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Uso diario por perfil y por tutor. El día se cuenta en hora de Chile.
--    usage_tutor_daily NO depende de students: borrar perfiles no reinicia la cuota.
-- ---------------------------------------------------------------------------
create table public.usage_student_daily (
  tutor_id   uuid    not null,
  student_id uuid    not null,
  day        date    not null,
  requests   integer not null default 0 check (requests >= 0),
  cost_units integer not null default 0 check (cost_units >= 0),
  primary key (student_id, day),
  foreign key (student_id, tutor_id) references public.students (id, tutor_id) on delete cascade
);
create index usage_student_daily_tutor_idx on public.usage_student_daily (tutor_id, day);

create table public.usage_tutor_daily (
  tutor_id   uuid    not null references public.tutors (id) on delete cascade,
  day        date    not null,
  requests   integer not null default 0 check (requests >= 0),
  cost_units integer not null default 0 check (cost_units >= 0),
  primary key (tutor_id, day)
);
create index usage_tutor_daily_day_idx on public.usage_tutor_daily (day);

alter table public.usage_student_daily enable row level security;
alter table public.usage_student_daily force row level security;
alter table public.usage_tutor_daily   enable row level security;
alter table public.usage_tutor_daily   force row level security;

revoke all on public.usage_student_daily, public.usage_tutor_daily from public, anon, authenticated;
grant select on public.usage_student_daily, public.usage_tutor_daily to authenticated;

-- El tutor puede ver su propio consumo; solo el servidor lo escribe.
create policy usage_student_select_own on public.usage_student_daily
  for select to authenticated
  using (tutor_id = (select auth.uid()));

create policy usage_tutor_select_own on public.usage_tutor_daily
  for select to authenticated
  using (tutor_id = (select auth.uid()));

-- Consume cuota de forma atómica (serializada por tutor). Los límites los entrega el
-- servidor (configurables sin migración). Devuelve: 'ok', 'student_limit' o 'tutor_limit'.
-- Si ya se superaría un límite, NO se registra nada.
create function public.consume_usage(
  p_tutor_id      uuid,
  p_student_id    uuid,
  p_cost          integer,
  p_student_limit integer,
  p_tutor_limit   integer
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day       date := (now() at time zone 'America/Santiago')::date;
  v_s_cost    integer;
  v_t_cost    integer;
begin
  if p_cost is null or p_cost < 1
     or p_student_limit is null or p_student_limit < 1
     or p_tutor_limit is null or p_tutor_limit < 1 then
    raise exception 'invalid_usage_parameters' using errcode = '22023';
  end if;

  perform public.assert_read_committed();

  -- El perfil debe ser del tutor. No basta con la clave foránea compuesta de la tabla de
  -- consumo: con `on conflict do nothing` no se evalúa si la fila del perfil ya existe.
  if not exists (select 1 from public.students s
                 where s.id = p_student_id and s.tutor_id = p_tutor_id) then
    raise exception 'student_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_tutor_id::text, 0));

  insert into public.usage_tutor_daily (tutor_id, day)
  values (p_tutor_id, v_day)
  on conflict do nothing;

  insert into public.usage_student_daily (tutor_id, student_id, day)
  values (p_tutor_id, p_student_id, v_day)
  on conflict do nothing;

  select u.cost_units into v_s_cost
  from public.usage_student_daily u
  where u.student_id = p_student_id and u.day = v_day;

  select u.cost_units into v_t_cost
  from public.usage_tutor_daily u
  where u.tutor_id = p_tutor_id and u.day = v_day;

  if v_s_cost + p_cost > p_student_limit then
    return 'student_limit';
  end if;
  if v_t_cost + p_cost > p_tutor_limit then
    return 'tutor_limit';
  end if;

  update public.usage_student_daily
     set requests = requests + 1, cost_units = cost_units + p_cost
   where student_id = p_student_id and day = v_day;

  update public.usage_tutor_daily
     set requests = requests + 1, cost_units = cost_units + p_cost
   where tutor_id = p_tutor_id and day = v_day;

  return 'ok';
end;
$$;

revoke all on function public.consume_usage(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_usage(uuid, uuid, integer, integer, integer) to service_role;

-- Limpieza: el consumo diario no se necesita pasadas unas semanas.
create function public.purge_old_usage()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff date := (now() at time zone 'America/Santiago')::date - 35;
  v_a      integer;
  v_b      integer;
begin
  delete from public.usage_student_daily where day < v_cutoff;
  get diagnostics v_a = row_count;
  delete from public.usage_tutor_daily where day < v_cutoff;
  get diagnostics v_b = row_count;
  return v_a + v_b;
end;
$$;

revoke all on function public.purge_old_usage() from public, anon, authenticated;
grant execute on function public.purge_old_usage() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Control parental (PIN): el servidor calcula y verifica el hash (argon2id); la base
--    guarda el hash y cuenta los intentos fallidos con bloqueo temporal.
--    5 fallos seguidos -> bloqueo de 15 minutos. Se borra con la cuenta.
-- ---------------------------------------------------------------------------
create table public.tutor_pins (
  tutor_id        uuid primary key references public.tutors (id) on delete cascade,
  pin_hash        text not null check (char_length(pin_hash) between 20 and 300),
  failed_attempts smallint not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

alter table public.tutor_pins enable row level security;
alter table public.tutor_pins force row level security;
revoke all on public.tutor_pins from public, anon, authenticated;

-- Política por tutor (regla del proyecto). El cliente no tiene privilegios sobre la tabla,
-- de modo que ni siquiera su propio hash es legible: solo el servidor la usa.
create policy tutor_pins_select_own on public.tutor_pins
  for select to authenticated
  using (tutor_id = (select auth.uid()));

create function public.set_tutor_pin(p_tutor_id uuid, p_pin_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tutor_pins (tutor_id, pin_hash)
  values (p_tutor_id, p_pin_hash)
  on conflict (tutor_id) do update
     set pin_hash = excluded.pin_hash,
         failed_attempts = 0,
         locked_until = null,
         updated_at = now();
end;
$$;

-- Estado para verificar: el servidor compara el hash y luego registra el resultado.
create function public.get_tutor_pin_state(p_tutor_id uuid)
returns table (pin_hash text, locked_until timestamptz, failed_attempts smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.pin_hash, p.locked_until, p.failed_attempts
  from public.tutor_pins p
  where p.tutor_id = p_tutor_id;
$$;

-- Registra el resultado de una verificación. Mientras haya bloqueo vigente no se cuenta.
-- Devuelve el estado resultante.
create function public.register_pin_attempt(p_tutor_id uuid, p_success boolean)
returns table (locked_until timestamptz, failed_attempts smallint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked   timestamptz;
  v_attempts smallint;
begin
  select p.locked_until, p.failed_attempts into v_locked, v_attempts
  from public.tutor_pins p
  where p.tutor_id = p_tutor_id
  for update;

  if not found then
    raise exception 'pin_not_set';
  end if;

  if v_locked is not null and v_locked > now() then
    return query select v_locked, v_attempts;
    return;
  end if;

  if p_success then
    update public.tutor_pins
       set failed_attempts = 0, locked_until = null
     where tutor_id = p_tutor_id;
    return query select null::timestamptz, 0::smallint;
    return;
  end if;

  v_attempts := v_attempts + 1;
  if v_attempts >= 5 then
    update public.tutor_pins
       set failed_attempts = 0, locked_until = now() + interval '15 minutes'
     where tutor_id = p_tutor_id;
    return query select now() + interval '15 minutes', 0::smallint;
  else
    update public.tutor_pins
       set failed_attempts = v_attempts, locked_until = null
     where tutor_id = p_tutor_id;
    return query select null::timestamptz, v_attempts;
  end if;
end;
$$;

revoke all on function public.set_tutor_pin(uuid, text)         from public, anon, authenticated;
revoke all on function public.get_tutor_pin_state(uuid)         from public, anon, authenticated;
revoke all on function public.register_pin_attempt(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_tutor_pin(uuid, text)         to service_role;
grant execute on function public.get_tutor_pin_state(uuid)         to service_role;
grant execute on function public.register_pin_attempt(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Limpieza del consumo con pg_cron y su alerta.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.schedule('privacy-purge-usage', '40 3 * * *', 'select public.purge_old_usage()');
  end if;
end $$;

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
                               'privacy-purge-inactive', 'privacy-purge-usage']
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

-- Reversa (solo desarrollo):
--   select cron.unschedule('privacy-purge-usage');
--   drop trigger students_enforce_read_committed on public.students;
--   drop trigger consents_enforce_read_committed on public.consents;
--   drop function public.enforce_read_committed(), public.assert_read_committed(),
--                 public.authorize_student_use(uuid, uuid), public.consume_usage(uuid, uuid, integer, integer, integer),
--                 public.purge_old_usage(), public.set_tutor_pin(uuid, text), public.get_tutor_pin_state(uuid),
--                 public.register_pin_attempt(uuid, boolean);
--   drop table public.usage_student_daily, public.usage_tutor_daily, public.tutor_pins;
--   (restaurar privacy_job_warnings con 3 trabajos)
