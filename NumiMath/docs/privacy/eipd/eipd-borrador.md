# Evaluación de Impacto en Protección de Datos (EIPD) — borrador 0.5

**Apoyo técnico, no asesoría legal.** Debe revisarlo un abogado o el delegado de protección de datos antes de darlo por válido. Enfoque del art. 15 ter de la Ley 21.719 (verificar contra el texto oficial; el texto de la ley y su fecha de vigencia deben confirmarse: ver sección 8).

**Proyecto:** App de matemáticas para niños (1° a 4° básico) con mascota animada e IA tutora · **Versión:** 0.5 (borrador) · **Fecha:** 2026-11-13 (0.3: modo sin conexión, CU-A12; 0.4: sincronización, CU-A13; 0.5: unión con los riesgos del docente R27 a R40; los de modo sin conexión pasan a R41 y R42)
**Responsable del tratamiento:** `<razón social y contacto: pendiente>` · **Contacto de privacidad:** `<correo: pendiente>`
**Basado en:** `docs/privacy/inventario-datos.md`, `docs/adr/0001-contrato-fastapi-consentimiento.md`, `docs/lote-2-propuesta-consentimiento.md` y las migraciones de `supabase/`.

---

## Resumen para quien no es experto

- **Qué es la app:** una tutora de matemáticas con mascota para niños de 6 a 10 años. Los niños **no tienen cuenta**: solo los adultos (tutor, docente y administrador) tienen cuenta. El tutor crea perfiles con **apodo y curso**; si lo decide, vincula a un docente, que pasa a ser un **tercero que ve datos del niño** (apodo, curso, progreso, historial y las hojas del papel que el niño guarda).
- **Por qué esta evaluación:** se tratan datos de **menores de 14 años** y una **IA** adapta la dificultad. Eso la hace una evaluación recomendada (la obligatoriedad la confirma un abogado).
- **Lo que ya está resuelto técnicamente:** del niño se guarda apodo y curso, más sus intentos de práctica, su progreso y (más adelante, solo con docente vinculado) las hojas del papel; sin consentimiento vigente no se puede crear ni usar un perfil; el consentimiento se puede retirar y bloquea los perfiles; un perfil se puede bloquear por separado; se guarda evidencia mínima y seudonimizada; hay plazos configurables, purgas programadas y alertas; todo está cubierto por 316 pruebas automáticas y una prueba de concurrencia.
- **Lo que falta:** los plazos legales de conservación, los acuerdos con proveedores (Supabase, IA, hosting), la región donde viven los datos, el filtro de la IA y los endpoints de FastAPI (aún no existen), la exportación de datos (portabilidad) y la validación legal.
- **Riesgo residual global (evaluación preliminar):** **medio**, hasta que se cierren los pendientes de la sección 8. Con los pendientes cerrados se estima **bajo a medio**.

---

## 1. Descripción del tratamiento

### 1.1 Qué hace y quién participa
| Actor | Rol | Datos |
|---|---|---|
| **Tutor** (adulto) | Con cuenta (Supabase Auth), igual que el docente y el administrador; el niño nunca tiene cuenta. Acepta términos y política, crea perfiles, ve el progreso, revoca, corrige o borra. | Correo y método de acceso (en Auth), identificador, consentimientos. |
| **Docente** (adulto) | Cuenta creada por el administrador. Ve **solo** a los niños que el tutor le vinculó: apodo, curso, progreso e historial; nunca la identidad del tutor. **Es un tercero** que recibe datos de menores. | Nombre, correo (en Auth) y código de vínculo. |
| **Administrador** (adulto) | Crea, edita y elimina cuentas de docentes. No ve datos de niños. | Correo (en Auth). |
| **Alumno** (6–10 años) | No tiene cuenta ni credenciales. Es un perfil dependiente del tutor. | Solo **apodo y curso**. |
| **Mascota / IA tutora** | Explica ejercicios. Corre en el servidor (FastAPI) llamando a un proveedor de IA. | El prompt lleva solo curso, tema y ejercicio. |

### 1.2 Datos tratados
Detalle completo y vigente en `docs/privacy/inventario-datos.md`. Resumen:

