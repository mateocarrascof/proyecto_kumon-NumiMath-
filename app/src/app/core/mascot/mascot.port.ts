/** Estados que cualquier pantalla puede pedirle a la mascota. */
export type MascotState = 'idle' | 'thinking' | 'happy' | 'sad' | 'talking';

/**
 * Puerto de la mascota: las pantallas solo conocen este contrato.
 * Hoy la mascota es un SVG animado con CSS (provisional); para cambiarla por Lottie o Rive
 * se reemplaza el componente `app-mascot`, sin tocar ninguna pantalla.
 */
export abstract class MascotPort {
  abstract readonly state: () => MascotState;
  abstract set(state: MascotState): void;
}
