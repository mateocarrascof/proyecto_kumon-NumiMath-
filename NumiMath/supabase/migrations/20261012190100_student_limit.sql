-- Lote 2, paso 2: tope de alumnos por tutor y clave única (id, tutor_id).
-- Diseño: docs/lote-2-propuesta-consentimiento.md (sección 5).
-- Decisión: máximo 5 alumnos por tutor y los perfiles bloqueados cuentan.

-- Tope configurable por tutor (solo el servidor lo cambia: tutors es de solo lectura
-- para el cliente). Por defecto 5.
alter table public.tutors
  add column max_students smallint not null default 5
  constraint tutors_max_students_range check (max_students between 1 and 20);

-- Clave que permite a futuras tablas hijas (progreso, uso) llevar tutor_id con
-- FK compuesta (student_id, tutor_id): su RLS queda como tutor_id = auth.uid(),
-- sin subconsultas por fila, y la consistencia la garantiza la FK.
alter table public.students
  add constraint students_id_tutor_uk unique (id, tutor_id);

-- La compuerta ahora también aplica el tope. El bloqueo por tutor (advisory lock)
-- serializa altas concurrentes para que dos inserciones simultáneas no lo superen.
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
  perform pg_advisory_xact_lock(hashtextextended(new.tutor_id::text, 0));

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
  select count(*) into v_count from public.students s where s.tutor_id = new.tutor_id;
  if v_count >= coalesce(v_max, 5) then
    raise exception 'student_limit_reached';
  end if;

  new.consent_id                   := v_consent;
  new.adult_declaration_version_id := v_decl;
  new.adult_declared_at            := now();
  new.blocked_at                   := null;
  return new;
end;
$$;

-- Reversa (solo desarrollo):
--   alter table public.students drop constraint students_id_tutor_uk;
--   alter table public.tutors drop column max_students;
--   (y restaurar students_before_insert() del paso 1)
