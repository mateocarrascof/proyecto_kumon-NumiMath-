# Mapa curricular de Matemática, 1° a 4° básico — IA Matemática

Documento de apoyo para el proyecto. Define **qué habilidades debe practicar un alumno en cada curso**, en qué orden y con qué niveles de dificultad. El detalle de cada habilidad (niveles, prerrequisitos y fase) está en `docs/habilidades_1a4_basico.csv`, con las mismas 101 habilidades listas para cargarse en la tabla `habilidad`.

## 1. Qué cursan hoy los niños de 1° a 4° básico (Chile)

- **Currículum que rige:** las Bases Curriculares de Matemática de 1° a 6° básico del Mineduc (con programas de estudio) y la **Priorización Curricular** (versión actualizada de marzo de 2023), que separa los objetivos de aprendizaje (OA) en **basales** (imprescindibles) y **complementarios**. No pude confirmar si la priorización sigue siendo obligatoria en 2026; por eso el mapa conserva ambos tipos y los ordena por importancia.
- **Cinco ejes** (en las Bases vigentes): Números y operaciones, Patrones y álgebra, Geometría, Medición, Datos y probabilidades. Total de OA: 1° = 20, 2° = 22, 3° = 26 y 4° = 27 (95 en total). Este mapa cubre los 95.
- **Actualización curricular en curso:** el Mineduc propuso nuevas Bases para 1° a 6° básico (4 ejes: Medición se integra a Números y Geometría; se agrega educación financiera desde 1°). El CNED no la aprobó en julio de 2025; el Ministerio la reingresó y, según las actas de diciembre de 2025 y enero de 2026, seguía en análisis con vigencia proyectada para 2028. **No encontré una aprobación posterior.** Por eso el catálogo guarda en cada habilidad su curso y su OA de las Bases vigentes (`curso_referencia` y `objetivo_aprendizaje`), de modo que si los OA cambian, solo se reasignan esas columnas.

### Ámbito numérico y foco por curso

| Curso | Ámbito numérico | Foco |
|---|---|---|
| 1° básico | 0 a 20 (conteo hasta 100) | Sentido del número, sumas y restas hasta 20, patrones simples, figuras y pictogramas |
| 2° básico | 0 a 100 | Valor posicional, sumas y restas hasta 100 sin reserva, **tablas del 2, 5 y 10**, hora y media hora |
| 3° básico | 0 a 1 000 | Sumas y restas con reserva, **tablas hasta el 10 y división**, fracciones de uso común, perímetro y peso |
| 4° básico | 0 a 10 000 | Multiplicar 3×1 cifras, dividir 2÷1 cifras, fracciones y decimales, ecuaciones, área y conversión de unidades |

## 2. Criterios de reparto

1. **Una habilidad = una operación o tipo de problema; el nivel (1 a 3) = el tamaño o la complejidad** (misma regla de los Prompts 3 a 5). Cada habilidad tiene su propio `nivel_dominio` por alumno.
2. **Progresión tipo Kumon:** habilidades pequeñas, con prerrequisitos explícitos. El alumno avanza a la siguiente habilidad al dominar el nivel 3 de la anterior.
3. **Orden por importancia:** primero los OA basales de Números y operaciones, que son la base de todo; luego patrones y álgebra y medición con respuesta numérica; después lo que necesita apoyo visual (relojes, figuras, gráficos).
4. **Fase de implementación** (columna "Fase"):
   - **A — Beta núcleo (54 habilidades):** ejercicios de texto con respuesta numérica o alternativas, generables por plantilla, sin imágenes. Compatibles con el teclado numérico de la Beta.
   - **B — Beta si hay tiempo (30):** necesitan un componente visual simple (reloj, pictograma, figura, fracción en barra) o teclado decimal.
   - **C — Posterior (17):** requieren manipular figuras, ángulos, simetrías o experimentos aleatorios. Quedan en el mapa para completar el recorrido curricular, sin implementar en la Beta.
   Algunas habilidades de fase A cubren OA complementarios (por ejemplo, contar en secuencias) porque sostienen a las demás.
5. **Cobertura:** todos los OA de 1° a 4° están asociados a al menos una habilidad. Cuando un OA se divide en varias habilidades (por ejemplo, las tablas de multiplicar), cada una guarda el mismo código de OA.
6. **Respuesta:** "num." = respuesta numérica entera (teclado numérico); "alt." = elección entre alternativas (la tabla `ejercicio.alternativas` es obligatoria). Los decimales (4-13) requieren teclado con coma y quedan en fase B.

### Resumen de habilidades

| Curso | A (Beta núcleo) | B (si hay tiempo) | C (posterior) | Total |
|---|---|---|---|---|
| 1° básico | 12 | 7 | 4 | 23 |
| 2° básico | 14 | 8 | 2 | 24 |
| 3° básico | 15 | 6 | 5 | 26 |
| 4° básico | 13 | 9 | 6 | 28 |
| **Total** | **54** | **30** | **17** | **101** |

## 3. Familias de generadores (para no escribir 54 generadores distintos)

Muchas habilidades de la fase A comparten la misma lógica y solo cambian los parámetros. Se recomienda implementar **familias** configurables desde el catálogo:

| Familia | Habilidades que cubre (ejemplos) |
|---|---|
| Secuencia | 1-01, 2-01, 3-01 (completar el número que sigue) |
| Conteo y valor posicional | 1-02, 1-05, 2-02, 3-02, 4-01 (decenas, unidades, centenas, miles) |
| Comparación y orden (alternativas) | 1-03, 2-03, 3-03, 4-02 |
| Descomposición | 1-04, 2-04 |
| Suma y resta (con rango y tipo de reserva) | 1-06 a 1-09, 2-07, 2-08, 3-05, 3-06, 4-04 |
| Cálculo mental | 1-10, 2-06, 3-04, 4-03 |
| Familia de operaciones / inversa | 1-11, 2-10, 3-07 |
| Multiplicación y división (tablas, propiedades, algoritmo) | 2-11 a 2-14, 3-08 a 3-11, 4-05 a 4-07 |
| Patrones y secuencias numéricas | 1-13, 2-15, 3-14, 4-14 |
| Ecuación de un paso y desigualdades | 1-15, 2-16, 3-15, 4-15 |
| Fracciones con igual denominador | 4-10 |
| Medición con fórmula o conversión | 3-22, 3-23, 4-22, 4-23, 4-24 |

## 4. Reglas del catálogo

- **Identificador:** `codigo` (ej.: `3-05`) es estable y único; `habilidad.id` se asigna por `orden`. El código nunca se reutiliza.
- **Columnas de `habilidad`:** `nombre`, `modulo` (= eje), `orden` (global, por curso y eje), `curso_referencia` (1 a 4) y `objetivo_aprendizaje` (ej.: `3B-OA06`, máximo 20 caracteres).
- **Ruta de aprendizaje:** el alumno parte en las habilidades de su curso; las habilidades de cursos anteriores quedan disponibles como repaso. Un alumno de 3° puede reforzar contenido de 2° y adelantar contenido de 4° si domina el suyo (sin comparar con otros alumnos).
- **Dominio:** se mantiene la regla actual (sesión de 10 ejercicios; 8 o más aciertos sube de nivel; 4 o menos baja). Un nivel 3 dominado desbloquea la habilidad siguiente.
- **Sin resultados negativos** en restas, **sin repetir** enunciados dentro de un lote y **respuesta única** en todos los ejercicios.
- **Validación en servidor:** el backend recalcula la respuesta de cada ejercicio de plantilla (nunca confía en lo que envía el cliente) y no usa `eval`.
