/**
 * Fecha local del dispositivo como `YYYY-MM-DD`, para la racha diaria.
 *
 * Usa la hora local (getFullYear/getMonth/getDate), NO `toISOString()`, que da la fecha UTC y
 * cambiaría de día antes o después de la medianoche local. No se envía la zona horaria.
 */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
