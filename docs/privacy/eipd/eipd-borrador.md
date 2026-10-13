# Evaluación de Impacto en Protección de Datos (EIPD) — borrador 0.1

**Apoyo técnico, no asesoría legal.** Debe revisarlo un abogado o el delegado de protección de datos antes de darlo por válido. Enfoque del art. 15 ter de la Ley 21.719 (verificar contra el texto oficial; el texto de la ley y su fecha de vigencia deben confirmarse: ver sección 8).

**Proyecto:** App de matemáticas para niños (1° a 4° básico) con mascota animada e IA tutora · **Versión:** 0.1 (borrador) · **Fecha:** 2026-10-12
**Responsable del tratamiento:** `<razón social y contacto: pendiente>` · **Contacto de privacidad:** `<correo: pendiente>`
**Basado en:** `docs/privacy/inventario-datos.md`, `docs/adr/0001-contrato-fastapi-consentimiento.md`, `docs/lote-2-propuesta-consentimiento.md` y las migraciones de `supabase/`.

---

## Resumen para quien no es experto

- **Qué es la app:** una tutora de matemáticas con mascota para niños de 6 a 10 años. Los niños **no tienen cuenta**: solo el adulto (tutor) se registra y crea perfiles con **apodo y curso**.
- **Por qué esta evaluación:** se tratan datos de **menores de 14 años** y una **IA** adapta la dificultad. Eso la hace una evaluación recomendada (la obligatoriedad la confirma un abogado).
- **Lo que ya está resuelto técnicamente:** solo se guarda apodo y curso del niño; sin consentimiento vigente no se puede crear ni usar un perfil; el consentimiento se puede retirar y bloquea los perfiles; se guarda evidencia mínima y seudonimizada; hay plazos configurables y alertas; todo está cubierto por 231 pruebas automáticas.
- **Lo que falta:** los plazos legales de conservación, los acuerdos con proveedores (Supabase, IA, hosting), la región donde viven los datos, el filtro de la IA y los endpoints de FastAPI (aún no existen), la exportación de datos (portabilidad) y la validación legal.
- **Riesgo residual global (evaluación preliminar):** **medio**, hasta que se cierren los pendientes de la sección 8. Con los pendientes cerrados se estima **bajo a medio**.

---

## 1. Descripción del tratamiento

### 1.1 Qué hace y quién participa
| Actor | Rol | Datos |
|---|---|---|
| **Tutor** (adulto) | Único con cuenta (Supabase Auth). Acepta términos y política, crea perfiles, ve el progreso, revoca, corrige o borra. | Correo y método de acceso (en Auth), identificador, consentimientos. |
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
| Prompt a la IA (curso, tema, ejercicio) | — | FastAPI → proveedor de IA | Sin datos personales si el filtro funciona. |
| Logs técnicos | — | Infraestructura | Sin contenido ni datos personales (regla de diseño). |

**No se recolectan:** apellidos, fotos, ubicación, fecha de nacimiento, voz, contactos, identificadores publicitarios, correo o teléfono del alumno. No hay SDK de publicidad ni de analítica de terceros.

