# Plan pendiente: docentes y administradores

Lo que quedó fuera de la base de roles y vínculos, asignado al paso del orden de construcción
(`docs/SPEC.md`, sección "Docentes y administradores") donde se resuelve. Fecha: 2026-11-12.

## Paso 4: vincular por código (T24–T26): hecho; queda pendiente
- El **texto del aviso** (`autorizacion-docente.md`) ya existe y es provisional: lo debe revisar Legal. Falta
  que diga el plazo de conservación (pendiente) y quién responde a las solicitudes del docente.
- Definir y documentar **quién verifica que el docente es realmente docente** (alta por el administrador)
  y el procedimiento ante abuso (también en la EIPD, R32).
- **Rotación del código de vínculo**: hoy es inmutable; si se filtra no se puede cambiar. Evaluar que el
  administrador lo rote y que eso invalide los vínculos pendientes.
- El texto de autorización no obliga a re-aceptar los términos generales: si cambia su versión, los vínculos
  existentes conservan la versión que se aceptó (decidir si deben reconfirmarse).

## Paso 8: hojas guardadas (T27, D8)
- **Las hojas pertenecen al niño** (decidido): quitar un vínculo o eliminar al docente NO las borra, solo
  dejan de verse para ese docente (la lectura pasa por `teacher_can_view`). Se borran cuando el tutor las
  elimina (T27), al borrar el perfil o la cuenta y al revocar el consentimiento. Sin docente vinculado
  activo no se guardan hojas nuevas.
- **Plazo máximo de conservación de las hojas**: pendiente (con Legal); implementar con purga programada.
- **Bucket privado de Storage con RLS** por tutor y lectura del docente solo por `teacher_can_view`, con
  prueba pgTAP.
- **Sin metadatos** (EXIF) y con tope de tamaño.
- Que el **aviso del vínculo diga expresamente que se guardarán hojas**; evaluar avisar al tutor en cada
  guardado.

## Para más adelante
- **PRIORIDAD ALTA: registro de lecturas del docente** (EIPD R38). Hacerlo si sobra tiempo después
  de T8, T22 y D6. Tabla de solo anexar con docente, perfil, recurso (D4, D5, D7) y **día**, sin contenido;
  lectura solo para el tutor dueño y escritura solo del servidor; purga programada; y en el panel del tutor
  "Docentes que vieron el perfil". Archivar también el alta y la baja del vínculo (R36).
- **Términos del docente** (EIPD R39 y R40): compromiso de confidencialidad y de uso solo pedagógico, versionado
  con su huella, y que `teacher_can_view` exija haberlos aceptado (hoy el docente ya lee sin haberlos aceptado).
  **En el MVP la medida es organizacional:** la empresa entrega la cuenta al docente y le exige confidencialidad
  por contrato. **Pendiente de Legal** (si basta o si hace falta el compromiso dentro de la app).
- **T5 muestra menos que el docente:** el tutor no ve el enunciado de cada ejercicio y el docente sí. Agregar el
  enunciado al historial del tutor (los datos son de su propio hijo) o un "ver como lo ve el docente".
- **Vínculos antiguos y versión del texto** (EIPD R35): los vínculos aceptados con versiones anteriores del texto
  (v1 a v3) ahora dan lecturas que esos textos no describían; en desarrollo basta borrarlos, en producción hay que
  exigir la versión vigente o pedir reconfirmación (con prueba pgTAP).
- **Fecha por día** del historial: permite deducir la rutina; si Legal lo pide, agrupar por semana. Documentar el
  análisis de proporcionalidad en la EIPD.
- **Registros de acceso del hosting:** confirmar que el log de acceso de uvicorn o del hosting no guarda la ruta
  real con el id del niño.
- **Paginación por cursor** `(answered_at, id)` si el volumen crece (hoy offset con tope de 5 000).
- **Respuesta del niño y respuesta correcta en el historial del docente (D7):** hoy los intentos NO guardan lo
  que respondió el niño ni la respuesta correcta (solo enunciado, resultado, nivel y fecha), así que el docente
  no puede ver en qué se equivocó. Mostrarlo exigiría guardar ambas en `student_attempts` (columnas nuevas,
  sin tareas del tutor, con su revisión de privacidad y el texto de autorización). Decidir antes de implementarlo.