| Dato | Titular | Dónde | Observación |
|---|---|---|---|
| Correo y acceso del tutor | Tutor | Supabase Auth | Contrato. |
| Registro de consentimiento (eventos `grant`/`revoke`, versiones, canal, fecha-hora UTC) | Tutor | PostgreSQL | Versionado, con huella del texto aceptado. |
| Apodo y curso | Alumno | PostgreSQL (`students`) | **Apodo es texto libre**: puede contener un nombre real (riesgo R8). |
| Declaración del adulto, vínculo con el consentimiento, bloqueo | Tutor / Alumno | PostgreSQL | Metadatos del tratamiento. |
| Historial de bloqueos y desbloqueos | Tutor / Alumno | PostgreSQL | Se borra con el perfil. |
| Evidencia seudonimizada (HMAC del id y del correo, versiones, huellas, canal, fecha) | Tutor | PostgreSQL, solo servidor | Sobrevive al borrado de la cuenta. **Sigue siendo dato personal.** |
| Declaración del adulto archivada (versión, huella, fecha; sin datos del niño) | Tutor | PostgreSQL, solo servidor | Se crea al borrar un perfil. |
| Cuenta del docente (nombre, código de vínculo; correo en Auth) | Docente | PostgreSQL (`teachers`) y Auth | La crea el administrador. Base de licitud por confirmar. |
| Vínculo docente–alumno (fecha de aceptación, versión de términos, nombre del docente mostrado) | Tutor / Alumno | PostgreSQL (`teacher_links`) | **Es la autorización.** Se borra al quitarlo, revocar o borrar perfil o cuenta; no queda archivo (pendiente). |
| Lectura del docente (apodo, curso, progreso, historial sin el texto de las tareas del tutor) | Alumno | FastAPI vía `teacher_can_view` | Comunicación de datos de un menor a un **tercero**. |
| Hoja del papel para calcular (trazos vectoriales, habilidad, enunciado si lo generó la app, respuesta del niño y correcta, si acertó, fecha) | Alumno | Seguimiento pedagógico del docente vinculado (consentimiento del tutor mediante el vínculo) | Solo con docente vinculado cuyo texto de autorización describe las hojas (prov-5 o posterior); 90 días máximo (provisional, sin confirmar por Legal); ver `hojas-guardadas-justificacion.md`. |
| Prompt a la IA (curso, tema, ejercicio) | — | FastAPI → proveedor de IA | Sin datos personales si el filtro funciona. |
| Logs técnicos | — | Infraestructura | Sin contenido ni datos personales (regla de diseño). |
| **Modo sin conexión (CU-A12):** copia de apodo y curso, lote de ejercicios, cola de intentos con las respuestas del niño, id del tutor dueño | Alumno / Tutor | **Dispositivo del tutor (IndexedDB), sin cifrar** | Primera vez que hay datos del niño fuera de la base. Al volver la red, la cola se envía dispositivo → FastAPI → Supabase (CU-A13; nunca a la IA) y queda en `student_attempts`. Plazos: copia 7 días, lote 7, cola hasta ~21; vencidos dejan de usarse y se borran la próxima vez que se abre la app o vuelve a primer plano (riesgos R41 y R42; ADR 0002). |

**No se recolectan:** apellidos, fotos, ubicación, fecha de nacimiento, voz, contactos, identificadores publicitarios, correo o teléfono del alumno. No hay SDK de publicidad ni de analítica de terceros.

### 1.3 Flujo
```
App (Ionic)  ──JWT──►  Supabase (Auth, PostgreSQL con RLS por tutor)
     │                         ▲
     └──────────►  FastAPI  ───┘   (service_role; comprobaciones del ADR 0001)
                      │
                      └──► Proveedor de IA   (solo curso, tema y ejercicio)

Docente ──JWT (rol teacher)──► FastAPI ──► teacher_can_view ──► apodo, curso, progreso, historial
   (solo con vínculo activo hecho por el tutor; nunca la identidad del tutor)
```
La app **nunca** llama a la IA directamente; las claves viven solo en variables de entorno del servidor.

### 1.4 Volumen y frecuencia
`<pendiente de estimación de producto>`: número de tutores, perfiles por tutor (máximo 5) y uso diario por perfil (límites por perfil/día y tope de costo por tutor).

---

## 2. Finalidad y base de licitud

- **Finalidad:** apoyo al aprendizaje de matemáticas con explicaciones adaptadas a la edad. No hay publicidad, ranking público ni contacto entre niños.
- **Base de licitud:** consentimiento del tutor para el tratamiento de datos de menores de 14 años.
- **Cómo se obtiene:** el tutor acepta explícitamente la versión vigente de los términos y de la política; se guarda quién, qué versión (con huella del texto), canal y fecha-hora UTC.
- **Cómo se prueba:** registro de eventos append-only (`consents`); al borrar la cuenta se conserva evidencia mínima seudonimizada, inmutable, con el HMAC del correo para poder localizarla ante un reclamo.
- **Cómo se revoca:** un evento `revoke` que **bloquea todos los perfiles** del tutor en la misma transacción. Volver a consentir **no** reactiva los perfiles: se desbloquean a mano desde la zona protegida del tutor.
- **Adulto responsable:** al crear cada perfil el tutor declara ser el adulto responsable; queda registrada la versión del texto y la fecha.
- **Cambio de versión:** si cambia la versión de los términos o de la política, no se pueden crear perfiles ni usar la IA hasta aceptar la nueva.
- **Base de la conservación de la evidencia tras borrar la cuenta:** obligación legal / interés legítimo de acreditar el consentimiento (**a validar por Legal**).

## 3. Necesidad y proporcionalidad

