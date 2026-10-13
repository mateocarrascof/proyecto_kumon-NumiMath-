begin;
select plan(36);

-- Lote B: inmutabilidad, historial de bloqueos, archivo de la declaración del adulto,
-- desbloqueo ligado al consentimiento vigente y purga de perfiles bloqueados.
-- Tutores: P=...0001 Q=...0002 R=...0003  (prefijo ffffffff-0000-0000-0000-)

insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000001', 'p@test.invalid'),
  ('ffffffff-0000-0000-0000-000000000002', 'q@test.invalid'),
  ('ffffffff-0000-0000-0000-000000000003', 'r@test.invalid');

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true);

insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('ffffffff-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 3) n;

insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('a0000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'Pia',   1, true),
  ('a0000000-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001', 'Pol',   2, true),
  ('a0000000-0000-0000-0000-000000000003', 'ffffffff-0000-0000-0000-000000000002', 'Quino', 3, true),
  ('a0000000-0000-0000-0000-000000000004', 'ffffffff-0000-0000-0000-000000000003', 'R1',    1, true),
  ('a0000000-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000003', 'R2',    1, true);

-- ===== 1. Los textos legales publicados son definitivos =====
select throws_ok(
  $$update public.legal_document_versions set content_sha256 = repeat('f', 64) where kind = 'terms'$$,
  'P0001', 'legal_versions_are_immutable', 'la huella de un texto publicado no se puede cambiar');
select throws_ok(
  $$update public.legal_document_versions set version = 'otra' where kind = 'terms'$$,
  'P0001', 'legal_versions_are_immutable', 'el nombre de una versión publicada no se puede cambiar');
select throws_ok(
  $$delete from public.legal_document_versions where kind = 'privacy'$$,
  'P0001', 'legal_versions_are_permanent', 'una versión publicada no se puede borrar');
select lives_ok(
  $$update public.legal_document_versions set is_current = true where kind = 'terms'$$,
  'is_current sí puede cambiar');

-- ===== 2. consents es append-only para todos los roles =====
select throws_ok(
  $$update public.consents set channel = 'ios'$$,
  'P0001', 'consents_are_append_only', 'ni el superusuario puede modificar un consentimiento');

-- ===== 3. Historial de bloqueos =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('ffffffff-0000-0000-0000-000000000001', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');

select is((select count(*) from public.student_status_events
            where tutor_id = 'ffffffff-0000-0000-0000-000000000001' and event_type = 'blocked' and reason = 'consent_revoked'),
  2::bigint, 'revocar registra un evento "blocked" por cada perfil del tutor');
select ok((select bool_and(consent_seq = (select max(seq) from public.consents where tutor_id = 'ffffffff-0000-0000-0000-000000000001'))
             from public.student_status_events where tutor_id = 'ffffffff-0000-0000-0000-000000000001'),
  'el evento queda ligado a la revocación que lo causó');
select is_empty($$select 1 from public.student_status_events where tutor_id = 'ffffffff-0000-0000-0000-000000000002'$$,
  'los perfiles de otro tutor no generan eventos');

-- ===== 4. Desbloqueo: queda ligado al consentimiento vigente =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('ffffffff-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'ios');

set local role service_role;
select is(public.unblock_student('ffffffff-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  true, 'el servidor desbloquea a Pia');
reset role;

select is((select count(*) from public.student_status_events
            where student_id = 'a0000000-0000-0000-0000-000000000001' and event_type = 'unblocked' and reason = 'manual_unblock'),
  1::bigint, 'el desbloqueo queda en el historial');
select is(
  (select consent_id from public.students where id = 'a0000000-0000-0000-0000-000000000001'),
  (select id from public.consents where tutor_id = 'ffffffff-0000-0000-0000-000000000001' order by seq desc limit 1),
  'el perfil reactivado queda ligado al consentimiento vigente');
select is(
  (select consent_seq from public.students where id = 'a0000000-0000-0000-0000-000000000001'),
  (select max(seq) from public.consents where tutor_id = 'ffffffff-0000-0000-0000-000000000001'),
  'consent_seq se actualiza con el consentimiento vigente');

-- ===== 5. El tutor ve solo su historial y no lo puede escribir =====
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.student_status_events), 3::bigint,
  'P ve sus 3 eventos (2 bloqueos y 1 desbloqueo)');
select throws_ok(
  $$insert into public.student_status_events (student_id, tutor_id, event_type, reason) values ('a0000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'blocked', 'consent_revoked')$$,
  '42501', 'permission denied for table student_status_events', 'el cliente no puede insertar en el historial');
select throws_ok($$update public.student_status_events set reason = 'manual_unblock'$$,
  '42501', 'permission denied for table student_status_events', 'el cliente no puede modificar el historial');
select throws_ok($$delete from public.student_status_events$$,
  '42501', 'permission denied for table student_status_events', 'el cliente no puede borrar el historial');
reset role;

select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.student_status_events), 0::bigint, 'Q no ve eventos de P');
reset role;

set local role anon;
select throws_ok($$select * from public.student_status_events$$,
  '42501', 'permission denied for table student_status_events', 'anon no lee el historial');
reset role;

-- ===== 6. Rectificación en perfil bloqueado =====
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$update public.students set nickname = 'Polo' where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'P corrige el apodo de un perfil bloqueado');

-- ===== 7. Borrar un perfil archiva la declaración del adulto (sin datos del niño) =====
select lives_ok($$delete from public.students where id = 'a0000000-0000-0000-0000-000000000002'$$,
  'P borra un perfil bloqueado');
select throws_ok($$select * from public.declaration_evidence$$,
  '42501', 'permission denied for table declaration_evidence', 'el cliente no lee declaration_evidence');
reset role;

select is(
  (select count(*) from public.declaration_evidence
    where declaration_version = 'ad-1' and declaration_sha256 = repeat('c', 64)),
  1::bigint, 'la declaración (versión y huella) quedó archivada al borrar el perfil');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'declaration_evidence'),
  array['archived_at', 'consent_seq', 'declaration_sha256', 'declaration_version', 'declared_at', 'id'],
  'declaration_evidence no tiene apodo, curso ni identificador del niño ni del tutor');
