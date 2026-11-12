# Plan pendiente: docentes y administradores

Lo que quedó fuera de la base de roles y vínculos, asignado al paso del orden de construcción
(`docs/SPEC.md`, sección "Docentes y administradores") donde se resuelve. Fecha: 2026-11-12.

## Paso 4: vincular por código (T24–T26)
- Redactar el **texto del aviso** de confirmación del vínculo: identidad del docente, que es un tercero,
  qué ve exactamente (incluidas las hojas), para qué, por cuánto tiempo, cómo quitarlo y qué hacer si hay
  abuso. Ligarlo a la versión de los términos (`terms_version_id`).
- Definir y documentar **quién verifica que el docente es realmente docente** (alta por el administrador)
  y el procedimiento ante abuso (también en la EIPD).
- **Rotación del código de vínculo**: hoy es inmutable; si se filtra no se puede cambiar. Evaluar que el
  administrador lo rote y que eso invalide los vínculos pendientes.
- Probar el **límite de intentos** al vincular (R28 de la EIPD).

## Paso 8: hojas guardadas (T27, D8)
- **Plazo máximo** de conservación con purga programada.
- **`teacher_id` en cada hoja**, para borrar solo las de ese vínculo al quitarlo.
- **Bucket privado de Storage con RLS** por tutor y lectura del docente solo por `teacher_can_view`, con
  prueba pgTAP.
- **Sin metadatos** (EXIF) y con tope de tamaño.
- Que el **aviso del vínculo diga expresamente que se guardarán hojas**; evaluar avisar al tutor en cada
  guardado.

## Para más adelante
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
- Respuestas de Legal: docente como tercero receptor o encargado, consentimiento separado y versionado,
  plazos de hojas y vínculos, evidencia al quitar un vínculo, estado del proyecto que posterga la Ley
  21.719 (`docs/privacy/eipd/eipd-borrador.md`, sección 8.1 bis).
