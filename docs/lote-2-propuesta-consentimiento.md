# Propuesta Lote 2: consentimiento, revocación y límites

**Estado:** **aprobado y aplicado** como tres migraciones (`20261012190000_consent_gate`, `20261012190100_student_limit`, `20261012190200_consent_evidence`) con sus tests en `supabase/tests/database/`. El SQL de más abajo es el borrador original; el definitivo está en las migraciones y difiere en lo indicado en la sección siguiente.
**Fecha:** 2026-10-12 · **Base:** Lote 1 (commit local `87b096b`) · **Apoyo técnico, no asesoría legal.**

### Diferencias entre este borrador y lo aplicado

- **Decisiones del usuario:** máximo 5 alumnos y los bloqueados cuentan; plazo de conservación sin definir (pendiente legal); si cambia la versión de los términos no se crean perfiles ni se usa la IA hasta aceptar la nueva; volver a consentir **no** desbloquea y el desbloqueo es manual.
- **Desbloqueo manual** (`unblock_student(tutor, alumno)`): solo `service_role`, para que FastAPI lo invoque tras verificar el control parental. Requiere consentimiento activo y que el alumno sea del tutor.
- **Idempotencia del archivo (R9):** `consent_evidence` guarda `source_seq` y tiene `unique (tutor_ref, source_seq)`; archivar dos veces no duplica.
- **Alerta R8:** `privacy_config_warnings()` (solo servidor) devuelve una alerta mientras el plazo esté sin definir, y `archive_consent_evidence` emite un `WARNING` sin datos personales. El plazo se valida (nulo o 1 a 36500 días).
- **Precondición explícita:** el paso 1 aborta si `consents` o `students` tienen datos (no hay backfill).
- **Orden de errores:** al intentar crear un alumno a nombre de otro tutor, el rechazo puede venir de la compuerta (`consent_required`) o de la política RLS según el estado de la transacción; en ambos casos no se inserta nada. Los tests afirman el efecto, no el mensaje.
- **No cubierto todavía:** concurrencia real con dos conexiones, límite de frecuencia de eventos de consentimiento (R5) y el flujo de FastAPI.

---

## Resumen para quien no es experto

Hoy un tutor puede crear perfiles de niños por la API aunque nunca haya aceptado los términos, y no hay forma de retirar el consentimiento sin borrar la cuenta (lo que además destruye la prueba de que consintió).

Esta propuesta arregla eso con seis ideas simples:

1. **Documentos legales con versión y huella (hash).** Queda registrado *exactamente* qué texto aceptó la persona.
2. **Sin consentimiento vigente no se crea ningún alumno.** Lo exige la base de datos, no solo la app.
3. **Cada alumno queda atado al consentimiento con el que se creó**, más una declaración de que quien lo crea es el adulto responsable.
4. **Retirar el consentimiento bloquea los perfiles** y queda registrado como un evento más (nunca se borra nada del historial).
5. **Al borrar la cuenta se conserva solo una evidencia mínima**: qué versión se aceptó, cuándo, por qué canal, y un identificador cifrado que no permite saber quién era sin una clave guardada fuera de la base.
6. **Un máximo de alumnos por tutor** (por defecto 5) y una clave que prepara las futuras tablas (progreso, uso) para ser seguras y rápidas.

**Qué falta decidir** (ver las preguntas al abogado al final): cuánto tiempo se guarda la evidencia, si revocar bloquea o borra, y el texto exacto de la declaración del adulto.

**Verificado hasta ahora:** el SQL previsto se ejecutó en una transacción de prueba que se deshizo, y una comprobación rápida confirmó lo esencial (sin consentimiento no se crea alumno; revocar bloquea; la evidencia se archiva). **No** están escritos ni ejecutados los tests pgTAP definitivos, ni se probó concurrencia real.

---

## Qué cambia respecto del Lote 1

