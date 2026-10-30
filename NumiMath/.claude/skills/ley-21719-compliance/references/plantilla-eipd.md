# Evaluación de Impacto en Protección de Datos (EIPD) — borrador

Apoyo técnico. Debe revisarlo un abogado o el delegado de protección de datos. Basada en el enfoque del art. 15 ter de la Ley 21.719 (verificar contra el texto oficial).

**Proyecto:** <nombre> · **Versión:** <n> · **Fecha:** <AAAA-MM-DD> · **Responsable del tratamiento:** <razón social, contacto>

## 1. Descripción del tratamiento
- Qué hace la app, quiénes son los titulares (alumnos de 6–10 años) y quiénes dan el consentimiento (tutores).
- Datos tratados: ver `docs/privacy/inventario-datos.md`.
- Flujo de datos: app → Supabase → FastAPI → proveedor de IA. Adjuntar diagrama.
- Volumen estimado de titulares y frecuencia de uso.

## 2. Finalidad y base de licitud
- Finalidad: apoyo al aprendizaje de matemáticas con explicaciones adaptadas a la edad.
- Base de licitud: consentimiento del tutor (menores de 14 años). Descripción de cómo se obtiene, prueba y revoca.

## 3. Necesidad y proporcionalidad
- Por qué cada dato es necesario (apodo para personalizar la interacción; curso para adaptar contenido).
- Datos que se decidió NO recolectar y por qué.
- Plazos de conservación.

## 4. Riesgos para los titulares
| Riesgo | Probabilidad | Impacto | Medida de mitigación | Riesgo residual |
|---|---|---|---|---|
| Exposición de datos de menores por falla de RLS o brecha | | | RLS + tests, cifrado, mínimo privilegio | |
| Envío de datos personales a la IA | | | Filtros de PII, prompts solo con curso/tema/ejercicio | |
| Respuesta inadecuada de la IA | | | Prompt estricto, filtros de entrada/salida, reportes | |
| Perfilamiento o manipulación del niño | | | Sin publicidad, sin dark patterns, sin ranking público | |
| Transferencia internacional sin garantías | | | DPA y cláusulas con proveedores, región documentada | |
| Retención excesiva | | | Jobs de borrado, plazos definidos | |

## 5. Medidas de seguridad y organizativas
Cifrado, control de acceso, registro de incidentes, capacitación, revisión de proveedores.

## 6. Derechos del titular
Cómo el tutor ejerce acceso, rectificación, supresión, oposición, portabilidad y bloqueo, con plazos.

## 7. Consulta y aprobación
Personas consultadas (tutores de prueba, asesor legal), conclusión y fecha de revisión.
