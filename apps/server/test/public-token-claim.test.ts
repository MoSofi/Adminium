// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A row shared by link — a studio's handover page — over the wire, through
 * an app installed by the real installer, on every engine this run can reach.
 *
 * The link's code opens that one row and what its key declares with it, read
 * only; stopping it, its expiry or a new code closes every session at once;
 * an unknown code is the one 404, and guessing is held to a few a minute.
 */
import { publicKeysRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compileScope, ScopeCompileError, type PublicScopeDocument } from '../src/public-api/scope.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const TOKEN = 'ABCDEFGHJKMNPQRS';
const OTHER = 'ZZZZ1111ZZZZ1111';

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'projects',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 120 },
          { ref: 'share_token', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16 } } },
          { ref: 'share_expires_on', type: 'date', nullable: true },
          { ref: 'share_stopped', type: 'bool', default: false },
        ],
      },
      {
        ref: 'deliverables',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'project_id', type: 'fk', references: 'projects' },
          { ref: 'title', type: 'text', maxLength: 120 },
          { ref: 'status', type: 'enum', enum: ['draft', 'approved'], default: 'draft' },
        ],
      },
    ]),
    publicKeys: { handover: {} },
    publicAccess: [
      { table: 'projects', methods: ['GET'], select: ['name'], claim: { by: 'token', column: 'share_token', expires: 'share_expires_on', stopped: 'share_stopped' }, key: 'handover' },
      {
        table: 'deliverables',
        methods: ['GET'],
        select: ['id', 'title'],
        claimedBy: { table: 'projects', column: 'project_id' },
        filters: [{ column: 'status', op: 'eq', value: 'approved' }],
        key: 'handover',
      },
    ],
  };
}

