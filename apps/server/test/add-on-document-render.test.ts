// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN PAGE ASKS FOR A DOCUMENT.
 *
 * By the add-on's own names — its short table name, the row's key, the kind
 * — and on the paper asked for, when the kind lists it. The record page's
 * rule holds: only a caller who reads every table the document reads and
 * every column it prints; anything else is the one 404. The same row on
 * another paper is another document; asked again unchanged, it is the same.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { documentProfilesRepo, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo, type User } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;

const kit = (): Doc => ({
  ...stockKitManifest(),
  documents: [{ kind: 'stock-label', addOn: 'stock-kit', table: 'items', name: 'Stock label', mapping: { title: { column: 'name' } } }],
});

describe.each(LEGS)('an add-on\'s page asks for a document — %s', (dialect, available) => {
  let h: Harness;
  const drawn: { kind: string; paper: string; subject: Doc }[] = [];
  afterEach(async () => {
    if (available) await h.close();
    drawn.length = 0;
  });

  const start = async () => {
    const state = { providers: new Map<string, unknown[]>(), slots: new Map(), conflicts: [], problems: [], deciders: new Map() };
    const module = {
      key: 'stock-kit',
      // A label on A6, or as a till strip: two papers, one kind.
      kinds: () => [{ id: 'stock-label', formats: ['html'], paper: ['a6', 'receipt-80mm'] }],
      describe: () => ({ slots: [{ id: 'title', type: 'text' }] }),
      render: (input: { kind: string; paper: string; subject: Doc }) => {
        drawn.push({ kind: input.kind, paper: input.paper, subject: input.subject });
        return Promise.resolve([{ format: 'html', filename: 'label.html', mediaType: 'text/html; charset=utf-8', bytes: new TextEncoder().encode(`<p>${input.paper}</p>`), locale: 'en-US', warnings: [] }]);
      },
    };
    h = await addOnHarness(dialect, {
      unbuiltWords: {},
      documents: { runtime: () => state as never },
      onRebuild: () => state.providers.set('document-render@1', [{ addOnKey: 'stock-kit', contract: 'document-render', version: 1, module }]),
    });
    await h.stageAddOn(kit());
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(200);
    await h.rows("INSERT INTO stock_kit_items (id, name) VALUES (1, 'Flour'), (2, 'Sugar')");
  };
  const ask = (body: Doc, as?: User | null) => h.inject({ method: 'POST', url: '/add-ons/stock-kit/documents/render', payload: { kind: 'stock-label', table: 'items', key: 1, ...body }, ...(as === undefined ? {} : { as }) });
  /** Somebody with these grants on the kit's tables, by their short names. */
  const person = async (name: string, grants: Record<string, Doc>): Promise<User> => {
    const member = await usersRepo(h.meta).create({ email: `${name}@test`, name });
    const role = await rolesRepo(h.meta).create({ slug: name, name } as never);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    for (const [ref, actions] of Object.entries(grants)) {
      const id = model.tables.find((table) => table.name === `stock_kit_${ref}`)!.id;
      await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${id}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
    }
    await rolesRepo(h.meta).assignToUser(member.id, role.id);
    return member;
  };

  it.skipIf(!available)('draws the add-on\'s own profile for the row, by its own names; asked again unchanged, it is the same document', async () => {
    await start();
    const first = await ask({});
    expect(first.statusCode, first.body).toBe(201);
    const made = first.json() as { id: string; printUrl: string; contentUrl: string; reused: boolean; document: Doc };
    expect(made).toMatchObject({ reused: false, printUrl: `/api/v1/documents/${made.id}/print`, contentUrl: `/api/v1/documents/${made.id}/content`, document: { kind: 'stock-label', addOnKey: 'stock-kit' } });
    expect(JSON.stringify(made.document['entityId'])).toContain('1');
    // The paper nobody named: the kind's first.
    expect(drawn.map((one) => one.paper)).toEqual(['a6']);
    expect(JSON.stringify(drawn[0]!.subject)).toContain('Flour');
    const again = await ask({});
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ id: made.id, reused: true });
    expect(drawn).toHaveLength(1);
  });

  it.skipIf(!available)('draws on the paper asked for — another paper is another document — and refuses one the kind does not list, by name', async () => {
    await start();
    const card = await ask({ paper: 'a6' });
    const strip = await ask({ paper: 'receipt-80mm' });
    expect([card.statusCode, strip.statusCode], strip.body).toEqual([201, 201]);
    expect((card.json() as Doc)['id']).not.toBe((strip.json() as Doc)['id']);
    expect(drawn.map((one) => one.paper)).toEqual(['a6', 'receipt-80mm']);
    // The strip again: the strip, not the card.
    expect((await ask({ paper: 'receipt-80mm' })).json()).toMatchObject({ id: (strip.json() as Doc)['id'], reused: true });
    const refused = await ask({ paper: 'letter' });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json()).toMatchObject({ error: { code: 'DOCUMENT_VALUE_REFUSED', details: { slot: 'paper' } } });
    expect(drawn).toHaveLength(2);
  });

  it.skipIf(!available)('is the one 404 for what is not there: another add-on, a table or a kind that is not its own, a row that does not exist', async () => {
    await start();
    for (const [url, body] of [
      ['/add-ons/no-such-kit/documents/render', {}],
      ['/add-ons/stock-kit/documents/render', { table: 'takes' }],
      ['/add-ons/stock-kit/documents/render', { table: 'shelves' }],
      ['/add-ons/stock-kit/documents/render', { kind: 'purchase-order' }],
      ['/add-ons/stock-kit/documents/render', { key: 999 }],
    ] as const) {
      const res = await h.inject({ method: 'POST', url, payload: { kind: 'stock-label', table: 'items', key: 1, ...body } });
      expect(res.statusCode, `${url} ${JSON.stringify(body)} ${res.body}`).toBe(404);
    }
    // Not the question at all: a key this route does not take.
    expect((await ask({ ref: 'items' })).statusCode).toBeGreaterThanOrEqual(400);
    expect(drawn).toHaveLength(0);
  });

  it.skipIf(!available)('only for a caller who reads what the document reads, and every column it prints; nobody signed in is 401', async () => {
    await start();
    const reader = await person('reader', { items: { read: true } });
    const other = await person('other', { takes: { read: true } });
    // Reads the items, and not the name the label prints.
    const half = await person('half', { items: { read: true, readLimit: { readable: ['id', 'zone'] } } });
    expect((await ask({}, reader)).statusCode).toBe(201);
    expect((await ask({}, other)).statusCode).toBe(404);
    expect((await ask({}, half)).statusCode).toBe(404);
    expect((await ask({}, null)).statusCode).toBe(401);
    expect(drawn).toHaveLength(1);
  });

  it.skipIf(!available)('a document switched off is said as such, never drawn', async () => {
    await start();
    const [profile] = await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'stock-kit');
    await documentProfilesRepo(h.meta).patch(profile!.id, { enabled: false });
    const res = await ask({});
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'FEATURE_OFF' } });
    expect(drawn).toHaveLength(0);
  });
});
