-- Apodos únicos por tutor y curso (ADR 0005).
--
-- Un tutor no puede tener dos alumnos con el mismo apodo en el mismo curso. Otro tutor sí puede
-- usar ese apodo. La comparación no distingue mayúsculas, tildes (á é í ó ú ü) ni espacios al
-- inicio, al final o repetidos. La "ñ" SÍ se distingue de la "n" (Toño ≠ Tono).
--
-- Aditiva e idempotente: se puede correr más de una vez. Si ya hay duplicados, se detiene con un
-- mensaje claro (solo la cantidad de grupos, nunca apodos) y no borra ni renombra nada.

-- Clave normalizada del apodo. IMMUTABLE (se usa en un índice), con search_path fijo y sin
-- extensiones: solo funciones del sistema. Las mayúsculas acentuadas van también en translate()
-- por si lower() no las convierte (depende del locale de la base).
create or replace function public.student_nickname_key(p_nickname text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select pg_catalog.translate(
    pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(p_nickname), '\s+', ' ', 'g')),
    'áéíóúüÁÉÍÓÚÜÑ',
    'aeiouuaeiouuñ'
  )
$$;

comment on function public.student_nickname_key(text) is
  'Apodo normalizado para la regla de apodos únicos por tutor y curso (ADR 0005).';

-- Sin revoke: el índice la evalúa con los permisos de quien inserta o actualiza (el tutor). Es pura
-- (solo transforma el texto que recibe) y no lee ninguna tabla.

do $$
declare
  v_groups integer;
begin
  if to_regclass('public.students_tutor_grade_nickname_uk') is not null then
    return; -- ya aplicada
  end if;

  select count(*) into v_groups
  from (
    select 1
    from public.students s
    group by s.tutor_id, s.grade, public.student_nickname_key(s.nickname)
    having count(*) > 1
  ) d;

  if v_groups > 0 then
    -- Sin apodos ni ids en el mensaje: va a los registros del despliegue.
    raise exception
      'apodos_duplicados: hay % grupo(s) de perfiles con el mismo apodo en el mismo curso y tutor. '
      'No se borró ni renombró nada. Resuélvelos con cada tutor (consulta en docs/adr/0005) y vuelve a aplicar.',
      v_groups
      using errcode = 'unique_violation';
  end if;

  create unique index students_tutor_grade_nickname_uk
    on public.students (tutor_id, grade, public.student_nickname_key(nickname));
end;
$$;

comment on index public.students_tutor_grade_nickname_uk is
  'Un apodo por tutor y curso, sin distinguir mayúsculas, tildes ni espacios (ADR 0005).';
