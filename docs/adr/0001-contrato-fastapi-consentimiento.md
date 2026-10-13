# ADR 0001 — Contrato entre FastAPI y la base para consentimiento, bloqueo y borrado de cuenta

**Estado:** propuesto (pendiente de aprobación) · **Fecha:** 2026-10-12
**Alcance:** FastAPI (`api/`) y las migraciones de `supabase/` (Lotes 1, 2, A y B).
**Apoyo técnico, no asesoría legal.**

## En simple

La base de datos ya sabe quién tiene consentimiento, qué perfiles están bloqueados y cómo guardar la evidencia. Pero **FastAPI usa la llave de servidor (`service_role`), que ignora las reglas de seguridad por fila**. Por eso, parte de la seguridad depende de que FastAPI haga ciertas comprobaciones siempre y en el mismo orden. Este documento fija esas reglas para que no queden a criterio de cada endpoint.

Tres decisiones:

1. **Antes de usar la IA o guardar progreso**, FastAPI hace siempre las mismas 5 comprobaciones, y ante cualquier duda **niega**.
2. **No hay caché en memoria** del consentimiento ni del bloqueo. Si hace falta caché, es compartida y de pocos segundos.
3. **Borrar una cuenta sigue un orden fijo** (bloquear, archivar la evidencia, borrar, verificar) y se puede repetir sin riesgo si algo falla a medias.

---

## Contexto

- La frontera de seguridad principal es RLS por tutor. FastAPI valida el JWT de Supabase y comprueba que el alumno pertenezca al tutor (CLAUDE.md).
- `service_role` **no pasa por RLS**. Sí pasa por los triggers: la compuerta de consentimiento y el tope de alumnos aplican también al servidor.
- Lo que los triggers **no** cubren: llamadas a la IA, escritura de progreso, lectura de datos y el orden del borrado de cuenta.
- Dependemos de PostgreSQL `READ COMMITTED` (ver decisión 2.3).

## Decisión 1 — Comprobaciones obligatorias

Antes de **cualquier** llamada a la IA y de **cualquier** escritura de progreso o uso, FastAPI ejecuta, en este orden y sin saltarse ninguna:

| # | Comprobación | Si falla |
|---|---|---|
| 1 | JWT válido y no vencido; `tutor_id` = `sub` del token. | 401 |
| 2 | El alumno existe, **pertenece a ese tutor** y `blocked_at is null`. | 403 (mensaje genérico) |
| 3 | `has_active_consent(tutor_id)` es verdadero (versión vigente de términos y de política). | 403 `consent_required` |
| 4 | Límites por perfil y por día, y tope de costo por tutor. | 429 |
| 5 | Filtro de entrada (PII, groserías, fuera de matemáticas) sobre el texto del niño. | 422 o respuesta de rechazo amable |

Reglas:

- **Falla cerrado:** un error de base, un timeout o una respuesta inesperada equivalen a "no autorizado". Nunca se asume que "seguramente está bien".
- **Una sola consulta:** las comprobaciones 2 y 3 se hacen en un solo viaje a la base (función única, a implementar en una migración posterior: `authorize_student_use(tutor_id, student_id)`, ejecutable solo por `service_role`, devolviendo un código de motivo o `ok`). Hasta entonces, dos consultas dentro de la misma transacción.
- **Sin contenido en logs:** ni mensajes del niño, ni apodo, ni correo en logs, errores o trazas. Se registra solo un identificador de petición y el código de resultado.
- **Mensajes genéricos:** al cliente nunca se le explica *por qué* otro tutor o perfil no existe.
- **Tablas hijas futuras** (progreso, uso, sesiones): las escribe **solo el servidor**; el cliente solo lee por RLS. Llevan `tutor_id` y FK compuesta `(student_id, tutor_id)` hacia `students` (la clave `students_id_tutor_uk` ya existe). Si más adelante el cliente debe escribirlas directamente, su política de INSERT deberá incluir `has_active_consent(auth.uid())` y `blocked_at is null`.

### Mapa de errores de la base

Hoy se distinguen por el texto del mensaje (SQLSTATE `P0001`). FastAPI los traduce así:

| Mensaje de la base | Respuesta de la API | Nota |
|---|---|---|
| `consent_required` | 403 `consent_required` | La app debe llevar al tutor a aceptar la versión vigente. |
| `student_limit_reached` | 409 `student_limit_reached` | |
| `declaration_version_missing` | 503 | Error de configuración: no hay declaración vigente publicada. Alerta interna. |
| `consent_event_redundant` | 200 idempotente | El estado ya era ese. |
| `consent_event_rate_limited` | 429 | Máximo 20 eventos de consentimiento por tutor en 24 h. |
| `no_consent_to_revoke` | 409 | |
| `tutor_mismatch` (42501) | 403 | Indica un cliente que intenta actuar a nombre de otro: registrar el evento de seguridad (sin datos personales). |
| `evidence_is_immutable`, `consents_are_append_only`, `legal_versions_are_*` | 500 | Error de programación del servidor: nunca debería ocurrir. |

