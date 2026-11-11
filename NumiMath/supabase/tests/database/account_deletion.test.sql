begin;
select plan(31);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- T20 (revocar) y T21 (eliminar la cuenta): funciones del servidor y "no queda nada".
-- Tutores: A=...0001 (con datos en TODAS las tablas), B=...0002 (control, no debe tocarse),
-- C=...0003 (nunca aceptó). Prefijo ffffffff-0000-0000-0000-

insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000001', 'a@test.invalid'),
  ('ffffffff-0000-0000-0000-000000000002', 'b@test.invalid'),
  ('ffffffff-0000-0000-0000-000000000003', 'c@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('ffffffff-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 2) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('a0000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'Ana',  2, true),
  ('a0000000-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 'Ani',  3, true),
  ('a0000000-0000-0000-0000-000000000003', 'ffffffff-0000-0000-0000-000000000002', 'Beto', 1, true);

-- Datos del tutor A en TODAS las tablas que cuelgan de un tutor o de un perfil.
set local role service_role;
select lives_ok($$select public.record_attempt('ffffffff-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
  'sumas_hasta_20', '7 + 5', true)$$, 'datos de prueba: un intento del tutor A');
select lives_ok($$select public.record_attempt('ffffffff-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000002',
  'sumas_hasta_20', '1 + 1', true)$$, 'datos de prueba: un intento del tutor B');
select lives_ok($$select public.set_tutor_pin('ffffffff-0000-0000-0000-000000000001',
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g')$$,
  'datos de prueba: el PIN del tutor A');
select lives_ok($$select public.consume_usage('ffffffff-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001', 1, 30, 90)$$, 'datos de prueba: consumo de uso del tutor A');
reset role;

insert into public.assigned_exercises (student_id, tutor_id, text, answer) values
  ('a0000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', '3 + 4 = ?', 7);
insert into public.student_daily_streaks (student_id, tutor_id, current_len, last_day) values
  ('a0000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 3, current_date)
  on conflict (student_id) do nothing;
insert into public.student_skill_progress (student_id, tutor_id, skill_code) values
  ('a0000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', '2-01')
  on conflict do nothing;
insert into public.student_status_events (student_id, tutor_id, event_type, reason) values
  ('a0000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'blocked', 'tutor_request');

-- ===== 1. revoke_consent =====
set local role service_role;
select is(public.revoke_consent('ffffffff-0000-0000-0000-000000000003'), 'no_consent',
  'quien nunca aceptó no tiene nada que revocar');
select is(public.revoke_consent('ffffffff-0000-0000-0000-000000000001'), 'ok',
  'revoca el consentimiento vigente');
select is(public.revoke_consent('ffffffff-0000-0000-0000-000000000001'), 'already_revoked',
  'revocar dos veces no duplica el evento');
reset role;

select is((select event_type from public.consents
            where tutor_id = 'ffffffff-0000-0000-0000-000000000001' order by seq desc limit 1),
  'revoke', 'queda constancia: el último evento es la revocación');
select ok((select occurred_at from public.consents
            where tutor_id = 'ffffffff-0000-0000-0000-000000000001' order by seq desc limit 1)
          > now() - interval '1 minute',
  'la constancia lleva la fecha y hora del servidor');
select is((select count(*) from public.consents where tutor_id = 'ffffffff-0000-0000-0000-000000000001'),
  2::bigint, 'el evento anterior (la aceptación) se conserva: es un registro append-only');
select ok((select bool_and(blocked_at is not null) from public.students
            where tutor_id = 'ffffffff-0000-0000-0000-000000000001'),
  'al revocar se bloquean todos los perfiles del tutor');
select is((select count(*) from public.students
            where tutor_id = 'ffffffff-0000-0000-0000-000000000002' and blocked_at is not null),
  0::bigint, 'los perfiles de otro tutor no se tocan');

-- Ni el cliente ni anon pueden llamar a estas funciones.
set local role authenticated;
select throws_ok($$select public.revoke_consent('ffffffff-0000-0000-0000-000000000002')$$,
  '42501', 'permission denied for function revoke_consent', 'authenticated no puede llamar a revoke_consent');
select throws_ok($$select public.tutor_exists('ffffffff-0000-0000-0000-000000000002')$$,
  '42501', 'permission denied for function tutor_exists', 'authenticated no puede llamar a tutor_exists');
reset role;

-- ===== 2. evidencia completa antes de borrar =====
set local role service_role;
select is(public.consent_evidence_is_complete('ffffffff-0000-0000-0000-000000000001'),
  false, 'sin archivar, la evidencia está incompleta (no se debe borrar)');
select is(public.archive_consent_evidence('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1::smallint),
  2, 'archiva las 2 filas (aceptación y revocación)');
select is(public.consent_evidence_is_complete('ffffffff-0000-0000-0000-000000000001'),
  true, 'archivada, la evidencia está completa');
select is(public.archive_consent_evidence('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1::smallint),
  0, 'archivar otra vez no duplica (idempotente)');
select is(public.tutor_exists('ffffffff-0000-0000-0000-000000000001'), true, 'el tutor existe antes de borrar');
reset role;

-- ===== 2b. la evidencia se comprueba por consentimiento, no por la huella =====
set local role service_role;
select is(public.consent_evidence_is_complete('ffffffff-0000-0000-0000-000000000001'), true,
  'sigue completa aunque se consulte sin ninguna huella (no depende de la clave HMAC)');
select is(public.archive_consent_evidence('ffffffff-0000-0000-0000-000000000001', repeat('c', 64), repeat('d', 64), 2::smallint),
  0, 'con otra clave (otra huella) no duplica la evidencia ya archivada');
select is(public.consent_evidence_is_complete('ffffffff-0000-0000-0000-000000000001'), true,
  'y sigue completa: un cambio de clave entre dos intentos no bloquea el borrado');
reset role;

-- Auth guarda el correo y la IP en su registro de auditoría: se purga tras borrar la cuenta.
insert into auth.audit_log_entries (instance_id, id, payload, created_at, ip_address) values
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
   '{"actor_id":"ffffffff-0000-0000-0000-000000000001","actor_username":"a@test.invalid","action":"login"}', now(), '10.0.0.1'),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
   '{"actor_id":"00000000-0000-0000-0000-0000000000aa","action":"user_deleted","traits":{"user_id":"ffffffff-0000-0000-0000-000000000001","user_email":"a@test.invalid"}}', now(), '10.0.0.1'),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
   '{"actor_id":"ffffffff-0000-0000-0000-000000000002","actor_username":"b@test.invalid","action":"login"}', now(), '10.0.0.2'),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
   '{"actor_username":"A@Test.Invalid","action":"login_failed"}', now(), '10.0.0.3');

-- ===== 3. borrar la cuenta (lo que hace Auth) y verificar que NO QUEDA NADA =====
-- Cada tabla pública que tenga tutor_id o student_id debe quedar sin filas del tutor A ni de sus
-- perfiles. Se revisa DINÁMICAMENTE: si alguien agrega una tabla nueva y olvida la cascada, falla.
create function pg_temp.leftover(p_tutor uuid, p_students uuid[]) returns text
language plpgsql as $f$
declare
  r record;
  n bigint;
  found_text text := '';
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name in ('tutor_id', 'student_id')
  loop
    if r.column_name = 'tutor_id' then
      execute format('select count(*) from public.%I where tutor_id = $1', r.table_name) into n using p_tutor;
    else
      execute format('select count(*) from public.%I where student_id = any($1)', r.table_name) into n using p_students;
    end if;
    if n > 0 then found_text := found_text || r.table_name || ':' || n || ' '; end if;
  end loop;
  select found_text || coalesce((select 'tutors:' || count(*) from public.tutors where id = p_tutor having count(*) > 0), '')
                    || coalesce((select 'students:' || count(*) from public.students where id = any(p_students) having count(*) > 0), '')
    into found_text;
  return found_text;
end;
$f$;

select is(pg_temp.leftover('ffffffff-0000-0000-0000-000000000001',
  array['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002']::uuid[]) <> '',
  true, 'antes de borrar sí hay datos (la verificación no es vacía)');

delete from auth.users where id = 'ffffffff-0000-0000-0000-000000000001';

select is(pg_temp.leftover('ffffffff-0000-0000-0000-000000000001',
  array['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002']::uuid[]),
  '', 'tras borrar la cuenta no queda NINGUNA fila del tutor ni de sus perfiles en ninguna tabla');

select is(pg_temp.leftover('ffffffff-0000-0000-0000-000000000002',
  array['a0000000-0000-0000-0000-000000000003']::uuid[]) <> '', true,
  'los datos de otro tutor siguen intactos');

-- Lo único que queda es el registro mínimo que exige la ley: evidencia SIN identificadores.
select is((select count(*) from public.consent_evidence where tutor_ref = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 2::bigint,
  'se conserva la evidencia mínima del consentimiento (2 eventos, solo huellas HMAC)');
select ok((select count(*) from public.declaration_evidence) >= 2,
  'se conserva la declaración del adulto de cada perfil borrado, sin apodo ni curso');

-- ===== 4. purgar el registro de auditoría de Auth =====
set local role service_role;
select is(public.purge_auth_audit('ffffffff-0000-0000-0000-000000000001', 'a@test.invalid'), 3,
  'se borran las filas del tutor: por id (inicio de sesión, el propio borrado) y solo por correo');
reset role;
select is((select count(*) from auth.audit_log_entries
            where payload::text like '%ffffffff-0000-0000-0000-000000000001%'
               or lower(payload::text) like '%a@test.invalid%'), 0::bigint,
  'ya no queda el correo ni el id del tutor en el registro de auditoría');
select is((select count(*) from auth.audit_log_entries
            where payload ->> 'actor_id' = 'ffffffff-0000-0000-0000-000000000002'), 1::bigint,
  'las filas de otro tutor no se tocan');
set local role authenticated;
select throws_ok($$select public.purge_auth_audit('ffffffff-0000-0000-0000-000000000002', null)$$,
  '42501', 'permission denied for function purge_auth_audit', 'el cliente no puede purgar el registro de Auth');
reset role;

select * from finish();
rollback;