select is_empty($$select 1 from public.student_status_events where student_id = 'a0000000-0000-0000-0000-000000000002'$$,
  'el historial del perfil se borra con el perfil');
select throws_ok($$update public.declaration_evidence set declaration_version = 'x'$$,
  'P0001', 'evidence_is_immutable', 'la declaración archivada es inmutable');

-- ===== 8. Borrar la cuenta archiva las declaraciones de todos sus perfiles =====
delete from auth.users where id = 'ffffffff-0000-0000-0000-000000000002';
select is((select count(*) from public.declaration_evidence), 2::bigint,
  'al borrar la cuenta de Q también se archivó la declaración de Quino');

-- ===== 9. Perfiles bloqueados: plazo máximo =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('ffffffff-0000-0000-0000-000000000003', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');
update public.students set blocked_at = now() - interval '40 days' where id = 'a0000000-0000-0000-0000-000000000004';
update public.students set blocked_at = now() - interval '10 days' where id = 'a0000000-0000-0000-0000-000000000005';

select is((select (value #>> '{}')::integer from public.app_settings where key = 'blocked_profile_retention_days'),
  30, 'el plazo provisional de perfiles bloqueados es de 30 días');

set local role service_role;
select is((select count(*) from public.blocked_students_due_soon(7)), 1::bigint,
  'con aviso de 7 días: solo R1 (ya vencido) está por purgarse');
select is((select count(*) from public.blocked_students_due_soon(25)), 2::bigint,
  'con aviso de 25 días: R1 y R2');
select is(public.purge_long_blocked_students(), 1, 'la purga elimina solo el perfil vencido');
reset role;

select is_empty($$select 1 from public.students where id = 'a0000000-0000-0000-0000-000000000004'$$, 'R1 fue purgado');
select is((select count(*) from public.students where id = 'a0000000-0000-0000-0000-000000000005'), 1::bigint,
  'R2 (bloqueado hace 10 días) se conserva');
select is((select count(*) from public.declaration_evidence), 3::bigint,
  'la purga archivó la declaración de R1');

update public.app_settings set value = '5'::jsonb where key = 'blocked_profile_retention_days';
set local role service_role;
select is(public.purge_long_blocked_students(), 1, 'con un plazo de 5 días, R2 también vence');
reset role;

select ok(not has_function_privilege('authenticated', 'public.purge_long_blocked_students()', 'execute')
          and not has_function_privilege('anon', 'public.purge_long_blocked_students()', 'execute'),
  'solo el servidor ejecuta la purga de bloqueados');
select ok(not has_function_privilege('authenticated', 'public.blocked_students_due_soon(integer)', 'execute'),
  'solo el servidor consulta los perfiles por purgarse');

select * from finish();
rollback;
