# Créditos y licencias de recursos visuales

Registro de autoría y licencias de los recursos gráficos de la app (Ley 17.336).
Actualizar cada vez que se agregue o reemplace una fuente, ilustración, sonido o voz.

| Recurso | Ubicación | Autor / origen | Licencia | Estado |
|---|---|---|---|---|
| Tipografía Nunito (variable, subconjunto latino) | `app/src/assets/fonts/nunito-latin-wght-normal.woff2` | Vernon Adams, Cyreal, Jacques Le Bailly. Archivo tomado de `@fontsource-variable/nunito` 5.2.7 | SIL Open Font License 1.1 (`app/src/assets/fonts/OFL.txt`) | **Pendiente**: falta agregar el archivo y la licencia |
| Mascota Numi (SVG + CSS) | `app/src/app/core/mascot/mascot.component.ts` | Hecha por el equipo del proyecto | Propia | Provisional, no es arte definitivo |
| Íconos de interfaz | paquete `ionicons` | Ionic | MIT | En uso |
| Figuras de los juegos (círculo, cuadrado, triángulo, rectángulo, cubo, esfera, cilindro; SVG) | `app/src/app/core/games/figure.component.ts` | Hechas por el equipo del proyecto | Propia | En uso (CU-A21) |
| Lápiz, cinta y alfombra para medir (SVG) | `app/src/app/core/games/game-visual.component.ts` | Hechos por el equipo del proyecto | Propia | En uso (CU-A21) |

Notas:
- La fuente se sirve desde los archivos de la app, nunca desde un CDN, para no enviar la IP del dispositivo a terceros.
- Los símbolos de los temas (+ − × ÷ ½ …) son caracteres de texto. No son ilustraciones con autor.
- Los emoji de los juegos (🍎 ⭐ ⚽ 🌸 📦 📎 👣) son caracteres de texto que dibuja la fuente del dispositivo; la app no incluye imágenes de emoji.
