/**
 * Prioridad del botón atrás de Android en la práctica y los juegos: sobre la navegación por
 * defecto de Ionic (0, que puede cerrar la app) y bajo alertas, modales y menús (100 y 99), que
 * se siguen cerrando primero. Cada pantalla se suscribe solo mientras está a la vista.
 */
export const HARDWARE_BACK_PRIORITY = 10;