| Dato | Por qué es necesario | Alternativa menos intrusiva considerada |
|---|---|---|
| Apodo | Personalizar la interacción de la mascota. | Elegir de una lista de apodos o avatares (reduce el riesgo R8). **Recomendado evaluar.** |
| Curso | Adaptar contenido y dificultad. | — |
| Evidencia seudonimizada tras borrar la cuenta | Acreditar el consentimiento (la carga de la prueba es del responsable). | No conservar nada y entregar solo un comprobante al tutor: menos datos, pero depende de que el tutor lo guarde. **Se eligió conservar**, por lo que es el punto de mayor atención legal. |
| HMAC del correo en la evidencia | Poder localizar la evidencia si la persona reclama tras borrar la cuenta. | Guardar solo el HMAC del id (el titular no lo conoce). **Se eligió añadir el del correo**; justificarlo es una pregunta legal abierta. |
| Metadatos de bloqueo y declaración | Acreditar que el tratamiento se suspendió y que un adulto responsable creó el perfil. | — |

**Plazos de conservación (estado actual):**

| Dato | Plazo | Estado |
|---|---|---|
| Perfil del alumno y su historial de bloqueos | Hasta que el tutor lo borre | Definido |
| Perfil **bloqueado por revocación** | Máximo **30 días** y luego se suprime automáticamente (con aviso previo al tutor, a cargo de FastAPI) | **Provisional, pendiente legal** (alerta activa) |
| Perfil **bloqueado a petición del tutor o por un reclamo** | No se suprime automáticamente; se mantiene hasta que se desbloquee o se borre | Pendiente: cuánto puede durar un bloqueo por reclamo |
| Perfil **inactivo** (sin uso) | **12 meses** y luego se suprime (con aviso previo); las cuentas sin inicio de sesión ni uso se listan para borrarlas con el flujo del ADR 0001 | **Provisional, pendiente legal** (alerta activa) |
| Registro de altas de perfiles (`student_creation_log`) | 24 horas | Definido |
| Consentimientos "vivos" | Mientras exista la cuenta (se borran en cascada) | Definido |
| Evidencia seudonimizada y declaración archivada | **Sin definir**: no se purga nada mientras sea nulo | **Pendiente legal** (alerta activa; se calcula al purgar, aplica a lo ya archivado) |
| Progreso y desempeño (futuro) | `<12 meses de inactividad: propuesta>` | Sin implementar |
| Logs técnicos | `<corto: pendiente>` | Sin implementar |
| Backups | `<plazo de retención del proveedor: pendiente>` | Sin definir; afecta la efectividad de la supresión |

---

## 4. Riesgos para los titulares

Escala: Probabilidad e Impacto = Baja / Media / Alta. **Evaluación preliminar del equipo técnico, a validar.**

