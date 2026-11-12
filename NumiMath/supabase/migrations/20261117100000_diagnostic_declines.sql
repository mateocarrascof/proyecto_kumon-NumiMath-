-- Test inicial (diagnóstico) rechazado: no se vuelve a ofrecer NUNCA para ese perfil y tema
-- (decisión del dueño, 2026-11-12). No hay forma de volver a habilitarlo: ni en el panel del tutor
-- ni con una función de borrado. La fila se borra solo junto con el perfil o la cuenta (cascada).
-- Dato del niño: solo "rechazó el test de la habilidad X" y cuándo (docs/privacy/inventario-datos.md).

create table public.diagnostic_declines (
  student_id  uuid not null references public.students (id) on delete cascade,
  tutor_id    uuid not null references public.tutors (id) on delete cascade,
  skill_code  text not null check (skill_code ~ '^[1-4]-[0-9]{2}$'),
  declined_at timestamptz not null default now(),
  primary key (student_id, skill_code)
);

-- Para el borrado en cascada desde el tutor (la llave primaria ya cubre la búsqueda por perfil).
create index diagnostic_declines_tutor_idx on public.diagnostic_declines (tutor_id);

alter table public.diagnostic_declines enable row level security;
alter table public.diagnostic_declines force row level security;

-- El tutor puede LEER los de sus perfiles (derecho de acceso). Nadie escribe directo: solo el
-- servidor con decline_diagnostic. Duda: ¿incluirlo en la exportación de datos (ARCOP)? Pendiente.
create policy diagnostic_declines_select_own on public.diagnostic_declines
  for select to authenticated
  using (tutor_id = (select auth.uid()));

revoke all on public.diagnostic_declines from anon, authenticated;
grant select on public.diagnostic_declines to authenticated;

create or replace function public.decline_diagnostic(
  p_tutor_id   uuid,
  p_student_id uuid,
  p_skill      text
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_skill is null or p_skill !~ '^[1-4]-[0-9]{2}$' then
    return 'invalid';
  end if;
  -- El perfil debe ser del tutor (la llave de servidor ignora RLS: se comprueba a mano).
  perform 1 from public.students s
    where s.id = p_student_id and s.tutor_id = p_tutor_id;
  if not found then
    return 'student_not_found';
  end if;
  -- Idempotente: rechazar dos veces (p. ej. reintento tras perder la red) no es un error.
  insert into public.diagnostic_declines (student_id, tutor_id, skill_code)
  values (p_student_id, p_tutor_id, p_skill)
  on conflict (student_id, skill_code) do nothing;
  return 'ok';
end;
$$;

revoke all on function public.decline_diagnostic(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.decline_diagnostic(uuid, uuid, text) to service_role;