| Tabla | Cambio |
|---|---|
| `legal_document_versions` | **Nueva.** Versión, huella SHA-256 y cuál es la vigente, por tipo de documento. |
| `consents` | Pasa de "una fila por aceptación" a **registro de eventos** (`grant` / `revoke`), con referencia a las versiones, canal y orden estricto. Se elimina el `unique` y las columnas de texto libre de versión. |
| `students` | Nuevas columnas: consentimiento con el que se creó, declaración del adulto (versión y fecha), `blocked_at`. Clave única `(id, tutor_id)`. |
| `tutors` | Nueva columna `max_students` (por defecto 5). |
| `consent_evidence` | **Nueva.** Evidencia mínima seudonimizada, **sin FK al tutor** (sobrevive al borrado de la cuenta). Solo accesible por el servidor. |
| `app_settings` | **Nueva.** Guarda el plazo configurable de conservación (hoy sin valor: pendiente legal). |

---

## 1. Compuerta de consentimiento

**Idea.** Un tutor tiene "consentimiento activo" si su último evento es `grant` y apunta a las versiones **vigentes** de términos y de política de privacidad. Si cambia la versión vigente, el consentimiento deja de estar activo hasta que vuelva a aceptar (regla de CLAUDE.md: re-pedirlo si cambia la versión).

**Dónde se exige.** En dos lugares, para no depender de una sola capa:
- Política RLS de inserción en `students` (protege el acceso directo por PostgREST).
- Trigger `BEFORE INSERT` en `students` (protege **también** al servidor: el `service_role` se salta RLS pero **no** los triggers).

**Quién publica una versión.** Solo el servidor o una migración (los tutores solo pueden leer el catálogo). La huella SHA-256 debe calcularse del texto publicado, idealmente en un paso de CI.

## 2. Consentimiento a nivel de cuenta, alumno ligado y declaración del adulto

- El consentimiento es **por cuenta de tutor** y sobre una **versión concreta**.
- Al crear un alumno, el trigger guarda en el perfil el id del consentimiento vigente (`consent_id`). El cliente no puede escribirlo ni cambiarlo.
- El cliente debe enviar `adult_declaration_accepted = true` (un check de la tabla lo exige). El servidor completa la **versión** del texto de la declaración y la **fecha-hora**. Así queda evidencia de qué texto se mostró y cuándo.
- Limitación honesta: ese `true` lo manda el cliente; su valor probatorio depende de que la app muestre el texto y exija el paso. La base solo garantiza que no se pueda crear el perfil sin él.

## 3. Revocación y qué debe comprobar FastAPI

**Revocar** es insertar un evento `revoke`. No se borra ni se edita nada (la tabla sigue siendo de solo altas).

**Efecto.** Un trigger bloquea (`blocked_at = now()`) todos los perfiles del tutor en la misma transacción. Un perfil bloqueado se puede leer (derecho de acceso) y borrar, pero **no editar**.

**Qué NO hace en esta propuesta:** volver a consentir **no** desbloquea automáticamente. Cómo reactivar (¿con PIN del tutor? ¿perfil por perfil?) es una decisión abierta.

**Qué debe comprobar FastAPI antes de cualquier llamada a la IA o escritura de progreso** (el `service_role` ignora RLS, así que esto es responsabilidad del código):

1. JWT válido y `tutor_id = sub` del token.
2. El alumno pertenece a ese tutor **y** `blocked_at is null`.
3. `has_active_consent(tutor_id)` es verdadero (versión vigente). Caché de segundos como máximo; **ante duda o error, denegar**.
4. Límites por perfil y por día, y tope de costo por tutor.
5. Tras una revocación, invalidar cachés y **cortar streams en curso**.
6. Ante un rechazo, responder un mensaje genérico; **no** registrar contenido ni datos personales en logs.

## 4. Evidencia mínima seudonimizada al borrar la cuenta

**Qué se conserva** (por cada evento): versión de términos, versión de política, fecha-hora, canal, tipo de evento y un **identificador del tutor calculado con HMAC-SHA-256**. No se guarda correo, apodo, curso ni nada del niño.

