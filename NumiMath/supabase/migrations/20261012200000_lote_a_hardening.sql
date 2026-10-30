-- Lote A (revisión del Lote 2): frenar el flujo de eventos de consentimiento, validar el
-- tipo de versión en las revocaciones, índices, permisos sobrantes y determinismo de la
-- compuerta.
--
-- Determinismo: PostgreSQL cachea dentro de una transacción el plan de una función SQL.
-- Si el rol cambia a mitad de la transacción (ocurre en los tests, no en producción), la
-- función reutilizaba un plan armado sin RLS. Por eso: (1) has_active_consent pasa a
-- PL/pgSQL, cuyas consultas se reevalúan al cambiar de rol, y (2) los triggers rechazan
-- explícitamente al cliente que actúa a nombre de otro tutor (tutor_mismatch).

-- ---------------------------------------------------------------------------
-- 1. has_active_consent en PL/pgSQL (misma firma y semántica).
-- ---------------------------------------------------------------------------
create or replace function public.has_active_consent(p_tutor_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_active boolean;
begin
  select latest.event_type = 'grant' and t.is_current and p.is_current
    into v_active
  from (
    select c.event_type, c.terms_version_id, c.privacy_version_id
    from public.consents c
    where c.tutor_id = p_tutor_id
    order by c.seq desc
    limit 1
  ) latest
  join public.legal_document_versions t on t.id = latest.terms_version_id
  join public.legal_document_versions p on p.id = latest.privacy_version_id;

  return coalesce(v_active, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Frenar el flujo de eventos de consentimiento (antes un tutor podía insertar miles).
--    Reglas, serializadas por tutor:
--      - un 'grant' idéntico al último 'grant' (mismas versiones) es redundante;
--      - un 'revoke' sobre otro 'revoke', o sin consentimiento previo, es redundante;
--      - máximo 20 eventos por tutor en 24 horas.
--    Se aplica también al servidor (los triggers corren con service_role).
-- ---------------------------------------------------------------------------
create function public.consents_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_last_type    text;
  v_last_terms   uuid;
  v_last_privacy uuid;
  v_count        integer;
begin
  -- El cliente solo puede registrar eventos propios. (RLS lo valida también; esto es
  -- determinista y evita tomar el bloqueo de otro tutor.)
  if current_user = 'authenticated' and new.tutor_id is distinct from auth.uid() then
    raise exception 'tutor_mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || new.tutor_id::text, 0));

  select c.event_type, c.terms_version_id, c.privacy_version_id
    into v_last_type, v_last_terms, v_last_privacy
  from public.consents c
  where c.tutor_id = new.tutor_id
  order by c.seq desc
  limit 1;

  if v_last_type is null then
    if new.event_type = 'revoke' then
      raise exception 'no_consent_to_revoke';
    end if;
  elsif new.event_type = v_last_type
        and (new.event_type = 'revoke'
             or (new.terms_version_id = v_last_terms
                 and new.privacy_version_id = v_last_privacy)) then
    raise exception 'consent_event_redundant';
  end if;

  select count(*) into v_count
  from public.consents c
  where c.tutor_id = new.tutor_id
    and c.occurred_at > now() - interval '24 hours';
  if v_count >= 20 then
    raise exception 'consent_event_rate_limited';
  end if;

  return new;
end;
$$;

revoke all on function public.consents_before_insert() from public, anon, authenticated;

create trigger consents_before_insert
  before insert on public.consents
  for each row execute function public.consents_before_insert();

-- ---------------------------------------------------------------------------
-- 3. Validar el tipo de documento también en las revocaciones.
--    is_current solo se exige para un 'grant'; un 'revoke' siempre se acepta, pero debe
--    apuntar a documentos del tipo correcto (si no, la evidencia queda falsa).
-- ---------------------------------------------------------------------------
drop policy consents_insert_own on public.consents;
create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (
    tutor_id = (select auth.uid())
    and exists (select 1 from public.legal_document_versions v
                where v.id = terms_version_id and v.kind = 'terms'
                  and (event_type = 'revoke' or v.is_current))
    and exists (select 1 from public.legal_document_versions v
                where v.id = privacy_version_id and v.kind = 'privacy'
                  and (event_type = 'revoke' or v.is_current))
  );

-- ---------------------------------------------------------------------------
-- 4. students_before_insert: chequeo de tutor al inicio, prefijo propio en el bloqueo
--    consultivo y error explícito si el tutor no existe.
-- ---------------------------------------------------------------------------
create or replace function public.students_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_consent uuid;
  v_decl    uuid;
  v_max     smallint;
  v_count   integer;
begin
  if current_user = 'authenticated' and new.tutor_id is distinct from auth.uid() then
    raise exception 'tutor_mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || new.tutor_id::text, 0));

  if not public.has_active_consent(new.tutor_id) then
    raise exception 'consent_required';
  end if;

  select c.id into v_consent
  from public.consents c
  where c.tutor_id = new.tutor_id
  order by c.seq desc
  limit 1;

  select v.id into v_decl
  from public.legal_document_versions v
  where v.kind = 'adult_declaration' and v.is_current;
  if v_decl is null then
    raise exception 'declaration_version_missing';
  end if;

  -- Cuenta todos los perfiles del tutor, también los bloqueados.
  select t.max_students into v_max from public.tutors t where t.id = new.tutor_id;
  if v_max is null then
    raise exception 'tutor_not_found';
  end if;
  select count(*) into v_count from public.students s where s.tutor_id = new.tutor_id;
  if v_count >= v_max then
    raise exception 'student_limit_reached';
  end if;

  new.consent_id                   := v_consent;
  new.adult_declaration_version_id := v_decl;
  new.adult_declared_at            := now();
  new.blocked_at                   := null;
  return new;
end;
$$;

-- Mismo prefijo en el bloqueo de las demás rutas que lo usan (deben coincidir).
create or replace function public.on_consent_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || new.tutor_id::text, 0));
  update public.students
     set blocked_at = now()
   where tutor_id = new.tutor_id and blocked_at is null;
  return new;
end;
$$;

create or replace function public.unblock_student(p_tutor_id uuid, p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || p_tutor_id::text, 0));

  if not public.has_active_consent(p_tutor_id) then
    return false;
  end if;

  update public.students
     set blocked_at = null
   where id = p_student_id and tutor_id = p_tutor_id and blocked_at is not null;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Índices de claves foráneas (borrar una cuenta recorría toda students por cada
--    evento de consentimiento eliminado).
-- ---------------------------------------------------------------------------
create index students_consent_id_idx on public.students (consent_id);
create index students_adult_declaration_version_id_idx on public.students (adult_declaration_version_id);

-- ---------------------------------------------------------------------------
-- 6. Permisos sobrantes.
-- ---------------------------------------------------------------------------
revoke all on function public.students_before_insert() from public, anon, authenticated;
revoke all on sequence public.consents_seq_seq from public, anon, authenticated;

-- Reversa (solo desarrollo):
--   drop trigger consents_before_insert on public.consents;
--   drop function public.consents_before_insert();
--   drop index public.students_consent_id_idx, public.students_adult_declaration_version_id_idx;
--   (restaurar has_active_consent, students_before_insert y la política consents_insert_own
--    de la migración 20261012190000/190100)
