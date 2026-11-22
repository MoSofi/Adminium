// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN OPEN CONNECTION DOES NOT OUTLIVE THE ACCOUNT. Sockets and event streams
 * are signed in once, when they open. Suspending or deleting the person closes
 * them at once, and a connection the close did not reach (the account changed
 * by another server process) is refused its next frame and its next
 * subscription, because each asks whether the account is still active.
 */
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createFirstSuperAdmin, rolesRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { registerJobsAndRealtime, type JobsAndRealtime } from '../src/jobs/register.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import type { RealtimeUser } from '../src/realtime/hub.js';
import { usersRoutes } from '../src/routes/users/index.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { until } from './jobs-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

interface Frame {
  op?: string;
  code?: string;
  channel?: string;
  type?: string;
}

describe.each(META_ENGINES.map((engine) => [engine.name, engine] as const))('an open connection after the account stops — %s', (_name, engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: AdminiumServer;
  let realtime: JobsAndRealtime;
  let port = 0;
  let adminCookie = '';
  let seq = 0;
  const opened: WebSocket[] = [];
  const streams: IncomingMessage[] = [];

  async function signIn(email: string): Promise<string> {
    seq += 1;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.77.0.${String(seq)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return sessionCookie(res.headers['set-cookie']);
  }

  async function person(): Promise<{ user: User; cookie: string }> {
    seq += 1;
    const email = `person${String(seq)}@example.com`;
    const user = await usersRepo(meta).create({ email, name: 'Sam Lee', passwordHash: await adminPasswordHash() });
    return { user, cookie: await signIn(email) };
  }

  /** An open socket subscribed to `config-changed`, with what it has heard. */
  async function socketOf(cookie: string): Promise<{ socket: WebSocket; frames: Frame[]; closed: () => boolean }> {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, { headers: { cookie } });
    socket.on('error', () => undefined);
    opened.push(socket);
    const frames: Frame[] = [];
    let isClosed = false;
    socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as Frame));
    socket.on('close', () => {
      isClosed = true;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({ op: 'subscribe', channel: 'config-changed' }));
    await until(() => frames.some((frame) => frame.op === 'subscribed'));
    return { socket, frames, closed: () => isClosed };
  }

  /** An open event stream on `config-changed`, with what it has received. */
  async function streamOf(cookie: string): Promise<{ text: () => string; closed: () => boolean }> {
    let body = '';
    let isClosed = false;
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/api/v1/events?channels=config-changed', headers: { cookie } }, resolve).on('error', reject);
    });
    expect(res.statusCode).toBe(200);
    streams.push(res);
    res.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    res.on('close', () => {
      isClosed = true;
    });
    res.on('error', () => undefined);
    await until(() => body.includes('retry:'));
    await until(() => realtime.hub.subscriberCount('config-changed') > 0);
    return { text: () => body, closed: () => isClosed };
  }

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: 'Ava Reyes', passwordHash: await adminPasswordHash() });
    app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    await app.register(rbacPlugin, { meta });
    realtime = await registerJobsAndRealtime(app, {
      meta,
      resolveUser: (request: FastifyRequest): RealtimeUser | null => (request.user === null ? null : { id: request.user.id }),
      can: async (user, permission) => permissionSetAllows(await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.id }), permission),
      startWorker: false,
      startScheduler: false,
    });
    await app.register(async (api) => api.register(usersRoutes), { prefix: '/api/v1' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    adminCookie = await signIn(ADMIN_EMAIL);
    expect(await rolesRepo(meta).findBySlug('super-admin')).not.toBeNull();
  }, 120_000);

  afterAll(async () => {
    if (!engine.available) return;
    for (const socket of opened) socket.terminate();
    for (const stream of streams) stream.destroy();
    await app.close();
    await handle.destroy();
  });

  const suspend = async (id: string) => {
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/users/${id}`, headers: { cookie: adminCookie }, payload: { status: 'suspended' } });
    expect(res.statusCode, res.body).toBe(200);
  };

  it.skipIf(!engine.available)('suspending closes that person’s socket and stream, and nobody else’s', async () => {
    const sam = await person();
    const other = await person();
    const socket = await socketOf(sam.cookie);
    const stream = await streamOf(sam.cookie);
    const bystander = await socketOf(other.cookie);
    await suspend(sam.user.id);
    await until(() => socket.closed() && stream.closed());
    realtime.hub.publish('config-changed', 'after-suspend', {});
    await until(() => bystander.frames.some((frame) => frame.type === 'after-suspend'));
    expect(bystander.closed()).toBe(false);
    expect(socket.frames.some((frame) => frame.type === 'after-suspend')).toBe(false);
    expect(stream.text()).not.toContain('after-suspend');
  });

  it.skipIf(!engine.available)('removing the account closes them too, whether it is suspended or deleted for good', async () => {
    for (const query of ['', '?permanent=true']) {
      const sam = await person();
      const socket = await socketOf(sam.cookie);
      const stream = await streamOf(sam.cookie);
      const res = await app.inject({ method: 'DELETE', url: `/api/v1/users/${sam.user.id}${query}`, headers: { cookie: adminCookie } });
      expect(res.statusCode, res.body).toBe(200);
      await until(() => socket.closed() && stream.closed());
    }
  });

  it.skipIf(!engine.available)('an account stopped where the close cannot reach gets no further frame, and the connection ends', async () => {
    const sam = await person();
    const socket = await socketOf(sam.cookie);
    const stream = await streamOf(sam.cookie);
    // As another server process would: the row changes, this process's hub hears nothing.
    await usersRepo(meta).updateStatus(sam.user.id, 'suspended');
    realtime.hub.publish('config-changed', 'not-for-them', {});
    await until(() => socket.closed() && stream.closed());
    expect(socket.frames.some((frame) => frame.type === 'not-for-them')).toBe(false);
    expect(stream.text()).not.toContain('not-for-them');
  });

  it.skipIf(!engine.available)('a stopped account cannot subscribe to anything more', async () => {
    const sam = await person();
    const socket = await socketOf(sam.cookie);
    await usersRepo(meta).updateStatus(sam.user.id, 'suspended');
    socket.socket.send(JSON.stringify({ op: 'subscribe', channel: `notifications:${sam.user.id}` }));
    await until(() => socket.closed());
    expect(socket.frames.some((frame) => frame.op === 'subscribed' && frame.channel === `notifications:${sam.user.id}`)).toBe(false);
    expect(realtime.hub.subscriberCount(`notifications:${sam.user.id}`)).toBe(0);
  });

  it.skipIf(!engine.available)('an active person keeps their connection and their frames', async () => {
    const sam = await person();
    const socket = await socketOf(sam.cookie);
    realtime.hub.publish('config-changed', 'still-theirs', {});
    await until(() => socket.frames.some((frame) => frame.type === 'still-theirs'));
    expect(socket.closed()).toBe(false);
  });
});
