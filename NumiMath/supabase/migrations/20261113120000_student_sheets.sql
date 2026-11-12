-- Hojas de cálculo guardadas del niño ("Papel para calcular", CU-A22) y su lectura por el docente (CU-D8).
--
-- Decisiones (docs/SPEC.md, "Hojas guardadas"; docs/privacy/hojas-guardadas-justificacion.md):
--   - Las hojas pertenecen al NIÑO. Se guardan solo si el perfil tiene un docente vinculado activo.
--   - Son DATOS VECTORIALES en jsonb (trazos), con tope de tamaño: sin imágenes ni metadatos del dispositivo.
--     `content` = { statement, child_answer, correct_answer, strokes }. El enunciado lo toma la base del
--     intento (nunca del cliente) y en las tareas del tutor es siempre "Tarea del tutor", nunca su texto.
--   - Una hoja por ejercicio (upsert). Sin columnas nuevas en `student_attempts`.
--   - Escribe solo el servidor (`service_role`). El tutor lee las de sus perfiles (RLS). El docente lee solo
--     por `teacher_can_view` y solo las guardadas desde `accepted_at` de su vínculo.
--   - Se borran en cascada con el perfil o la cuenta (T21) y al revocar el consentimiento (T20). Quitar un
--     vínculo o borrar al docente NO las borra: dejan de verse para ese docente.
--   - Solo cuentan los vínculos cuyo texto de autorización DESCRIBE las hojas (`covers_sheets`, desde
--     `autorizacion-docente-prov-5`): los vínculos con textos anteriores no guardan ni muestran hojas
--     (EIPD R35, solo para hojas; el historial y el progreso no cambian).
--   - Límite por tutor (hojas por minuto y por día, en app_settings) contra abusos.
--   - Plazo máximo: 90 días PROVISIONAL (`sheet_retention_days`, `sheet_retention_confirmed` = false hasta
--     que Legal lo valide), purgado a diario con pg_cron.

-- ---------------------------------------------------------------------------
-- 0. Qué versiones del texto de autorización describen las hojas. Las ya publicadas quedan en false
--    (no las describían); la semilla marca `prov-5` y las siguientes deben marcarlo al publicarse.
-- ---------------------------------------------------------------------------
alter table public.legal_document_versions
  add column covers_sheets boolean not null default false;

-- Como el texto y su huella, `covers_sheets` es definitivo una vez publicada la versión.
create or replace function public.legal_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'legal_versions_are_permanent';
  end if;
  -- Solo is_current puede cambiar: el texto publicado, su huella y lo que cubre son definitivos.
  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.version is distinct from old.version
     or new.content_sha256 is distinct from old.content_sha256
     or new.published_at is distinct from old.published_at
     or new.covers_sheets is distinct from old.covers_sheets then
    raise exception 'legal_versions_are_immutable';
  end if;
  return new;
end;
$$;

-- ¿El perfil tiene un docente vinculado ACTIVO cuyo vínculo cubre las hojas? (misma regla de acceso
-- del docente: `teacher_can_view`). La usan el guardado y la API ("hay vínculo").
create function public.student_has_sheet_link(p_tutor_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teacher_links l
    join public.legal_document_versions v on v.id = l.terms_version_id and v.covers_sheets
    where l.student_id = p_student_id and l.tutor_id = p_tutor_id
      and public.teacher_can_view(l.teacher_id, l.student_id)
  );
$$;