| # | Riesgo | Prob. | Impacto | Medidas de mitigación (existentes) | Medidas pendientes | Residual |
|---|---|---|---|---|---|---|
| R1 | **Exposición de datos de menores** por falla de RLS, brecha o mal uso de `service_role`. | Baja | Alta | RLS activada y forzada en todas las tablas; permisos por columna; mínimo privilegio; funciones sensibles solo para `service_role`; 231 pruebas pgTAP; revisiones de seguridad por lote. | Comprobaciones de FastAPI (ADR 0001); pruebas de integración de la API; cifrado en reposo y gestión de secretos verificados en el proveedor. | Medio |
| R2 | **Envío de datos personales a la IA** (el niño escribe su nombre u otro dato). | Media | Alta | El prompt lleva solo curso, tema y ejercicio; filtro de PII previo (regla de diseño). | **Filtro de PII, filtro de salida y pruebas** (aún no implementados en `api/`). | Medio hasta implementarlo |
| R3 | **Respuesta inadecuada de la IA** (contenido, tono, pedir datos al niño). | Media | Alta | Prompt estricto y validación de salida (regla de diseño). | Implementar y probar filtros; revisión con `child-safety-ai-reviewer`; canal de reporte. | Medio |
| R4 | **Perfilamiento o manipulación** del niño por la adaptación de dificultad. | Baja | Media | Sin publicidad ni analítica de terceros; sin ranking público; sin contacto entre niños. | Definir que la adaptación no excluye ni sanciona (art. 8 bis, verificar); explicación al tutor; sin patrones de diseño engañosos. | Bajo |
| R5 | **Transferencia internacional sin garantías.** | Media | Media | — | Fijar región de Supabase y hosting (ADR); DPA y cláusulas con Supabase, proveedor de IA y hosting; confirmar que no entrenan con los datos. | Medio (hoy, sin acuerdos) |
| R6 | **Retención excesiva** (evidencia sin plazo, bloqueados, inactivos, backups). | Alta (hoy) | Media | Plazos configurables, calculados al purgar; **purgas programadas con `pg_cron`**; alertas `privacy_config_warnings()` y `privacy_job_warnings()` que deben bloquear el despliegue y vigilar los trabajos; plazo de inactividad de 12 meses (provisional). | **Plazos definidos por Legal**; avisos a tutores (FastAPI); política de backups y registro de supresiones que se reaplique tras restaurar. | Medio hasta cerrar plazos |
| R7 | **Reidentificación de la evidencia seudonimizada** (cruce de fechas, canal y orden con backups, logs o Auth; o filtración de la clave HMAC). | Baja | Media | HMAC con clave fuera de la base; tabla accesible solo por el servidor; inmutable; sin datos del niño. | Gestión y rotación de la clave HMAC (custodio); reducir precisión de fechas si Legal lo recomienda; tratarla como dato personal en backups. | Bajo a medio |
| R8 | **Apodo con datos personales** (nombre real, teléfono). | Media | Media | Longitud máxima de 30; advertencia pendiente en la UI. | Elegir de lista o validar en API (rechazar `@`, secuencias de dígitos); excluirlo del prompt y de los logs. | Medio |
| R9 | **Pérdida de la evidencia** si se borra una cuenta por un canal distinto de FastAPI (panel, Admin API). | Media | Media | El runbook exige borrar solo vía FastAPI; flujo idempotente en el ADR. Decisión actual: **no impedirlo en la base por ahora**. | **Pendiente antes de lanzar:** reevaluar un trigger que exija evidencia archivada o una alerta de integración. | Medio |
| R10 | **Un niño accede a la zona del tutor** y cambia consentimientos o borra datos. | Media | Alta | Zona protegida con control parental (PIN o pregunta de adulto); desbloqueo solo por servidor. | Implementar y probar el control parental con límite de intentos, verificado en servidor. | Medio hasta implementarlo |
| R11 | **Uso de la IA tras una revocación** (stream en curso, caché). | Baja | Alta | Compuerta en la base; reglas de ADR (sin caché en memoria, re-chequeo ≤ 10 s en streams, fallar cerrado). | Implementarlo y probarlo en FastAPI. | Bajo tras implementar |
| R12 | **Abuso del sistema de consentimiento y de perfiles** (inundar eventos, crear y borrar perfiles en bucle, bloquear a otros tutores). | Media | Baja | Máximo 10 aceptaciones por tutor/24 h (las revocaciones nunca se limitan); eventos redundantes rechazados; máximo 10 altas de perfiles por tutor/24 h, contando los borrados; el cliente no puede actuar a nombre de otro. | Límite de frecuencia por IP/usuario en la API; cuota de IA por tutor además de por perfil. | Bajo |
| R13 | **Incidente de seguridad no detectado o mal gestionado.** | Baja | Alta | Sin datos personales en logs. | **Runbook de incidentes**, criterio de notificación a la Agencia y a los titulares, restauración de backups probada. | Medio (sin runbook) |
| R14 | **Acceso a los datos del niño por compromiso del correo del tutor** (quien lea el correo puede usar el enlace de recuperación y cambiar la contraseña). | Baja | Alta | Enlace de 30 minutos y un solo uso; el código se canjea solo al pulsar un botón (un escáner de correo no lo gasta); la sesión de recuperación no abre el panel hasta cambiar la contraseña; al cambiarla se cierran todas las sesiones y se avisa por correo. | Verificación adicional con el PIN del tutor o doble factor; revisar con Legal si basta. | Baja |
| R15 | **Enumeración de cuentas** de tutores (en una app infantil, saber qué adultos tienen cuenta). | Media | Baja | La app muestra siempre el mismo mensaje; una prueba documenta la limitación de Supabase (429 solo para correos con cuenta). | Captcha de Supabase o proxy por la API con límite por IP antes de publicar. | Media |
| R16 | **Proveedor de correo como nuevo encargado** (transferencia internacional probable, registros de envío). | Media | Media | En local no sale ningún correo (Mailpit). | Elegir proveedor, DPA, retención, sin seguimiento de clics; ver `pendientes-legales.md`, 25. | Media |
| R17 | **Revocación irreversible**: borrar la cuenta revoca el consentimiento y bloquea los perfiles antes de borrar; si el proceso se corta, quedan bloqueados sin datos borrados. | Baja | Media | Bloqueo corto de Auth (15 min) que vence solo, mensaje honesto y reintento seguro. |
| R18 | **Purga de auditoría de Auth sin reintento propio**: si falla, quedan filas con id o correo. | Baja | Media | Se purga por id y por correo, también al reintentar sobre una cuenta ya borrada; no probado en Supabase alojado. |
| R19 | **Copias fuera de nuestro control**: respaldos, registros de la plataforma y correos ya enviados. | Media | Media | Informado al tutor en pantalla; plazos del proveedor pendientes (pendientes-legales 26). |
| R20 | **Reidentificación por la evidencia conservada** (seudónimo HMAC del tutor; ya no hay huella del correo). | Baja | Media | Clave solo del servidor; sin id ni correo en claro ni huella del correo; plazo de 5 años provisional con purga diaria (pendientes-legales, 27). |
| R21 | **Borrado autorizado solo con confirmación fuerte** (contraseña escrita hace menos de 5 minutos; el PIN no vale porque un niño podría conocerlo). | Baja | Alta | Palabra ELIMINAR obligatoria y contraseña reciente exigida por el servidor. |
| R22 | **Datos del niño siguen guardados tras revocar** (bloqueados hasta el plazo de 30 días) y el tutor cree que ya se borraron. | Media | Media | La pantalla de revocación y la constancia dicen que NO se borran al instante, con la fecha exacta de borrado y cómo borrarlos antes (pendientes-legales 10 y 28). |
| R23 | **Revocación hecha por un niño que conoce el PIN**, o por error. | Baja | Media | Exige PIN, explicación previa y confirmación explícita. Los perfiles no se reactivan solos al volver a aceptar: decisión pendiente (28). |
| R24 | **Perfiles bloqueados antes por otro motivo no se purgan al revocar** y quedan guardados sin plazo ni consentimiento. | Baja | Media | Hoy no hay ruta de la app que bloquee por `tutor_request` o `arcop_claim`; decisión legal pendiente (28.5). |
| R25 | **Para borrar un solo perfil tras revocar hay que eliminar la cuenta entera** (la interfaz no lo ofrece sin consentimiento). | Media | Media | El texto lo dice con veracidad; la API sí lo permite. Pendiente (28.6). |
| R26 | **Constancia falsificable o visible en la dirección** (`?revocado=…`). | Baja | Baja | Solo muestra un aviso; plazo absurdo ignorado; no identifica al niño. Mejorar con una consulta al servidor. |
| R27 | **Un tercero (el docente) ve datos de menores.** La autorización es el vínculo que el tutor crea con un aviso de confirmación (T25); no hay casillas aparte. | Media | Alta | El docente solo accede por `teacher_can_view` (vínculo activo + consentimiento no revocado + perfil no bloqueado + rol verificado); sin `select` directo a tablas de niños; solo apodo, curso, progreso e historial; nunca la identidad del tutor; el tutor lo quita al instante; revocar borra todos los vínculos; se guarda `accepted_at` y `terms_version`. | Términos y política con la cláusula del docente; aviso claro al tutor; procedimiento si un docente abusa. | Medio |
| R28 | **Vínculo por engaño o por adivinar el código** (el código solo identifica al docente). | Baja | Alta | El acceso lo da el tutor al confirmar viendo el nombre del docente; límite de intentos; el código no da acceso por sí solo. | **Hecho:** PIN recién verificado en cada vínculo, límite de 5 fallos y 15 minutos por tutor, respuesta igual para códigos inexistentes, token de confirmación ligado al docente mostrado. Falta la rotación del código y la verificación de identidad del docente (R32). | Bajo |
| R29 | **Cuenta de docente comprometida** (contraseña débil o robada). | Media | Alta | Cuenta creada por el administrador con contraseña inicial mostrada una sola vez; el rol se verifica en cada llamada; quitar el rol corta el acceso; sin contraseñas ni correos en logs. | Cambio obligatorio de contraseña al primer ingreso (por decidir); recuperación por correo. | Medio |
| R31 | **Cuenta de administrador comprometida, o credenciales de un docente mal entregadas.** El administrador crea cuentas de adultos y ve el correo y el código de cada docente (no datos de niños). | Baja | Alta | La cuenta de administrador la crea la empresa fuera de la app; el rol viene de `app_metadata` (el usuario no lo puede cambiar); cada alta, edición y baja queda en `admin_audit` (quién, qué, cuándo, sin datos personales); la contraseña inicial se muestra una sola vez y no se guarda ni se registra; el administrador no ve datos de niños. | Cambio obligatorio de contraseña del docente al primer ingreso (o invitación de un solo uso); canal de entrega definido por escrito; función de purga de `admin_audit` (hoy imposible) y plazo; segundo factor para el administrador (por decidir). | Bajo a medio |
| R32 | **La identidad del docente no se verifica.** El correo se marca confirmado al crear la cuenta y el tutor autoriza el acceso viendo solo un nombre que escribió el administrador: un correo mal escrito o una persona suplantada podría vincularse a menores (interés superior del niño, Ley 21.430). | Baja | Alta | El acceso lo da el tutor al confirmar viendo el nombre; límite de intentos con el código; el administrador crea las cuentas y queda registrado. | Procedimiento de verificación del docente antes de crear la cuenta; confirmación del correo; evaluar verificación de idoneidad para trabajar con menores. | Medio |
| R33 | **Una cuenta de docente con vínculos vigentes pasa a otra persona.** El administrador puede cambiar nombre y correo (el correo rige de inmediato) y los vínculos se conservan: el tutor autorizó a "nombre X" y no se entera del cambio; con un administrador comprometido (R31) y "recuperar contraseña" alguien podría quedarse con la cuenta. | Baja | Alta | Cada edición queda en `admin_audit`; el administrador no ve datos de niños; el docente solo accede por `teacher_can_view`. | Cerrar las sesiones del docente al cambiar el correo y avisar al correo anterior; suspender los vínculos o avisar a los tutores al cambiar nombre o correo (antes de vincular, T24 a T26); mostrar en T26 el nombre vigente frente al autorizado. | Medio |
| R34 | **Datos que persisten tras eliminar a un docente:** su id en `admin_audit` (sin purga posible), los registros de auditoría de Supabase Auth (correo, IP, fecha) y los respaldos. | Media | Media | El borrado en Auth es real; `admin_audit` guarda solo ids. | Función de purga y plazo de `admin_audit`; confirmar con Supabase la retención de `auth.audit_log_entries` y de los respaldos. | Medio |
| R35 | **Un vínculo sigue vigente con una versión antigua del texto de autorización**: `teacher_can_view` no mira la versión; si el texto cambia y amplía lo que ve el docente, los vínculos existentes siguen dando acceso. | Baja | Media | El vínculo guarda la versión aceptada; el texto es un anexo aparte. | Decidir si se suspende o reconfirma el vínculo al cambiar la versión (con prueba pgTAP). | Medio |
| R36 | **Se pierde la evidencia de la autorización al quitar o borrar un vínculo** (fecha, versión y nombre mostrado se borran con él; no hay archivo, a diferencia de `consent_evidence`). | Media | Media | El borrado es real y el vínculo no guarda datos del niño. | Archivar el alta y la baja del vínculo, sin datos del niño, con el patrón de `consent_evidence` (tutor con HMAC, versión, huella, fecha, evento). | Medio |
| R37 | **El docente podría ver el historial o las hojas anteriores al vínculo.** | Baja | Alta | **Implementado para el historial (D7):** el progreso por habilidad (estado actual) se ve completo; el historial de ejercicios solo desde `accepted_at` del vínculo vigente, con fecha sin hora, sin duración y sin el texto de las tareas del tutor; sin acceso, siempre el mismo 404; pruebas pgTAP y de integración. El texto de autorización (v4) lo dice, y también que el progreso (estado actual) incluye lo previo al vínculo y el nivel de entrada del diagnóstico. | **Implementado también para las hojas (D8):** solo las guardadas desde `accepted_at`, y solo si el vínculo tiene un texto de autorización que las describe (`covers_sheets`, prov-5 o posterior; R35 solo para hojas, con pruebas pgTAP). Caso borde aceptado: las hojas no están ligadas a un docente concreto; con dos docentes vinculados a la vez, cada uno ve lo guardado desde su propio vínculo. | Bajo |
| R38 | **No hay trazabilidad de las lecturas del docente**: no queda registro de qué docente vio qué niño y cuándo (ni del alta y baja del vínculo, R36); el tutor no puede saber quién vio a su hijo y la empresa no puede demostrarlo ante un reclamo. | Media | Alta | Hoy las lecturas pasan siempre por `teacher_can_view`, son solo lectura y no entregan datos de más. | Decidir un registro mínimo de solo anexar (docente, perfil, recurso y día, sin contenido; lectura para el tutor dueño; purga programada) y mostrarle al tutor "Docentes que vieron el perfil". | Medio hasta decidirlo |
| R39 | **Lo que el docente ya vio persiste tras quitar el vínculo** (notas, capturas de pantalla, memoria). No hay remedio técnico. | Alta | Media | El texto de autorización (v4) lo dice expresamente. | Términos del docente con compromiso de confidencialidad y de no conservar copias; qué hacer si un docente abusa. | Medio |
| R40 | **El docente usa los datos fuera de la finalidad pedagógica** (calificar, clasificar o comparar al niño). | Baja | Alta | El texto limita la finalidad; el docente solo ve lo mínimo (día, nivel, enunciado generado por la app). | Términos del docente aceptados y versionados, y que `teacher_can_view` exija haberlos aceptado; procedimiento ante abuso. | Medio |
| R30 | **Hojas guardadas con datos personales** (el niño puede escribir algo identificable en el papel). | Media | Media | Solo se guardan con vínculo activo (sola al responder o con "Guardar el papel"), como trazos vectoriales con tope de tamaño, sin imágenes ni metadatos; el docente solo ve las guardadas desde su vínculo; las hojas pertenecen al niño: quitar el vínculo o eliminar al docente no las borra (solo dejan de verse para ese docente); se eliminan al revocar el consentimiento o al borrar el perfil o la cuenta (probado, T20 y T21) y a los 90 días (purga diaria). Justificación en `hojas-guardadas-justificacion.md`. | **Plazo de 90 días provisional, sin confirmar por Legal** (`sheet_retention_confirmed` = false); **T27** (el tutor ve y elimina hojas) y el aviso al niño en lenguaje simple siguen pendientes. | Medio |
| R41 | **Datos del niño sin cifrar en el dispositivo** (modo sin conexión): apodo, curso y respuestas quedan en IndexedDB; en un equipo compartido, quien lo use sin cerrar sesión puede verlos. | Media | Media | Decisión 6 del ADR 0002 (sin cifrado: datos mínimos y vida corta). Solo apodo, curso y respuestas numéricas; nada va a la IA. Plazos: copia de perfiles 7 días, lote 7, cola hasta ~21; vencidos dejan de usarse y se borran la próxima vez que se abre la app o vuelve a primer plano (no se puede borrar si la app no se abre). Se borra al cerrar sesión, al revocar, si la sesión termina sin cerrar sesión (`SIGNED_OUT`), si entra otro tutor, al borrar o pausar un perfil y ante un 403. "Cerrar sesión" no se ofrece sin red para no perder intentos. `storage.persist()` solo en la web y desde el panel del tutor. | Política `privacidad-prov-2` (cambio aparte). Evaluar cifrado si Legal lo pide (pendientes-legales, 29). | Medio |
| R42 | **Excepción a la revocación sin red**: si el tutor revoca o pausa desde otro equipo, un dispositivo **sin conexión** sigue permitiendo practicar con su lote hasta conectarse (máx. 7 días). | Media | Media | Decisión 8 del ADR 0002, aceptada **para esta etapa** y **pendiente de revisión por Adolfo y `privacy-cl-auditor`**. Al conectarse, el dispositivo lo detecta (consentimiento `missing` o 403) y borra todo; la copia deja de usarse a los 7 días aunque nunca se conecte y se borra la próxima vez que se abre la app. La pantalla de revocación lo avisa ("en un equipo sin internet, el borrado ocurre al conectarse"). Lo que se practicó no cuenta hasta que el servidor lo acepte: CU-A13 (implementado, con pruebas) responde 403 a perfiles bloqueados o sin consentimiento y el dispositivo borra lo suyo. | Validar con Legal (pendientes-legales, 29). Política `privacidad-prov-2` (cambio aparte). | Medio |

