# ADR 0003: Recordatorio de racha local (CU-A9, RF-10)

**Estado:** aceptado (2026-11-12) · **Alcance:** CU-A9 "Recibir notificación de racha" (RF-10)

## Contexto

El SPEC del 2026-10-26 descartó las notificaciones ("sin notificaciones push ni recordatorios") y
RF-10 quedó fuera. El diseño final incluye CU-A9 "Recibir notificación de racha", que debe
construirse.

## Decisión

RF-10 se incorpora como un **recordatorio local**, **opcional** y **desactivado por defecto**, que
solo el tutor activa, por perfil, desde el panel con el PIN vigente. El dispositivo lo programa con
el plugin oficial `@capacitor/local-notifications` (8.3.1, única dependencia nueva). No hay servidor
de notificaciones ni tokens de push, y no sale ningún dato del niño. Se muestra **como máximo un
aviso por día y por dispositivo**, a las **18:00** (hora fija). El texto es amable, sin apodo, sin
decir quién no practicó, sin culpa, sin urgencia y sin emoji. Funciona sin internet y respeta el
modo "no molestar" del sistema.

**Por qué es compatible con la protección del niño:**
1. Lo decide un adulto: está apagado por defecto, se activa en la zona del tutor con PIN, y el niño
   no puede activarlo ni cambiarlo. El permiso del sistema también se pide ahí.
2. Sin perfilamiento ni terceros: el aviso se arma en el dispositivo, sin push, sin SDK de terceros
   y sin enviar datos. En el servidor solo se guarda un sí o un no por perfil.
3. Sin presión: un aviso al día como máximo, sin apodo en la pantalla de bloqueo, sin culpa ni
   urgencia, y respeta "no molestar".

## Detalles

- **Plataformas:** solo en la app nativa. En la web/PWA el aviso solo funciona con la página
  abierta (y en iOS solo como PWA instalada, sin manifiesto hoy): la opción no se ofrece y el panel
  dice "Disponible en la app del teléfono o tablet".
- **Permisos:** Android 13+ pide `POST_NOTIFICATIONS`; se usa alarma inexacta (sin
  `SCHEDULE_EXACT_ALARM`) y un canal de importancia normal. iOS pide autorización (alerta y sonido).
- **Programación:** solo el próximo aviso (nunca una serie); se reprograma al abrir la app, al
  volver a primer plano, al cargar perfiles, tras practicar y cuando cambia lo guardado sin conexión.
- **Se cancela** si el tutor lo desactiva en todos los perfiles, cierra sesión, entra otro tutor,
  se revoca el consentimiento, el perfil se borra o se pausa, o la purga elimina la copia local.
- **Limitaciones aceptadas:** en Android el aviso puede llegar unos minutos tarde (alarma inexacta)
  y puede perderse al reiniciar el teléfono hasta que se abra la app.

## Consecuencias

Sustituye la frase del SPEC "sin notificaciones push ni recordatorios". Pendientes: elegir la hora
en el panel; crear los proyectos nativos (`npx cap add android/ios`) y comprobar en dispositivo real
permisos, "no molestar" y el toque del aviso.