**La clave del HMAC vive fuera de la base** (variable de entorno del servidor). La base no puede recalcular el identificador por sí sola; por eso lo calcula FastAPI.

**Flujo de borrado de cuenta (FastAPI, con `service_role`):**
1. Calcular `tutor_ref = HMAC(clave, tutor_id)` y registrar la versión de la clave.
2. Llamar a `archive_consent_evidence(tutor_id, tutor_ref, key_version)`: copia los eventos a `consent_evidence`.
3. Borrar el usuario de Auth (la cascada elimina tutor, alumnos y consentimientos *vivos*).
4. Un job periódico ejecuta `purge_expired_consent_evidence()` cuando se cumple `retain_until`.

**Plazo.** `retain_until` se calcula con `app_settings.consent_evidence_retention_days`. Hoy es `null`: significa "sin plazo definido" y por tanto **no se purga nada** hasta que Legal lo fije. Ver riesgo R8.

**Importante:** seudonimizado **no** es anonimizado. Sigue siendo dato personal mientras exista la clave.

## 5. Tope de alumnos y clave única

- **Tope:** `tutors.max_students` (1 a 20, por defecto 5). Un trigger cuenta los alumnos bajo un bloqueo por tutor (advisory lock) para que dos inserciones simultáneas no superen el límite. El cliente no puede cambiar el tope.
- **Por qué importa:** los límites de IA son "por perfil y por día"; sin tope, crear perfiles multiplica la cuota.
- **Clave `unique (id, tutor_id)`:** permite que las futuras tablas hijas (progreso, uso) lleven `tutor_id` y una FK compuesta `(student_id, tutor_id)`. Su RLS queda en `tutor_id = auth.uid()` sin subconsultas por fila, y la consistencia la garantiza la FK.

---

## SQL previsto (borrador, no aplicado)

Probado en una transacción deshecha contra el esquema del Lote 1. Se aplicaría como una migración nueva (`supabase/migrations/<timestamp>_consent_gate.sql`).

**Precondición:** `public.consents` debe estar vacía (no hay datos reales). Si no lo estuviera, se necesita un backfill antes de dejar las columnas de versión como `NOT NULL`.

