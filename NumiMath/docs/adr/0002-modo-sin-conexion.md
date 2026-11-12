# ADR 0002 — Modo sin conexión (CU-A12) y su convivencia con la corrección en el servidor

**Estado:** aceptado (opción A), decidido el 2026-11-12 · implementado CU-A12 el 2026-11-12 · la
decisión 8 queda **pendiente de revisión** (ver "Decisiones tomadas")
**Alcance:** CU-A12 "Usar aplicación sin conexión" (RF-18, RNF-06). Deja preparado CU-A13
(sincronizar, RF-19, RF-25), que se implementa aparte.
**Apoyo técnico, no asesoría legal.**

## En simple

Hoy un ejercicio vive 10 minutos, se responde una vez y lo corrige el servidor, que regenera la
respuesta desde el token firmado (la respuesta nunca viaja al teléfono). CU-A12 pide lo contrario:
practicar sin internet y corregir "con la solución guardada" en el dispositivo.

La propuesta (opción A) es separar dos cosas que hoy van juntas:

- **Lo que el niño ve** (bien / casi, estrellas, bloque): se calcula en el dispositivo, con una
  solución guardada. Es solo una **corrección provisional** para que el niño no practique a ciegas.
- **Lo que cuenta** (intentos, nivel, racha, informe del tutor): lo decide **solo el servidor** al
  sincronizar (CU-A13), recorrigiendo cada respuesta desde el token firmado, igual que hoy. El
  "acertó" que mande el dispositivo se ignora.

Así, manipular el lote o la cola local no cambia el progreso real. Lo único que no se puede impedir
es que alguien con herramientas de desarrollador lea las soluciones del lote: se acepta, porque la
app no tiene premios canjeables ni notas.

---

## Contexto (lo que ya existe y condiciona el diseño)

- `api/app/exercises/tokens.py`: el token (v4) lleva `jti`, perfil, tema, nivel, emisión y
  caducidad, firmado con HMAC-SHA256. La semilla del generador es `HMAC(clave, jti)`: **el servidor
  puede regenerar la respuesta de un token en cualquier momento**, sin guardarla.
- `student_attempts_once unique (student_id, exercise_id)`: un `jti` cuenta una sola vez.
- `record_attempt` aplica la regla de bloques de 10 **al insertar**, en orden de llegada, y usa
  `answered_at = now()`. La racha acepta solo `local_date` en ±1 día del servidor.
- `exercise_token_ttl_seconds`: 600 por defecto, **máximo 3600** en `config.py`.
- **La app no funciona hoy sin internet**: no hay service worker ni manifiesto PWA
  (`app/src/index.html`, `angular.json`), ni proyecto Android/iOS generado (solo
  `capacitor.config.ts`). Sin internet el navegador ni siquiera carga la app.
- Los guards `authGuard` y `consentGuard` y la lista de perfiles consultan la red.
- RF-06: corrección en el servidor ("condiciona RF-18"). RNF-06: todo avance sin conexión se
  persiste antes de confirmarse en pantalla (prueba de *kill* del proceso). RNF-10: todo ejercicio
  sale del generador determinista y validado. RNF-02: acceso validado en el servidor.

## Opciones

### Opción A — Lote firmado de vigencia larga + corrección local provisional + recorrección en el servidor (recomendada)

El servidor entrega un lote de ejercicios firmados (tokens de un **dominio propio** y vigencia de
días) junto con la solución de cada uno. Sin conexión, la app corrige con esa solución, guarda cada
intento en una cola local y lo muestra. Al sincronizar (CU-A13) el servidor verifica cada token,
recorrige la respuesta del niño y aplica la regla de bloques.

| Ventajas | Desventajas |
|---|---|
| Cumple la ficha tal cual (corrige con la solución guardada, intentos en cola). | La solución queda en el dispositivo: un adulto o niño con herramientas de desarrollador la puede leer. |
| El progreso real lo sigue decidiendo el servidor (RF-06 se mantiene para lo que cuenta). | La regla de bloques queda en 3 lugares (SQL, Python y TypeScript). |
| Reutiliza generador, tokens y `jti` único: sin generador en el cliente. | El nivel que el niño ve sin conexión puede no coincidir con el que calcule el servidor (p. ej. si practicó en otro dispositivo). |
| El lote no sirve en otro perfil ni a otro tutor (firma ligada al perfil + JWT al sincronizar). | Es la opción más cara (ver estimación). |

