begin;
select plan(40);
update public.legal_document_versions set is_current = false; -- neutraliza la semilla (supabase/seed.sql)

-- Lote D, parte 1: arreglos de la revisión de los Lotes A y B.
-- Tutores U1..U8 = aaaa1111-0000-0000-0000-00000000000N
-- Versiones: terms tos-1 =1111...0001, privacy pp-1 =1111...0002, adult_declaration ad-1 =1111...0003,
--            tos-0 =...0005 y pp-0 =...0006 (antiguas, no vigentes)

insert into auth.users (id, email)
select ('aaaa1111-0000-0000-0000-00000000000' || n)::uuid, 'u' || n || '@test.invalid'
from generate_series(1, 8) n;

insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('11111111-0000-0000-0000-000000000001', 'terms',             'tos-1', repeat('a', 64), true),
  ('11111111-0000-0000-0000-000000000002', 'privacy',           'pp-1',  repeat('b', 64), true),
  ('11111111-0000-0000-0000-000000000003', 'adult_declaration', 'ad-1',  repeat('c', 64), true),
  ('11111111-0000-0000-0000-000000000005', 'terms',             'tos-0', repeat('0', 64), false),
  ('11111111-0000-0000-0000-000000000006', 'privacy',           'pp-0',  repeat('1', 64), false);

-- Todos parten con un grant vigente.
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select ('aaaa1111-0000-0000-0000-00000000000' || n)::uuid, 'grant',
       '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'
from generate_series(1, 8) n;

-- ===== 1. Revocar nunca se frena: el tope cuenta solo aceptaciones =====
-- U1: 10 aceptaciones alternadas con revocaciones; el último evento es una aceptación (19 eventos).
select lives_ok($t$do $do$ begin
    for i in 1..9 loop
      insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
      values ('aaaa1111-0000-0000-0000-000000000001', 'revoke',
              '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');
      insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
      values ('aaaa1111-0000-0000-0000-000000000001', 'grant',
              '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');
    end loop;
  end $do$ $t$ , 'U1 llega a 10 aceptaciones en 24 horas (19 eventos)') ;

select set_config('request.jwt.claims', '{"sub":"aaaa1111-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('aaaa1111-0000-0000-0000-000000000001', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'con 10 aceptaciones recientes, revocar sigue siendo posible');
select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('aaaa1111-0000-0000-0000-000000000001', 'grant', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web')$$,
  'P0001', 'consent_event_rate_limited', 'la aceptación número 11 en 24 horas es rechazada');
reset role;

-- ===== 2. La revocación copia las versiones del último consentimiento =====
select set_config('request.jwt.claims', '{"sub":"aaaa1111-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('aaaa1111-0000-0000-0000-000000000002', 'revoke', '11111111-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000006', 'web')$$,
  'un revoke que cita versiones antiguas se acepta');
reset role;
select is(
  (select terms_version_id || '/' || privacy_version_id from public.consents
    where tutor_id = 'aaaa1111-0000-0000-0000-000000000002' and event_type = 'revoke'),
  '11111111-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000002',
  'queda registrado sobre las versiones que el tutor aceptó por última vez');

select set_config('request.jwt.claims', '{"sub":"aaaa1111-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values ('aaaa1111-0000-0000-0000-000000000003', 'revoke', '11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000003', 'web')$$,
  'un revoke que cita documentos del tipo equivocado no contamina la evidencia');
reset role;
select is(
  (select terms_version_id || '/' || privacy_version_id from public.consents
    where tutor_id = 'aaaa1111-0000-0000-0000-000000000003' and event_type = 'revoke'),
  '11111111-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000002',
  'las versiones se normalizan a las del último consentimiento');

-- ===== 3. Límite de altas de perfiles por tutor cada 24 h =====
select set_config('request.jwt.claims', '{"sub":"aaaa1111-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
-- 10 altas en dos tandas de 5; el borrado lo hace el servidor (delete_student).
do $do$ begin
  for i in 1..5 loop
    insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
    values ('aaaa1111-0000-0000-0000-000000000004', 'Ciclo', 1, true);
  end loop;
end $do$;
reset role;
set local role service_role;
do $do$ begin
  perform public.delete_student(s.tutor_id, s.id) from public.students s
    where s.tutor_id = 'aaaa1111-0000-0000-0000-000000000004';
end $do$;
set local role authenticated;
select lives_ok($t$do $do$ begin
    for i in 1..5 loop
      insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
      values ('aaaa1111-0000-0000-0000-000000000004', 'Ciclo', 1, true);
    end loop;
  end $do$ $t$ , 'U4 crea y borra 10 perfiles en 24 horas');
reset role;
set local role service_role;
do $do$ begin
  perform public.delete_student(s.tutor_id, s.id) from public.students s
    where s.tutor_id = 'aaaa1111-0000-0000-0000-000000000004';
end $do$;
set local role authenticated;
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaa1111-0000-0000-0000-000000000004', 'Once', 1, true)$$,
  'P0001', 'student_create_rate_limited', 'la alta número 11 en 24 horas es rechazada aunque no haya perfiles vivos');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaa1111-0000-0000-0000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaa1111-0000-0000-0000-000000000005', 'Otro', 1, true)$$,
  'el límite de un tutor no afecta a otro');
