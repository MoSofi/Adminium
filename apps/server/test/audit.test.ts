/**
 * Audit query-route tests (08-server-api.md §2.14, M2-T06): RBAC guard,
 * category/actor/date-range/resource filters, keyset pagination, detail
 * fetch. Entries are seeded with controlled timestamps via auditRepo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditRepo, destroyMetaDb, type AuditEntry } from '@adminium/meta';

import { asUser, buildRbacTestApp, type RbacTestContext } from './rbac-helpers.js';

let ctx: RbacTestContext;

const BASE = 1_700_000_000_000;

/** 25 seeded entries, 1 s apart, alternating category/action/actor. */
async function seedEntries(): Promise<AuditEntry[]> {
  const audit = auditRepo(ctx.meta);
  const entries: AuditEntry[] = [];
  for (let i = 0; i < 25; i += 1) {
    entries.push(
      await audit.append(
        {
          actorKind: 'user',
          actorId: i % 2 === 0 ? 'usr_even' : 'usr_odd',
          actorLabel: i % 2 === 0 ? 'Even User' : 'Odd User',
          category: i % 5 === 0 ? 'auth' : 'data',
          action: i % 5 === 0 ? 'session.create' : 'record.update',
          changes: { after: { i } },
        },
        BASE + i * 1000,
      ),
    );
  }
  return entries;
}

beforeEach(async () => {
  ctx = await buildRbacTestApp();
});

afterEach(async () => {
  await ctx.app.close();
  await destroyMetaDb(ctx.meta);
});

describe('GET /audit', () => {
  it('requires system:audit:read', async () => {
    const denied = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit', headers: asUser(ctx.users.viewer) });
    expect(denied.statusCode).toBe(403);
    const allowed = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit', headers: asUser(ctx.users.superAdmin) });
    expect(allowed.statusCode).toBe(200);
  });

  it('filters by category, actor, resource, and date range', async () => {
    await seedEntries();
    const headers = asUser(ctx.users.superAdmin);

    const byCategory = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit?category=auth', headers });
    const authEntries = (byCategory.json() as { entries: { category: string }[] }).entries;
    expect(authEntries).toHaveLength(5);
    expect(authEntries.every((entry) => entry.category === 'auth')).toBe(true);

    const byActor = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit?actorId=usr_odd', headers });
    expect((byActor.json() as { entries: unknown[] }).entries).toHaveLength(12);

    // resource filter matches the dotted-verb prefix: record → record.update.
    const byResource = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit?resource=record', headers });
    const recordEntries = (byResource.json() as { entries: { action: string }[] }).entries;
    expect(recordEntries).toHaveLength(20);
    expect(recordEntries.every((entry) => entry.action.startsWith('record.'))).toBe(true);

    // Inclusive range picking exactly entries 10..14.
    const from = BASE + 10_000;
    const to = BASE + 14_000;
    const byRange = await ctx.app.inject({ method: 'GET', url: `/api/v1/audit?from=${from}&to=${to}`, headers });
    const ranged = (byRange.json() as { entries: { createdAt: number }[] }).entries;
    expect(ranged).toHaveLength(5);
    expect(ranged.every((entry) => entry.createdAt >= from && entry.createdAt <= to)).toBe(true);
  });

  it('paginates with a keyset cursor: newest-first, no gaps, no overlap', async () => {
    const seeded = await seedEntries();
    const headers = asUser(ctx.users.superAdmin);

    const page1 = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit?limit=10', headers });
    const body1 = page1.json() as { entries: { id: string; createdAt: number }[]; nextCursor: string | null };
    expect(body1.entries).toHaveLength(10);
    expect(body1.nextCursor).not.toBeNull();
    // Newest first.
    expect(body1.entries[0]?.createdAt).toBe(BASE + 24_000);

    const page2 = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/audit?limit=10&cursor=${body1.nextCursor}`,
      headers,
    });
    const body2 = page2.json() as { entries: { id: string }[]; nextCursor: string | null };
    expect(body2.entries).toHaveLength(10);
    expect(body2.nextCursor).not.toBeNull();

    const page3 = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/audit?limit=10&cursor=${body2.nextCursor}`,
      headers,
    });
    const body3 = page3.json() as { entries: { id: string }[]; nextCursor: string | null };
    expect(body3.entries).toHaveLength(5);
    expect(body3.nextCursor).toBeNull();

    const collected = [...body1.entries, ...body2.entries, ...body3.entries].map((entry) => entry.id);
    expect(new Set(collected).size).toBe(25);
    expect(new Set(collected)).toEqual(new Set(seeded.map((entry) => entry.id)));
  });

  it('rejects a malformed cursor with 422', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/audit?cursor=%%%not-a-cursor',
      headers: asUser(ctx.users.superAdmin),
    });
    expect(res.statusCode).toBe(422);
  });

  it('GET /audit/:id returns the structured entry; unknown id → 404', async () => {
    const [first] = await seedEntries();
    const headers = asUser(ctx.users.superAdmin);
    const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/audit/${first?.id}`, headers });
    expect(res.statusCode).toBe(200);
    const entry = res.json() as { id: string; action: string; changes: { after: { i: number } } };
    expect(entry.id).toBe(first?.id);
    expect(entry.action).toBe('session.create');
    expect(entry.changes.after.i).toBe(0);

    const missing = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit/aud_missing', headers });
    expect(missing.statusCode).toBe(404);
  });
});
