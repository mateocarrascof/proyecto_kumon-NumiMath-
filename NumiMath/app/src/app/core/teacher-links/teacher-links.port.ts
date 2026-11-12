export interface LinkedTeacher {
  teacherId: string;
  /** Nombre actual del docente. */
  name: string;
  /** Nombre que se le mostró al tutor al aceptar. */
  shownName: string;
  acceptedAt: string;
}

export interface LinkTerms {
  id: string;
  version: string;
  /** Huella SHA-256 publicada del texto de autorización. */
  sha256: string;
}

export type LinkFailure =
  | 'not_found'
  | 'locked'
  | 'already_linked'
  | 'expired'
  | 'pin'
  | 'consent'
  | 'forbidden'
  | 'network'
  | 'error';

export type ListLinksResult =
  | { ok: true; teachers: LinkedTeacher[] }
  | { ok: false; reason: LinkFailure };

export type LookupResult =
  | { ok: true; teacherName: string; confirmationToken: string; terms: LinkTerms }
  | { ok: false; reason: LinkFailure; retryAfterSeconds?: number };

export type CreateLinkResult = { ok: true; teacherName: string } | { ok: false; reason: LinkFailure };
export type RemoveLinkResult = { ok: true } | { ok: false; reason: LinkFailure };

export interface AuthorizationText {
  text: string;
  /** El texto coincide con la huella publicada: solo entonces se puede aceptar. */
  verified: boolean;
}

/**
 * Vínculo de un docente con UN hijo, desde el panel del tutor (T25 y T26). Vincular y quitar piden el
 * PIN recién verificado (el componente lo verifica justo antes de llamar). Nada de esto muestra
 * datos del niño ni la identidad del docente más allá de su nombre.
 */
export abstract class TeacherLinksPort {
  abstract list(studentId: string): Promise<ListLinksResult>;
  abstract lookup(studentId: string, code: string): Promise<LookupResult>;
  abstract create(studentId: string, confirmationToken: string): Promise<CreateLinkResult>;
  abstract remove(studentId: string, teacherId: string): Promise<RemoveLinkResult>;
  /** Texto de autorización de la app, verificado contra la huella publicada. */
  abstract loadAuthorizationText(expectedSha256: string): Promise<AuthorizationText>;
}