```sql
-- 1. Versiones de documentos legales
create table public.legal_document_versions (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('terms', 'privacy', 'adult_declaration')),
  version        text not null check (char_length(version) between 1 and 40),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  published_at   timestamptz not null default now(),
  is_current     boolean not null default false,
  unique (kind, version)
);
create unique index legal_document_versions_one_current_idx
  on public.legal_document_versions (kind) where is_current;

alter table public.legal_document_versions enable row level security;
alter table public.legal_document_versions force row level security;
revoke all on public.legal_document_versions from public, anon, authenticated;
grant select on public.legal_document_versions to authenticated;
-- Catálogo público de textos legales: lectura abierta a propósito. Escritura: solo servidor.
create policy legal_versions_read on public.legal_document_versions
  for select to authenticated using (true);

-- 2. consents pasa a ser un registro de eventos
alter table public.consents drop constraint consents_tutor_id_terms_version_privacy_version_key;
alter table public.consents rename column accepted_at to occurred_at;
alter table public.consents
  add column seq                bigint generated always as identity,
  add column event_type         text not null default 'grant' check (event_type in ('grant', 'revoke')),
  add column terms_version_id   uuid references public.legal_document_versions (id),
  add column privacy_version_id uuid references public.legal_document_versions (id),
  add column channel            text not null default 'web' check (channel in ('ios', 'android', 'web'));
alter table public.consents
  alter column terms_version_id set not null,
  alter column privacy_version_id set not null,
  drop column terms_version,
  drop column privacy_version;
create index consents_tutor_seq_idx on public.consents (tutor_id, seq desc);

revoke insert on public.consents from authenticated;
grant insert (tutor_id, event_type, terms_version_id, privacy_version_id, channel)
  on public.consents to authenticated;

drop policy consents_insert_own on public.consents;
create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (
    tutor_id = (select auth.uid())
    and (
      event_type = 'revoke'
      or (
        exists (select 1 from public.legal_document_versions v
                where v.id = terms_version_id and v.kind = 'terms' and v.is_current)
        and exists (select 1 from public.legal_document_versions v
                    where v.id = privacy_version_id and v.kind = 'privacy' and v.is_current)
      )
    )
  );

-- 3. ¿El tutor tiene consentimiento vigente?
create function public.has_active_consent(p_tutor_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select last.event_type = 'grant'
       and t.is_current and p.is_current
    from (
      select c.event_type, c.terms_version_id, c.privacy_version_id
      from public.consents c
      where c.tutor_id = p_tutor_id
      order by c.seq desc
      limit 1
    ) last
    join public.legal_document_versions t on t.id = last.terms_version_id
    join public.legal_document_versions p on p.id = last.privacy_version_id
  ), false);
$$;
revoke all on function public.has_active_consent(uuid) from public, anon;
grant execute on function public.has_active_consent(uuid) to authenticated, service_role;

-- 4. Tope de alumnos y clave (id, tutor_id)
alter table public.tutors
  add column max_students smallint not null default 5 check (max_students between 1 and 20);

alter table public.students
  add constraint students_id_tutor_uk unique (id, tutor_id);

alter table public.students
  add column consent_id                    uuid references public.consents (id),
  add column adult_declaration_accepted    boolean not null default false
             check (adult_declaration_accepted),
  add column adult_declaration_version_id  uuid references public.legal_document_versions (id),
  add column adult_declared_at             timestamptz,
  add column blocked_at                    timestamptz;

grant insert (adult_declaration_accepted) on public.students to authenticated;

create function public.students_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_consent  uuid;
  v_decl     uuid;
  v_max      smallint;
  v_count    integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tutor_id::text, 0));

  if not public.has_active_consent(new.tutor_id) then
    raise exception 'consent_required';
  end if;

  select id into v_consent
  from public.consents where tutor_id = new.tutor_id
  order by seq desc limit 1;

  select id into v_decl
  from public.legal_document_versions
  where kind = 'adult_declaration' and is_current;
  if v_decl is null then
    raise exception 'declaration_version_missing';
  end if;

  select max_students into v_max from public.tutors where id = new.tutor_id;
  select count(*) into v_count from public.students where tutor_id = new.tutor_id;
  if v_count >= coalesce(v_max, 5) then
    raise exception 'student_limit_reached';
  end if;

  new.consent_id                   := v_consent;
  new.adult_declaration_version_id := v_decl;
  new.adult_declared_at            := now();
  new.blocked_at                   := null;
  return new;
end;
$$;

create trigger students_before_insert
  before insert on public.students
  for each row execute function public.students_before_insert();

drop policy students_insert_own on public.students;
create policy students_insert_own on public.students
  for insert to authenticated
  with check (
    tutor_id = (select auth.uid())
    and public.has_active_consent((select auth.uid()))
  );

-- Un perfil bloqueado se puede leer y borrar, pero no editar.
drop policy students_update_own on public.students;
create policy students_update_own on public.students
  for update to authenticated
  using (tutor_id = (select auth.uid()) and blocked_at is null)
  with check (tutor_id = (select auth.uid()));

-- 5. Revocar bloquea los perfiles
create function public.on_consent_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tutor_id::text, 0));
  update public.students
     set blocked_at = now()
   where tutor_id = new.tutor_id and blocked_at is null;
  return new;
end;
$$;
revoke all on function public.on_consent_revoked() from public, anon, authenticated;

create trigger consents_after_revoke
  after insert on public.consents
  for each row when (new.event_type = 'revoke')
  execute function public.on_consent_revoked();

-- 6. Evidencia mínima seudonimizada, sin FK al tutor
create table public.app_settings (
  key   text primary key,
  value jsonb not null
);
-- null = plazo aún no definido por Legal (no se purga nada).
insert into public.app_settings (key, value)
values ('consent_evidence_retention_days', 'null'::jsonb);

create table public.consent_evidence (
  id               uuid primary key default gen_random_uuid(),
  tutor_ref        text not null check (tutor_ref ~ '^[0-9a-f]{64}$'),  -- HMAC-SHA256, clave fuera de la BD
  hmac_key_version smallint not null,
  event_type       text not null check (event_type in ('grant', 'revoke')),
  terms_version    text not null,
  privacy_version  text not null,
  channel          text not null,
  occurred_at      timestamptz not null,
  archived_at      timestamptz not null default now(),
  retain_until     timestamptz
);
create index consent_evidence_tutor_ref_idx on public.consent_evidence (tutor_ref);
create index consent_evidence_retain_until_idx on public.consent_evidence (retain_until)
  where retain_until is not null;

alter table public.app_settings     enable row level security;
alter table public.app_settings     force row level security;
alter table public.consent_evidence enable row level security;
alter table public.consent_evidence force row level security;
-- Sin políticas y sin grants: solo service_role (backend) accede.
revoke all on public.app_settings, public.consent_evidence from public, anon, authenticated;

create function public.archive_consent_evidence(
  p_tutor_id uuid, p_tutor_ref text, p_key_version smallint
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_rows integer;
begin
  select (value #>> '{}')::integer into v_days
  from public.app_settings where key = 'consent_evidence_retention_days';

  insert into public.consent_evidence
    (tutor_ref, hmac_key_version, event_type, terms_version, privacy_version,
     channel, occurred_at, retain_until)
  select p_tutor_ref, p_key_version, c.event_type, t.version, p.version,
         c.channel, c.occurred_at,
         case when v_days is null then null else now() + make_interval(days => v_days) end
  from public.consents c
  join public.legal_document_versions t on t.id = c.terms_version_id
  join public.legal_document_versions p on p.id = c.privacy_version_id
  where c.tutor_id = p_tutor_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function public.archive_consent_evidence(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.archive_consent_evidence(uuid, text, smallint) to service_role;

create function public.purge_expired_consent_evidence()
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (
    delete from public.consent_evidence
    where retain_until is not null and retain_until < now()
    returning 1
  )
  select count(*)::integer from d;
$$;
revoke all on function public.purge_expired_consent_evidence() from public, anon, authenticated;
grant execute on function public.purge_expired_consent_evidence() to service_role;
```

