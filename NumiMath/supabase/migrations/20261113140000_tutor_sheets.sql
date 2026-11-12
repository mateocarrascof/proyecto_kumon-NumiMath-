-- T27: el tutor ve y borra las hojas guardadas de sus hijos (docs/SPEC.md, "Hojas guardadas").
--
-- Solo las llama el servidor (`service_role`) y solo para el tutor TITULAR del perfil: si el perfil no es
-- suyo devuelven `null` (la API responde el mismo 404 que si no existiera). Ver y borrar es un derecho
-- del titular: funciona aunque el consentimiento esté revocado o el perfil bloqueado (como borrar el
-- perfil). Borrar es DEFINITIVO: la fila desaparece y el docente deja de verla de inmediato (sus lecturas
-- consultan la tabla en cada llamada). El cliente sigue sin poder escribir ni borrar directo (RLS solo
-- lectura); el servidor exige el PIN recién verificado antes de llamar a las funciones de borrado.
--
-- Los borrados toman el cerrojo del tutor (`tutor_gate`), el mismo de `save_student_sheet`, así que no
-- compiten con un guardado en curso.

-- ---------------------------------------------------------------------------
-- Lista paginada, de la más reciente a la más antigua. Sin trazos. `total` es el de todo el perfil (lo
-- usa la confirmación de "Borrar todas").
-- ---------------------------------------------------------------------------
create function public.list_student_sheets(
  p_tutor_id   uuid,
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
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items  jsonb;
  v_count  integer;
  v_total  integer;
begin
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return null;
  end if;

  select count(*)::integer into v_total
  from public.student_sheets h where h.student_id = p_student_id and h.tutor_id = p_tutor_id;

  with page as (
    select h.id, h.topic, h.correct, h.saved_at, h.content ->> 'statement' as statement
    from public.student_sheets h
    where h.student_id = p_student_id and h.tutor_id = p_tutor_id
    order by h.saved_at desc, h.id desc
    offset v_offset limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'topic', topic, 'correct', correct, 'statement', statement, 'saved_at', saved_at)
         order by saved_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         count(*)::integer
    into v_items, v_count
  from (select page.*, row_number() over (order by saved_at desc, id desc) as rn from page) numbered;

  return jsonb_build_object('items', v_items, 'has_more', v_count > v_limit, 'total', v_total);
end;
$$;

revoke all on function public.list_student_sheets(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_student_sheets(uuid, uuid, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Una hoja completa (con trazos). `null` si el perfil no es del tutor o la hoja no es de ese perfil.
-- ---------------------------------------------------------------------------
create function public.get_student_sheet(p_tutor_id uuid, p_student_id uuid, p_sheet_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', h.id, 'topic', h.topic, 'correct', h.correct, 'saved_at', h.saved_at,
           'content', h.content)
  from public.student_sheets h
  join public.students s on s.id = h.student_id and s.tutor_id = h.tutor_id
  where h.id = p_sheet_id and h.student_id = p_student_id and h.tutor_id = p_tutor_id;
$$;

revoke all on function public.get_student_sheet(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_student_sheet(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Borrar UNA hoja: 'ok' o 'not_found' (no es del tutor, no es de ese perfil o ya no existe).
-- ---------------------------------------------------------------------------
create function public.delete_student_sheet(p_tutor_id uuid, p_student_id uuid, p_sheet_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || p_tutor_id::text, 0));
  delete from public.student_sheets
   where id = p_sheet_id and student_id = p_student_id and tutor_id = p_tutor_id;
  if not found then
    return 'not_found';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.delete_student_sheet(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_student_sheet(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Borrar TODAS las hojas de un perfil: devuelve cuántas se borraron, o `null` si el perfil no es del tutor.
-- ---------------------------------------------------------------------------
create function public.delete_student_sheets(p_tutor_id uuid, p_student_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('tutor_gate:' || p_tutor_id::text, 0));
  if not exists (
    select 1 from public.students s where s.id = p_student_id and s.tutor_id = p_tutor_id
  ) then
    return null;
  end if;
  delete from public.student_sheets where student_id = p_student_id and tutor_id = p_tutor_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.delete_student_sheets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_student_sheets(uuid, uuid) to service_role;

-- Reversión manual (no se ejecuta sola):
--   drop function public.list_student_sheets(uuid, uuid, integer, integer),
--     public.get_student_sheet(uuid, uuid, uuid), public.delete_student_sheet(uuid, uuid, uuid),
--     public.delete_student_sheets(uuid, uuid);
