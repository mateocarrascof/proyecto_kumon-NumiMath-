/** Regla de contraseña de las cuentas de adultos. El servidor la exige igual (config.toml). */
export const PASSWORD_MIN = 8;

/** `null` si sirve; si no, el mensaje para mostrar. */
export function passwordProblem(password: string): string | null {
  return password.length >= PASSWORD_MIN
    ? null
    : `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
}