---

## Tests previstos (pgTAP, aún no escritos)

**Compuerta y versiones**
1. Sin eventos de consentimiento, insertar un alumno falla (`consent_required`), tanto como `authenticated` como como `service_role`.
2. Con `grant` sobre versiones vigentes, el alumno se crea y queda con `consent_id` y declaración completados por el servidor.
3. Si cambia la versión vigente, `has_active_consent` pasa a falso y no se pueden crear más alumnos.
4. Un `grant` apuntando a una versión no vigente es rechazado por RLS.
5. El cliente no puede insertar, actualizar ni borrar en `legal_document_versions`; `anon` no la lee.
6. Solo puede existir una versión vigente por tipo.
7. El cliente no puede escribir `consent_id`, `adult_declared_at`, `adult_declaration_version_id` ni `blocked_at`.
8. `adult_declaration_accepted = false` es rechazado.

**Revocación**
9. Un `revoke` bloquea todos los perfiles del tutor y solo los suyos (el otro tutor no se ve afectado).
10. Un perfil bloqueado se lee y se borra, pero no se edita.
11. Tras `revoke`, `has_active_consent` es falso y no se crean alumnos.
12. Volver a consentir no desbloquea automáticamente (comportamiento actual, a confirmar).
13. `consents` sigue sin UPDATE ni DELETE para el cliente.
14. Orden estricto: dos eventos en el mismo instante respetan `seq`.