### Opción B — Lote firmado sin soluciones; corrección solo al sincronizar

Igual que A, pero el dispositivo **no** guarda soluciones: el niño responde y ve "¡Guardado! Lo
revisamos cuando vuelva internet".

| Ventajas | Desventajas |
|---|---|
| Ninguna respuesta en el dispositivo: RF-06 intacto. | **No cumple la ficha** (paso 2: "corrige con la solución guardada"). |
| Sin regla de bloques en TypeScript. | Para un niño de 6 a 10 años, practicar sin saber si acertó desmotiva; sin estrellas ni subir de nivel. |
| Un poco más barata que A (~1 día menos). | Requiere igual service worker, almacenamiento local, cola y lote. |

### Opción C — Mínima: "modo demostración" sin internet que no registra progreso

La app trae (dentro de sus archivos) un juego fijo de ejercicios de muestra con su solución,
generados en la compilación por el mismo generador del servidor. Sin conexión se ofrece "Practicar
sin internet (no se guarda)". Nada se registra ni se sincroniza.

| Ventajas | Desventajas |
|---|---|
| Barata (3 a 4 días). Sin tokens nuevos, sin cola, sin datos del niño en el dispositivo. | **No cumple la postcondición** de la ficha ("sus intentos quedan en cola") ni RNF-06; CU-A13 quedaría sin nada que sincronizar. |
| Sin riesgo de manipular progreso (no hay progreso). | Los mismos ejercicios para todos y para siempre; no sigue el nivel del niño. |
| RNF-10 se cumple si el juego se genera con el código del servidor y lo valida una prueba. | Igual necesita service worker para abrir la app sin internet. |

### Recomendación

**Opción A.** Es la única que cumple la ficha CU-A12 y deja a CU-A13 algo real que sincronizar, y lo
que importa (progreso, nivel, racha, informe) sigue calculándose en el servidor. Si el plazo no lo
permite, **C** es un paso intermedio honesto que no compromete la seguridad, pero hay que registrar
que CU-A12 queda parcial.

El resto del documento detalla la opción A.

---

## 1. Ejercicios firmados y uso sin conexión

**Token sin conexión (v5, dominio `offline-token|`).** Mismo formato que el de práctica (`jti`,
perfil, tema, nivel, emisión, caducidad) con otra firma de dominio, como ya se hizo con el
diagnóstico (`diagnostic-token|`). Así un token de práctica de 10 minutos no se puede "estirar" y
un token del lote no sirve en el endpoint de práctica en línea.

- **Vigencia:** 7 días para responder (`offline_token_ttl_seconds`, configurable; el tope actual de
  3600 s aplica solo a la práctica en línea). El `jti` único sigue garantizando una sola respuesta.
- **Plazo para sincronizar:** el servidor acepta un intento del lote hasta 14 días después de la
  caducidad del token (gracia para un dispositivo que estuvo días sin red). Pasado eso se descarta.
  *(Decisión pendiente: 7 + 14 días es una propuesta.)*
- **El token NO lleva la respuesta** (igual que hoy). La solución viaja **al lado** del token, en
  la respuesta del endpoint del lote, solo para la corrección provisional.

**Corrección local.** La app compara la respuesta del niño con la solución guardada, con las mismas
reglas que el servidor: entero exacto; fracción equivalente aceptada salvo en ejercicios que piden
simplificar. Para no copiar la lógica de fracciones, el lote trae por ejercicio la forma canónica y
el modo (`exacta` / `equivalente`).

**Cómo se evita que se manipulen los resultados.**

