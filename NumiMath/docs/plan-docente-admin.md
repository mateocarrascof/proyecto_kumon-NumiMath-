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

## Paso 8: hojas guardadas (A22, D8 y T27 hechos)
- **Hecho:** guardar la hoja (sola al responder y a mano), lectura del docente desde `accepted_at`, borrado por
  perfil/cuenta/consentimiento (probado), plazo de 90 días provisional con purga diaria, texto de autorización
  `prov-5`. Decisiones en `docs/SPEC.md` ("Hojas guardadas"). Se eligió jsonb vectorial en vez de imágenes en Storage.
- **T27 hecho:** el tutor ve y elimina (una o todas) las hojas de su hijo, con PIN reciente y confirmación; el visor del
  docente (`app-sheet-view`) se movió a `CoreModule` y lo usan ambos paneles.
- **Límite: las hojas no entran a la cola sin conexión** (CU-A12/A13): sin red no se guardan.
- **Plazo de 90 días sin confirmar por Legal:** confirmarlo o cambiarlo. `privacy_config_warnings()` y
  `privacy_job_warnings()` aún NO vigilan `sheet_retention_confirmed` ni el trabajo `privacy-purge-sheets`.
- **Aviso al niño** en lenguaje simple de que su docente verá la hoja (evaluar avisar al tutor en cada guardado).
- **Vínculos con el texto de autorización antiguo** (v1 a v4): para las hojas ya está resuelto (`covers_sheets`); para
  historial y progreso sigue pendiente (EIPD R35).
- **Aviso al niño** en lenguaje simple ("Tu profe podrá ver este papel. No escribas tu nombre."), visible solo con vínculo.
- **Alertas de la purga:** sumar `sheet_retention_confirmed` a `privacy_config_warnings()` y `privacy-purge-sheets` a
  `privacy_job_warnings()`; avisar si falta `pg_cron`.
- **Preguntas para Legal:** (1) ¿un vínculo con v1 a v4 puede cubrir historial/progreso o hay que reconfirmar?; (2) ¿son
  proporcionales los 90 días, y conservar hojas sin docente vinculado, aunque ahora el tutor puede borrarlas?; (3) resguardos de la Ley 21.430 para un
  dibujo libre de un menor que ve un tercero (¿aviso al niño o al tutor en cada guardado?); (4) ¿el acceso del docente
  desde el extranjero es transferencia internacional?; (5) ¿el acceso y la supresión de hojas desde el panel (T27) bastan
  para los derechos ARCOP?; (6) estado del Boletín 18.623-07 (posterga la Ley 21.719 a 2027).
- **Aceptado (B2):** la hoja contrasta si la respuesta fue correcta, no el valor exacto que escribió el niño; solo afecta a
  datos propios del tutor.
- **Límite de frecuencia antes de autenticar:** el servidor lee el cuerpo (hasta 256 KB) de `/sheet` antes de validar la
  sesión; el límite por tutor se aplica después.

## Pendientes tras la revisión previa al PR (feat/docente-admin contra main)
Los cinco revisores del CLAUDE.md corrieron una vez; sus hallazgos críticos y altos ya se corrigieron
(`20261113150000_review_hardening`). Queda esto, sin bloquear el PR:
- **BLOQUEA EL USO CON FAMILIAS REALES: la política de privacidad `privacidad-prov-2` no nombra al docente como
  destinatario ni habla de las hojas.** Hasta que Legal la resuelva (nueva versión de la política y del
  consentimiento), la app no debe usarse con familias reales. Está pendiente en la mitigación de EIPD R27.
- **Paginación** de `admin_list_teachers` y `teacher_students` (hoy sin tope; alcanza para pocos docentes).
- **Token de vínculo de 8 minutos** reutilizable tras quitar al docente (ya anotado más abajo).
- **Zona horaria de la purga:** `purge_expired_student_sheets` limpia los contadores con `current_date` del servidor y no
  con la hora de Santiago (el límite diario sí usa Santiago).
- **Dibujo libre con datos personales** escritos a mano (R30): no hay filtro posible; mitigación = aviso al niño y plazo.
- **Aviso al niño** de que su docente verá la hoja (ya anotado).
- **Cobertura no revisada:** `EXPLAIN` sobre una base poblada, y el visor de hojas en equipos de gama baja.
- **Lo que debe validar un abogado:** los 90 días de las hojas, `admin_audit` sin purga, el docente como tercero y su acceso
  desde fuera de Chile, y los términos del docente.
- **Administradores degradados:** `admin_list_teachers` y las demás rutas del administrador solo confían en el rol del token
  (vence en minutos); borrar un docente ya lo comprueba en la base.

## Pendientes de D6, T8 y T22
- **D6:** umbral de "pocos ejercicios" = 5 en total; ajustar con la experiencia de uso.

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
