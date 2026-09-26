// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an update takes back from an app's public access, and what it gives
 * only when the operator says so — on every engine this run can reach.
 *
 * A version that stops declaring an entry, or a key, takes it back from the
 * app's live keys on every update: when the version declares no public access
 * at all, when the operator revoked the guests' key, when an entry the version
 * keeps cannot be made, and when a key already holds something that would no
 * longer be allowed. What a version adds is given only on an explicit
 * `publicAccess: true`, each grant is audited the moment it is written, and a
 * staff screen's key opens to a shared link only when the check said so and
 * the operator allowed it.
 */
import { auditRepo, overridesRepo, publicEndpointsRepo, publicKeysRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { KeyCreateRefused, createEndpointService } from '../src/public-api/endpoint-service.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness, type PublicAccessHooks } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const TOKEN = 'HARBRXNKSTWYZ202';
const id = { ref: 'id', type: 'int', role: 'pk' };
const TABLES = [
  {
    ref: 'projects',
    columns: [
      id,
      { ref: 'name', type: 'text', maxLength: 120 },
      { ref: 'share_token', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { code: { length: 16 } } },
    ],
  },
  { ref: 'faqs', columns: [id, { ref: 'question', type: 'text', maxLength: 120 }] },
  { ref: 'enquiries', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
  { ref: 'clients', columns: [id, { ref: 'email', type: 'text', maxLength: 120 }, { ref: 'pin', type: 'text', maxLength: 8 }] },
  { ref: 'notes', columns: [id, { ref: 'client_id', type: 'fk', references: 'clients' }, { ref: 'body', type: 'text', maxLength: 200, nullable: true }] },
];

const faqs = { table: 'faqs', methods: ['GET'], select: ['question'] };
const enquiries = { table: 'enquiries', methods: ['POST'], select: ['id'], writable: ['name'] };
const handover = { table: 'projects', methods: ['GET'], select: ['name'], claim: { by: 'token', column: 'share_token' }, key: 'handover' };
const client = { table: 'clients', methods: ['GET'], select: ['id'], claim: { match: ['email', 'pin'] } };
const notes = { table: 'notes', methods: ['GET', 'PATCH'], select: ['body'], writable: ['body'], claimedBy: { table: 'clients', column: 'client_id' } };

/** A studio's version: its public access and second keys as given, none when absent. */
function version(v: string, access?: Record<string, unknown>[], keys?: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...invoicingManifest(TABLES),
    version: v,
    compatibility: { minAdminiumVersion: '0.3.0', updatesFrom: '>=0.2.0' },
    ...(keys === undefined ? {} : { publicKeys: keys }),
    ...(access === undefined ? {} : { publicAccess: access }),
    ...extra,
  };
}

describe.each(LEGS)('an update takes back what its version drops — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  afterEach(async () => {
    await h?.close();
  });

  const install = async (manifest: Record<string, unknown>, hooks: PublicAccessHooks = {}) => {
    h = await installInvoicing(dialect, manifest, undefined, {}, {}, hooks);
    return (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
  };
  const stage = async (manifest: Record<string, unknown>) => {
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'staff/index.html': '<!doctype html><html></html>' });
    const staged = await h.app.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(200);
  };
  const update = async (payload: Record<string, unknown> = {}) => {
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update', payload });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { app: { publicAccess?: { granted?: Record<string, string[]>; skipped: { ref: string; reason: string }[] } } };
  };
  /** What a key holds, read from the key row itself. */
  const holds = async (keyId: string) => {
    const access = JSON.parse((await publicKeysRepo(h.meta).findById(keyId))!.access ?? '{}') as Record<string, string[]>;
    const refOf = new Map((await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((e) => [e.id, e.ref]));
    return Object.fromEntries(Object.entries(access).map(([endpointId, methods]) => [refOf.get(endpointId) ?? endpointId, methods]));
  };
  const audited = async (action: string) =>
    (await auditRepo(h.meta).list({ limit: 200 })).filter((row) => row.action === action).map((row) => row.changes as Record<string, Record<string, unknown>>);
  const revoked = async (keyId: string) => (await publicKeysRepo(h.meta).findById(keyId))!.revokedAt !== null;

  it.skipIf(!available)('takes back every entry and the link key when the new version declares no public access at all', async () => {
    const keys = await install(version('0.2.0', [faqs, handover], { handover: {} }));
    await h.rows(`INSERT INTO ${h.real('faqs')} (question) VALUES ('How long does a logo take?')`);
    await h.rows(`INSERT INTO ${h.real('projects')} (name, share_token) VALUES ('Harbour rebrand', '${TOKEN}')`);
    await stage(version('0.2.1'));
    await update();

    expect(await holds(keys['customer']!)).toEqual({});
    expect(await revoked(keys['customer']!)).toBe(false);
    expect(await revoked(keys['handover']!)).toBe(true);
    expect((await audited('public-key.withdraw')).map((c) => c['after'])).toEqual([expect.objectContaining({ keyId: keys['customer'], withdrawn: ['studio_faqs'] })]);
    expect((await audited('public-key.revoke')).map((c) => c['before'])).toEqual([expect.objectContaining({ keyId: keys['handover'], purpose: 'handover' })]);
    // A server that never saw either key: nothing answers.
    const served = await servePublic(h, keys['customer']!);
    try {
      expect((await served.get('/records/studio_faqs')).statusCode).toBeGreaterThanOrEqual(400);
      await served.useKey(keys['handover']!);
      const claim = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim/token', headers: served.headers(), payload: { token: TOKEN } });
      expect(claim.statusCode).toBe(401);
    } finally {
      await served.close();
    }
  }, 120_000);

  it.skipIf(!available)('takes back a dropped link key when the operator revoked the guests’ key', async () => {
    const keys = await install(version('0.2.0', [faqs, handover], { handover: {} }));
    await publicKeysRepo(h.meta).revoke(keys['customer']!);
    await stage(version('0.2.1', [faqs]));
    await update({ publicAccess: true });
    expect(await revoked(keys['handover']!)).toBe(true);
    // Nor is the guests' key made again: the operator took it back.
    expect((await publicKeysRepo(h.meta).listManagedBy('studio')).filter((k) => k.revokedAt === null)).toEqual([]);
  }, 120_000);

  it.skipIf(!available)('takes back a dropped entry though an entry it keeps cannot be made, and the key holds one it may no longer', async () => {
    const keys = await install(version('0.2.0', [faqs, client, notes]));
    expect(Object.keys(await holds(keys['customer']!)).sort()).toEqual(['studio_clients_claimed', 'studio_faqs', 'studio_notes_claimed']);
    // Adminium now decides the note's body (a code): a guest may no longer write it.
    const source = (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).find((e) => e.ref === 'studio_notes_claimed')!;
    const table = (JSON.parse(source.definition) as { source: string }).source;
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.code', tableName: table, columnName: 'body', value: { length: 8 } });
    // What the key keeps is no longer allowed: a write that checks it refuses the whole key, dropped entry and all.
    const service = createEndpointService({ meta: h.meta, viewFor: createPublicViews(h.meta).viewFor, tenantConfigOf: async () => undefined });
    const kept = [
      { ref: 'studio_clients_claimed', methods: ['GET' as const] },
      { ref: 'studio_notes_claimed', methods: ['GET' as const, 'PATCH' as const] },
    ];
    await expect(service.setManagedAccess({ connectionId: h.connectionId, keyId: keys['customer']!, access: kept })).rejects.toBeInstanceOf(KeyCreateRefused);

    await stage(version('0.2.1', [client, notes]));
    const reply = await update({ publicAccess: true });
    // The note's entry cannot be made as declared: the rest of the refresh stops, and says nothing.
    expect(reply.app.publicAccess).toBeUndefined();
    // The FAQs are gone from the key all the same; what it keeps, it keeps.
    expect(await holds(keys['customer']!)).toEqual({ studio_clients_claimed: ['GET'], studio_notes_claimed: ['GET', 'PATCH'] });
    expect((await audited('public-key.withdraw')).map((c) => c['after'])).toEqual([expect.objectContaining({ keyId: keys['customer'], withdrawn: ['studio_faqs'] })]);
  }, 120_000);

  it.skipIf(!available)('audits and forgets a grant the moment it is written, though a later step of the update fails', async () => {
    const forgotten: string[] = [];
    const keys = await install(version('0.2.0', [faqs]), {
      invalidateKey: (keyId) => forgotten.push(keyId),
      // The link key a version adds is refused beside the connection's other keys.
      service: (real) => ({
        ...real,
        createKey: async (input) => {
          if (input.purpose === 'handover') throw new KeyCreateRefused([{ code: 'KEY_LINK_WRITTEN', message: 'another key writes the link it reads by' }]);
          return real.createKey(input);
        },
      }),
    });
    await stage(version('0.2.1', [faqs, enquiries, handover], { handover: {} }));
    forgotten.length = 0;
    const reply = await update({ publicAccess: true });
    expect(reply.app.publicAccess).toBeUndefined();
    // The guests' key did gain the enquiry form before the link key was refused…
    expect(await holds(keys['customer']!)).toEqual({ studio_enquiries: ['POST'], studio_faqs: ['GET'] });
    // …and that is on the record, and no resolver keeps its old scope.
    expect((await audited('public-key.grant')).map((c) => c['after'])).toEqual([
      expect.objectContaining({ keyId: keys['customer'], purpose: 'customer', granted: ['studio_enquiries'] }),
    ]);
    expect(forgotten).toContain(keys['customer']);
  }, 120_000);

  it.skipIf(!available)('gives what a version adds only when asked to', async () => {
    const keys = await install(version('0.2.0', [faqs]));
    await stage(version('0.2.1', [faqs, enquiries]));
    const quiet = await update();
    expect(quiet.app.publicAccess?.granted).toBeUndefined();
    expect(quiet.app.publicAccess?.skipped).toEqual([{ ref: 'studio_enquiries', reason: expect.stringContaining('"publicAccess": true') }]);
    expect(Object.keys(await holds(keys['customer']!))).toEqual(['studio_faqs']);
    await stage(version('0.2.2', [faqs, enquiries]));
    const asked = await update({ publicAccess: true });
    expect(asked.app.publicAccess?.granted).toEqual({ customer: ['studio_enquiries'] });
  }, 120_000);

  it.skipIf(!available)('opens a staff screen’s key to a shared link only when the check says so and the operator allows it', async () => {
    // The desk's screen lists the projects beside a staff sign-in; the next version hands the same key out in links.
    const desk = { roles: [{ key: 'desk', name: 'Desk', screensOnly: true, permissions: ['app:@:staff'] }] };
    const list = { table: 'projects', methods: ['GET'], select: ['name'], key: 'handover' };
    const keys = await install(version('0.2.0', [faqs, list], { handover: { requiresStaff: { role: 'desk' } } }, desk));
    const bound = async () => (await publicKeysRepo(h.meta).findById(keys['handover']!))!.requiresStaff;
    expect(await bound()).not.toBeNull();
    const plan = async (v: string) => {
      const res = await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: v, connectionId: h.connectionId } });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { plan: { publicAccess: { opensWithoutStaff?: string[] } } }).plan.publicAccess;
    };

    // The key no longer bound to a staff sign-in: its token alone would list every project.
    await stage(version('0.2.1', [faqs, list, handover], { handover: {} }, desk));
    expect((await plan('0.2.1')).opensWithoutStaff).toEqual(['handover']);
    await update();
    expect(await bound()).not.toBeNull();

    await stage(version('0.2.2', [faqs, list, handover], { handover: {} }, desk));
    expect((await plan('0.2.2')).opensWithoutStaff).toEqual(['handover']);
    await update({ publicAccess: true });
    expect(await bound()).toBeNull();
    expect((await audited('public-key.rebind')).map((c) => c['after'])).toEqual([
      expect.objectContaining({ keyId: keys['handover'], purpose: 'handover', requiresStaff: null }),
    ]);
    expect(await revoked(keys['handover']!)).toBe(false);
  }, 120_000);
});