---

## 5. Medidas de seguridad y organizativas

**Implementadas (verificadas por pruebas automáticas):**
- RLS por tutor activada y forzada en todas las tablas, con permisos por columna y mínimo privilegio; `anon` sin acceso.
- Compuerta de consentimiento y tope de alumnos aplicados también al servidor (triggers).
- Evidencia, textos legales publicados y consentimientos inmutables; historial de bloqueos append-only.
- Funciones sensibles `SECURITY DEFINER` con `search_path` fijo, ejecutables solo por `service_role`.
- Límites de frecuencia en eventos de consentimiento y en altas de perfiles; mensajes de error sin datos personales.
- Evidencia, textos legales y consentimientos inmutables también frente a `service_role` (TRUNCATE bloqueado, borrado solo por cascada o por las funciones de purga).
- Purgas programadas con `pg_cron` y alertas de configuración y de trabajos.
- Prueba de concurrencia con dos conexiones sobre el tope de perfiles y la carrera alta/revocación.
- Revisión de código, seguridad, privacidad y escalabilidad en cada lote.

**Pendientes (no implementadas todavía):**
- Cifrado en reposo y en tránsito verificado con los proveedores (TLS); gestión de secretos y clave HMAC.
- Control parental, filtros de PII y de salida de la IA, endpoints de FastAPI y sus pruebas.
- Trabajos programados (purgas y avisos), runbook de borrado de cuenta y de incidentes, restauración de backups probada.
- Capacitación y responsables: `<pendiente>`.
- Revisión de proveedores y DPA.