| Manipulación | Qué pasa |
|---|---|
| Cambiar "acertó" en la cola local | El servidor lo ignora: recorrige la respuesta del niño desde el token. |
| Cambiar la solución guardada | Solo cambia lo que se ve en pantalla; el servidor recorrige. |
| Inventar un ejercicio fácil | Sin la clave no hay firma válida: el servidor lo rechaza. |
| Cambiar el nivel o el tema del token | Rompe la firma. |
| Responder el mismo ejercicio dos veces (o en dos dispositivos) | `jti` único: cuenta solo la primera que llegue. |
| Usar el lote de otro perfil o de otro tutor | El perfil va firmado y al sincronizar se exige el JWT de su tutor (RNF-02). |
| Adelantar el reloj para "ganar días" de racha | Ver 4: la fecha local se acota a la vida del token. |
| **Leer las soluciones** con herramientas de desarrollador | **No se puede impedir** con corrección local. Se guarda la solución como `SHA-256(sal del lote ‖ forma canónica)` para que no se lea a simple vista, pero **no es una barrera de seguridad** (las respuestas son números chicos y se prueban todos en milisegundos). Riesgo aceptado: no hay premios ni notas. |

## 2. Qué se guarda en el dispositivo y con qué protección

**Almacenamiento: IndexedDB nativo del navegador**, sin librerías. Sirve igual en la PWA y dentro
de Capacitor (WebView). SQLite exigiría un plugin nuevo de Capacitor y no existe proyecto nativo
todavía. Al guardar un intento se usa una transacción con `durability: 'strict'` y la pantalla
espera `oncomplete` antes de mostrar el resultado (RNF-06). Se pide `navigator.storage.persist()`
para reducir el riesgo de que el navegador borre los datos.

| Almacén | Contenido | Datos del niño | Se borra |
|---|---|---|---|
| `offline_batches` | Por perfil: `student_id` (UUID), fecha de descarga, y por ejercicio: token, texto del enunciado, tema, nivel, solución en hash, modo, caducidad, usado sí/no | `student_id`, curso implícito en las habilidades | Al caducar, al descargar uno nuevo, al cerrar sesión, al borrar el perfil o la cuenta, al detectar revocación o bloqueo |
| `offline_queue` | Por intento: id local, `student_id`, token, **respuesta del niño**, corrección provisional, hora local, fecha local, segundos | `student_id` y sus respuestas | Al sincronizar con éxito (CU-A13) o al vencer el plazo de sincronización (máx. ~21 días) |
| `offline_profiles` | Lista para "¿Quién practica?" sin red: `student_id`, **apodo**, curso, en pausa | **Apodo y curso** (copia local de lo que ya existe en la base) | Igual que el lote |

- **Nada de esto llega a la IA.** Sin conexión no hay explicación de Numi (el botón no aparece).
- **No se cifra.** Un cifrado con WebCrypto tendría la llave en el mismo navegador: protege poco y
  agrega complejidad. La protección real es: datos mínimos, vida corta, y que lo que importa se
  decide en el servidor. *(Decisión pendiente: confirmarlo con el auditor de privacidad.)*
- **Dispositivo compartido (PWA en un PC de uso común):** quien use el mismo navegador sin cerrar
  sesión puede ver apodos y respuestas guardadas. Se mitiga borrando todo al cerrar sesión.
  Cerrar sesión con intentos sin enviar los pierde: el aviso al adulto es parte de CU-A13.
- Hay que actualizar `docs/privacy/inventario-datos.md` y la EIPD (copia local del apodo y de las
  respuestas; plazo).

## 3. Tamaño del lote, descarga y lote agotado

**Contenido.** Por perfil, las habilidades de su curso que tienen generador (hoy 12 a 15 por curso;
el repaso de cursos anteriores **no** va en el lote). Por habilidad, 10 ejercicios en su nivel
actual y 10 en cada nivel vecino que exista (nivel − 1 y nivel + 1). Así el niño puede completar un
bloque, ver si sube o baja y seguir con el siguiente bloque. Máximo 30 por habilidad, unos 450 por
perfil, alrededor de 150 kB. Sin enunciados repetidos dentro de un mismo nivel, salvo donde el nivel
tiene menos de 10 posibles (regla actual). *(El número es configurable: `offline_batch_per_level`.)*

