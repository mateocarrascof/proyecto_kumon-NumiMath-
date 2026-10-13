#!/usr/bin/env bash
# Prueba de concurrencia con DOS conexiones reales a la base local de Supabase.
#
# Por qué existe: pgTAP corre todo en una sola conexión y no puede probar carreras.
# Aquí dos sesiones psql independientes compiten por el bloqueo por tutor
# (pg_advisory_xact_lock 'tutor_gate:') que protege el tope de alumnos y la
# serialización alta/revocación.
#
# Escenarios:
#   A  dos altas simultáneas con 4 alumnos      -> exactamente 1 entra, la otra recibe student_limit_reached
#   B1 alta y revocación simultáneas (alta 1º)  -> el alumno queda y termina BLOQUEADO
#   B2 revocación y alta simultáneas (revoc. 1º)-> la alta recibe consent_required, sin alumno
#   C  REPEATABLE READ                          -> la base RECHAZA la alta (isolation_level_not_allowed);
#                                                  antes el tope podía superarse (ADR 0001, 2.3)
#
# Requisitos: Docker y `supabase start` en marcha. Usa el contenedor de la base local.
# Es una prueba de DESARROLLO: crea y luego elimina sus propios datos (usuarios dddddddd-...).
# Si se interrumpe y quedan restos, `supabase db reset` deja la base limpia.
#
# Uso:  bash supabase/tests/concurrency/run.sh

set -u
CONTAINER="${DB_CONTAINER:-supabase_db_IA-Matematica}"
# En Git Bash de Windows el cliente de Docker puede no estar en el PATH (inofensivo en otros SO).
export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"

PFX='dddddddd-0000-0000-0000-0000000000'
T1="${PFX}01"; T2="${PFX}02"; T3="${PFX}03"; T4="${PFX}04"
V_TERMS='99999999-0000-0000-0000-000000000001'
V_PRIV='99999999-0000-0000-0000-000000000002'
V_DECL='99999999-0000-0000-0000-000000000003'

OUT="$(mktemp -d)"
FAILS=0