Pendiente (baja prioridad): sustituir el texto por códigos propios (`errcode`), para no depender de comparar cadenas.

## Decisión 2 — Caché, aislamiento y revocación en curso

**2.1 Sin caché en memoria del proceso.** Con varias réplicas de FastAPI, una revocación atendida por una réplica no invalidaría la caché de las otras. La consulta es barata (búsqueda por el índice `consents(tutor_id, seq desc)` con `limit 1` más dos búsquedas por clave primaria): no se justifica el riesgo.

**2.2 Si algún día hace falta caché**, debe cumplir todo esto:
- compartida entre réplicas (p. ej. Redis), nunca en memoria del proceso;
- vigencia de **15 segundos como máximo**;
- se invalida explícitamente cuando el servidor procesa una revocación o un bloqueo;
- ante un error al leerla, **se consulta la base**; ante un error de la base, **se niega**.

**2.3 Aislamiento.** Las rutas que toman el bloqueo por tutor (`students_before_insert`, `consents_before_insert`, `on_consent_revoked`, `unblock_student`) son correctas bajo `READ COMMITTED`. Bajo `REPEATABLE READ` o `SERIALIZABLE`, el conteo del tope y el estado del consentimiento se leen con la vista del inicio de la transacción y dos altas concurrentes pueden superar el tope (se demuestra en `supabase/tests/concurrency/`). Por lo tanto:
- FastAPI **debe** usar `READ COMMITTED` (el valor por defecto de PostgreSQL) en esas rutas;
- la configuración del pool y del ORM debe fijarlo explícitamente y tener una prueba que lo verifique;
- (propuesta futura) las funciones podrían rechazar `current_setting('transaction_isolation') <> 'read committed'`.

**2.4 Revocación con una respuesta en streaming en curso.**
- Al iniciar el stream se hacen las 5 comprobaciones.
- Durante el stream se **repite la comprobación 2 y 3 como máximo cada 10 segundos** y al empezar cada bloque lógico de respuesta; si falla, se corta el stream y se cierra con un mensaje neutro.
- Duración máxima de un stream: acotada por configuración (propuesta: 60 s).
- Una revocación o un bloqueo debe poder cortar un stream en curso en **a lo sumo ~10 segundos**.

## Decisión 3 — Borrado de cuenta en orden

La base no puede hacer todo sola: **la clave HMAC vive fuera de la base** y el borrado del usuario es una llamada a la API de administración de Auth. Por eso el orden lo impone FastAPI:

| Paso | Qué hace FastAPI | Por qué en este orden |
|---|---|---|
| 0 | Verifica identidad y control parental (PIN o pregunta de adulto) y pide confirmación. | Evita borrados accidentales o por un niño. |
| 1 | **Congela la cuenta**: registra una revocación (bloquea todos los perfiles), bloquea el acceso del usuario en Auth (ban) e invalida sus sesiones. | Impide eventos nuevos entre archivar y borrar. |
| 2 | Calcula `tutor_ref = HMAC(clave, tutor_id)` y `email_ref = HMAC(clave, lower(trim(correo)))`, con la versión de clave vigente. | La base no tiene la clave. |
| 3 | Llama a `archive_consent_evidence(tutor_id, tutor_ref, email_ref, versión)`. Comprueba que la cantidad archivada coincide con la cantidad de eventos del tutor. | Si falla aquí, **no se borra nada**. |
| 4 | **Repite el paso 3** (es idempotente). | Cubre cualquier evento que hubiera entrado entre 3 y 5. |
| 5 | Borra el usuario en Auth. La cascada elimina tutor, alumnos y consentimientos vivos; un trigger archiva la declaración del adulto de cada perfil. | Es el paso irreversible. |
| 6 | Verifica: no queda fila del tutor; existe evidencia; existe evidencia de declaración. Registra el resultado (sin datos personales). | Cierra el procedimiento. |

**Reintentos:** todo el flujo se puede volver a ejecutar desde el paso 1.
- Falla en 1 a 4 → no se ha borrado nada; se reintenta o se aborta y se descongela la cuenta.
- Falla en 5 → la evidencia ya está archivada; se reintenta solo 5 (y 6).
- Si en un reintento el usuario ya no existe, el trabajo está terminado.
- Archivar dos veces no duplica (clave única por `source_seq`, independiente de la clave HMAC).