**Evidencia y supresión**
15. `consent_evidence` y `app_settings` son ilegibles e inescribibles para `anon` y `authenticated`.
16. `archive_consent_evidence` y `purge_expired_consent_evidence` no son ejecutables por `anon` ni `authenticated`; sí por `service_role`.
17. Tras archivar y borrar el usuario, no queda fila del tutor y sí quedan sus eventos en `consent_evidence` sin ningún dato del niño.
18. `retain_until` es nulo si el plazo es nulo, y se calcula bien cuando está definido; la purga elimina solo lo vencido.
19. Verificación de que `consent_evidence` no tiene FK ni columnas de correo, apodo o curso.

**Tope y clave**
20. El alumno número `max_students + 1` es rechazado.
21. El cliente no puede cambiar `max_students`.
22. La clave `(id, tutor_id)` existe y una FK compuesta de prueba la usa.
23. (Prueba de concurrencia con dos conexiones: queda fuera de pgTAP; se haría como script aparte.)

**Actualizar los tests del Lote 1:** cambian las columnas de `consents` (ya no existen `terms_version` ni `privacy_version`) y toda inserción en `students` ahora necesita un consentimiento vigente y `adult_declaration_accepted = true`.

---

## Riesgos

| # | Riesgo | Qué hacer |
|---|---|---|
| R1 | **El servidor ignora RLS.** `service_role` no pasa por las políticas; si FastAPI no comprueba consentimiento y bloqueo, el niño sigue usando la IA tras una revocación. | La lista de la sección 3 es obligatoria. El trigger de `students` sí cubre las altas, pero no las llamadas a la IA ni el progreso. |
| R2 | **Cambiar la versión vigente deja a todos sin consentimiento activo** y, por tanto, sin poder crear alumnos ni usar la IA hasta que vuelvan a aceptar. Es lo que pide CLAUDE.md, pero es una decisión de producto y de experiencia de usuario. | Definir el flujo de "re-aceptar", si habrá aviso previo y si los perfiles existentes se bloquean o siguen usables hasta aceptar. |
| R3 | **Reconstrucción de `consents`.** Elimina columnas; el SQL asume tabla vacía. Si hubiera datos, hace falta backfill. También rompe tests y código del Lote 1 que usen esas columnas. | Verificar que está vacía antes de aplicar; actualizar tests. |
| R4 | **Concurrencia no probada.** El bloqueo por tutor (advisory lock) debería evitar pasarse del tope y carreras revocar/crear, pero solo se verificó el comportamiento en una sola conexión. | Script de prueba con dos conexiones antes de confiar en ello. |
| R5 | **Crecimiento de `consents`.** Al ser append-only, un cliente malicioso puede insertar miles de eventos `grant`/`revoke`. | Límite de frecuencia en FastAPI o un tope por tutor; la lectura usa `(tutor_id, seq desc)`. |
| R6 | **La clave del HMAC.** Si se pierde, no se podrá vincular la evidencia con un reclamo. Si se filtra junto con la base, la seudonimización se rompe. Rotarla exige conservar `hmac_key_version` y las claves anteriores. | Guardarla solo en el gestor de secretos del servidor, con procedimiento de rotación documentado. |
| R7 | **Seudonimizado sigue siendo dato personal.** El inventario y la EIPD deben decir que `consent_evidence` es dato personal con base de licitud y plazo propios. | Actualizar `docs/privacy/inventario-datos.md` al aplicar. |
| R8 | **Plazo en `null` = se conserva para siempre.** Mientras Legal no defina el plazo, nada se purga, lo que contradice el principio de conservación limitada. | Fijar un valor provisional explícito (por ejemplo, el de prescripción que indique Legal) o una alerta si sigue en `null` al acercarse al lanzamiento. |
| R9 | **Archivar y borrar no son atómicos.** Si el flujo falla entre pasos o se reintenta, la evidencia puede duplicarse. | Hacer el archivo idempotente (por ejemplo, un `unique` sobre `tutor_ref` + evento) y borrar el usuario solo si el archivo terminó bien. |
| R10 | **Bloquear no es borrar.** Los datos siguen en la base tras revocar. Si Legal exige suprimir, hay que añadir un paso de supresión programada. | Ver pregunta legal 6. |
| R11 | **El valor de la declaración del adulto es limitado:** el `true` lo manda el cliente. | Texto versionado, mostrado y aceptado en un paso explícito; protegerlo con el PIN o pregunta de adulto. |
| R12 | **El tope y la política por defecto son decisiones de producto** (5 alumnos, 20 como máximo). | Confirmar los números. |
| R13 | **Reactivación sin definir.** Volver a consentir no desbloquea perfiles; falta decidir cómo se reactivan y quién puede hacerlo. | Función explícita, solo desde la zona del tutor protegida. |
| R14 | **Los bloqueados cuentan para el tope.** Un tutor con perfiles bloqueados no puede crear otros. | Decidir si cuentan o no. |
| R15 | **El catálogo legal es legible por cualquier usuario autenticado** (`using (true)`). Es intencional (es texto público), pero cambia el criterio "todas las políticas son por tutor". | Dejarlo documentado; queda excluido de la regla de tutor. |