**Descarga.** `POST /v1/students/{id}/offline-batch` con el JWT del tutor y las mismas
comprobaciones que la práctica (`AuthorizedStudentDep`: perfil del tutor, no bloqueado,
consentimiento vigente). No usa IA. Límite: 5 descargas por perfil al día (evita acumular lotes).
La app lo pide **sola** al abrir la práctica de un perfil con conexión, si no hay lote, si quedan
menos de la mitad o si vence en menos de 2 días. El lote nuevo reemplaza al anterior en el
dispositivo; los tokens del anterior siguen válidos en el servidor hasta caducar (no hay estado),
pero ya no se ofrecen.

**Sin conexión.** Se detecta cuando `navigator.onLine` es falso **o** una petición falla por red
(`navigator.onLine` solo no basta). Aviso fijo, corto y sin culpa: "Estás sin internet. Puedes
practicar con los ejercicios guardados." Solo están disponibles la práctica de las habilidades del
lote. Las tareas del tutor, el diagnóstico, el repaso, el progreso, el panel y la explicación de Numi
muestran "Esto necesita internet".

**Lote agotado** (excepción de la ficha). Por habilidad: la baldosa muestra "Ya hiciste todos los
ejercicios guardados. Para traer más hace falta conectarse a internet." (o "Pide a un adulto que se
conecte a internet"). Si no hay lote para el perfil: "Para practicar sin internet, primero hay que
conectarse una vez".

## 4. Nivel y bloques de 10: qué es local y qué recalcula el servidor

| Qué | Sin conexión (dispositivo) | Al sincronizar (servidor, CU-A13) |
|---|---|---|
| Corrección | Provisional, con la solución del lote | **Definitiva**, regenerada desde el token |
| Nivel y bloque | Se calcula con una copia en TypeScript de `apply_answer`, partiendo del progreso que trajo el lote. Solo para mostrar estrellas, "🎯 4/10" y "¡Subiste de nivel!" | **Fuente de verdad**: se aplica la regla a los intentos en orden cronológico. Luego la app reemplaza su copia por la del servidor |
| Racha de días | Se muestra "🔥 N" estimada | La recalcula el servidor con la fecha local de cada intento, acotada a la vida del token |
| Tiempo por ejercicio | Medido en el dispositivo | Se acepta con tope de 600 s (no es verificable; solo informativo). *(Pendiente: o guardarlo vacío.)* |

**Lo que CU-A13 deberá resolver** (registrado aquí para no perderlo):
1. `record_attempt` aplica la regla **en orden de llegada** y con `answered_at = now()`. RF-25 pide
   recalcular **en orden cronológico** y conservar la hora del intento. Hará falta guardar la hora
   del dispositivo (acotada a `[emisión, min(caducidad, ahora)]`) y reprocesar los bloques cuando
   lleguen intentos más antiguos que el último registrado (por ejemplo, desde otro dispositivo).
2. La racha hoy rechaza fechas fuera de ±1 día y "no se rellenan días perdidos". Para el lote habrá
   que aceptar la fecha local dentro de la vida del token. Con eso, cambiando el reloj se puede ganar
   como máximo los días de vida del token (hoy, 1). *(Decisión pendiente.)*
3. Si al sincronizar el nivel del servidor es distinto del que vio el niño, se muestra el del
   servidor **sin** decir "bajaste" (misma regla de tono que hoy).
4. Intentos de un perfil bloqueado o sin consentimiento: se rechazan (403) y se borran de la cola.

## 5. Riesgos y estimación

**RNF-10 (ejercicios correctos y adecuados).** Se cumple: el lote sale del mismo generador
determinista y validado. Nueva prueba: todo ejercicio de un lote pasa el filtro y su solución
coincide con la que regenera el servidor desde el token.