**Qué NO hace esta propuesta:** no hace atómico el borrado entre la base y Auth (son dos sistemas). Una alternativa más estricta (una función `SECURITY DEFINER` que archive y borre `auth.users` en una sola transacción) queda descartada por ahora: obliga a que la clave HMAC viva en la base o a calcularla fuera y pasar los valores igual, y acopla el borrado a tablas internas de Auth.

**Atender un derecho de acceso tras el borrado:** la persona acredita el correo (envío de un enlace); FastAPI calcula `email_ref` con la clave y las versiones de clave activas, localiza los eventos y entrega solo versión, fecha y canal. Nunca se entrega información de otras personas.

**Comprobante opcional:** antes del paso 5 se puede enviar al tutor un resumen (versiones aceptadas y fechas). Es una cortesía; no sustituye la evidencia.

## Decisión 4 — Clave HMAC

- Vive solo en el gestor de secretos del servidor. Nunca en la base, el repositorio ni la app.
- Cada fila de evidencia guarda `hmac_key_version`.
- **Rotación:** se genera una versión nueva; las filas antiguas no se reescriben (la evidencia es inmutable). Las búsquedas prueban todas las versiones activas.
- **Destruir una versión** de clave equivale a perder la capacidad de localizar esa evidencia (y podría considerarse anonimización). Es una decisión legal; no se hace sin ella.
- Quién la custodia y quién la rota: **pendiente de asignar** (ver "Qué debe hacer el equipo").

## Decisión 5 — Trabajos programados

| Trabajo | Frecuencia | Qué ejecuta | Quién |
|---|---|---|---|
| Purga de evidencia vencida | diaria | `purge_expired_consent_evidence()` | FastAPI (cron) o `pg_cron` |
| Purga de perfiles bloqueados vencidos | diaria | `purge_long_blocked_students()` | ídem |
| Aviso previo a la purga | diaria | `blocked_students_due_soon(7)` → avisar a cada tutor | FastAPI |
| Alertas de configuración | al arrancar, en el chequeo de salud y **en el despliegue** | `privacy_config_warnings()` | FastAPI y CI |

- **Bloquear el despliegue a producción** si `privacy_config_warnings()` devuelve filas (plazos sin definir o provisionales).
- Las purgas hoy no tienen tope de filas por ejecución: con volumen alto conviene ejecutarlas por lotes (pendiente).
- Hoy no hay trabajo programado en la base: ninguna migración activa `pg_cron`.

## Decisión 6 — Desbloqueo manual

1. El tutor entra a la zona protegida (PIN o pregunta de adulto), verificada **en el servidor**, con límite de intentos.
2. FastAPI llama a `unblock_student(tutor_id, student_id)` con `service_role`.
3. La función exige consentimiento activo y que el alumno sea del tutor; deja el perfil ligado al consentimiento vigente y registra el evento en `student_status_events`.
4. Si devuelve `false`, FastAPI explica al tutor que debe aceptar la versión vigente.

## Consecuencias

**Positivas:** el comportamiento ante revocaciones y cambios de versión es el mismo en todos los endpoints; el borrado de cuenta es repetible; los riesgos que dependen de FastAPI están escritos y se pueden revisar.

**Negativas / costos:**
- Más trabajo en FastAPI (comprobaciones, re-chequeo en streams, flujo de borrado, trabajos programados).
- Mientras no exista la función única, hay un viaje extra a la base por petición.
- El borrado entre base y Auth sigue sin ser atómico (mitigado con orden e idempotencia).

## Alternativas descartadas

- **Caché en memoria con TTL corto:** no se puede invalidar entre réplicas.
- **Bloquear el borrado de `auth.users` desde la base si no hay evidencia:** protege contra borrados por otros canales, pero obliga a que la evidencia ya exista antes de borrar y complica el borrado en cascada de pruebas y migraciones. Se registra como mitigación opcional en la EIPD (ver "Riesgos"); mientras tanto, el borrado de cuentas **solo** debe pasar por FastAPI (runbook).
- **Archivar y borrar en una sola función de base:** ver arriba.

## Qué debe hacer el equipo

1. Aprobar o ajustar este ADR.
2. Designar quién custodia y rota la clave HMAC, y dónde vive.
3. Fijar el nivel de aislamiento `READ COMMITTED` en la configuración del pool y del ORM de FastAPI, con prueba.
4. Decidir si se implementa ya la función única `authorize_student_use` (recomendado antes de escribir los endpoints de IA).
5. Definir con Legal los plazos pendientes (ver EIPD y `docs/privacy/inventario-datos.md`).
6. Confirmar quién ejecuta los trabajos programados (FastAPI o `pg_cron`).

## Referencias

- `docs/lote-2-propuesta-consentimiento.md` (diseño y diferencias aplicadas)
- `docs/privacy/inventario-datos.md`
- `supabase/tests/concurrency/` (prueba con dos conexiones)
- `docs/privacy/eipd/eipd-borrador.md`