**Modo sin conexión (CU-A12, implementadas con pruebas):** copia local ligada al tutor y con
vencimiento de 7 días; borrado ante `SIGNED_OUT`, cambio de tutor, revocación detectada con red y
403; perfil en pausa no se abre sin red ni por dirección directa; el service worker no guarda
respuestas de la API (sin `dataGroups`) y solo se registra en la web.

**Sincronización (CU-A13, implementadas con pruebas):** el servidor vuelve a corregir con el token
(ignora lo que diga el dispositivo sobre si acertó, el nivel o el tema); el token va ligado al
perfil; margen de 14 días tras su caducidad; la respuesta escrita no se guarda; hora y duración del
dispositivo acotadas a la vida del token (tope 600 s); un endpoint por perfil con consentimiento
vigente; reenviar no duplica nada. **Riesgo bajo de exactitud:** hora y duración de esos intentos
vienen de un reloj que se puede manipular (acotadas; pregunta en pendientes-legales, 29).

## 6. Derechos del titular (ejercidos por el tutor)

Plazos de referencia a verificar con el texto vigente: respuesta en 30 días corridos (prorrogable una vez), bloqueo temporal en 2 días hábiles; rectificación, supresión y oposición gratuitas.

| Derecho | Cómo se ejerce hoy | Brecha |
|---|---|---|
| **Acceso** | El tutor ve sus perfiles, sus consentimientos y el historial de bloqueos. Tras borrar la cuenta, acredita su correo y FastAPI localiza la evidencia por el HMAC del correo. | Falta el endpoint y el procedimiento documentado. |
| **Rectificación** | Puede corregir apodo y curso, **también con el perfil bloqueado**. | — |
| **Supresión** | Borra un perfil o la cuenta; el borrado de cuenta sigue el orden del ADR 0001. Se archiva solo evidencia mínima. | Plazos de la evidencia y de los backups sin definir; borrado selectivo de evidencia no implementado (solo por vencimiento). |
| **Oposición / bloqueo** | La revocación bloquea **todos** los perfiles del tutor, y un perfil se puede bloquear por separado (`tutor_request` o `arcop_claim`) vía servidor tras el control parental. Los bloqueados por reclamo no se purgan automáticamente. | Falta el endpoint y definir cuánto puede durar un bloqueo por reclamo (plazo de bloqueo temporal en 2 días hábiles: verificar). |
| **Portabilidad** | — | **No implementada** (exportación JSON/CSV a cargo de FastAPI). |
| **Decisiones automatizadas** | La adaptación de dificultad no excluye ni sanciona. | Explicación e intervención humana: a definir (art. 8 bis, verificar). |

