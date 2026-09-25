// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An invoicing app built on an add-on's shape, installed through the real
 * installer on a real database, with its document profiles made the way the
 * install makes them and the public routes served over its own key.
 *
 * The add-on that really draws invoices lives in another repository, so the
 * provider here is a stand-in that records the subject it was given and
 * returns it as the document's bytes: a test reads "what was printed" from
 * the file a client downloads.
 */
import { addOnManifest } from './app-add-ons.helpers.js';
import { Readable } from 'node:stream';

import { manifestsRepo, publicKeysRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';
import { expect } from 'vitest';

import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { installedShapes, makeAppProfiles } from '../src/documents/app-profiles.js';
import { createDocumentPipeline } from '../src/documents/compose.js';
import type { RenderDeps } from '../src/documents/render.js';
import type { FileStore } from '../src/files/store.js';
import { openPublishableKey } from '../src/public-api/keys.js';
import { createPublicRateLimiter } from '../src/public-api/limiter.js';
import { publicRoutes } from '../src/routes/public/index.js';
import { TEST_SECRET, makeEnv } from './helpers.js';
import { installInvoicing, invoicingManifest, invoicingTables, type Dialect, type InvoicingHarness } from './invoicing-install.helpers.js';

export const ORIGIN = 'https://studio.example.com';
/** The render clock: Friday 25 September 2026, noon in London, a second later per render. */
export const NOON = Date.parse('2026-09-25T11:00:00Z');

/** The rules the stand-in shape keeps on its document's number, and the app spells out. */
const SHAPE_RULES = {
  number_seq: { sequence: { gapless: true } },
  number: { format: { from: 'number_seq', prefix: 'INV-', pad: 4 } },
};

/** The invoice shape the stand-in add-on defines: three parts and two profiles in part names. */
export function invoiceShape(): Record<string, unknown> {
  const id = { ref: 'id', type: 'int', role: 'pk' };
  return {
    name: 'invoice',
    version: 1,
    parts: {
      document: {
        columns: [
          id,
          { ref: 'number_seq', type: 'int', nullable: true, rules: SHAPE_RULES.number_seq },
          { ref: 'number', type: 'text', maxLength: 24, nullable: true, rules: SHAPE_RULES.number },
          { ref: 'total', type: 'decimal', scale: 'currency', nullable: true },
          { ref: 'currency', type: 'text', maxLength: 3, nullable: true },
          { ref: 'balance', type: 'decimal', scale: 'currency', nullable: true },
        ],
      },
      lines: {
        columns: [
          id,
          { ref: 'invoice_id', type: 'fk', references: 'document' },
          { ref: 'position', type: 'int', default: 0 },
          { ref: 'description', type: 'text', maxLength: 200, nullable: true },
          { ref: 'amount', type: 'decimal', scale: 'currency', nullable: true },
        ],
      },
      payments: {
        columns: [
          id,
          { ref: 'invoice_id', type: 'fk', references: 'document' },
          { ref: 'amount', type: 'decimal', scale: 'currency' },
          { ref: 'paid_on', type: 'date', nullable: true },
          { ref: 'voided_at', type: 'timestamptz', nullable: true },
        ],
      },
    },
    documentProfiles: [
      {
        kind: 'invoice',
        part: 'document',
        name: 'Invoice',
        mapping: {
          number: { column: 'number' },
          total: { column: 'total' },
          lines: { collection: { table: 'lines', via: 'invoice_id', orderBy: 'position', columns: { description: 'description', amount: 'amount' } } },
        },
      },
      {
        kind: 'receipt',
        part: 'payments',
        name: 'Receipt',
        mapping: {
          amount: { column: 'amount' },
          invoiceNumber: { via: 'invoice_id', column: 'number' },
          balanceAfter: { via: 'invoice_id', column: 'balance' },
          issuedAt: { column: 'paid_on' },
          voidedOn: { column: 'voided_at' },
        },
      },
    ],
  };
}

/** The studio's tables, built on the shape, with a client's company and a table a client writes to. */
export function studioTables(): Record<string, unknown>[] {
  const tables: Record<string, unknown>[] = invoicingTables().map((table) => ({ ...table, columns: [...(table['columns'] as Record<string, unknown>[])] }));
  const find = (ref: string) => tables.find((t) => t['ref'] === ref)!;
  const columns = (ref: string) => find(ref)['columns'] as Record<string, unknown>[];
  columns('clients').push({ ref: 'company', type: 'text', maxLength: 120, nullable: true });
  Object.assign(find('invoices'), { builtOn: 'invoices/invoice@1', part: 'document' });
  Object.assign(find('invoice_lines'), { builtOn: 'invoices/invoice@1', part: 'lines' });
  columns('invoice_lines').push({ ref: 'description', type: 'text', maxLength: 200, nullable: true });
  Object.assign(find('payments'), { builtOn: 'invoices/invoice@1', part: 'payments' });
  // A client who referred another's invoice: a second way to reach an invoice row.
  columns('invoices').push({ ref: 'referrer_id', type: 'fk', references: 'clients', nullable: true });
  /*
   * A table built on a shape keeps the shape's rules on the shape's columns,
   * exactly (the install refuses anything else, SHAPE_MISMATCH): the number is
   * the stand-in shape's, and the columns it keeps no rule on carry none here
   * — these tests write their rows directly.
   */
  const reshaped: Record<string, Record<string, unknown> | undefined> = {
    'invoices.number_seq': SHAPE_RULES.number_seq,
    'invoices.number': SHAPE_RULES.number,
    'invoices.total': undefined,
    'invoices.currency': undefined,
    'invoice_lines.amount': undefined,
  };
  for (const [at, rules] of Object.entries(reshaped)) {
    const [table, column] = at.split('.') as [string, string];
    const index = columns(table).findIndex((c) => c['ref'] === column);
    const { rules: _rules, ...rest } = columns(table)[index]!;
    columns(table)[index] = rules === undefined ? rest : { ...rest, rules };
  }
  columns('payments').push(
    { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
    { ref: 'paid_on', type: 'date', nullable: true },
    { ref: 'voided_at', type: 'timestamptz', nullable: true },
  );
  tables.push({
    ref: 'requests',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'client_id', type: 'fk', references: 'clients' },
      { ref: 'note', type: 'text', maxLength: 200, nullable: true },
    ],
  });
  return tables;
}