revoke all on function public.student_has_sheet_link(uuid, uuid) from public, anon, authenticated;
grant execute on function public.student_has_sheet_link(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 1. Tabla
-- ---------------------------------------------------------------------------
create table public.student_sheets (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  tutor_id    uuid not null references public.tutors (id) on delete cascade,
  exercise_id uuid not null,
  topic       text not null check (char_length(topic) between 1 and 60),
  correct     boolean not null,
  content     jsonb not null
              constraint student_sheets_content_shape check (
                jsonb_typeof(content) = 'object'
                and jsonb_typeof(content -> 'strokes') = 'array'
                and octet_length(content::text) <= 300000),
  saved_at    timestamptz not null default now(),
  constraint student_sheets_once unique (student_id, exercise_id)
);

create index student_sheets_student_time_idx on public.student_sheets (student_id, saved_at desc);
create index student_sheets_tutor_idx on public.student_sheets (tutor_id);
create index student_sheets_saved_at_idx on public.student_sheets (saved_at);

alter table public.student_sheets enable row level security;
alter table public.student_sheets force row level security;

revoke all on public.student_sheets from public, anon, authenticated;
grant select on public.student_sheets to authenticated;

create policy student_sheets_select_own on public.student_sheets
  for select to authenticated
  using (tutor_id = (select auth.uid()));

-- Contador de guardados por tutor (límite por minuto y por día). Solo el servidor lo toca: RLS sin
-- políticas ni permisos para el cliente. Se borra con el tutor y se purga con las hojas.
create table public.sheet_save_counters (
  tutor_id     uuid not null references public.tutors (id) on delete cascade,
  day          date not null,
  n_day        integer not null default 0,
  minute_start timestamptz not null default now(),
  n_minute     integer not null default 0,
  primary key (tutor_id, day)
);

alter table public.sheet_save_counters enable row level security;
alter table public.sheet_save_counters force row level security;
revoke all on public.sheet_save_counters from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guardar (upsert). 'ok' | 'not_found' | 'no_link' | 'no_attempt' | 'mismatch' | 'rate_limited'.
--    p_correct: si acertó, calculado por el servidor (fracciones equivalentes incluidas). En las tareas
--    del tutor se ignora: la base lo calcula con la respuesta de la tarea.
-- ---------------------------------------------------------------------------
create function public.save_student_sheet(
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

  v_correct := p_correct;
  if v_attempt.topic = 'tarea_tutor' then
    select * into v_task from public.assigned_exercises t
    where t.id = p_exercise_id and t.student_id = p_student_id;
    if not found or p_child_answer !~ '^[0-9]{1,7}$' then
      return 'mismatch';
    end if;
    p_correct_ans := v_task.answer::text;
    v_correct := (p_child_answer::integer = v_task.answer);
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
  if v_counter.n_minute >= coalesce(v_per_min, 30) or v_counter.n_day >= coalesce(v_per_day, 500) then
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
  return 'ok';
end;
$$;

revoke all on function public.save_student_sheet(uuid, uuid, uuid, text, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_student_sheet(uuid, uuid, uuid, text, boolean, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Lectura del DOCENTE (D8). Solo por `teacher_can_view`; `null` si no hay acceso (la API responde el
--    mismo 404). Solo las guardadas desde `accepted_at` del vínculo. Solo lectura.
-- ---------------------------------------------------------------------------
create function public.teacher_student_sheets(
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
  join public.legal_document_versions v on v.id = l.terms_version_id and v.covers_sheets
  where l.teacher_id = p_teacher_id and l.student_id = p_student_id;
  if not found then
    return null;   -- sin vínculo, o su texto de autorización no describe las hojas (R35)
  end if;

  with page as (
    select h.id, h.topic, h.correct, h.saved_at
    from public.student_sheets h
    where h.student_id = p_student_id and h.tutor_id = v_tutor and h.saved_at >= v_from
    order by h.saved_at desc, h.id desc
    offset v_offset limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'topic', topic, 'correct', correct,
           'day', to_char((saved_at at time zone 'America/Santiago')::date, 'YYYY-MM-DD'))
         order by saved_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         count(*)::integer
    into v_items, v_count
  from (select page.*, row_number() over (order by saved_at desc, id desc) as rn from page) numbered;

  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit);
end;
$$;

revoke all on function public.teacher_student_sheets(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.teacher_student_sheets(uuid, uuid, integer, integer) to service_role;

create function public.teacher_student_sheet(p_teacher_id uuid, p_student_id uuid, p_sheet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from  timestamptz;
  v_tutor uuid;
  v_row   public.student_sheets%rowtype;
begin
  if not public.teacher_can_view(p_teacher_id, p_student_id) then
    return null;
  end if;
  select l.accepted_at, l.tutor_id into v_from, v_tutor
  from public.teacher_links l
  join public.legal_document_versions v on v.id = l.terms_version_id and v.covers_sheets
  where l.teacher_id = p_teacher_id and l.student_id = p_student_id;
  if not found then
    return null;
  end if;
  select * into v_row from public.student_sheets h
  where h.id = p_sheet_id and h.student_id = p_student_id and h.tutor_id = v_tutor
    and h.saved_at >= v_from;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_row.id, 'topic', v_row.topic, 'correct', v_row.correct,
    'day', to_char((v_row.saved_at at time zone 'America/Santiago')::date, 'YYYY-MM-DD'),
    'content', v_row.content);
end;
$$;

revoke all on function public.teacher_student_sheet(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.teacher_student_sheet(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Revocar el consentimiento borra las hojas del tutor (T20). El perfil y la cuenta las borran en
--    cascada (T21). Quitar un vínculo NO pasa por aquí.
-- ---------------------------------------------------------------------------
create function public.on_consent_revoked_delete_sheets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.student_sheets where tutor_id = new.tutor_id;
  return new;
end;
$$;

revoke all on function public.on_consent_revoked_delete_sheets() from public, anon, authenticated;

create trigger consents_after_revoke_delete_sheets
  after insert on public.consents
  for each row when (new.event_type = 'revoke')
  execute function public.on_consent_revoked_delete_sheets();

-- ---------------------------------------------------------------------------
-- 5. Plazo máximo de conservación (PROVISIONAL, sin confirmar por Legal) y purga diaria.
-- ---------------------------------------------------------------------------
alter table public.app_settings drop constraint app_settings_values_valid;
alter table public.app_settings add constraint app_settings_values_valid check (
  case key
    when 'consent_evidence_retention_days' then
      value = 'null'::jsonb
      or (jsonb_typeof(value) = 'number'
          and case when (value #>> '{}') ~ '^[0-9]{1,5}$'
                   then (value #>> '{}')::integer between 1 and 36500
                   else false end)
    when 'blocked_profile_retention_days' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,5}$'
               then (value #>> '{}')::integer between 1 and 36500
               else false end
    when 'inactive_profile_retention_days' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,5}$'
               then (value #>> '{}')::integer between 1 and 36500
               else false end
    when 'sheet_retention_days' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,5}$'
               then (value #>> '{}')::integer between 1 and 36500
               else false end
    when 'sheet_saves_per_minute' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,4}$'
               then (value #>> '{}')::integer between 1 and 1000
               else false end
    when 'sheet_saves_per_day' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,5}$'
               then (value #>> '{}')::integer between 1 and 100000
               else false end
    when 'blocked_profile_retention_confirmed' then jsonb_typeof(value) = 'boolean'
    when 'inactive_profile_retention_confirmed' then jsonb_typeof(value) = 'boolean'
    when 'consent_evidence_retention_confirmed' then jsonb_typeof(value) = 'boolean'
    when 'sheet_retention_confirmed' then jsonb_typeof(value) = 'boolean'
    when 'student_creations_per_day' then
      jsonb_typeof(value) = 'number'
      and case when (value #>> '{}') ~ '^[0-9]{1,4}$'
               then (value #>> '{}')::integer between 1 and 1000
               else false end
    else true
  end
);

insert into public.app_settings (key, value) values
  ('sheet_retention_days', '90'::jsonb),
  ('sheet_retention_confirmed', 'false'::jsonb),
  ('sheet_saves_per_minute', '30'::jsonb),
  ('sheet_saves_per_day', '500'::jsonb);

-- El plazo se lee AL PURGAR y cuenta desde `saved_at` (la última vez que se guardó la hoja).
create function public.purge_expired_student_sheets()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_rows integer;
begin
  select (s.value #>> '{}')::integer into v_days
  from public.app_settings s where s.key = 'sheet_retention_days';
  if v_days is null then
    return 0;
  end if;
  delete from public.student_sheets where saved_at + make_interval(days => v_days) < now();
  get diagnostics v_rows = row_count;
  delete from public.sheet_save_counters where day < current_date - 2;
  return v_rows;
end;
$$;

revoke all on function public.purge_expired_student_sheets() from public, anon, authenticated;
grant execute on function public.purge_expired_student_sheets() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('privacy-purge-sheets', '50 3 * * *',
                          'select public.purge_expired_student_sheets()');
  else
    raise notice 'pg_cron no está disponible: la purga de hojas debe programarse por otro medio';
  end if;
end $$;

-- Reversión manual (no se ejecuta sola):
--   select cron.unschedule('privacy-purge-sheets');
--   drop trigger consents_after_revoke_delete_sheets on public.consents;
--   drop function public.on_consent_revoked_delete_sheets(), public.purge_expired_student_sheets(),
--     public.teacher_student_sheet(uuid, uuid, uuid), public.teacher_student_sheets(uuid, uuid, integer, integer),
--     public.save_student_sheet(uuid, uuid, uuid, text, boolean, text, jsonb);
--   delete from public.app_settings where key in ('sheet_retention_days', 'sheet_retention_confirmed');
--   drop table public.student_sheets, public.sheet_save_counters;
--   drop function public.student_has_sheet_link(uuid, uuid);
--   alter table public.legal_document_versions drop column covers_sheets;
