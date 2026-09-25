// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A signed-in person downloads the file a row of theirs names — over the
 * wire, uploaded through the real files route, on every engine this run can
 * reach.
 *
 * The row is read through the resource's whole scope (here a version, visible
 * only with a shared deliverable of theirs); the file is the one that column
 * names; an image or a PDF opens inline, an SVG or anything else downloads;
 * every response is sandboxed, unsniffed and privately cached. Another
 * client's, an unshared one's, a column not offered, a URL in the column, a
 * file thrown away or of another connection: the one 404.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a tiny picture of a logo')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'clients', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, { ref: 'name', type: 'text', maxLength: 120 }] },
      { ref: 'deliverables', columns: [id, { ref: 'client_id', type: 'fk', references: 'clients' }, { ref: 'status', type: 'enum', enum: ['unshared', 'pending'], default: 'unshared' }] },
      {
        ref: 'deliverable_versions',
        columns: [
          id,
          { ref: 'deliverable_id', type: 'fk', references: 'deliverables' },
          { ref: 'file', type: 'text', maxLength: 400, nullable: true },
          { ref: 'note', type: 'text', maxLength: 400, nullable: true },
        ],
      },
    ]),
    publicAccess: [
      { table: 'clients', methods: ['GET'], select: ['name'], claim: { match: ['email', 'name'] } },
      { table: 'deliverables', methods: ['GET'], select: ['id', 'status'], claimedBy: { table: 'clients', column: 'client_id' }, filters: [{ column: 'status', op: 'neq', value: 'unshared' }] },
      { table: 'deliverable_versions', methods: ['GET'], select: ['id', 'file', 'note'], files: ['file'], visibleWith: { table: 'deliverables', via: 'deliverable_id' } },
    ],
  };
}

describe.each(LEGS)('a private file, through the row that names it — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let dataDir: string;
  let ada: string;
  let ben: string;
  const files: Record<string, string> = {};
  const versions = () => `${h.real('deliverable_versions')}_claimed`;
  const download = (row: number, session?: string, column = 'file') => served.get(`/files/${versions()}/${String(row)}/${column}`, session);

  beforeAll(async () => {
    if (!available) return;
    dataDir = await mkdtemp(join(tmpdir(), 'public-files-'));
    h = await installInvoicing(dialect, manifest());
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId, { ADMINIUM_DATA_DIR: dataDir });
    // The desk uploads, as it does from a record's page.
    const desk = await usersRepo(h.meta).create({ email: 'desk@studio.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@studio.dev', password: ADMIN_PASSWORD } });
    const cookie = sessionCookie(login.headers['set-cookie']);
    for (const [name, bytes, type] of [
      ['logo.png', PNG, 'image/png'],
      ['proof.pdf', PDF, 'application/pdf'],
      ['mark.svg', SVG, 'image/svg+xml'],
      ['notes.txt', Buffer.from('plain words'), 'text/plain'],
      ['other.png', PNG, 'image/png'],
      ['gone.png', PNG, 'image/png'],
    ] as const) {
      const res = await served.composed.app.inject({
        method: 'POST',
        url: `/api/v1/files?filename=${name}&connectionId=${h.connectionId}`,
        headers: { cookie, 'content-type': type },
        payload: bytes,
      });
      expect(res.statusCode, res.body).toBe(201);
      files[name] = (res.json() as { data: { id: string } }).data.id;
    }
    const t = h.real;
    await h.rows(`insert into ${t('clients')} (email, name) values ('ada@example.com', 'Ada')`);
    await h.rows(`insert into ${t('clients')} (email, name) values ('ben@example.com', 'Ben')`);
    await h.rows(`insert into ${t('deliverables')} (client_id, status) values (1, 'pending')`);
    await h.rows(`insert into ${t('deliverables')} (client_id, status) values (1, 'unshared')`);
    await h.rows(`insert into ${t('deliverables')} (client_id, status) values (2, 'pending')`);
    const version = (deliverable: number, file: string | null, note = 'n') =>
      h.rows(`insert into ${t('deliverable_versions')} (deliverable_id, file, note) values (${String(deliverable)}, ${file === null ? 'null' : `'${file}'`}, '${note}')`);
    await version(1, files['logo.png']!, files['logo.png']!); // 1: Ada's, shared
    await version(1, files['proof.pdf']!); // 2
    await version(1, files['mark.svg']!); // 3
    await version(1, files['notes.txt']!); // 4
    await version(2, files['other.png']!); // 5: Ada's, unshared
    await version(3, files['other.png']!); // 6: Ben's
    await version(1, 'https://cdn.example.com/elsewhere.png'); // 7: a URL, not a file of ours
    await version(1, files['gone.png']!); // 8: thrown away below
    await h.meta.db.updateTable('adminium_files').set({ deletedAt: Date.now() }).where('id', '=', files['gone.png']!).execute();
    const claim = async (email: string, name: string) =>
      ((await served.post('/claim', { match: { email, name } })).json() as { data: { session: string } }).data.session;
    ada = await claim('ada@example.com', 'Ada');
    ben = await claim('ben@example.com', 'Ben');
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it.skipIf(!available)('serves an image inline, sandboxed, unsniffed and privately cached', async () => {
    const res = await download(1, ada);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="logo\.png"/);
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, max-age=0, must-revalidate');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it.skipIf(!available)('opens a PDF inline, and never an SVG or anything else', async () => {
    expect((await download(2, ada)).headers['content-disposition']).toMatch(/^inline;/);
    const svg = await download(3, ada);
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-disposition']).toMatch(/^attachment;/);
    expect(svg.headers['content-security-policy']).toBe('sandbox');
    expect((await download(4, ada)).headers['content-disposition']).toMatch(/^attachment;/);
  });

  it.skipIf(!available)('answers one 404 for everything that is not the caller’s to download', async () => {
    const unknown = await download(999, ada);
    expect(unknown.statusCode).toBe(404);
    const cases: [number, string | undefined, string][] = [
      [1, undefined, 'file'], // no session
      [6, ada, 'file'], // Ben's
      [1, ben, 'file'], // Ada's, asked by Ben
      [5, ada, 'file'], // her own, unshared
      [1, ada, 'note'], // a column holding a file id, never offered for download
      [7, ada, 'file'], // a URL: not a file of ours
      [8, ada, 'file'], // thrown away
    ];
    for (const [row, session, column] of cases) {
      const res = await download(row, session, column);
      expect(res.statusCode, `${String(row)} ${column}`).toBe(404);
      expect(res.body).toBe(unknown.body);
    }
    // A file of another connection, named by her own row: not hers to have.
    await h.meta.db.updateTable('adminium_files').set({ entityConnectionId: 'con_elsewhere' }).where('id', '=', files['proof.pdf']!).execute();
    expect((await download(2, ada)).body).toBe(unknown.body);
  });
});