/** The app: its own invoice slots added to the shape's, a statement, and a client's public side. */
export function studioManifest(): Record<string, unknown> {
  return {
    ...invoicingManifest(studioTables()),
    addOns: { requires: [{ key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Draws the invoices.' } }] },
    documents: [
      {
        kind: 'invoice',
        addOn: 'invoices',
        table: 'invoices',
        name: { 'en-US': 'Studio invoice' },
        mapping: { clientName: { via: 'client_id', column: 'company' } },
      },
      {
        kind: 'statement',
        addOn: 'invoices',
        table: 'clients',
        name: 'Statement',
        mapping: { clientName: { column: 'company' } },
        statement: {
          documents: { table: 'invoices', via: 'client_id', date: 'issued_on', amount: 'total', number: 'number', where: { column: 'status', in: ['sent'] } },
          payments: { table: 'payments', via: 'client_id', date: 'paid_on', amount: 'amount', unless: 'voided' },
        },
      },
    ],
    publicAccess: [
      { table: 'clients', methods: ['GET'], select: ['id', 'email', 'company'], claim: { match: ['email'] }, documents: ['statement'] },
      { table: 'invoices', methods: ['GET'], select: ['id', 'number', 'status', 'total'], claimedBy: { table: 'clients', column: 'client_id' }, documents: ['invoice'] },
      { table: 'payments', methods: ['GET'], select: ['id', 'amount'], claimedBy: { table: 'clients', column: 'client_id' }, documents: ['receipt'] },
      { table: 'requests', methods: ['GET', 'PATCH'], select: ['id', 'note'], writable: ['note'], claimedBy: { table: 'clients', column: 'client_id' } },
    ],
  };
}

/** The stand-in add-on's kinds: what each document's outline asks for. */
const KINDS: Record<string, { id: string; type: string; required: boolean; default?: string; columns?: { id: string; type: string }[] }[]> = {
  invoice: [
    { id: 'number', type: 'text', required: false },
    { id: 'clientName', type: 'text', required: true },
    // Never mapped here: the day the invoice is first drawn, as the real add-on defaults it.
    { id: 'issuedAt', type: 'date', required: true, default: 'now' },
    { id: 'total', type: 'money', required: false },
    { id: 'lines', type: 'collection', required: false, columns: [{ id: 'description', type: 'text' }, { id: 'amount', type: 'money' }] },
  ],
  receipt: [
    { id: 'number', type: 'text', required: false },
    { id: 'amount', type: 'money', required: true },
    { id: 'invoiceNumber', type: 'text', required: false },
    { id: 'balanceAfter', type: 'money', required: false },
    { id: 'issuedAt', type: 'date', required: false },
    { id: 'voidedOn', type: 'date', required: false },
    { id: 'lines', type: 'collection', required: false, columns: [{ id: 'description', type: 'text' }, { id: 'amount', type: 'money' }] },
  ],
  'insurer-receipt': [
    { id: 'insurer', type: 'text', required: true },
    { id: 'patient', type: 'text', required: false },
    { id: 'amount', type: 'money', required: true },
  ],
  statement: [
    // Required, with the engine's `now` default, as the Invoices & Receipts add-on declares it.
    { id: 'issuedAt', type: 'date', required: true, default: 'now' },
    { id: 'clientName', type: 'text', required: false },
    { id: 'period', type: 'text', required: false },
    { id: 'periodFrom', type: 'date', required: false },
    { id: 'periodTo', type: 'date', required: false },
    { id: 'openingBalance', type: 'money', required: false },
    { id: 'documentsTotal', type: 'money', required: false },
    { id: 'paymentsTotal', type: 'money', required: false },
    { id: 'closingBalance', type: 'money', required: false },
    {
      id: 'entries',
      type: 'collection',
      required: false,
      columns: [
        { id: 'date', type: 'date' },
        { id: 'kind', type: 'text' },
        { id: 'number', type: 'text' },
        { id: 'amount', type: 'money' },
        { id: 'balance', type: 'money' },
      ],
    },
  ],
};

/** A till receipt is drawn for an 80 mm roll first. */
const PAPER: Record<string, string[]> = { receipt: ['receipt-80mm', 'a4'] };

/** A provider that prints the subject it is given, and counts its draws. */
export function standInProvider() {
  const drawn: { kind: string; subject: Record<string, unknown> }[] = [];
  const module = {
    key: 'invoices',
    kinds: () => Object.keys(KINDS).map((id) => ({ id, formats: ['html'] as const, paper: PAPER[id] ?? ['a4'] })),
    describe: (kind: string) => ({ slots: KINDS[kind] ?? [] }),
    render: (input: { kind: string; subject: Record<string, unknown> }) => {
      drawn.push({ kind: input.kind, subject: input.subject });
      return Promise.resolve([
        {
          format: 'html' as const,
          filename: `${input.kind}.html`,
          mediaType: 'text/html; charset=utf-8',
          bytes: new TextEncoder().encode(JSON.stringify(input.subject)),
          locale: 'en-US',
          warnings: [],
        },
      ]);
    },
  };
  const runtime = {
    providers: new Map([['document-render@1', [{ addOnKey: 'invoices', contract: 'document-render', version: 1, module }]]]),
    slots: new Map(),
    conflicts: [],
    problems: [],
  } as unknown as AddOnRuntimeState;
  return { drawn, runtime };
}

/** Bytes kept in memory, read back by the content route. */
export function memoryStorage(): FileStore {
  const bytes = new Map<string, Buffer>();
  return {
    defaultDestinationId: () => Promise.resolve(null),
    write: (input: { id: string; bytes: Buffer | string }) => {
      const buffer = Buffer.from(input.bytes);
      bytes.set(`documents/${input.id}`, buffer);
      return Promise.resolve({ sizeBytes: buffer.byteLength, sha256: 'x', storageKey: `documents/${input.id}`, destinationId: null, storage: 'local' });
    },
    read: (file: { storageKey: string }) => Promise.resolve(Readable.from([bytes.get(file.storageKey) ?? Buffer.alloc(0)])),
    open: (file: { storageKey: string }) => {
      const held = bytes.get(file.storageKey) ?? Buffer.alloc(0);
      return Promise.resolve({ stream: Readable.from([held]), sizeBytes: held.byteLength });
    },
  } as unknown as FileStore;
}

/** The real id of one of the app's tables on a connection, from its latest snapshot. */
export async function realIdOf(meta: MetaDb, connectionId: string, real: (ref: string) => string): Promise<(ref: string) => string | null> {
  const snapshot = (await snapshotsRepo(meta).latest(connectionId))!;
  const tables = (snapshot.schema as { tables: { id: string; name: string }[] }).tables;
  return (ref) => tables.find((t) => t.name === real(ref))?.id ?? null;
}

/** Registers the stand-in add-on (its manifest row carries the shape). */
export async function registerInvoicesAddOn(meta: MetaDb): Promise<void> {
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
    manifestKey: 'invoices',
    version: '1.0.0',
    kind: 'add-on',
    source: 'file',
    // A whole add-on manifest: an app install checks it before connecting it, and connects it.
    document: addOnManifest('invoices', { addOn: { attaches: [{ app: 'studio' }], slots: [], shapes: [invoiceShape()] } }),
  });
}

export interface StudioHarness extends InvoicingHarness {
  keyId: string;
  token: string;
  pipeline: RenderDeps;
  drawn: ReturnType<typeof standInProvider>['drawn'];
  storage: FileStore;
  realId: (ref: string) => string | null;
  sql: (statement: string) => Promise<void>;
  /** The public routes over the app's key, with a limiter of their own. */
  serve: () => Promise<{
    call: (method: 'GET' | 'POST' | 'PATCH', url: string, opts?: { session?: string | undefined; payload?: unknown; ip?: string | undefined }) => Promise<{ statusCode: number; body: string; headers: Record<string, unknown>; json: () => unknown }>;
    claim: (email: string, ip: string) => Promise<string>;
    close: () => Promise<void>;
  }>;
}

/** Installs the studio on `dialect`, makes its profiles, and hands back a way to serve its public side. */
/**
 * The studio with two harder public sides: `referrer` shows a client's own
 * invoices in euros only, and adds a second entry on invoices — the invoices
 * a client referred, declaring statements only — and
 * `verified` asks a confirmed session for invoices, while a found one still
 * opens the client row and its statement.
 */
export function hostileManifest(variant: 'referrer' | 'verified'): Record<string, unknown> {
  const manifest = studioManifest();
  const entries = manifest['publicAccess'] as Record<string, unknown>[];
  if (variant === 'referrer') {
    // Her own invoices only in euros: a filter a statement of hers must keep.
    entries[1] = { ...entries[1], filters: [{ column: 'currency', op: 'eq', value: 'EUR' }] };
    entries.splice(2, 0, { table: 'invoices', methods: ['GET'], select: ['id', 'status'], claimedBy: { table: 'clients', column: 'referrer_id' }, documents: ['statement'] });
  } else {
    entries[0] = { ...entries[0], claim: { match: ['email'], verify: 'email-code', email: 'email' }, writable: [] };
    entries[1] = { ...entries[1], level: 'verified' };
  }
  return manifest;
}

export async function installStudio(dialect: Dialect, manifest: Record<string, unknown> = studioManifest()): Promise<StudioHarness> {
  // The add-on first: an app that needs it is refused without it.
  const h = await installInvoicing(dialect, manifest, registerInvoicesAddOn);
  const realId = await realIdOf(h.meta, h.connectionId, h.real);
  const made = await makeAppProfiles({
    meta: h.meta,
    manifest: manifest as never,
    connectionId: h.connectionId,
    realId,
    shapes: await installedShapes(h.meta),
  });
  expect(made.skipped).toEqual([]);

  const keyId = (h.reply['publicAccess'] as { keyId: string }).keyId;
  const key = (await publicKeysRepo(h.meta).findById(keyId))!;
  const token = openPublishableKey(dsnCryptoFromSecret(TEST_SECRET), key.tokenEncrypted!);
  const { drawn, runtime } = standInProvider();
  const storage = memoryStorage();
  let tick = NOON;
  const pipeline: RenderDeps = { ...createDocumentPipeline({ meta: h.meta, manager: h.manager, storage, runtime: () => runtime }), now: () => (tick += 1000) };

  const serve = async () => {
    const Fastify = (await import('fastify')).default;
    const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorateRequest('user', null);
    app.decorateRequest('session', null);
    await app.register(
      async (api) => {
        await api.register(
          publicRoutes({
            env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: ORIGIN, HOST: '127.0.0.1' }),
            meta: h.meta,
            manager: h.manager,
            isEnabled: () => Promise.resolve(true),
            limiter: createPublicRateLimiter(),
            documents: pipeline,
            storage,
          }),
        );
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
    const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, opts: { session?: string | undefined; payload?: unknown; ip?: string | undefined } = {}) =>
      await app.inject({
        method,
        url: `/api/v1/public${url}`,
        remoteAddress: opts.ip ?? '203.0.113.1',
        headers: {
          authorization: `Bearer ${token}`,
          origin: ORIGIN,
          ...(opts.session === undefined ? {} : { 'x-adminium-public-session': opts.session }),
        },
        ...(opts.payload === undefined ? {} : { payload: opts.payload as never }),
      });
    const claim = async (email: string, ip: string): Promise<string> => {
      const res = await call('POST', '/claim', { payload: { match: { email } }, ip });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { session: string } }).data.session;
    };
    return { call, claim, close: async () => await app.close() };
  };

  return {
    ...h,
    keyId,
    token,
    pipeline,
    drawn,
    storage,
    realId,
    sql: async (statement) => {
      await h.rows(statement);
    },
    serve,
  };
}
