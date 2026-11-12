import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthPort } from '../auth/auth.port';
import { HttpAdminService } from './http-admin.service';

const URL = `${environment.apiUrl}/v1/admin/teachers`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const NEW = { name: 'Profe', email: 'p@colegio.test', password: 'clave-inicial-1' };

function setup(accessToken: string | null = 'jwt-admin') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthPort, useValue: { accessToken: async () => accessToken } },
    ],
  });
  return {
    service: TestBed.inject(HttpAdminService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpAdminService', () => {
  it('lista los docentes con el token del administrador', async () => {
    const { service, http } = setup();
    const result = service.listTeachers();
    await tick();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-admin');
    req.flush({ teachers: [{ id: 'd1', name: 'Ana', email: 'a@x.test', link_code: 'AAAA2345' }] });
    expect(await result).toEqual({
      ok: true,
      teachers: [{ id: 'd1', name: 'Ana', email: 'a@x.test', linkCode: 'AAAA2345' }],
    });
  });

  it('crea un docente y devuelve la contraseña para mostrarla una vez', async () => {
    const { service, http } = setup();
    const result = service.createTeacher(NEW);
    await tick();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(NEW);
    req.flush({
      id: 'd1',
      name: 'Profe',
      email: 'p@colegio.test',
      link_code: 'BBBB2345',
      password: NEW.password,
    });
    expect(await result).toEqual({
      ok: true,
      teacher: {
        id: 'd1',
        name: 'Profe',
        email: 'p@colegio.test',
        linkCode: 'BBBB2345',
        password: NEW.password,
      },
    });
  });

  it.each([
    [409, 'email_taken'],
    [422, 'invalid'],
    [403, 'forbidden'],
    [401, 'forbidden'],
    [503, 'error'],
    [0, 'network'],
  ])('un %i al crear se traduce a %s', async (status, reason) => {
    const { service, http } = setup();
    const result = service.createTeacher(NEW);
    await tick();
    const req = http.expectOne(URL);
    if (status === 0) req.error(new ProgressEvent('error'));
    else req.flush({ error: { code: 'x' } }, { status, statusText: 'x' });
    expect(await result).toEqual({ ok: false, reason });
  });

  it('edita enviando solo los cambios por PATCH', async () => {
    const { service, http } = setup();
    const result = service.updateTeacher('d1', { name: 'Nueva' });
    await tick();
    const req = http.expectOne(`${URL}/d1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Nueva' });
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-admin');
    req.flush({ id: 'd1', name: 'Nueva', email: 'a@x.test', link_code: 'AAAA2345', changed: true });
    expect(await result).toEqual({
      ok: true,
      changed: true,
      teacher: { id: 'd1', name: 'Nueva', email: 'a@x.test', linkCode: 'AAAA2345' },
    });
  });

  it('elimina con DELETE', async () => {
    const { service, http } = setup();
    const result = service.deleteTeacher('d1');
    await tick();
    const req = http.expectOne(`${URL}/d1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toEqual({ ok: true });
  });

  it.each([
    [409, 'email_taken'],
    [404, 'not_found'],
    [403, 'forbidden'],
  ])('un %i al editar o eliminar se traduce a %s', async (status, reason) => {
    const { service, http } = setup();
    const edit = service.updateTeacher('d1', { email: 'x@y.test' });
    await tick();
    http.expectOne(`${URL}/d1`).flush({}, { status, statusText: 'x' });
    expect(await edit).toEqual({ ok: false, reason });
    const del = service.deleteTeacher('d1');
    await tick();
    http.expectOne(`${URL}/d1`).flush({}, { status, statusText: 'x' });
    expect(await del).toEqual({ ok: false, reason });
  });

  it('sin sesión no llama al servidor', async () => {
    const { service, http } = setup(null);
    expect(await service.listTeachers()).toEqual({ ok: false, reason: 'forbidden' });
    expect(await service.createTeacher(NEW)).toEqual({ ok: false, reason: 'forbidden' });
    expect(await service.updateTeacher('d1', { name: 'x' })).toEqual({ ok: false, reason: 'forbidden' });
    expect(await service.deleteTeacher('d1')).toEqual({ ok: false, reason: 'forbidden' });
    http.expectNone(URL);
  });
});