reset role;

-- La ventana se renueva pasadas 24 horas.
update public.student_creation_log set created_at = now() - interval '25 hours'
 where tutor_id = 'aaaa1111-0000-0000-0000-000000000004';
select set_config('request.jwt.claims', '{"sub":"aaaa1111-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaa1111-0000-0000-0000-000000000004', 'Nueva', 1, true)$$,
  'pasadas 24 horas la ventana se renueva');
reset role;

-- El límite es configurable.
update public.app_settings set value = '1'::jsonb where key = 'student_creations_per_day';
select set_config('request.jwt.claims', '{"sub":"aaaa1111-0000-0000-0000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted) values ('aaaa1111-0000-0000-0000-000000000005', 'Dos', 1, true)$$,
  'P0001', 'student_create_rate_limited', 'con el límite en 1 por día, la segunda alta es rechazada');
reset role;
update public.app_settings set value = '10'::jsonb where key = 'student_creations_per_day';

select set_config('request.jwt.claims', '', true);
select throws_ok($$update public.app_settings set value = '0'::jsonb where key = 'student_creations_per_day'$$,
  '23514', 'new row for relation "app_settings" violates check constraint "app_settings_values_valid"',
  'el límite de altas no puede ser 0');

-- ===== 4. TRUNCATE y DELETE sobre las tablas inmutables =====
select throws_ok($$truncate public.consent_evidence$$,
  'P0001', 'truncate_not_allowed', 'ni el dueño puede vaciar consent_evidence');
select throws_ok($$truncate public.declaration_evidence$$,
  'P0001', 'truncate_not_allowed', 'ni el dueño puede vaciar declaration_evidence');
select throws_ok($$truncate public.student_status_events$$,
  'P0001', 'truncate_not_allowed', 'ni el dueño puede vaciar student_status_events');
select throws_ok($$truncate public.consents cascade$$,
  'P0001', 'truncate_not_allowed', 'ni siquiera con CASCADE se puede vaciar consents');
set local role service_role;
select throws_ok($$truncate public.consent_evidence$$,
  '42501', 'permission denied for table consent_evidence', 'service_role no tiene permiso de TRUNCATE');
select throws_ok($$delete from public.consents$$,
  'P0001', 'consents_are_append_only', 'service_role no puede borrar consentimientos de tutores vivos');
reset role;
select throws_ok($$delete from public.consents$$,
  'P0001', 'consents_are_append_only', 'ni el dueño puede borrar consentimientos de tutores vivos');

-- ===== 5. La variable de purga no basta =====
insert into public.consent_evidence
  (tutor_ref, tutor_email_ref, hmac_key_version, event_type, terms_version, terms_sha256,
   privacy_version, privacy_sha256, channel, occurred_at, source_seq)
values (repeat('1', 64), repeat('2', 64), 1, 'grant', 'tos-1', repeat('a', 64), 'pp-1', repeat('b', 64), 'web', now(), 910001);

set local role service_role;
select set_config('app.evidence_purge', 'on', true);
select throws_ok($$delete from public.consent_evidence$$,
  'P0001', 'evidence_is_immutable', 'activar la variable no permite borrar evidencia a service_role');
reset role;

-- ===== 6. La declaración archivada conserva el consentimiento ORIGINAL =====
insert into public.students (id, tutor_id, nickname, grade, adult_declaration_accepted) values
  ('a7000000-0000-0000-0000-000000000001', 'aaaa1111-0000-0000-0000-000000000007', 'Siete', 1, true);
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('aaaa1111-0000-0000-0000-000000000007', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web'),
  ('aaaa1111-0000-0000-0000-000000000007', 'grant',  '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'ios');
set local role service_role;
select is(public.unblock_student('aaaa1111-0000-0000-0000-000000000007', 'a7000000-0000-0000-0000-000000000001'),
  true, 'se desbloquea el perfil de U7');
select is(public.unblock_student('aaaa1111-0000-0000-0000-000000000007', 'a7000000-0000-0000-0000-000000000001'),
  false, 'un segundo desbloqueo no hace nada');
reset role;
select is((select count(*) from public.student_status_events
            where student_id = 'a7000000-0000-0000-0000-000000000001' and event_type = 'unblocked'),
  1::bigint, 'el historial conserva exactamente un desbloqueo');
select ok(
  (select consent_seq > declaration_consent_seq from public.students where id = 'a7000000-0000-0000-0000-000000000001'),
  'tras desbloquear, consent_seq avanza pero declaration_consent_seq se mantiene');

delete from public.students where id = 'a7000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.declaration_evidence
    where consent_seq = (select min(seq) from public.consents where tutor_id = 'aaaa1111-0000-0000-0000-000000000007')),
  1::bigint, 'la declaración archivada apunta al consentimiento original, no al de reactivación');

