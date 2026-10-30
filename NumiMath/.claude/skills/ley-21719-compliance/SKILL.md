---
name: ley-21719-compliance
description: Audita código, esquemas, flujos y documentación contra la Ley 21.719 de Chile (protección de datos personales), con foco en datos de menores. Úsalo cuando se agreguen o modifiquen datos personales, perfiles de alumnos, consentimiento del tutor, logs, analítica o SDKs, integraciones con terceros, transferencias fuera de Chile, IA, o cuando se pida "revisar cumplimiento 21.719", "privacidad", "EIPD" o "derechos ARCOP".
allowed-tools: Read, Grep, Glob, Bash(git diff *), Bash(git log *)
---
# Auditoría Ley 21.719 (apoyo técnico, no asesoría legal)

Contexto del proyecto: app educativa para niños de 6 a 10 años. El tutor (adulto) es el único que se registra y otorga el consentimiento. El alumno es un perfil dependiente con solo apodo y curso. Todos los alumnos son menores de 14 años.

## Procedimiento
1. **Mapear datos personales** del alcance (diff o módulo): modelos, migraciones, DTOs, formularios, logs, eventos de analítica, SDKs de terceros, colas, exportaciones, prompts enviados a la IA. Clasifica cada dato: común / sensible / de menor.
2. **Contrastar con `docs/privacy/inventario-datos.md`**: cada dato debe tener finalidad, base de licitud, plazo de conservación, destinatarios y país de destino. Lo que falte es un hallazgo.
3. **Revisar contra `references/checklist-codigo.md`**.
4. **Determinar si requiere EIPD** (evaluación de impacto). Para este proyecto (menores + IA) se recomienda hacerla aunque la obligatoriedad deba confirmarla un abogado. Si corresponde, genera un borrador desde `references/plantilla-eipd.md` en `docs/privacy/eipd/`.
5. **Verificar vigencia**: la fecha legal es el 1‑dic‑2026, pero existe un proyecto (Boletín 18.623‑07) que propone postergarla al 1‑dic‑2027. Si el usuario necesita decidir plazos, recomienda revisar el estado de la tramitación; mientras tanto, diseñar para cumplir y respetar la Ley 19.628 vigente.
6. **Leyes complementarias** cuando el cambio lo amerite: Ley 21.430 (interés superior y privacidad del niño), Ley 19.496 (términos y cobros, si hay suscripción), Ley 21.663 (ciberseguridad, referencia).

## Formato de salida
Tabla: | Severidad (Alta/Media/Baja según riesgo) | Artículo o ley | Archivo:línea | Evidencia | Remediación técnica |
Luego: "Actualizaciones requeridas al inventario", "¿Requiere EIPD?" y "Preguntas para el equipo legal".
Nunca afirmes "cumple" de forma absoluta: indica supuestos y lo que requiere validación legal. No inventes números de artículo; si no estás seguro de uno, cita el principio o derecho y marca "verificar artículo".