---

## Preguntas para un abogado

1. **Conservación de la evidencia.** Al suprimir la cuenta, ¿corresponde conservar evidencia mínima seudonimizada del consentimiento? ¿Con qué base de licitud y durante cuánto tiempo (prescripción de eventuales acciones)?
2. **Seudonimización.** ¿El identificador calculado con HMAC y la clave en poder de la empresa se considera dato personal seudonimizado? ¿Cómo se atiende un derecho de acceso sobre esa evidencia si la cuenta ya no existe?
3. **Alcance del consentimiento.** ¿Basta un consentimiento por cuenta de tutor sobre una versión, con el perfil del niño ligado a él, o se exige un consentimiento específico por cada niño?
4. **Declaración del adulto.** ¿Qué texto debe tener y qué nivel de verificación se exige de que quien crea el perfil es padre, madre o representante legal? ¿Basta una declaración o hace falta un mecanismo reforzado?
5. **Retiro del consentimiento.** ¿Tiene que ser tan simple como otorgarlo? ¿Dónde debe estar disponible y qué efecto exige la ley?
6. **Bloqueo o supresión.** Al revocar, ¿basta bloquear los perfiles o hay que suprimir los datos del niño? ¿En qué plazo?
7. **Cambio de versión.** Cuando cambian los términos o la política, ¿hay que bloquear el servicio hasta que se re-acepte o se puede seguir con el consentimiento anterior mientras no cambie la finalidad?
8. **Decisiones automatizadas.** La adaptación de dificultad de la IA, ¿califica como perfilamiento o decisión automatizada y qué obligaciones trae?
9. **EIPD.** ¿Es obligatoria una evaluación de impacto para este tratamiento (menores de 14, IA)? ¿Con qué contenido mínimo?
10. **Vigencia.** ¿En qué estado está el proyecto que propone postergar la Ley 21.719 al 1-dic-2027 y qué norma aplicamos mientras tanto para el consentimiento de menores?
11. **Canal y prueba.** ¿Es suficiente guardar versión, fecha-hora, canal y huella del texto como prueba del consentimiento, o se requiere algo más (por ejemplo, la dirección IP, que hoy **no** guardamos por minimización)?
12. **Transferencias.** Si la base alojada queda fuera de Chile, ¿qué garantías y contratos exige la transferencia internacional de estos datos?

---

## Si apruebas esta propuesta

Orden sugerido de implementación (cada paso con sus tests y con `supabase test db` y `db lint` como evidencia):

1. Migración nueva con las secciones 1 a 3 (versiones, `consents` como eventos, compuerta, revocación) y actualización de los tests del Lote 1.
2. Sección 5 (tope y clave única).
3. Sección 4 (evidencia, `app_settings`, archivo y purga), con el plazo en `null` y la alerta de R8.
4. Actualizar `docs/privacy/inventario-datos.md` y revisar con `privacy-cl-auditor`, `security-reviewer` y `code-reviewer` antes de cualquier PR.
5. Contrato de FastAPI (sección 3) como ADR corto en `docs/`.