## 7. Consulta y aprobación

| | |
|---|---|
| Personas consultadas | `<tutores de prueba, asesor legal, delegado de protección de datos: pendiente>` |
| Conclusión | **Borrador técnico sin validación legal.** |
| Aprobación | `<pendiente>` |
| Fecha de revisión | Al cerrar los pendientes de la sección 8 y antes de cualquier lanzamiento; después, anual o ante cambios del tratamiento. |

---

## 8. Pendientes y supuestos

### 8.1 Decisiones que necesitan al abogado
1. **Conservación de la evidencia tras borrar la cuenta:** ¿procede?, ¿con qué base de licitud y por cuánto tiempo?
2. **HMAC del correo:** ¿se justifica frente a la minimización?; ¿se considera dato personal seudonimizado? ¿Cómo se atiende un derecho de acceso sobre esa evidencia?
3. **Perfiles bloqueados:** plazo máximo (hoy 30 días provisionales), si corresponde bloquear o suprimir al revocar, y si debe avisarse al tutor antes de la purga.
4. **Alcance del consentimiento:** ¿basta uno por cuenta con la declaración del adulto por perfil, o se exige uno específico por niño y por finalidad (datos del menor, uso de IA)?
5. **Declaración del adulto:** texto y nivel de verificación exigido; si debe repetirse al reactivar un perfil.
6. **Cambio de versión:** ¿bloquear el servicio hasta re-aceptar o permitir seguir mientras no cambie la finalidad?
7. **Decisiones automatizadas:** ¿la adaptación de dificultad es perfilamiento con efectos significativos?
8. **Backups:** plazo aceptable para que la supresión sea efectiva.
9. **Transferencias internacionales:** garantías exigidas para Supabase, el proveedor de IA y el hosting según región.
10. **Vigencia:** estado del proyecto que propone postergar la Ley 21.719 al 1-dic-2027 y normas aplicables mientras tanto (Ley 19.628, Ley 21.430).
11. **Seudonimización y clave:** si destruir una versión de la clave HMAC equivale a anonimizar y qué política de claves se espera.

