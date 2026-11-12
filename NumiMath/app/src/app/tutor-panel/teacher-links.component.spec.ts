import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { ParentalPort, PinError } from '../core/parental/parental.port';
import {
  CreateLinkResult,
  LinkedTeacher,
  LookupResult,
  RemoveLinkResult,
  TeacherLinksPort,
} from '../core/teacher-links/teacher-links.port';
import { TeacherLinksComponent } from './teacher-links.component';

const ANA: LinkedTeacher = {
  teacherId: 't1',
  name: 'Docente X',
  shownName: 'Docente X',
  acceptedAt: '2026-11-12T10:00:00Z',
};
const FOUND: LookupResult = {
  ok: true,
  teacherName: 'Docente X',
  confirmationToken: 'token-de-confirmacion',
  terms: { id: 'v1', version: 'doc-1', sha256: 'abc' },
};
const TEXT = '# Autorización\n\nAutorizo que el docente cuyo nombre aparece pueda ver **progreso**.';

function setup(
  over: {
    teachers?: LinkedTeacher[];
    lookup?: LookupResult;
    create?: CreateLinkResult;
    remove?: RemoveLinkResult;
    verified?: boolean;
    verify?: () => Promise<void>;
  } = {},
) {
  let teachers = over.teachers ?? [];
  const links = {
    list: vi.fn(async () => ({ ok: true as const, teachers })),
    lookup: vi.fn(async () => over.lookup ?? FOUND),
    create: vi.fn(async () => over.create ?? ({ ok: true, teacherName: 'Docente X' } as CreateLinkResult)),
    remove: vi.fn(async () => {
      teachers = [];
      return over.remove ?? ({ ok: true } as RemoveLinkResult);
    }),
    loadAuthorizationText: vi.fn(async () => ({ text: TEXT, verified: over.verified ?? true })),
  };
  const parental = { verify: vi.fn(over.verify ?? (async () => undefined)) };
  TestBed.configureTestingModule({
    declarations: [TeacherLinksComponent],
    imports: [IonicModule.forRoot(), FormsModule],
    providers: [
      { provide: TeacherLinksPort, useValue: links },
      { provide: ParentalPort, useValue: parental },
    ],
  });
  const fixture = TestBed.createComponent(TeacherLinksComponent);
  const c = fixture.componentInstance;
  c.studentId = 'perfil-1';
  c.nickname = 'Ana';
  return {
    c,
    fixture,
    links,
    parental,
    async load() {
      await c.ngOnChanges({ studentId: new SimpleChange(null, 'perfil-1', true) });
      fixture.detectChanges();
    },
  };
}

async function toNotice(ctx: ReturnType<typeof setup>) {
  await ctx.load();
  ctx.c.startLink();
  ctx.c.onPin('1234');
  ctx.c.onCode('xxxx2345');
  await ctx.c.search();
  ctx.fixture.detectChanges();
}

