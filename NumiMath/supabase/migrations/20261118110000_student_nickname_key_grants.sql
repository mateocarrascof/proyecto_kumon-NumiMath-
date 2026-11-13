-- Permisos de public.student_nickname_key (ADR 0005, revisión de seguridad).
--
-- Sin esto, cualquiera (incluso sin sesión, `anon`) podía llamarla por RPC (/rpc/student_nickname_key).
-- Es pura y no lee tablas, pero no hay motivo para exponerla. Misma convención que
-- has_active_consent: fuera public y anon; execute solo para authenticated y service_role.
-- authenticated DEBE conservarlo: Postgres comprueba EXECUTE al evaluar el índice
-- students_tutor_grade_nickname_uk con el rol que inserta o actualiza (el tutor).
--
-- Idempotente: revoke y grant se pueden repetir.
--
-- OJO (ADR 0005): cualquier cambio del CUERPO de student_nickname_key o de la COLLATION de la base
-- (lower() depende de ella) deja el índice inconsistente sin aviso. Toda migración que lo haga debe
-- terminar con:  reindex index public.students_tutor_grade_nickname_uk;
-- (y revisar antes que no queden duplicados con la regla nueva).

revoke all on function public.student_nickname_key(text) from public, anon;
grant execute on function public.student_nickname_key(text) to authenticated, service_role;
