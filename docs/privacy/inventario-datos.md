# Inventario de datos personales (registro de tratamientos)

Actualizar en cada migración o cambio que agregue, modifique o elimine datos personales.
Estado inicial según el diseño del MVP (Tutor + Alumno + IA con mascota).

| Dato | Titular | Dónde vive | Finalidad | Base de licitud | Conservación | Destinatarios / terceros | País | Categoría |
|---|---|---|---|---|---|---|---|---|
| Correo del tutor | Tutor | Supabase Auth | Crear cuenta, iniciar sesión, avisos | Contrato / consentimiento | Mientras exista la cuenta + plazo definido tras eliminación | Supabase; proveedor de correo | <región> | Común |
| Contraseña (hash) o método de acceso del tutor | Tutor | Supabase Auth | Autenticación | Contrato | Mientras exista la cuenta | Supabase | <región> | Común |
| Registro de consentimiento como eventos (`consents`: `tutor_id`, tipo `grant`/`revoke`, referencia a la versión de términos y de política, canal, fecha-hora UTC fijada por el servidor, orden `seq`) | Tutor y alumnos | PostgreSQL | Acreditar el consentimiento y su retiro; habilitar o bloquear el tratamiento de los perfiles | Obligación legal / consentimiento | Mientras exista la cuenta (se elimina en cascada con ella) | Supabase | <región> | Común |
| Versiones de documentos legales (`legal_document_versions`: tipo, versión, huella SHA-256, vigente) | — (texto público) | PostgreSQL | Probar qué texto exacto se aceptó | Obligación legal | Permanente (catálogo, no son datos personales) | Supabase | <región> | No personal |
| Declaración de adulto responsable por perfil (`students`: aceptación, versión del texto, fecha-hora, `consent_id` con que se creó) | Tutor y alumno | PostgreSQL (`students`) | Acreditar que el perfil lo creó un adulto responsable con consentimiento vigente | Obligación legal / consentimiento | Hasta eliminación del perfil | Supabase | <región> | Menor |
| Bloqueo del perfil (`students.blocked_at`) | Alumno (menor de 14 años) | PostgreSQL (`students`) | Suspender el tratamiento tras revocar el consentimiento | Obligación legal | Hasta desbloqueo manual o eliminación del perfil | Supabase | <región> | Menor |
| Evidencia mínima seudonimizada de consentimiento (`consent_evidence`: id del tutor con HMAC-SHA256, versión de la clave, tipo de evento, versión de términos y de política, canal, fecha-hora, `source_seq`, `retain_until`) | Tutor | PostgreSQL (solo `service_role`) | Acreditar que hubo consentimiento tras borrar la cuenta | Obligación legal / interés legítimo (**validar con Legal**) | **Plazo sin definir (pendiente legal)**: mientras sea nulo no se purga | Supabase | <región> | Común (seudonimizado: sigue siendo dato personal) |
| Apodo del alumno | Alumno (menor de 14 años) | PostgreSQL (`students`) | Personalizar la interacción de la mascota | Consentimiento del tutor | Hasta eliminación del perfil | Supabase | <región> | Menor |
| Curso del alumno (1° a 4° básico) | Alumno (menor de 14 años) | PostgreSQL (`students`) | Adaptar contenido y dificultad | Consentimiento del tutor | Hasta eliminación del perfil | Supabase | <región> | Menor |
| PIN o control parental (hash) | Tutor | PostgreSQL o almacenamiento local seguro | Proteger la zona del tutor | Consentimiento / interés legítimo | Mientras exista la cuenta | Supabase | <región> | Común |
| Progreso y desempeño (aciertos, temas) | Alumno (menor de 14 años) | PostgreSQL | Mostrar progreso al tutor y adaptar ejercicios | Consentimiento del tutor | Definir plazo (p. ej. 12 meses de inactividad) | Supabase | <región> | Menor |
| Prompt a la IA (curso, tema, ejercicio; sin datos personales) | — | FastAPI → proveedor de IA | Generar explicaciones | Consentimiento del tutor | No se almacena / plazo mínimo del proveedor (confirmar) | Proveedor de IA | <país> | No personal si el filtro funciona |
| Logs técnicos (sin contenido ni PII) | — | Infraestructura | Operación y seguridad | Interés legítimo | Plazo corto (definir) | Hosting | <región> | Común |

## Datos que NO se recolectan (decisión de diseño)
Apellidos, fotos, ubicación, fecha de nacimiento, voz, contactos, identificadores publicitarios, correo o teléfono del alumno.

## Decisiones implementadas pendientes de validación legal
Implementadas en el Lote 2 (migraciones `20261012190000`, `…190100` y `…190200`). Lo técnico está hecho; lo que sigue abierto es la validación legal.