describe('TeacherLinksComponent: vincular (T25)', () => {
  it('muestra los docentes ya vinculados o que no hay ninguno', async () => {
    const a = setup({ teachers: [ANA] });
    await a.load();
    expect(a.fixture.nativeElement.querySelectorAll('[data-testid="linked-teacher"]').length).toBe(1);
    TestBed.resetTestingModule();
    const b = setup();
    await b.load();
    expect(b.fixture.nativeElement.textContent).toContain('todavía no tiene docentes vinculados');
  });

  it('pide el PIN SIEMPRE: lo verifica de nuevo justo antes de buscar', async () => {
    const ctx = setup();
    await toNotice(ctx);
    expect(ctx.parental.verify).toHaveBeenCalledWith('1234');
    expect(ctx.links.lookup).toHaveBeenCalledWith('perfil-1', 'XXXX2345');
    expect(ctx.parental.verify.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.links.lookup.mock.invocationCallOrder[0],
    );
  });

  it('no busca sin PIN de 4 dígitos ni con un código incompleto', async () => {
    const ctx = setup();
    await ctx.load();
    ctx.c.startLink();
    ctx.c.onPin('12');
    ctx.c.onCode('XXXX2345');
    await ctx.c.search();
    ctx.c.onPin('1234');
    ctx.c.onCode('XXXX');
    await ctx.c.search();
    expect(ctx.parental.verify).not.toHaveBeenCalled();
    expect(ctx.links.lookup).not.toHaveBeenCalled();
  });

  it('con el PIN equivocado no busca al docente y muestra cuántos intentos quedan', async () => {
    const ctx = setup({
      verify: async () => {
        throw new PinError('wrong', 3);
      },
    });
    await ctx.load();
    ctx.c.startLink();
    ctx.c.onPin('1234');
    ctx.c.onCode('XXXX2345');
    await ctx.c.search();
    expect(ctx.links.lookup).not.toHaveBeenCalled();
    expect(ctx.c.error).toContain('Te quedan 3 intentos');
    expect(ctx.c.pin).toBe('');
    expect(ctx.c.step).toBe('code');
  });

  it('muestra el nombre del docente y el texto completo antes de aceptar', async () => {
    const ctx = setup();
    await toNotice(ctx);
    const el = ctx.fixture.nativeElement as HTMLElement;
    expect(ctx.c.step).toBe('notice');
    expect(el.querySelector('[data-testid="notice-teacher"]')?.textContent).toContain('Docente X');
    expect(el.textContent).toContain('Autorizo que el docente');
    expect(ctx.links.loadAuthorizationText).toHaveBeenCalledWith('abc');
    expect(ctx.links.create).not.toHaveBeenCalled(); // todavía no: falta aceptar
  });

  it('no se puede vincular sin marcar "Entiendo y autorizo"', async () => {
    const ctx = setup();
    await toNotice(ctx);
    expect(ctx.c.canConfirm).toBe(false);
    await ctx.c.confirm();
    expect(ctx.links.create).not.toHaveBeenCalled();
    ctx.c.accepted = true;
    expect(ctx.c.canConfirm).toBe(true);
  });

  it('al aceptar crea el vínculo con el token, avisa y recarga la lista', async () => {
    const ctx = setup();
    await toNotice(ctx);
    ctx.c.accepted = true;
    await ctx.c.confirm();
    expect(ctx.links.create).toHaveBeenCalledWith('perfil-1', 'token-de-confirmacion');
    expect(ctx.c.ok).toBe('Vinculaste a Docente X con Ana.');
    expect(ctx.c.step).toBe('idle');
    expect(ctx.links.list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('si el texto no coincide con su huella publicada no se puede aceptar', async () => {
    const ctx = setup({ verified: false });
    await toNotice(ctx);
    const el = ctx.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="text-unverified"]')).not.toBeNull();
    ctx.c.accepted = true;
    expect(ctx.c.canConfirm).toBe(false);
  });

  it.each([
    ['not_found', 'No encontramos un docente'],
    ['locked', 'Espera'],
    ['already_linked', 'ya está vinculado'],
  ] as const)('un %s al buscar se explica y deja reintentar', async (reason, text) => {
    const ctx = setup({ lookup: { ok: false, reason, retryAfterSeconds: 840 } });
    await ctx.load();
    ctx.c.startLink();
    ctx.c.onPin('1234');
    ctx.c.onCode('ZZZZ2345');
    await ctx.c.search();
    expect(ctx.c.error).toContain(text);
    expect(ctx.c.step).toBe('code');
    expect(ctx.c.busy).toBe(false);
  });

  it('el bloqueo dice cuántos minutos esperar', async () => {
    const ctx = setup({ lookup: { ok: false, reason: 'locked', retryAfterSeconds: 840 } });
    await ctx.load();
    ctx.c.startLink();
    ctx.c.onPin('1234');
    ctx.c.onCode('ZZZZ2345');
    await ctx.c.search();
    expect(ctx.c.error).toContain('14 minutos');
  });

  it('si la confirmación venció vuelve a pedir el código', async () => {
    const ctx = setup({ create: { ok: false, reason: 'expired' } });
    await toNotice(ctx);
    ctx.c.accepted = true;
    await ctx.c.confirm();
    expect(ctx.c.error).toContain('Vuelve a ingresar el código');
    expect(ctx.c.step).toBe('code');
  });

  it('cancelar en cualquier paso no crea nada y limpia el PIN y el código', async () => {
    const ctx = setup();
    await toNotice(ctx);
    ctx.c.cancel();
    expect(ctx.c.step).toBe('idle');
    expect(ctx.c.pin).toBe('');
    expect(ctx.c.code).toBe('');
    expect(ctx.links.create).not.toHaveBeenCalled();
  });

  it('el código se normaliza a mayúsculas y 8 caracteres', async () => {
    const ctx = setup();
    ctx.c.onCode('ab-cd 23 45xyz');
    expect(ctx.c.code).toBe('ABCD2345');
  });

  it('cambiar de hijo limpia el formulario y recarga sus docentes', async () => {
    const ctx = setup({ teachers: [ANA] });
    await toNotice(ctx);
    ctx.c.studentId = 'perfil-2';
    await ctx.c.ngOnChanges({ studentId: new SimpleChange('perfil-1', 'perfil-2', false) });
    expect(ctx.c.step).toBe('idle');
    expect(ctx.links.list).toHaveBeenLastCalledWith('perfil-2');
  });
});

describe('TeacherLinksComponent: quitar (T26)', () => {
  it('pide el PIN otra vez y quita el vínculo sin tocar al niño', async () => {
    const ctx = setup({ teachers: [ANA] });
    await ctx.load();
    ctx.c.askRemove(ANA);
    ctx.fixture.detectChanges();
    expect((ctx.fixture.nativeElement as HTMLElement).textContent).toContain('no se borran');
    ctx.c.onRemovePin('1234');
    await ctx.c.confirmRemove();
    expect(ctx.parental.verify).toHaveBeenCalledWith('1234');
    expect(ctx.links.remove).toHaveBeenCalledWith('perfil-1', 't1');
    expect(ctx.c.ok).toBe('Docente X ya no está vinculado a Ana.');
    expect(ctx.c.teachers).toEqual([]);
  });

  it('sin PIN completo no hace nada y cancelar no cambia nada', async () => {
    const ctx = setup({ teachers: [ANA] });
    await ctx.load();
    ctx.c.askRemove(ANA);
    ctx.c.onRemovePin('12');
    await ctx.c.confirmRemove();
    ctx.c.cancelRemove();
    expect(ctx.links.remove).not.toHaveBeenCalled();
    expect(ctx.c.removing).toBeNull();
  });

  it('con el PIN equivocado no quita', async () => {
    const ctx = setup({
      teachers: [ANA],
      verify: async () => {
        throw new PinError('locked');
      },
    });
    await ctx.load();
    ctx.c.askRemove(ANA);
    ctx.c.onRemovePin('1234');
    await ctx.c.confirmRemove();
    expect(ctx.links.remove).not.toHaveBeenCalled();
    expect(ctx.c.removeError).toContain('Demasiados intentos');
  });

  it('si el servidor falla lo dice y el vínculo sigue', async () => {
    const ctx = setup({ teachers: [ANA], remove: { ok: false, reason: 'error' } });
    await ctx.load();
    ctx.c.askRemove(ANA);
    ctx.c.onRemovePin('1234');
    await ctx.c.confirmRemove();
    expect(ctx.c.removeError).toContain('No pude completar');
    expect(ctx.c.removing).not.toBeNull();
  });

  it('avisa si el docente cambió de nombre desde que se vinculó', async () => {
    const ctx = setup({ teachers: [{ ...ANA, name: 'Docente Nuevo' }] });
    await ctx.load();
    const el = ctx.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="name-differs"]')?.textContent).toContain('Docente X');
  });
});
