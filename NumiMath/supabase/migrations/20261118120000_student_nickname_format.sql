-- Formato del apodo del alumno (CLAUDE.md: nunca apellidos ni datos personales del niño).
--
-- Regla: UNA sola palabra, solo letras (A-Z, a-z, tildes á é í ó ú, ü y ñ, también en mayúscula),
-- de 1 a 30. Sin espacios, números ni símbolos: así no caben "Nombre Apellido", teléfonos ni
-- correos. Un apellido escrito como única palabra NO se puede detectar (riesgo residual anotado en
-- docs/privacy/inventario-datos.md).
--
-- Por qué trigger y no CHECK: un CHECK (aunque sea NOT VALID) se evalúa en CADA update de la fila,
-- y students se actualiza por otros motivos (blocked_at, last_active_at, streak_reminder, curso).
-- Un perfil antiguo con apodo de dos palabras dejaría de poder bloquearse o marcar actividad. El
-- trigger valida solo el alta y los cambios de apodo (NEW.nickname IS DISTINCT FROM OLD.nickname).
-- No toca ni revisa las filas existentes.
--
-- Error: SQLSTATE 23514 (check_violation) con el mensaje 'students_nickname_format'; la app lo
-- traduce al mensaje del formulario. Convive con students_nickname_len y con el índice único
-- students_tutor_grade_nickname_uk (ADR 0005), que no cambian.
--
-- Idempotente: create or replace + drop trigger if exists.

create or replace function public.students_nickname_format()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' or new.nickname is distinct from old.nickname then
    if new.nickname is null
       or new.nickname !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{1,30}$' then
      raise exception 'students_nickname_format' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.students_nickname_format() from public, anon, authenticated;

drop trigger if exists students_nickname_format on public.students;
create trigger students_nickname_format
  before insert or update of nickname on public.students
  for each row execute function public.students_nickname_format();