**RNF-02 (acceso validado en el servidor).**
- La descarga y la sincronización pasan por las comprobaciones del ADR 0001 (decisión 1).
- **Sin conexión el servidor no puede validar nada.** Se practica con lo que ya se autorizó al
  descargar. Por eso una **revocación de consentimiento o un bloqueo no alcanza a un dispositivo
  sin red**: el niño puede seguir practicando con su lote hasta que vuelva la conexión (máx. 7
  días). Nada de eso cuenta, porque el servidor lo rechaza al sincronizar, y el dispositivo borra
  lote y cola en cuanto se entera. Es una excepción acotada a la regla "desde la revocación no se
  usan datos del niño" (T20): los datos están solo en el dispositivo del propio tutor y no llegan a
  la IA. **Debe revisarlo `privacy-cl-auditor`.**
- Los guards de la app tendrán que aceptar, sin red, el último estado conocido de sesión y
  consentimiento **solo para la práctica sin conexión**. No contradice la decisión 2 del ADR 0001
  (sin caché en el servidor): el servidor sigue sin caché y vuelve a comprobar todo al sincronizar.

**Otros riesgos.**
- **Service worker.** Sin él la PWA no abre sin internet. Hay dos caminos: `@angular/service-worker`
  (paquete oficial de Angular, sin analítica, pero es una **dependencia nueva**: CLAUDE.md pide
  preguntar) o un service worker escrito a mano (sin dependencia, más código propio que mantener).
  *(Decisión pendiente.)*
- **Safari/iOS** puede borrar los datos de un sitio web tras 7 días sin uso (no a una PWA instalada
  en la pantalla de inicio). Los intentos de la cola podrían perderse. Hay que recomendar instalar la
  app o usar la versión Capacitor.
- **La regla de bloques en tres lenguajes.** Mitigación: pruebas con la misma tabla de casos en SQL,
  Python y TypeScript.
- **Presupuesto de estilos** de `practice.page.scss` (7,95 de 8 kB, SPEC CU-A2, pendiente 7): los
  avisos nuevos no caben sin ajustar el presupuesto o mover estilos.
- Lectura de soluciones: ver 1 (aceptado).

**Estimación (días de trabajo de una persona, incluye pruebas, revisores y documentación).**

| Tarea | A | B | C |
|---|---|---|---|
| Service worker y manifiesto (abrir sin red) | 1 | 1 | 1 |
| Token v5 + endpoint del lote + límites + pruebas pytest | 2 | 2 | — |
| Juego fijo de demostración generado en la compilación + prueba | — | — | 1 |
| IndexedDB (lote, cola, perfiles), escritura estricta, pruebas | 1,5 | 1,5 | — |
| Detección de conexión, avisos, guards sin red | 1,5 | 1,5 | 1 |
| Práctica con el lote, corrección local, bloques en TS, lote agotado | 2 | 1 | 1 |
| Revisores (`code`, `security`, `scalability`, `privacy-cl`, `child-safety`), correcciones, SPEC, inventario, EIPD | 1,5 | 1,5 | 0,5 |
| **Total CU-A12** | **9,5** | **8,5** | **4,5** |

CU-A13 (A o B): unos 4 a 6 días más (reproceso cronológico de bloques y racha, cola con reintentos,
aviso al cerrar sesión con intentos pendientes). Probablemente con una migración y pgTAP.
CU-A12 por sí solo (opción A) no necesita migración: el lote no se guarda en la base. El límite de
descargas puede reutilizar el registro de uso existente, y si hiciera falta una tabla nueva, llevaría
RLS y pgTAP.

## 6. Alternativa mínima

Es la **opción C**. Si se elige, el texto de la app debe dejar claro que "no se guarda", y CU-A12
debe marcarse como parcial en el resumen de avance (la postcondición no se cumple).

## Decisiones tomadas (2026-11-12)