### 1.3 Flujo
```
App (Ionic)  ──JWT──►  Supabase (Auth, PostgreSQL con RLS por tutor)
     │                         ▲
     └──────────►  FastAPI  ───┘   (service_role; comprobaciones del ADR 0001)
                      │
                      └──► Proveedor de IA   (solo curso, tema y ejercicio)
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
| Perfil **bloqueado** | Máximo **30 días** y luego se suprime (con aviso previo al tutor) | **Provisional, pendiente legal** (alerta activa) |
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
| R6 | **Retención excesiva** (evidencia sin plazo, bloqueados, backups). | Alta (hoy) | Media | Plazos configurables, calculados al purgar; purga de bloqueados con aviso; alertas `privacy_config_warnings()` que deben bloquear el despliegue a producción. | **Plazos definidos por Legal**; trabajos programados; política de backups. | Medio hasta cerrar plazos |
| R7 | **Reidentificación de la evidencia seudonimizada** (cruce de fechas, canal y orden con backups, logs o Auth; o filtración de la clave HMAC). | Baja | Media | HMAC con clave fuera de la base; tabla accesible solo por el servidor; inmutable; sin datos del niño. | Gestión y rotación de la clave HMAC (custodio); reducir precisión de fechas si Legal lo recomienda; tratarla como dato personal en backups. | Bajo a medio |
| R8 | **Apodo con datos personales** (nombre real, teléfono). | Media | Media | Longitud máxima de 30; advertencia pendiente en la UI. | Elegir de lista o validar en API (rechazar `@`, secuencias de dígitos); excluirlo del prompt y de los logs. | Medio |
| R9 | **Pérdida de la evidencia** si se borra una cuenta por un canal distinto de FastAPI (panel, Admin API). | Media | Media | El runbook exige borrar solo vía FastAPI; flujo idempotente en el ADR. | Opcional: impedir en la base el borrado sin evidencia archivada; alerta de integración. | Medio |
| R10 | **Un niño accede a la zona del tutor** y cambia consentimientos o borra datos. | Media | Alta | Zona protegida con control parental (PIN o pregunta de adulto); desbloqueo solo por servidor. | Implementar y probar el control parental con límite de intentos, verificado en servidor. | Medio hasta implementarlo |
| R11 | **Uso de la IA tras una revocación** (stream en curso, caché). | Baja | Alta | Compuerta en la base; reglas de ADR (sin caché en memoria, re-chequeo ≤ 10 s en streams, fallar cerrado). | Implementarlo y probarlo en FastAPI. | Bajo tras implementar |
| R12 | **Abuso del sistema de consentimiento** (inundar eventos, bloquear a otros tutores). | Media | Baja | Límite de 20 eventos por tutor/24 h; eventos redundantes rechazados; el cliente no puede actuar a nombre de otro. | Límite de frecuencia por IP/usuario en la API. | Bajo |
| R13 | **Incidente de seguridad no detectado o mal gestionado.** | Baja | Alta | Sin datos personales en logs. | **Runbook de incidentes**, criterio de notificación a la Agencia y a los titulares, restauración de backups probada. | Medio (sin runbook) |

---

## 5. Medidas de seguridad y organizativas

**Implementadas (verificadas por pruebas automáticas):**
- RLS por tutor activada y forzada en todas las tablas, con permisos por columna y mínimo privilegio; `anon` sin acceso.
- Compuerta de consentimiento y tope de alumnos aplicados también al servidor (triggers).
- Evidencia, textos legales publicados y consentimientos inmutables; historial de bloqueos append-only.
- Funciones sensibles `SECURITY DEFINER` con `search_path` fijo, ejecutables solo por `service_role`.
- Límites de frecuencia en eventos de consentimiento; mensajes de error sin datos personales.
- Revisión de código, seguridad, privacidad y escalabilidad en cada lote.

**Pendientes (no implementadas todavía):**
- Cifrado en reposo y en tránsito verificado con los proveedores (TLS); gestión de secretos y clave HMAC.
- Control parental, filtros de PII y de salida de la IA, endpoints de FastAPI y sus pruebas.
- Trabajos programados (purgas y avisos), runbook de borrado de cuenta y de incidentes, restauración de backups probada.
- Capacitación y responsables: `<pendiente>`.
- Revisión de proveedores y DPA.

## 6. Derechos del titular (ejercidos por el tutor)

Plazos de referencia a verificar con el texto vigente: respuesta en 30 días corridos (prorrogable una vez), bloqueo temporal en 2 días hábiles; rectificación, supresión y oposición gratuitas.

| Derecho | Cómo se ejerce hoy | Brecha |
|---|---|---|
| **Acceso** | El tutor ve sus perfiles, sus consentimientos y el historial de bloqueos. Tras borrar la cuenta, acredita su correo y FastAPI localiza la evidencia por el HMAC del correo. | Falta el endpoint y el procedimiento documentado. |
| **Rectificación** | Puede corregir apodo y curso, **también con el perfil bloqueado**. | — |
| **Supresión** | Borra un perfil o la cuenta; el borrado de cuenta sigue el orden del ADR 0001. Se archiva solo evidencia mínima. | Plazos de la evidencia y de los backups sin definir; borrado selectivo de evidencia no implementado (solo por vencimiento). |
| **Oposición / bloqueo** | La revocación bloquea **todos** los perfiles del tutor. | **No existe bloqueo de un solo perfil** a petición del tutor. |
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

### 8.2 Decisiones técnicas y de producto abiertas
- Región de Supabase y del hosting (ADR pendiente); proveedor de IA y su configuración de no retención.
- Custodia y rotación de la clave HMAC.
- Apodo: lista cerrada o texto libre con validación.
- Bloqueo individual de un perfil, exportación de datos (portabilidad).
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