### 8.1 bis Preguntas para Legal sobre docentes y hojas
1. ¿El docente es un **tercero receptor** (responsable independiente) o un **encargado** de un colegio? Cambia contratos y la base de licitud de su cuenta.
2. ¿Basta el consentimiento del tutor en el aviso del vínculo, o hace falta un consentimiento separado con versión y huella propias? ¿Va en un anexo versionado aparte o en la versión global?
3. Plazo máximo de conservación de las hojas y de los vínculos (¿un año escolar?); resguardos adicionales por ser texto libre de un menor (Ley 21.430).
4. Evidencia que debe quedar al quitar un vínculo y si el derecho de acceso del tutor incluye saber qué docentes accedieron y cuándo.
5. ¿Hay que avisar al tutor cuando el administrador cambia el nombre o el correo de un docente vinculado, o cuando se guarda una hoja?
6. ¿Cuál es la base de licitud de la cuenta del docente y de `admin_audit` mientras rija la Ley 19.628, y con quién es el "contrato"? ¿Cuánto tiempo se conserva `admin_audit` y el id de un docente eliminado?
7. ¿Qué hay que informarle al docente al crearle la cuenta, cuándo (antes o en su primer ingreso) y si debe aceptar términos con versión?
8. ¿Es aceptable que la empresa elija y conozca la contraseña inicial y la entregue por un canal externo, o se exige invitación de un solo uso o cambio obligatorio? ¿Hay que verificar la identidad e idoneidad del docente antes de que pueda vincularse a niños?

### 8.2 Decisiones técnicas y de producto abiertas
- Región de Supabase y del hosting (ADR pendiente); proveedor de IA y su configuración de no retención.
- Custodia y rotación de la clave HMAC.
- Apodo: lista cerrada o texto libre con validación.
- Exportación de datos (portabilidad).
- Función única `authorize_student_use` y códigos de error propios.
- Trabajos programados (FastAPI o `pg_cron`) y purga por lotes.
- Nivel de aislamiento `READ COMMITTED` fijado en el pool de FastAPI.

### 8.3 Supuestos
- FastAPI implementará las comprobaciones del ADR 0001 (hoy no existe código de `api/` que lo demuestre).
- La app mostrará el texto completo de cada versión antes de aceptarla.
- La clave HMAC vivirá solo en el gestor de secretos del servidor.
- El proveedor de IA no retiene ni entrena con los datos (a confirmar por contrato).
- No se agregarán datos nuevos del niño sin actualizar el inventario y esta evaluación.

### 8.4 Limitaciones de este borrador
- Las probabilidades e impactos son una estimación inicial, sin datos de uso reales.
- No se han evaluado aún los proveedores ni la infraestructura de producción.
- Los artículos legales citados están sin verificar contra el texto oficial.