describe.each(LEGS)('a row shared by link — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let ip = 0;
  const from = () => {
    ip += 1;
    return `10.7.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const open = (token: string, remoteAddress = from()) =>
    served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim/token', remoteAddress, headers: served.headers(), payload: { token } });
  const sessionOf = async (token: string) => {
    const res = await open(token);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { session: string } }).data.session;
  };
  const titles = async (session?: string) => {
    const res = await served.get(`/records/${h.real('deliverables')}_claimed`, session);
    return res.statusCode === 200 ? (res.json() as { data: { title: string }[] }).data.map((d) => d.title) : res.statusCode;
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    const t = (short: string) => h.real(short);
    await h.rows(`insert into ${t('projects')} (name, share_token, share_stopped) values ('Harbour rebrand', '${TOKEN}', ${dialect === 'postgres' ? 'false' : '0'})`);
    await h.rows(`insert into ${t('projects')} (name, share_token, share_stopped) values ('Other studio job', '${OTHER}', ${dialect === 'postgres' ? 'false' : '0'})`);
    await h.rows(`insert into ${t('deliverables')} (project_id, title, status) values (1, 'Logo files', 'approved')`);
    await h.rows(`insert into ${t('deliverables')} (project_id, title, status) values (1, 'Draft poster', 'draft')`);
    await h.rows(`insert into ${t('deliverables')} (project_id, title, status) values (2, 'Not theirs', 'approved')`);
    const keys = await publicKeysRepo(h.meta).listManagedBy('studio');
    const handover = keys.find((key) => key.purpose === 'handover')!;
    expect(handover.requiresStaff).toBeNull();
    served = await servePublic(h, handover.id);
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('opens that one row and what its key declares with it, as the code is typed or pasted', async () => {
    const session = await sessionOf(TOKEN);
    expect(await titles(session)).toEqual(['Logo files']);
    expect((await served.get(`/records/${h.real('projects')}_claimed`, session)).json()).toMatchObject({ data: [{ name: 'Harbour rebrand' }] });
    // Lower case, spaced, the look-alike letters: the same code.
    expect(await titles(await sessionOf('abcd efgh jkmn pqrs'))).toEqual(['Logo files']);
    // Without a session, nothing.
    expect(await titles()).toBe(404);
  });

  it.skipIf(!available)('answers one 404 for a code that opens nothing, and no lookup claim at all', async () => {
    const res = await open('QQQQQQQQQQQQQQQQ');
    expect(res.statusCode).toBe(404);
    expect(served.codeOf(res)).toBe('PUBLIC_REF_NOT_FOUND');
    const lookup = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim', remoteAddress: from(), headers: served.headers(), payload: { match: { share_token: TOKEN } } });
    expect(served.codeOf(lookup)).toBe('PUBLIC_CLAIM_UNAVAILABLE');
  });

  it.skipIf(!available)('holds a guesser to ten tries a minute', async () => {
    const address = '10.99.0.1';
    for (let i = 0; i < 10; i += 1) expect((await open(`GUESS${String(i).padStart(11, '0')}`, address)).statusCode).toBe(404);
    expect((await open(TOKEN, address)).statusCode).toBe(429);
  });

  it.skipIf(!available)('closes at once when stopped, and opens no new session while it is', async () => {
    const session = await sessionOf(TOKEN);
    expect(await titles(session)).toEqual(['Logo files']);
    await h.rows(`update ${h.real('projects')} set share_stopped = ${dialect === 'postgres' ? 'true' : '1'} where id = 1`);
    expect(await titles(session)).toBe(404);
    const refused = await open(TOKEN);
    expect(refused.statusCode).toBe(410);
    expect(served.codeOf(refused)).toBe('LINK_EXPIRED');
    await h.rows(`update ${h.real('projects')} set share_stopped = ${dialect === 'postgres' ? 'false' : '0'} where id = 1`);
    // The stopped session stays ended; a fresh one opens again.
    expect(await titles(session)).toBe(404);
    expect(await titles(await sessionOf(TOKEN))).toEqual(['Logo files']);
  });

  it.skipIf(!available)('works through its last day, and not the day after', async () => {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    await h.rows(`update ${h.real('projects')} set share_expires_on = '${day(1)}' where id = 1`);
    const session = await sessionOf(TOKEN);
    await h.rows(`update ${h.real('projects')} set share_expires_on = '${day(-1)}' where id = 1`);
    expect(await titles(session)).toBe(404);
    expect((await open(TOKEN)).statusCode).toBe(410);
    await h.rows(`update ${h.real('projects')} set share_expires_on = null where id = 1`);
  });

  it.skipIf(!available)('closes every session when the row takes a new code', async () => {
    const session = await sessionOf(TOKEN);
    await h.rows(`update ${h.real('projects')} set share_token = 'NEWC0DE000000000' where id = 1`);
    expect(await titles(session)).toBe(404);
    expect((await open(TOKEN)).statusCode).toBe(404);
    expect(await titles(await sessionOf('NEWC0DE000000000'))).toEqual(['Logo files']);
  });
});

describe('the scope of a shared link', () => {
  it('only reads', () => {
    const document = {
      version: 1,
      side: 'customer',
      timezone: 'UTC',
      claim: { strategy: 'token', ref: 'projects', match: ['share_token'], stopped: 'share_stopped' },
      resources: [
        { ref: 'projects', table: 'public.projects', actions: ['read'], expose: ['name'], claim: { column: 'id' } },
        { ref: 'notes', table: 'public.notes', actions: ['read', 'create'], expose: ['id'], writable: ['body'], claim: { column: 'project_id', ref: 'projects' } },
      ],
    } as PublicScopeDocument;
    const codes = () => {
      try {
        compileScope(document);
        return [];
      } catch (error) {
        if (!(error instanceof ScopeCompileError)) throw error;
        return error.issues.map((issue) => issue.code);
      }
    };
    expect(codes()).toContain('SCOPE_CLAIM_TOKEN_READ_ONLY');
    document.resources[1]!.actions = ['read'];
    document.resources[1]!.writable = [];
    expect(codes()).toEqual([]);
  });
});
