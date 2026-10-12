# Inventario de datos personales (registro de tratamientos)

Actualizar en cada migración o cambio que agregue, modifique o elimine datos personales.
Estado inicial según el diseño del MVP (Tutor + Alumno + IA con mascota).

| Dato | Titular | Dónde vive | Finalidad | Base de licitud | Conservación | Destinatarios / terceros | País | Categoría |
|---|---|---|---|---|---|---|---|---|
| Correo del tutor | Tutor | Supabase Auth | Crear cuenta, iniciar sesión, avisos | Contrato / consentimiento | Mientras exista la cuenta + plazo definido tras eliminación | Supabase; proveedor de correo | <región> | Común |
| Contraseña (hash) o método de acceso del tutor | Tutor | Supabase Auth | Autenticación | Contrato | Mientras exista la cuenta | Supabase | <región> | Común |
| Registro de consentimiento (tutor_id, versión términos, versión política, fecha-hora UTC) | Tutor y alumnos | PostgreSQL | Acreditar el consentimiento | Obligación legal / consentimiento | Mientras dure el tratamiento + plazo de prescripción (definir) | Supabase | <región> | Común |
| Apodo del alumno | Alumno (menor de 14 años) | PostgreSQL (`students`) | Personalizar la interacción de la mascota | Consentimiento del tutor | Hasta eliminación del perfil | Supabase | <región> | Menor |
| Curso del alumno (1° a 4° básico) | Alumno (menor de 14 años) | PostgreSQL (`students`) | Adaptar contenido y dificultad | Consentimiento del tutor | Hasta eliminación del perfil | Supabase | <región> | Menor |
| PIN o control parental (hash) | Tutor | PostgreSQL o almacenamiento local seguro | Proteger la zona del tutor | Consentimiento / interés legítimo | Mientras exista la cuenta | Supabase | <región> | Común |
| Progreso y desempeño (aciertos, temas) | Alumno (menor de 14 años) | PostgreSQL | Mostrar progreso al tutor y adaptar ejercicios | Consentimiento del tutor | Definir plazo (p. ej. 12 meses de inactividad) | Supabase | <región> | Menor |
| Prompt a la IA (curso, tema, ejercicio; sin datos personales) | — | FastAPI → proveedor de IA | Generar explicaciones | Consentimiento del tutor | No se almacena / plazo mínimo del proveedor (confirmar) | Proveedor de IA | <país> | No personal si el filtro funciona |
| Logs técnicos (sin contenido ni PII) | — | Infraestructura | Operación y seguridad | Interés legítimo | Plazo corto (definir) | Hosting | <región> | Común |

## Datos que NO se recolectan (decisión de diseño)
Apellidos, fotos, ubicación, fecha de nacimiento, voz, contactos, identificadores publicitarios, correo o teléfono del alumno.

## Decisiones pendientes de validación legal (diseño acordado, aún no implementado)
| Tema | Decisión de diseño | Pendiente |
|---|---|---|
| Evidencia de consentimiento al suprimir la cuenta | Conservar solo evidencia mínima seudonimizada: versión de términos y de política, fecha-hora UTC, canal e id del tutor hasheado (con sal). Sin FK en cascada hacia el tutor. Hoy, en cambio, `ON DELETE CASCADE` la borra junto con la cuenta. | **Plazo de conservación configurable: definir con Legal.** Base de licitud para conservarla. Procedimiento de purga y efecto en backups. |
| Alcance del consentimiento | Híbrido: aceptación a nivel de cuenta de tutor sobre una versión concreta (tabla de versiones vigentes con hash); cada alumno queda ligado al consentimiento vigente al crearse; declaración de adulto responsable al crear cada perfil. | Texto de la declaración y validación legal del esquema híbrido. |
| Revocación | Evento `revoke` append-only en el registro de consentimiento; dispara bloqueo o supresión de los perfiles de alumnos. | Decidir con Legal si corresponde bloqueo o supresión y en qué plazo. |

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
