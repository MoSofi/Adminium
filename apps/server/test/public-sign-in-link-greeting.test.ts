// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Continue page a sign-in link opens greets its person by first name —
 * from the name the app declares, on every engine this run can reach.
 *
 * A client portal's identity entry shows `id, company, contact_name`: the
 * first column is a number and the second a company, so neither greets
 * anyone. The outbox's recipient declares `contact_name` as the person's
 * name, and that is the column the page reads. With nothing declared, the
 * first text column the entry shows that is not the address; never a number,
 * the address, a masked or secret column, or one the entry does not show.
 */
import { settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import type { ResolvedColumn, ResolvedTable } from '../src/crud/identifiers.js';
import { addressKey } from '../src/public-api/claim-code.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import type { CompiledResource } from '../src/public-api/scope.js';
import { createSignInLinkMinter } from '../src/public-api/sign-in-link-minter.js';
import { firstNameOf, greetingColumn, type LinkIdentity } from '../src/public-api/sign-in-link.js';
import type { SignInLinkMinter } from '../src/outbox/sign-in-link.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { packageTarball } from './app-bundle-helpers.js';
import { TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'clients', columns: [id, text('company'), text('contact_name'), { ref: 'email', type: 'text', maxLength: 254, unique: true }] },
      {
        ref: 'messages',
        columns: [
          id,
          { ref: 'kind', type: 'enum', enum: ['hello'] },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          text('to_address', 254),
          { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
          text('error', 200),
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
        ],
      },
    ]),
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { client: 'client_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email', name: 'contact_name' },
      kinds: { hello: 'studio-hello' },
    },
    emailTemplates: [
      { key: 'studio-hello', name: 'hello', locales: { 'en-US': { subject: 'Hello', blocks: [{ block: 'email.text', data: { text: 'Hi {{recipient.first_name}}.' } }] } } },
    ],
    publicAccess: [{ table: 'clients', methods: ['GET'], select: ['id', 'company', 'contact_name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true }],
  };
}

describe.each(LEGS)('the Continue page’s greeting — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let minter: SignInLinkMinter;
  let clients: string;
  let ip = 0;
  const peek = async (token: string) =>
    served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim/link/peek', remoteAddress: `10.8.0.${String((ip += 1))}`, headers: served.headers(), payload: { token } });

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    await h.rows(`insert into ${h.real('clients')} (company, contact_name, email) values ('Acme Works', 'Dana Greeted', 'dana@example.com')`);
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://studio.example.com');
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
    const views = createPublicViews(h.meta);
    clients = (await views.viewFor(h.connectionId))!.table(h.real('clients')).id;
    minter = createSignInLinkMinter({ meta: h.meta, manager: h.manager, views, crypto: dsnCryptoFromSecret(TEST_SECRET), addressSecret: addressKey(TEST_SECRET) });
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('greets by the first word of the name the outbox declares, and nothing else', async () => {
    const url = await minter.mint({ appKey: 'studio', connectionId: h.connectionId, table: clients, pk: { id: 1 }, email: 'dana@example.com', base: 'https://portal.example.com', now: Date.now() });
    const res = await peek(/#([A-Za-z0-9_-]{43})/.exec(url!)![1]!);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { firstName: 'Dana' } });
  });
});

describe('which column greets', () => {
  const column = (name: string, logicalType: string, extra: Partial<ResolvedColumn> = {}): [string, ResolvedColumn] => [
    name,
    { name, logicalType, nullable: true, isPrimaryKey: name === 'id', masked: false, secret: false, textish: logicalType === 'text' || logicalType === 'varchar', ...extra } as ResolvedColumn,
  ];
  const table = {
    columns: new Map([
      column('id', 'integer'),
      column('email', 'varchar'),
      column('code', 'integer'),
      column('company', 'text'),
      column('contact_name', 'text'),
      column('secret_name', 'text', { secret: true }),
      column('masked_name', 'text', { masked: true }),
      column('born_on', 'date'),
    ]),
    primaryKey: ['id'],
    table: { columns: [{ name: 'id', isPrimaryKey: true, references: null }] },
  } as unknown as ResolvedTable;
  const identity = (expose: string[]): LinkIdentity => ({ ref: 'clients_claimed', resource: { expose } as unknown as CompiledResource, email: 'email', column: 'id' });
  const row = { id: 7, email: 'dana@example.com', code: 12, company: 'Acme Works', contact_name: '  Dana   Greeted ', secret_name: 'Hidden One', masked_name: 'Masked One', born_on: '1990-01-01' };

  it('takes the declared name when the entry shows it', () => {
    expect(firstNameOf(row, identity(['id', 'company', 'contact_name']), table, 'contact_name')).toBe('Dana');
  });

  it('greets nobody by name when the declared name is not shown, is the address, or is not text', () => {
    expect(greetingColumn(identity(['id', 'company']), table, 'contact_name')).toBeNull();
    expect(greetingColumn(identity(['id', 'email', 'company']), table, 'email')).toBeNull();
    expect(greetingColumn(identity(['id', 'code', 'company']), table, 'code')).toBeNull();
    expect(firstNameOf(row, identity(['id', 'company']), table, 'contact_name')).toBe('');
  });

  it('with nothing declared, takes the first text column shown that is not the address', () => {
    expect(greetingColumn(identity(['id', 'email', 'born_on', 'contact_name', 'company']), table, null)).toBe('contact_name');
    expect(greetingColumn(identity(['secret_name', 'masked_name', 'company']), table, null)).toBe('company');
    expect(greetingColumn(identity(['id', 'email', 'code', 'born_on']), table, null)).toBeNull();
    expect(firstNameOf(row, identity(['id', 'email', 'code']), table, null)).toBe('');
  });

  it('never greets by a key, even a text one listed first: the row’s own, the pinned one, or one naming another row', () => {
    const keyed = {
      columns: new Map([
        column('id', 'text', { isPrimaryKey: true }),
        column('account_ref', 'text'),
        column('client_code', 'text'),
        column('email', 'varchar'),
        column('company', 'text'),
      ]),
      primaryKey: ['id'],
      table: {
        columns: [
          { name: 'id', isPrimaryKey: true, references: null },
          { name: 'account_ref', isPrimaryKey: false, references: null },
          { name: 'client_code', isPrimaryKey: false, references: { tableId: 'main.clients', columnName: 'code' } },
          { name: 'email', isPrimaryKey: false, references: null },
          { name: 'company', isPrimaryKey: false, references: null },
        ],
      },
    } as unknown as ResolvedTable;
    const pinned = (expose: string[]): LinkIdentity => ({ ...identity(expose), column: 'account_ref' });
    const keyedRow = { id: '3f2a9c1e', account_ref: 'AC-7', client_code: 'CL-001', email: 'dana@example.com', company: 'Acme Works' };
    expect(greetingColumn(pinned(['id', 'account_ref', 'client_code', 'company']), keyed, null)).toBe('company');
    expect(firstNameOf(keyedRow, pinned(['id', 'account_ref', 'client_code', 'company']), keyed, null)).toBe('Acme');
    expect(greetingColumn(pinned(['id', 'account_ref', 'client_code']), keyed, null)).toBeNull();
    expect(greetingColumn(pinned(['id', 'company']), keyed, 'id')).toBeNull();
  });
});

/*
 * An install made before its app was prefixed, renamed to the prefix through
 * `/apps/:key/rename-tables`: the outbox the app declared names the tables it
 * had, and the greeting still finds its recipient's name under the new ones.
 */
describe.each(LEGS)('the greeting after an old install’s tables are renamed to the prefix — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served | null = null;

  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h.close();
  });

  it.skipIf(!available)('greets by the declared name under the new table names', async () => {
    const prefixed = manifest();
    const plain = { ...prefixed, requiredSchema: { tables: (prefixed['requiredSchema'] as { tables: unknown[] }).tables } };
    h = await installInvoicing(dialect, plain);
    await h.rows(`insert into clients (company, contact_name, email) values ('Acme Works', 'Dana Greeted', 'dana@example.com')`);
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://studio.example.com');

    // The version that prefixes its tables: the update keeps the names it has.
    const next = { ...prefixed, version: '0.2.1' };
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(next), 'staff/index.html': '<!doctype html><html><body></body></html>' });
    const staged = await h.app.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(200);
    const updated = await h.app.inject({ method: 'POST', url: '/apps/studio/update', payload: {} });
    expect(updated.statusCode, updated.body).toBe(200);
    const planned = await h.app.inject({ method: 'POST', url: '/apps/studio/rename-tables/plan' });
    expect(planned.statusCode, planned.body).toBe(200);
    const renamed = await h.app.inject({ method: 'POST', url: '/apps/studio/rename-tables', payload: { checksum: planned.json().plan.checksum } });
    expect(renamed.statusCode, renamed.body).toBe(200);

    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
    const views = createPublicViews(h.meta);
    const clients = (await views.viewFor(h.connectionId))!.table(h.real('clients')).id;
    const minter = createSignInLinkMinter({ meta: h.meta, manager: h.manager, views, crypto: dsnCryptoFromSecret(TEST_SECRET), addressSecret: addressKey(TEST_SECRET) });
    const url = await minter.mint({ appKey: 'studio', connectionId: h.connectionId, table: clients, pk: { id: 1 }, email: 'dana@example.com', base: 'https://portal.example.com', now: Date.now() });
    expect(url).not.toBeNull();
    const res = await served.composed.app.inject({
      method: 'POST',
      url: '/api/v1/public/claim/link/peek',
      remoteAddress: '10.9.0.1',
      headers: served.headers(),
      payload: { token: /#([A-Za-z0-9_-]{43})/.exec(url!)![1]! },
    });
    expect(res.statusCode, res.body).toBe(200);
    // Not "Acme", the company the entry shows first.
    expect(res.json()).toEqual({ data: { firstName: 'Dana' } });
  }, 120_000);
});
