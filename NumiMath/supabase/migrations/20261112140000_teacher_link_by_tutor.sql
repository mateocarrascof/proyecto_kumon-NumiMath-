-- El tutor vincula a un docente con un hijo (T25, con el aviso de T24 integrado) y lo quita (T26).
--
-- Solo las llama el servidor (`service_role`), después de verificar el JWT del tutor y su PIN. El
-- vínculo es la autorización: guarda cuándo la dio el tutor, la versión del texto que aceptó y el
-- nombre del docente que se le mostró. Un vínculo es de UN hijo; cada hijo se vincula por separado.
--
-- Ninguna función lee datos de niños: solo comprueban que el perfil es del tutor (ni apodo ni curso).

-- ---------------------------------------------------------------------------
-- 1. Texto legal propio: la autorización del docente. Versionado como los demás (huella SHA-256); su
--    versión vigente NO interviene en `has_active_consent` (no obliga a re-aceptar los términos).
-- ---------------------------------------------------------------------------
alter table public.legal_document_versions drop constraint legal_document_versions_kind_check;
alter table public.legal_document_versions
  add constraint legal_document_versions_kind_check
  check (kind in ('terms', 'privacy', 'adult_declaration', 'teacher_authorization'));

-- ---------------------------------------------------------------------------
-- 2. Límite de intentos al ingresar códigos: 5 fallos seguidos por tutor y 15 minutos de bloqueo,
--    igual que el PIN. Solo los lleva el servidor. Un código correcto reinicia la cuenta.
-- ---------------------------------------------------------------------------
create table public.link_code_attempts (
  tutor_id     uuid primary key references public.tutors (id) on delete cascade,
  failed       smallint not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.link_code_attempts enable row level security;
alter table public.link_code_attempts force row level security;
revoke all on public.link_code_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. teacher_link_lookup: busca al docente por su código y devuelve solo su nombre y el texto legal
--    vigente. Estados: 'ok', 'not_found' (el código no existe: mismo estado para cualquier código
--    malo), 'locked' (demasiados fallos), 'already_linked', 'student_not_found',
--    'no_terms' (no hay texto vigente publicado).
--    El docente NO se entera de nada: no se escribe nada que él pueda ver.
-- ---------------------------------------------------------------------------
create function public.teacher_link_lookup(p_tutor_id uuid, p_student_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.link_code_attempts;
  v_teacher record;
  v_terms   record;
begin
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return jsonb_build_object('status', 'student_not_found');
  end if;

  -- Un tutor a la vez: el conteo de fallos no se puede esquivar con peticiones paralelas.
  perform pg_advisory_xact_lock(hashtextextended('link_attempts:' || p_tutor_id::text, 0));
  insert into public.link_code_attempts (tutor_id) values (p_tutor_id) on conflict do nothing;
  select * into v_row from public.link_code_attempts where tutor_id = p_tutor_id;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'status', 'locked',
      'retry_after', greatest(1, ceil(extract(epoch from (v_row.locked_until - now())))::int));
  end if;
  if v_row.locked_until is not null
     or v_row.updated_at < now() - interval '15 minutes' then
    -- el bloqueo ya venció, o pasaron 15 minutos sin fallos: se parte de cero
    update public.link_code_attempts set failed = 0, locked_until = null where tutor_id = p_tutor_id;
    v_row.failed := 0;
  end if;

  select t.id, t.name into v_teacher
  from public.teachers t
  join auth.users u on u.id = t.id and u.raw_app_meta_data ->> 'role' = 'teacher'
  where t.link_code = upper(btrim(p_code));

  if not found then
    update public.link_code_attempts
       set failed = failed + 1,
           locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' end,
           updated_at = now()
     where tutor_id = p_tutor_id;
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Un acierto NO reinicia la cuenta (si no, se podría intercalar un código válido conocido para no
  -- bloquearse nunca): se reinicia al crear el vínculo o tras 15 minutos sin fallos.
  if exists (
    select 1 from public.teacher_links l
    where l.teacher_id = v_teacher.id and l.student_id = p_student_id
  ) then
    return jsonb_build_object('status', 'already_linked');
  end if;

  select v.id, v.version, v.content_sha256 into v_terms
  from public.legal_document_versions v
  where v.kind = 'teacher_authorization' and v.is_current;
  if not found then
    return jsonb_build_object('status', 'no_terms');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'teacher_id', v_teacher.id,
    'name', v_teacher.name,
    'terms_id', v_terms.id,
    'terms_version', v_terms.version,
    'terms_sha256', v_terms.content_sha256);
