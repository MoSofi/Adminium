/**
 * /me profile + preference axes (08-server-api.md §2.2, 07-meta-store.md §7.2):
 * profile view/patch (email change re-authenticates), prefs GET/PATCH
 * round-trip including explicit `null` = "clear back to inherit".
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

let fixture: AuthTestApp | undefined;

afterEach(async () => {
  await fixture?.destroy();
  fixture = undefined;
});

interface PrefsBody {
  data: {
    prefs: Record<string, string | null>;
    resolved: { theme: string; accent: string; source: Record<string, string> };
  };
}

describe('GET/PATCH /me', () => {
  it('requires a session', async () => {
    fixture = await buildAuthApp();
    const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
  });

  it('serves the profile without secret material', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const res = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { user: { email: ADMIN_EMAIL, name: ADMIN_NAME } } });
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('recoveryCodes');
  });

  it('patches the display name without a password', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const res = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: cookie ?? '' },
      payload: { name: 'Ava R.' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { user: { name: string } } }).data.user.name).toBe('Ava R.');
  });

  it('changing email demands the current password (422 absent, 401 wrong, 200 right)', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const headers = { cookie: cookie ?? '' };

    const absent = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers,
      payload: { email: 'ava.new@example.com' },
    });
    expect(absent.statusCode).toBe(422); // schema refine: password required

    const wrong = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers,
      payload: { email: 'ava.new@example.com', password: 'not-the-password' },
    });
    expect(wrong.statusCode).toBe(401);

    const right = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers,
      payload: { email: 'Ava.New@Example.com', password: ADMIN_PASSWORD },
    });
    expect(right.statusCode).toBe(200);
    // Normalized to lowercase on the way in.
    expect((right.json() as { data: { user: { email: string } } }).data.user.email).toBe(
      'ava.new@example.com',
    );
  });
});

describe('GET/PATCH /me/prefs', () => {
  it('starts fully inherited and round-trips a patch', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const headers = { cookie: cookie ?? '' };

    const initial = await fixture.app.inject({ method: 'GET', url: '/api/v1/me/prefs', headers });
    expect(initial.statusCode).toBe(200);
    const before = initial.json() as PrefsBody;
    expect(before.data.prefs).toEqual({
      theme: null,
      accent: null,
      density: null,
      locale: null,
      dir: null,
    });
    // Nothing user-set yet — every axis resolves from workspace/system.
    expect(Object.values(before.data.resolved.source)).not.toContain('user');

    const patch = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/v1/me/prefs',
      headers,
      payload: { theme: 'dark', accent: 'teal' },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json() as PrefsBody;
    expect(patched.data.prefs.theme).toBe('dark');
    expect(patched.data.prefs.accent).toBe('teal');
    expect(patched.data.prefs.density).toBeNull(); // untouched axis stays inherited
    expect(patched.data.resolved.theme).toBe('dark');
    expect(patched.data.resolved.source.theme).toBe('user');
    expect(patched.data.resolved.source.accent).toBe('user');
    expect(patched.data.resolved.source.density).not.toBe('user');

    const readBack = await fixture.app.inject({ method: 'GET', url: '/api/v1/me/prefs', headers });
    expect((readBack.json() as PrefsBody).data.prefs.theme).toBe('dark');
  });

  it('explicit null clears an axis back to inherit; absent leaves it alone', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const headers = { cookie: cookie ?? '' };

    await fixture.app.inject({
      method: 'PATCH',
      url: '/api/v1/me/prefs',
      headers,
      payload: { theme: 'dark', density: 'compact' },
    });

    // theme → null (clear); density absent (keep).
    const clear = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/v1/me/prefs',
      headers,
      payload: { theme: null },
    });
    expect(clear.statusCode).toBe(200);
    const cleared = clear.json() as PrefsBody;
    expect(cleared.data.prefs.theme).toBeNull();
    expect(cleared.data.prefs.density).toBe('compact');
    expect(cleared.data.resolved.source.theme).not.toBe('user');
    expect(cleared.data.resolved.source.density).toBe('user');
  });

  it('rejects values outside the axis enums', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const res = await fixture.app.inject({
      method: 'PATCH',
      url: '/api/v1/me/prefs',
      headers: { cookie: cookie ?? '' },
      payload: { theme: 'blurple' },
    });
    expect(res.statusCode).toBe(422);
  });
});
