// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CODE NO STAFF MEMBER READS, AS THE SERVER KEEPS IT. A quote's code
 * (`code.hiddenFromStaff`) is the link its email carries, whether or not an
 * entry claims by it yet. Somebody who may change the schema's rules or
 * make API endpoints had four ways to show it, judged here where they are
 * judged — when the rule is saved or the endpoint made — each refused, with
 * the same rule on a code staff do read let through:
 *
 *  - a kept total: the newest child row's value (`column.rollup` `latest`);
 *  - its last four (`column.codeLast4`);
 *  - a ledger's copy (a posting's `map`);
 *  - a hand-made public endpoint that selects it.
 *
 * And a stamp that copies it. Judged on the model, so one engine says it.
 */
import { overridesRepo } from '@adminium/meta';
import type { AddOnManifest, Posting } from '@adminium/manifest';
import { validateManifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { storedPostingIssue } from '../src/ledgers/rules.js';
import { endpointIssues, type PublicEndpointDefinition } from '../src/public-api/endpoint.js';
import { ledgerKitDecidesManifest } from './fixtures/ledger-kit/index.js';
import { wholeServer, type WholeServer } from './whole-server.helpers.js';

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, rules?: Record<string, unknown>) => ({ ref, type: 'text', maxLength, nullable: true, ...(rules === undefined ? {} : { rules }) });

function quotes(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'quoting',
    name: 'Quoting',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.quoting.desc', fallback: 'Quoting.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'quoting', label: en('Quoting'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'quotes',
          columns: [
            id,
            text('name', 120),
            // The link the quote's email carries: no staff member reads it.
            text('share_code', 16, { code: { length: 16, hiddenFromStaff: true } }),
            // A reference staff read out to the customer.
            text('ref_code', 8, { code: { length: 8 } }),
            text('last4', 4),
            text('copied', 16),
            text('latest_note', 16),
          ],
        },
        {
          ref: 'quote_notes',
          columns: [id, { ref: 'quote_id', type: 'fk', references: 'quotes' }, text('note_code', 16, { code: { length: 16, hiddenFromStaff: true } }), text('note_ref', 16, { code: { length: 16 } }), { ref: 'at', type: 'timestamptz', nullable: true }],
        },
      ],
    },
    roles: [{ key: 'desk', name: 'Desk', permissions: ['table:@quotes:read', 'page:@quoting-quotes:view'] }],
    pages: [{ ref: 'quoting-quotes', template: 'page-crud', title: { key: 't.quotes', fallback: 'Quotes' }, nav: { group: 'quoting', icon: 'list', order: 1 }, bindings: { rows: 'quotes' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

describe('a code no staff member reads, as the server keeps it', () => {
  let s: WholeServer;
  let current: Record<string, unknown>[];
  const put = (overrides: unknown[]) => s.send('owner', 'PUT', `/api/v1/connections/${s.connectionId}/overrides`, { overrides });
  /** The app's rules with one more on a column of quotes. */
  const plus = (op: string, columnName: string, value: unknown) => put([...current, { op, tableName: s.t('quotes'), columnName, value }]);

  beforeAll(async () => {
    s = await wholeServer('sqlite', quotes());
    current = (await overridesRepo(s.meta).listForConnection(s.connectionId)).map((o) => ({
      op: o.op,
      tableName: o.tableName,
      ...(o.columnName === null ? {} : { columnName: o.columnName }),
      value: o.value,
      status: o.status,
    }));
    expect((await put(current)).statusCode).toBe(200);
  }, 180_000);
  afterAll(async () => {
    await s?.close();
  });

  it('is kept as no total\'s newest value', async () => {
    const latest = (of: string) => plus('column.rollup', 'latest_note', { from: s.t('quote_notes'), via: 'quote_id', latest: { of, by: 'at' } });
    const refused = await latest('note_code');
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.body).toContain('is the code a shared link opens its row with, so no total keeps it');
    const kept = await latest('note_ref');
    expect(kept.statusCode, kept.body).toBe(200);
    expect((await put(current)).statusCode).toBe(200);
  });

  it('keeps no last four', async () => {
    const refused = await plus('column.codeLast4', 'last4', { of: 'share_code' });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.body).toContain('is the code a shared link opens its row with, so no column keeps its last four');
    const kept = await plus('column.codeLast4', 'last4', { of: 'ref_code' });
    expect(kept.statusCode, kept.body).toBe(200);
    expect((await put(current)).statusCode).toBe(200);
  });

  it('is copied by no stamp', async () => {
    const refused = await plus('column.stamp', 'copied', { set: { copy: 'share_code' }, on: 'create' });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.body).toContain('is the code a shared link opens its row with, so no column copies it');
    expect((await put(current)).statusCode).toBe(200);
  });

  it('is copied into no ledger by a posting', async () => {
    const parsed = validateManifest(ledgerKitDecidesManifest());
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues.slice(0, 3)));
    const view = await loadSnapshotView(s.meta, s.connectionId);
    const table = view.model.tables.find((one) => one.id === s.t('quotes'))!;
    const posting = (note: string): Posting => ({ id: 'units', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, post: { on: { create: true } }, map: { account: 'id', quantity: 'id', note } });
    const judged = (note: string) => storedPostingIssue({ model: view.model, table, posting: posting(note), manifest: parsed.manifest as AddOnManifest });
    expect(judged('share_code')).toContain('reads "share_code", the code a shared link opens its row with, so no posting copies it into a ledger');
    expect(judged('ref_code') ?? '').not.toContain('the code a shared link opens its row with');
  });

  it('is selected, filtered or ordered by no hand-made public endpoint', async () => {
    const view = await loadSnapshotView(s.meta, s.connectionId);
    const def = (select: string[]): PublicEndpointDefinition => ({
      path: '/quotes',
      source: s.t('quotes'),
      methods: ['GET'],
      select,
      filters: [],
      pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
      auth: { role: 'anon' },
      rate_limit: { requests: 120, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
    });
    const codes = (select: string[]) => endpointIssues(def(select), { ref: 'quotes', view }).map((issue) => `${issue.code} ${issue.column ?? ''}`);
    expect(codes(['id', 'name', 'share_code'])).toContain('ENDPOINT_SHARE_CODE_READ share_code');
    expect(codes(['id', 'name', 'ref_code'])).not.toContain('ENDPOINT_SHARE_CODE_READ ref_code');
  });
});
