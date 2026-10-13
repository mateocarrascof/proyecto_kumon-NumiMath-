-- La regla de aislamiento: bajo REPEATABLE READ (o SERIALIZABLE) la base rechaza las
-- operaciones que dependen de READ COMMITTED. Este archivo corre TODO su contenido bajo
-- REPEATABLE READ; los demás archivos corren bajo READ COMMITTED y prueban el camino feliz.
begin isolation level repeatable read;
select plan(6);

select is(current_setting('transaction_isolation'), 'repeatable read',
  'la prueba corre bajo REPEATABLE READ');

select throws_ok($$select public.assert_read_committed()$$,
  'P0001', 'isolation_level_not_allowed', 'assert_read_committed rechaza REPEATABLE READ');

select throws_ok(
  $$insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
    values (gen_random_uuid(), 'grant', gen_random_uuid(), gen_random_uuid(), 'web')$$,
  'P0001', 'isolation_level_not_allowed', 'los eventos de consentimiento exigen READ COMMITTED');

select throws_ok(
  $$insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
    values (gen_random_uuid(), 'X', 1, true)$$,
  'P0001', 'isolation_level_not_allowed', 'las altas de perfiles exigen READ COMMITTED');

select throws_ok(
  $$update public.students set blocked_at = null where false$$,
  'P0001', 'isolation_level_not_allowed', 'los cambios de bloqueo exigen READ COMMITTED');

set local role service_role;
select throws_ok(
  $$select public.consume_usage(gen_random_uuid(), gen_random_uuid(), 1, 3, 5)$$,
  'P0001', 'isolation_level_not_allowed', 'el consumo de cuota exige READ COMMITTED');
reset role;

select * from finish();
rollback;