end;
$$;

revoke all on function public.teacher_link_lookup(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.teacher_link_lookup(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. create_teacher_link: crea el vínculo. Comprueba que el perfil es del tutor, que el docente sigue
--    siendo docente y que su nombre es el que se le mostró, y que el texto aceptado es el vigente.
--    El trigger `teacher_links_require_consent` exige el consentimiento vigente del tutor.
--    Devuelve 'ok', 'already_linked', 'student_not_found', 'teacher_not_found', 'name_changed',
--    'terms_outdated' o 'consent_required'.
-- ---------------------------------------------------------------------------
create function public.create_teacher_link(
  p_tutor_id         uuid,
  p_student_id       uuid,
  p_teacher_id       uuid,
  p_teacher_name     text,
  p_terms_version_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.tutor_id = p_tutor_id and s.blocked_at is null
  ) then
    return 'student_not_found';
  end if;

  select t.name into v_name
  from public.teachers t
  join auth.users u on u.id = t.id and u.raw_app_meta_data ->> 'role' = 'teacher'
  where t.id = p_teacher_id;
  if not found then
    return 'teacher_not_found';
  end if;
  if v_name is distinct from p_teacher_name then
    return 'name_changed';
  end if;

  if not exists (
    select 1 from public.legal_document_versions v
    where v.id = p_terms_version_id and v.kind = 'teacher_authorization' and v.is_current
  ) then
    return 'terms_outdated';
  end if;

  begin
    insert into public.teacher_links (teacher_id, student_id, tutor_id, terms_version_id, teacher_name)
    values (p_teacher_id, p_student_id, p_tutor_id, p_terms_version_id, p_teacher_name);
  exception
    when unique_violation then
      return 'already_linked';
    when insufficient_privilege then
      return 'consent_required';  -- lo lanza el trigger si no hay consentimiento vigente
  end;
  update public.link_code_attempts
     set failed = 0, locked_until = null, updated_at = now() where tutor_id = p_tutor_id;
  return 'ok';
end;
$$;

revoke all on function public.create_teacher_link(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_teacher_link(uuid, uuid, uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. list_student_teachers: docentes vinculados a un perfil del tutor (T26). Devuelve `null` si el
--    perfil no es del tutor. Trae el nombre actual y el que se le mostró al aceptar; nunca el correo.
-- ---------------------------------------------------------------------------
create function public.list_student_teachers(p_tutor_id uuid, p_student_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id)
      then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'teacher_id', t.id, 'name', t.name, 'shown_name', l.teacher_name,
               'accepted_at', l.accepted_at) order by lower(t.name), t.id)
      from public.teacher_links l
      join public.teachers t on t.id = l.teacher_id
      where l.student_id = p_student_id and l.tutor_id = p_tutor_id
    ), '[]'::jsonb)
  end;
$$;

revoke all on function public.list_student_teachers(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_student_teachers(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. remove_teacher_link: quita el vínculo (T26). Siempre se puede, aunque el perfil esté bloqueado
--    o el consentimiento revocado. No toca ningún dato del niño (ni sus hojas). 'ok' o 'not_found'.
-- ---------------------------------------------------------------------------
create function public.remove_teacher_link(p_tutor_id uuid, p_student_id uuid, p_teacher_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.teacher_links
   where tutor_id = p_tutor_id and student_id = p_student_id and teacher_id = p_teacher_id;
  if not found then
    return 'not_found';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.remove_teacher_link(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_teacher_link(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Quitar un vínculo SOLO por el servidor (con el PIN recién verificado). El tutor ya no puede borrarlo
--    directo desde el cliente (con su sesión abierta y sin PIN): conserva solo la lectura.
-- ---------------------------------------------------------------------------
revoke delete on public.teacher_links from authenticated;
drop policy teacher_links_delete_tutor on public.teacher_links;
