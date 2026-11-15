// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CUSTOMER SIDE'S REHEARSAL CONFIG (`payments/rehearsal.ts`).
 *
 * A person rehearsing an app's checkout on its customer side is handed the
 * CSRF token their public-API writes need, and until when the rehearsal runs;
 * someone not rehearsing, without the payments right, or not signed in gets
 * nothing.
 */
import BetterSqlite3 from 'better-sqlite3';
import type { FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';

import { REHEARSAL_MS, rehearsalConfig, setRehearsal } from '../src/payments/rehearsal.js';

describe("the customer side's rehearsal config", () => {
  let meta: MetaDb;
  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  const request = (over: { user?: { id: string } | null; manages?: boolean; session?: { id: string } | null } = {}) =>
    ({
      user: over.user === undefined ? { id: 'u-1' } : over.user,
      session: over.session === undefined ? { id: 's-1' } : over.session,
      can: async (permission: string) => permission === 'system:payments:manage' && over.manages !== false,
      server: { hasDecorator: (name: string) => name === 'csrfTokenFor', csrfTokenFor: (id: string) => `tok-${id}` },
    }) as unknown as FastifyRequest;

  it('hands the token and the end of the rehearsal to the person rehearsing, and nothing to anyone else', async () => {
    expect(await rehearsalConfig(meta, request())).toEqual({});
    const at = Date.now();
    await setRehearsal(meta, 'u-1', true, at);
    const config = await rehearsalConfig(meta, request());
    expect(config.rehearsal?.csrfToken).toBe('tok-s-1');
    expect(Date.parse(config.rehearsal!.until)).toBe(at + REHEARSAL_MS);
    expect(await rehearsalConfig(meta, request({ manages: false }))).toEqual({});
    expect(await rehearsalConfig(meta, request({ session: null }))).toEqual({});
    expect(await rehearsalConfig(meta, request({ user: { id: 'u-2' } }))).toEqual({});
    await setRehearsal(meta, 'u-1', false);
    expect(await rehearsalConfig(meta, request())).toEqual({});
  });

  it('lapses on its own', async () => {
    await setRehearsal(meta, 'u-1', true, Date.now() - REHEARSAL_MS - 1);
    expect(await rehearsalConfig(meta, request())).toEqual({});
  });
});