| Tema | Qué se implementó | Pendiente |
|---|---|---|
| Evidencia de consentimiento al suprimir la cuenta | Tabla `consent_evidence` sin FK al tutor: versión de términos y de política, fecha-hora UTC, canal, tipo de evento e id del tutor con HMAC-SHA256 (clave fuera de la base, versionada). Archivo idempotente antes de borrar la cuenta. Plazo configurable en `app_settings`. | **Plazo de conservación: SIN DEFINIR (pendiente legal).** Con plazo nulo no se purga nada: `privacy_config_warnings()` emite una alerta que debe resolverse antes del lanzamiento. Base de licitud, efecto en backups y cómo atender un derecho de acceso sobre esta evidencia. |
| Alcance del consentimiento | Híbrido: aceptación a nivel de cuenta de tutor sobre una versión concreta (`legal_document_versions` con huella); cada alumno queda ligado al consentimiento vigente al crearse; declaración de adulto responsable (versión del texto y fecha) al crear cada perfil. Sin consentimiento vigente no se crea ningún alumno (compuerta también para el servidor). | Texto de la declaración y validación legal del esquema híbrido. |
| Cambio de versión de términos | Al cambiar la versión vigente, los tutores no pueden crear perfiles ni usar la IA hasta aceptar la nueva (FastAPI debe comprobarlo). | Confirmar con Legal si los perfiles existentes pueden seguir usables hasta aceptar. |
| Revocación | Evento `revoke` append-only que bloquea todos los perfiles del tutor. Volver a consentir **no** desbloquea: el desbloqueo es manual desde la zona del tutor, vía servidor (`unblock_student`). | Decidir con Legal si corresponde bloqueo o supresión y en qué plazo. |
| Límite de perfiles | Máximo 5 alumnos por tutor (los bloqueados cuentan); configurable solo por el servidor. | Confirmar la cifra con producto. |

## Terceros y transferencias internacionales
| Proveedor | Servicio | País / región | DPA firmado | Garantía de transferencia | No entrena con datos |
|---|---|---|---|---|---|
| Supabase | BD, Auth, Storage | <región> | pendiente | pendiente | n/a |
| Proveedor de IA | Generación de explicaciones | <país> | pendiente | pendiente | pendiente de confirmar |
| Hosting de FastAPI | Cómputo | <región> | pendiente | pendiente | n/a |
| Apple / Google | Distribución de la app | EE. UU. | términos de la tienda | — | n/a |

## Historial de cambios
| Fecha | Cambio | Responsable |
|---|---|---|
| <AAAA-MM-DD> | Versión inicial | |
| 2026-10-12 | Migración `20261012180000_init_tutors_students_consents`: tablas `tutors` (solo `id` = auth.users, sin correo duplicado), `students` (`nickname` ≤30 caracteres, `grade` 1–4; sin otros datos) y `consents` (`tutor_id`, `terms_version`, `privacy_version`, `accepted_at` UTC fijado por el servidor; append-only). RLS activada y forzada con política por tutor; `anon` sin acceso. Nota: `nickname` es texto libre y puede contener un nombre real; la app debe advertirlo al tutor y filtrar PII. `ON DELETE CASCADE` desde el tutor también borra su evidencia de consentimiento: definir plazo de conservación y procedimiento de eliminación antes del lanzamiento. | |
| 2026-10-12 | Endurecimiento de la misma migración (Lote 1 de la revisión): permisos por columna en `students` (el cliente solo escribe `tutor_id`, `nickname`, `grade` al insertar y solo `nickname`, `grade` al actualizar; `id` y `created_at` los fija el servidor); `nickname` debe venir sin espacios al borde; los usuarios anónimos de Auth no generan tutor; se crean tutores para usuarios de Auth ya existentes; se elimina un índice redundante. Sin datos personales nuevos. Se registran como metadatos: `tutors.id`/`created_at` (fecha de alta del tutor), `students.id`/`tutor_id` (vínculo tutor–alumno)/`created_at`. | |
| 2026-10-12 | **Lote 2** (migraciones `20261012190000_consent_gate`, `20261012190100_student_limit`, `20261012190200_consent_evidence`): `consents` pasa a registro de eventos (`grant`/`revoke`) con referencia a versiones, canal y orden; nueva `legal_document_versions` con huella; compuerta de consentimiento para crear alumnos (RLS + trigger, también aplica al servidor); declaración del adulto, `consent_id` y `blocked_at` en `students`; revocación que bloquea perfiles; tope de 5 alumnos por tutor y clave `(id, tutor_id)`; nuevas `consent_evidence` (seudonimizada, sin FK al tutor) y `app_settings` (solo servidor). Se eliminan las columnas de versión en texto libre de `consents`. No se agregan datos del niño: solo metadatos de consentimiento. Plazo de conservación de la evidencia: **sin definir (pendiente legal)**. | |
| 2026-10-12 | **Lote A** (migración `20261012200000_lote_a_hardening`): se frena el flujo de eventos de consentimiento (rechazo de `grant`/`revoke` redundantes, máximo 20 eventos por tutor cada 24 h) para evitar basura que acabaría en la evidencia; las revocaciones deben apuntar a documentos del tipo correcto; el cliente no puede actuar a nombre de otro tutor (`tutor_mismatch`); índices de claves foráneas; permisos sobrantes revocados. Sin datos personales nuevos. | |