-- ===== 7. El cliente no escribe las columnas de consentimiento del perfil =====
select set_config('request.jwt.claims', '{"sub":"aaaa1111-0000-0000-0000-000000000008","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted, consent_seq) values ('aaaa1111-0000-0000-0000-000000000008', 'X', 1, true, 1)$$,
  '42501', 'permission denied for table students', 'el cliente no puede fijar consent_seq');
select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted, declaration_consent_seq) values ('aaaa1111-0000-0000-0000-000000000008', 'X', 1, true, 1)$$,
  '42501', 'permission denied for table students', 'el cliente no puede fijar declaration_consent_seq');
insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
values ('aaaa1111-0000-0000-0000-000000000008', 'Ocho', 1, true);
select throws_ok($$update public.students set consent_seq = 1 where nickname = 'Ocho'$$,
  '42501', 'permission denied for table students', 'el cliente no puede actualizar consent_seq');
reset role;

-- ===== 8. Borrar una cuenta con perfil bloqueado, historial, evidencia y declaración =====
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel) values
  ('aaaa1111-0000-0000-0000-000000000008', 'revoke', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'web');
select is((select count(*) from public.student_status_events where tutor_id = 'aaaa1111-0000-0000-0000-000000000008'),
  1::bigint, 'el perfil de U8 quedó bloqueado con un evento en el historial');

set local role service_role;
select is(public.archive_consent_evidence('aaaa1111-0000-0000-0000-000000000008', repeat('8', 64), repeat('9', 64), 1::smallint),
  2, 'se archivan los 2 eventos de U8');
reset role;

select lives_ok($$delete from auth.users where id = 'aaaa1111-0000-0000-0000-000000000008'$$,
  'se borra la cuenta con perfil bloqueado, historial, evidencia y declaración a la vez');
select is_empty($$select 1 from public.student_status_events where tutor_id = 'aaaa1111-0000-0000-0000-000000000008'$$,
  'el historial de estados desaparece con la cuenta');
select is((select count(*) from public.consent_evidence where tutor_ref = repeat('8', 64)),
  2::bigint, 'la evidencia sobrevive al borrado de la cuenta');

-- ===== 9. Purgas: límites exactos, declaraciones y variable restablecida =====
update public.app_settings set value = '30'::jsonb where key = 'consent_evidence_retention_days';
insert into public.declaration_evidence (consent_seq, declaration_version, declaration_sha256, declared_at, archived_at) values
  (920001, 'ad-1', repeat('c', 64), now() - interval '90 days', now() - interval '31 days'),
  (920002, 'ad-1', repeat('c', 64), now() - interval '90 days', now() - interval '30 days'),
  (920003, 'ad-1', repeat('c', 64), now() - interval '90 days', now() - interval '29 days');
insert into public.consent_evidence
  (tutor_ref, tutor_email_ref, hmac_key_version, event_type, terms_version, terms_sha256,
   privacy_version, privacy_sha256, channel, occurred_at, source_seq, archived_at)
values (repeat('3', 64), repeat('4', 64), 1, 'grant', 'tos-0', repeat('1', 64), 'pp-0', repeat('2', 64),
        'web', now() - interval '90 days', 910002, now() - interval '31 days');

set local role service_role;
select is(public.purge_expired_consent_evidence(), 2,
  'la purga elimina una fila de cada tabla de evidencia (31 días) y respeta el límite exacto de 30');
reset role;
select is((select count(*) from public.declaration_evidence where consent_seq in (920002, 920003)),
  2::bigint, 'una declaración archivada exactamente hace 30 días y otra reciente se conservan');
select throws_ok($$delete from public.consent_evidence$$,
  'P0001', 'evidence_is_immutable', 'tras la purga, la variable quedó restablecida y el borrado directo falla');

-- ===== 10. Funciones trigger sin acceso del cliente e índices =====
select ok(
  not has_function_privilege('authenticated', 'public.evidence_immutable()', 'execute')
  and not has_function_privilege('authenticated', 'public.legal_versions_guard()', 'execute')
  and not has_function_privilege('authenticated', 'public.consents_append_only()', 'execute')
  and not has_function_privilege('authenticated', 'public.student_status_events_append_only()', 'execute')
  and not has_function_privilege('authenticated', 'public.truncate_not_allowed()', 'execute')
  and not has_function_privilege('authenticated', 'public.students_creation_rate_limit()', 'execute'),
  'ninguna función trigger de los Lotes B y D es ejecutable por el cliente');
select ok(
  (select count(*) = 3 from pg_indexes where schemaname = 'public'
     and indexname in ('consent_evidence_archived_at_idx', 'declaration_evidence_archived_at_idx', 'students_blocked_at_idx')),
  'existen los índices de las purgas');
select ok(
  not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'students_adult_declaration_version_id_idx'),
  'se eliminó el índice sin uso');

select * from finish();
rollback;
