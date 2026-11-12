# Por qué se guardan las hojas del papel para calcular

Estado: justificación de diseño (la función aún no está implementada). Complementa
`inventario-datos.md` y `eipd/eipd-borrador.md` (riesgo R30). No es asesoría legal.

## Regla general
El papel para calcular del niño **no se guarda**: vive solo en la pantalla y se borra al pasar de ejercicio.

## Excepción y su justificación
Una hoja se guarda únicamente cuando el niño tiene **un docente vinculado activo** y el niño pulsa
"Guardar el papel". El motivo es pedagógico: el docente necesita ver **cómo hizo la cuenta** el niño
para corregir errores de procedimiento, algo que el resultado final no muestra.

## Límites (minimización)
- **Sin vínculo activo no se guarda nada.** No hay casillas aparte: la autorización es el vínculo que el
  tutor creó al confirmar el aviso.
- Solo la ve el docente vinculado, por la misma regla que el resto de sus datos (`teacher_can_view`:
  vínculo activo, consentimiento no revocado, perfil no bloqueado, rol verificado).
- **El tutor puede verlas y borrarlas** cuando quiera.
- **Las hojas pertenecen al niño, no al docente.** Quitar un vínculo o eliminar al docente **no las
  borra**: solo dejan de verse para ese docente. Se eliminan cuando **el tutor las borra** (T27), al
  **borrar el perfil o la cuenta** y al **revocar el consentimiento**.
- **Sin docente vinculado activo no se guardan hojas nuevas.**
- No llegan a la IA, no se analizan y no se hace reconocimiento de texto.
- Sin metadatos del dispositivo; tamaño acotado; aviso al niño en lenguaje simple de que su profe verá la hoja.

## Riesgos que quedan
El niño puede escribir algo identificable en el papel. Se acepta porque la hoja solo la ve un docente vinculado por el
tutor y se borra con las reglas de arriba. Como sobreviven a la baja de un vínculo o de un docente, el
**plazo máximo de conservación es una decisión pendiente (con Legal)** y debe implementarse con una purga
programada antes de guardar hojas reales.