sql()     { docker exec -i "$CONTAINER" psql -U postgres -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
session() { docker exec -i "$CONTAINER" psql -U postgres -X -q -t -A -v ON_ERROR_STOP=0 2>&1; }

check() {  # descripción, esperado, obtenido
  if [ "$2" = "$3" ]; then echo "  OK    $1"; else echo "  FALLA $1 (esperado: $2, obtenido: $3)"; FAILS=$((FAILS + 1)); fi
}

wait_ready() {  # archivo, segundos máximos
  local i=0
  while ! grep -q READY "$1" 2>/dev/null; do
    sleep 0.2; i=$((i + 1))
    if [ "$i" -gt $(( $2 * 5 )) ]; then echo "  (tiempo agotado esperando la sesión)"; return 1; fi
  done
}

# Sesión como tutor (rol authenticated, como PostgREST): ejecuta $3, avisa READY y retiene
# el bloqueo $2 segundos antes de confirmar.
tutor_session() {  # uuid, segundos de retención, sentencia
  cat <<SQL | session
begin;
select set_config('request.jwt.claims','{"sub":"$1","role":"authenticated"}',true) as c \gset
set local role authenticated;
$3
select 'READY';
select pg_sleep($2);
commit;
SQL
}

cleanup() {
  sql <<SQL >/dev/null 2>&1
begin;
create temp table _seqs on commit drop as
  select seq from public.consents where tutor_id in ('$T1','$T2','$T3','$T4');
alter table public.declaration_evidence disable trigger declaration_evidence_immutable;
alter table public.legal_document_versions disable trigger legal_document_versions_guard;
delete from auth.users where id in ('$T1','$T2','$T3','$T4');
delete from public.declaration_evidence where consent_seq in (select seq from _seqs);
delete from public.legal_document_versions where id in ('$V_TERMS','$V_PRIV','$V_DECL');
alter table public.declaration_evidence enable trigger declaration_evidence_immutable;
alter table public.legal_document_versions enable trigger legal_document_versions_guard;
commit;
SQL
  rm -rf "$OUT"
}
trap cleanup EXIT

echo "== Preparación =="
if ! docker exec "$CONTAINER" true 2>/dev/null; then
  echo "No encuentro el contenedor '$CONTAINER'. ¿Está corriendo 'supabase start'?"; exit 2
fi
CURRENT="$(sql -c "select count(*) from public.legal_document_versions where is_current" 2>/dev/null)"
if [ "$CURRENT" != "0" ]; then
  echo "La base ya tiene versiones legales vigentes; esta prueba espera una base de desarrollo limpia (supabase db reset)."; exit 2
fi

sql <<SQL
begin;
insert into auth.users (id, email) values
  ('$T1','c1@test.invalid'), ('$T2','c2@test.invalid'), ('$T3','c3@test.invalid'), ('$T4','c4@test.invalid');
insert into public.legal_document_versions (id, kind, version, content_sha256, is_current) values
  ('$V_TERMS', 'terms',             'conc-tos', repeat('a', 64), true),
  ('$V_PRIV',  'privacy',           'conc-pp',  repeat('b', 64), true),
  ('$V_DECL',  'adult_declaration', 'conc-ad',  repeat('c', 64), true);
insert into public.consents (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
select t, 'grant', '$V_TERMS', '$V_PRIV', 'web' from unnest(array['$T1','$T2','$T3','$T4']::uuid[]) t;
insert into public.students (tutor_id, nickname, grade, adult_declaration_accepted)
select t, 'Base' || g, 1, true
from unnest(array['$T1','$T4']::uuid[]) t, generate_series(1, 4) g;
commit;
SQL
echo "  datos de prueba creados"

# ---------------------------------------------------------------------------
echo "== A. Dos altas simultáneas con 4 alumnos (tope 5) =="
tutor_session "$T1" 3 "insert into public.students (tutor_id,nickname,grade,adult_declaration_accepted) values ('$T1','S5a',1,true);" > "$OUT/a1" &
wait_ready "$OUT/a1" 10
tutor_session "$T1" 0 "insert into public.students (tutor_id,nickname,grade,adult_declaration_accepted) values ('$T1','S5b',1,true);" > "$OUT/a2" &
wait
ERRS="$(cat "$OUT/a1" "$OUT/a2" | grep -c 'student_limit_reached')"
TOTAL="$(sql -c "select count(*) from public.students where tutor_id = '$T1'")"
check "exactamente una alta rechazada con student_limit_reached" "1" "$ERRS"
check "el tutor termina con 5 alumnos (no 6)" "5" "$TOTAL"

# ---------------------------------------------------------------------------
echo "== B1. Alta y revocación simultáneas (la alta toma el bloqueo primero) =="
tutor_session "$T2" 3 "insert into public.students (tutor_id,nickname,grade,adult_declaration_accepted) values ('$T2','B1',1,true);" > "$OUT/b11" &
wait_ready "$OUT/b11" 10
tutor_session "$T2" 0 "insert into public.consents (tutor_id,event_type,terms_version_id,privacy_version_id,channel) values ('$T2','revoke','$V_TERMS','$V_PRIV','web');" > "$OUT/b12" &
wait
N="$(sql -c "select count(*) from public.students where tutor_id = '$T2'")"
BLOCKED="$(sql -c "select count(*) from public.students where tutor_id = '$T2' and blocked_at is not null")"
check "el alumno recién creado existe" "1" "$N"
check "y quedó bloqueado por la revocación (no escapa al bloqueo)" "1" "$BLOCKED"

# ---------------------------------------------------------------------------
echo "== B2. Revocación y alta simultáneas (la revocación toma el bloqueo primero) =="
tutor_session "$T3" 3 "insert into public.consents (tutor_id,event_type,terms_version_id,privacy_version_id,channel) values ('$T3','revoke','$V_TERMS','$V_PRIV','web');" > "$OUT/b21" &
wait_ready "$OUT/b21" 10
tutor_session "$T3" 0 "insert into public.students (tutor_id,nickname,grade,adult_declaration_accepted) values ('$T3','B2',1,true);" > "$OUT/b22" &
wait
ERRS="$(cat "$OUT/b22" | grep -c 'consent_required')"
N="$(sql -c "select count(*) from public.students where tutor_id = '$T3'")"
check "la alta posterior a la revocación recibe consent_required" "1" "$ERRS"
check "no se creó ningún alumno" "0" "$N"

# ---------------------------------------------------------------------------
echo "== C. REPEATABLE READ: la base rechaza la alta =="
tutor_session "$T4" 2 "insert into public.students (tutor_id,nickname,grade,adult_declaration_accepted) values ('$T4','C5a',1,true);" > "$OUT/c1" &
wait_ready "$OUT/c1" 10
cat <<SQL | session > "$OUT/c2" &
begin isolation level repeatable read;
select count(*) from public.students where tutor_id = '$T4';
select pg_sleep(3);
select set_config('request.jwt.claims','{"sub":"$T4","role":"authenticated"}',true) as c \gset
set local role authenticated;
insert into public.students (tutor_id,nickname,grade,adult_declaration_accepted) values ('$T4','C5b',1,true);
commit;
SQL
wait
ERRS="$(grep -c 'isolation_level_not_allowed' "$OUT/c2")"
N="$(sql -c "select count(*) from public.students where tutor_id = '$T4'")"
check "la alta bajo REPEATABLE READ recibe isolation_level_not_allowed" "1" "$ERRS"
check "el tutor termina con 5 alumnos (no 6)" "5" "$N"

# ---------------------------------------------------------------------------
echo
if [ "$FAILS" -eq 0 ]; then
  echo "RESULTADO: todas las comprobaciones de concurrencia pasaron."
  exit 0
else
  echo "RESULTADO: $FAILS comprobación(es) fallaron."
  exit 1
fi
