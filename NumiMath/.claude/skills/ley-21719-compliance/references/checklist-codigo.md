# Checklist técnico Ley 21.719 para esta app (verificable en código)

Referencias de artículos tomadas de la investigación previa; verificar contra el texto oficial antes de citar en documentos legales.

## Consentimiento del tutor (menores de 14 años; art. 16 quáter, arts. 12–13)
- [ ] El registro lo hace solo el tutor adulto; no existe flujo de registro del niño.
- [ ] Consentimiento libre, informado, específico, previo e inequívoco; casillas no premarcadas; texto claro y breve, separado de los términos generales.
- [ ] Se guarda `tutor_id`, versión de términos, versión de política de privacidad, fecha-hora UTC y canal. La carga de la prueba es del responsable.
- [ ] Revocación del consentimiento tan simple como otorgarlo, y se traduce en supresión o bloqueo del perfil.
- [ ] Si cambia la versión de términos o política, se vuelve a pedir el consentimiento.
- [ ] Control parental (PIN o pregunta de adulto) para entrar a la zona del tutor.

## Principios (art. 3) y minimización
- [ ] Solo apodo y curso del alumno. Sin apellidos, fotos, ubicación, fecha de nacimiento, voz ni identificadores publicitarios.
- [ ] Cada campo nuevo tiene finalidad específica y está en el inventario.
- [ ] Conservación: jobs de borrado o anonimización por categoría; el historial de progreso tiene plazo definido; al eliminar la cuenta se borra todo, incluidos backups en el plazo declarado.

## Derechos del titular (arts. 4–11; ejercidos por el tutor)
- [ ] Acceso: el tutor puede ver todo lo guardado del perfil.
- [ ] Rectificación: puede corregir apodo y curso.
- [ ] Supresión: elimina perfil y cuenta; se propaga a réplicas, backups y terceros.
- [ ] Oposición y bloqueo: puede pausar el tratamiento de un perfil.
- [ ] Portabilidad: exportación en formato estructurado y de uso común (JSON o CSV).
- [ ] Seguimiento de plazos: 30 días corridos (prorrogable una vez por 30); bloqueo temporal en 2 días hábiles; rectificación, supresión y oposición gratuitas.
- [ ] Decisiones automatizadas o perfilamiento con efectos significativos (art. 8 bis): la adaptación de dificultad no debe excluir ni sancionar al niño; hay explicación y opción de intervención humana si aplica.

## Diseño, seguridad y brechas (arts. 14 quáter, 14 quinquies, 14 sexies)
- [ ] Privacidad desde el diseño y por defecto: perfiles sin compartir, sin rankings públicos, sin contacto entre niños.
- [ ] Cifrado en tránsito (TLS) y en reposo; RLS por tutor en todas las tablas; mínimo privilegio; secretos fuera del repo.
- [ ] Sin datos personales ni mensajes del niño en logs, errores, trazas ni herramientas de monitoreo.
- [ ] Runbook de incidentes: registro de vulneraciones, criterio de notificación a la Agencia "sin dilaciones indebidas" y aviso a los titulares cuando corresponda (datos de menores). No asumir un plazo fijo de 72 horas: confirmarlo con el texto vigente.
- [ ] Restauración de backups probada.

## Terceros y transferencias internacionales (arts. 27–29)
- [ ] Inventario de proveedores: Supabase (región del proyecto), proveedor de IA, hosting de FastAPI, correo transaccional, tiendas de apps.
- [ ] Para cada uno: país, acuerdo de tratamiento de datos (DPA) firmado, garantía de transferencia (cláusulas contractuales u otra), política de retención y de no entrenamiento con datos.
- [ ] Preferir la región más cercana o adecuada para Supabase; documentar la decisión en un ADR.

## IA
- [ ] El prompt solo contiene curso, tema y ejercicio; el texto del niño pasa antes por filtro de PII.
- [ ] El proveedor de IA no retiene ni entrena con los datos (configuración o contrato); no se guardan transcripciones salvo necesidad justificada y con plazo corto.
- [ ] Transparencia: el niño y el tutor saben que la mascota es una IA.

## Sanciones y gobierno (art. 35, arts. 48–51)
- [ ] El tutor puede contactar al responsable (correo de privacidad visible).
- [ ] Evaluar delegado de protección de datos y modelo de prevención (voluntarios; atenúan sanciones si se certifican).
- [ ] Política de privacidad en lenguaje claro, versionada, y una versión resumida para el tutor.
