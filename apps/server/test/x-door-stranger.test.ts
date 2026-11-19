// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stranger's door never acts as the signed-in person (`routes/x-door/stranger.ts`):
 * with the owner's session (and a key) arriving, every request of a door's
 * plugin runs as nobody, so `request.can` refuses the refund right the owner
 * holds (what an answer's write asks, `crud/payment-rows.ts`); only a
 * preview's read (`GET ?preview=1`) keeps the session; a route outside the
 * door keeps it too.
 */
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { asksPreviewRead, strangerDoor } from '../src/routes/x-door/stranger.js';

const OWNER = { id: 'usr_owner', email: 'boss@meridian.example', name: 'Boss' };

async function server() {
  const app = Fastify();
  app.decorateRequest('user', null);
  app.decorateRequest('session', null);
  app.decorateRequest('apiKey', null);
  app.decorateRequest('apiKeyPrincipal', null);
  app.decorateRequest('rbacResolution', null);
  // As the rbac plugin: a signed-in principal holds what its role grants (here, the refund right).
  app.decorateRequest('can', async function can(this: FastifyRequest, permission: string) {
    const signedIn = this.user !== null && this.user !== undefined;
    return (signedIn || (this.apiKeyPrincipal !== null && this.apiKeyPrincipal !== undefined)) && permission === 'system:payments:refund';
  });
  // As the auth plugin, before every door: the owner's session cookie and a key resolved.
  app.addHook('onRequest', async (request) => {
    request.user = OWNER as never;
    request.session = { id: 'ses_owner', userId: OWNER.id } as never;
    request.apiKeyPrincipal = { kind: 'api-key', id: 'key_1', label: 'Key', roleId: 'rol_1' } as never;
  });
  const seen = async (request: FastifyRequest) => ({ user: request.user?.id ?? null, session: request.session?.id ?? null, refund: await request.can('system:payments:refund') });
  await app.register(async (door) => {
    strangerDoor(door);
    door.post('/x/forms/api/:slug/answers', async (request) => seen(request));
    door.get('/x/forms/api/:slug', async (request) => seen(request));
  });
  app.get('/api/v1/me', async (request) => seen(request));
  await app.ready();
  return app;
}

describe('a stranger\'s door', () => {
  it('runs every request as nobody, whatever session or key arrives: the owner\'s refund right is never used', async () => {
    const app = await server();
    const answer = await app.inject({ method: 'POST', url: '/x/forms/api/refund-request/answers', payload: {} });
    expect(answer.json()).toEqual({ user: null, session: null, refund: false });
    const read = await app.inject({ method: 'GET', url: '/x/forms/api/refund-request' });
    expect(read.json()).toEqual({ user: null, session: null, refund: false });
    // A preview's read keeps the session (the door then asks the person's own grant); a write that says preview does not.
    expect((await app.inject({ method: 'GET', url: '/x/forms/api/refund-request?preview=1' })).json()).toEqual({ user: OWNER.id, session: 'ses_owner', refund: true });
    expect((await app.inject({ method: 'POST', url: '/x/forms/api/refund-request/answers?preview=1', payload: {} })).json()).toEqual({ user: null, session: null, refund: false });
    expect((await app.inject({ method: 'GET', url: '/x/forms/api/refund-request?preview=yes' })).json()).toMatchObject({ user: null });
    // Outside the door, the session stands.
    expect((await app.inject({ method: 'GET', url: '/api/v1/me' })).json()).toEqual({ user: OWNER.id, session: 'ses_owner', refund: true });
    await app.close();
  });

  it('knows a preview\'s read by its method and its query alone', () => {
    expect(asksPreviewRead({ method: 'GET', query: { preview: '1' } })).toBe(true);
    expect(asksPreviewRead({ method: 'HEAD', query: { preview: '1' } })).toBe(true);
    expect(asksPreviewRead({ method: 'POST', query: { preview: '1' } })).toBe(false);
    expect(asksPreviewRead({ method: 'DELETE', query: { preview: '1' } })).toBe(false);
    expect(asksPreviewRead({ method: 'GET', query: {} })).toBe(false);
  });
});