1. **Opción A.**
2. **`@angular/service-worker` 22.1.7**, la librería oficial de Angular, sin service worker escrito
   a mano. Es la **única dependencia nueva** de este cambio. Por qué:
   - es del mismo equipo y versión que el resto de Angular del proyecto (no entra un tercero nuevo);
   - no trae analítica ni publicidad (Apple Kids Category y Google Families Policy);
   - resuelve la caché y la actualización de versiones, que a mano es fácil hacer mal (una app
     que queda "pegada" en una versión vieja).

   Se configura solo para los archivos de la app (`ngsw-config.json`, **sin `dataGroups`**): nunca
   guarda respuestas de la API ni de Supabase, así que ningún dato del niño queda en su caché.
   Apagado en desarrollo (`ng serve`); activo en la compilación de producción.
3. **7 días** para responder y **14 de margen** para sincronizar.
4. **10 ejercicios por nivel**, en el nivel actual y en los vecinos.
5. **Sí** a la copia local, solo de **apodo y curso** (y si está en pausa) para elegir perfil.
6. **Sin cifrado** local.
7. Tiempo por ejercicio: **se guarda con tope de 600 s**.
8. **Se acepta para esta etapa** que una revocación o un bloqueo no alcance a un dispositivo sin
   red hasta que se conecte. **Pendiente de revisión por Adolfo y por `privacy-cl-auditor`.**

## Lo que cambió al implementar (2026-11-12)

- **Límite de descargas:** se reutilizó `usage_student_daily` (columna `offline_batches`) y la
  función `consume_offline_batch` (solo `service_role`), en la migración
  `20261112120000_offline_batch_limit.sql`. No suma a la cuota de la IA.
- **Ante una respuesta incorrecta sin conexión se muestra solo "Casi."**, sin la solución: el lote
  la guarda en hash (sección 1), así que el dispositivo sabe si acertó pero no cuál era la
  respuesta. Para mostrarla habría que guardarla de forma reversible: **decisión pendiente**.
- **Racha de días sin conexión:** no se muestra (la sección 4 decía "estimada"); se comporta como
  cuando la racha no se puede leer. **Decisión pendiente** si se quiere una estimación.
- **Sin conexión se ocultan** "Tareas de tu tutor" y "Mi progreso", en vez de mostrar "Esto
  necesita internet". El repaso y el diagnóstico no se ofrecen. **Confirmar.**
- **Manifiesto PWA: no se agregó.** Solo hay un ícono de 64×64 y un manifiesto instalable necesita
  íconos de 192 y 512 px (recursos gráficos nuevos que hay que registrar en
  `docs/creditos-recursos.md`). Sin él, la mitigación de Safari ("instalar la app") no está
  disponible. **Pendiente.**
- **Guards:** sin red, `authGuard` y `consentGuard` aceptan solo las rutas marcadas
  `data: { offline: true }` (Inicio, "¿Quién practica?" y la práctica) y solo si existe la copia
  local de perfiles (señal de que un tutor entró con sesión y consentimiento en ese equipo y no
  cerró sesión). Las demás rutas no se abren sin red.
- **Datos locales que se borran:** al cerrar sesión, al revocar el consentimiento, al borrar un
  perfil y cuando el servidor responde 403 al pedir el lote.
- **Mientras no exista CU-A13:** al renovar el lote con conexión, el nivel que se muestra vuelve al
  del servidor, aunque haya intentos en cola sin enviar. Se resuelve sincronizando antes de
  renovar (CU-A13).

## Consecuencias

**Positivas:** se cumple la ficha sin que el progreso real deje de decidirlo el servidor; se
reutilizan generador, tokens y `jti` único; CU-A13 queda acotado.

**Negativas:** soluciones legibles en el dispositivo; la regla de bloques en tres lugares; una
ventana de días en que una revocación no alcanza a un dispositivo sin red; un service worker nuevo
que mantener.

## Referencias

- ADR 0001 (decisiones 1 y 2).
- `docs/SPEC.md`: racha diaria, dificultad progresiva, diagnóstico (CU-A2), revocación (T20).
- Ficha CU-A12 y CU-A13 en los Anexos (`FINAL FASE 1/Anexos/Diseño/Plantillas de C.U. por cada C. U..docx`).
- Requerimientos RF-06, RF-18, RF-19, RF-25, RNF-02, RNF-06, RNF-10.