- **Tiempo típico y racha en el progreso del docente (D5):** fuera por ahora (salen de duraciones y fechas); si se
  quieren, decidirlo con la misma regla de privacidad.
- **Archivo de la autorización** al quitar o borrar un vínculo (alta y baja, sin datos del niño; EIPD R36).
- **Reconfirmar o suspender vínculos** cuando cambie la versión del texto de autorización (EIPD R35).
- **Token de confirmación de un solo uso:** hoy, si el tutor quita al docente con un token todavía vigente
  (hasta 8 minutos), ese token podría volver a crear el vínculo sin PIN nuevo. Incluir una marca de tiempo y
  rechazarlo si hubo una baja posterior, o exigir PIN reciente también al crear.
- **`accepted_at` devuelto por la API:** la respuesta de crear el vínculo calcula la hora en la API; devolver
  la que guardó la base.
- **Publicar la versión del texto de autorización** con un procedimiento versionado (migración o script que
  verifique la huella): hoy solo la publica la semilla de desarrollo.
- **Texto de autorización:** completar el responsable y el contacto de privacidad; que lo revise Legal.
- Quitar la lectura de `tutor_id` por el docente: requiere servir los vínculos del docente solo por
  FastAPI (cambio de diseño; hoy es un UUID opaco).
- Archivo append-only, sin datos del niño, de los vínculos dados de baja (alta, baja, motivo, versión) y,
  si se decide, auditoría mínima de lecturas del docente.
- Vencimiento o reconfirmación anual de los vínculos y purga de cuentas de docente inactivas.
- Aviso al tutor si el administrador cambia el nombre o el correo de un docente vinculado (hoy se guarda
  `teacher_name` para poder detectarlo).
- Prueba concurrente de la carrera entre revocar el consentimiento y crear un vínculo (la prueba actual es
  secuencial).
- **Cuenta de Auth huérfana tras un corte de red al crear un docente** (la cuenta se crea pero la
  respuesta se pierde): buscar el usuario por correo y borrarlo si no tiene perfil de docente, o permitir
  completar el alta. Hoy solo se avisa al administrador de revisar la lista antes de reintentar.
- **Purga de `admin_audit`**: hoy el registro bloquea el borrado incluso al servidor; hace falta una
  función de purga, un plazo confirmado por Legal y una alerta mientras no esté confirmado.
- **Cambio obligatorio de contraseña del docente en el primer ingreso** (o invitación de un solo uso) y
  canal de entrega de la contraseña inicial definido por escrito. El servidor sigue devolviendo la
  contraseña una sola vez al crear la cuenta.
- **Aviso de privacidad al docente** al crearle la cuenta o en su primer ingreso, con versión y
  fecha-hora aceptadas.
- **Límite de tasa** en las rutas del administrador (`/v1/admin/teachers`).
- **Verificación de la identidad del docente** antes de crear la cuenta (confirmación del correo,
  idoneidad para trabajar con menores; EIPD R32).
- **Cambio de titular de una cuenta de docente (AD4):** (ya se cierran sus sesiones al cambiar el correo) avisar al correo anterior; suspender los vínculos o avisar a los tutores al cambiar nombre o correo (antes de T24 a T26); en T26 mostrar el nombre vigente frente a `teacher_name`. Ver EIPD R33.
- **Orden de la baja (AD5):** hoy se borra en Auth y después se registra; si el registro falla queda solo un log. Evaluar bloquear la cuenta, registrar y luego borrar (con desbloqueo si falla).
- **El docente ve su correo y un contacto de privacidad** en `/docente`, junto con el aviso de privacidad.
- **Recuperar contraseña del docente:** "recuperar contraseña" (`/recuperar`) sirve a docentes y
  administradores, pero el flujo termina en el inicio de sesión del tutor (`/login`, con el aviso
  "cambiaste tu contraseña"); el docente debe entrar luego por `/docente/login`. Evaluar que la pantalla
  de nueva contraseña lleve a la entrada de su rol.
- Respuestas de Legal: docente como tercero receptor o encargado, consentimiento separado y versionado,
  plazos de hojas y vínculos, evidencia al quitar un vínculo, estado del proyecto que posterga la Ley
  21.719 (`docs/privacy/eipd/eipd-borrador.md`, sección 8.1 bis).
