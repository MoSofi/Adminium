// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DOCUMENT THAT PRINTS A MONEY CODE IS DRAWN WHEN ASKED AND KEPT NOWHERE.
 *
 * A gift card's code is worth what the card holds. Its document leaves no
 * register row and no stored bytes; every door that would keep one refuses
 * it. The person who made the row is handed the code once, with a token that
 * prints the row once whatever their role reads; a print address is good for
 * one use, by the person it was handed to, within a minute.
 */
import { auditRepo, documentProfilesRepo, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo, type User } from '@adminium/meta';
import { parseDatabaseModel } from '@adminium/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { moneyCodeColumns, moneyCodeOf } from '../src/documents/money-code.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { createPrintStore, printRow, PRINT_TICKET_MS, PRINT_TOKEN_MS } from '../src/documents/print-tokens.js';
import { renderDocument } from '../src/documents/render.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { CARDS_KIT, cardsKitManifest } from './fixtures/cards-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

/** The cards kit with the last four of a card's code kept beside it, a card document that prints the code, and a note that prints none. */
function kit(): Doc {
  const manifest = cardsKitManifest() as Doc & { requiredSchema: { tables: (Doc & { ref: string; columns: Doc[] })[] } };
  const cards = manifest.requiredSchema.tables.find((table) => table.ref === 'cards')!;
  cards.columns.push({ ref: 'code_last4', type: 'text', maxLength: 4, nullable: true, rules: { codeLast4: { of: 'code' } } });
  return {
    ...manifest,
    documents: [
      { kind: 'gift-card', addOn: CARDS_KIT, table: 'cards', name: 'Gift card', mapping: { title: { column: 'label' }, code: { column: 'code', form: 'grouped' } } },
      { kind: 'card-note', addOn: CARDS_KIT, table: 'notes', name: 'Note', mapping: { title: { column: 'text' } } },
    ],
  };
}

describe.each(LEGS)('a document that prints a money code — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let cashier: User;
  let other: User;
  let cashierCookie = '';
  const drawn: { kind: string; subject: Doc }[] = [];
  const state = { providers: new Map<string, unknown[]>(), slots: new Map(), conflicts: [], problems: [], deciders: new Map() };
  const tableId = async (name: string) => parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema).tables.find((table) => table.name === name)!.id;
  const profileOf = async (kind: string) => (await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, CARDS_KIT)).find((profile) => profile.kind === kind)!;
  const ask = (body: Doc, as?: User | null) => h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/documents/render`, payload: { kind: 'gift-card', table: 'cards', key: 1, ...body }, ...(as === undefined ? {} : { as }) });
  const print = (url: string, as?: User | null) => h.inject({ method: 'GET', url: url.replace('/api/v1', ''), ...(as === undefined ? {} : { as }) }) as Promise<{ statusCode: number; body: string; json: () => Doc; headers?: Record<string, string> }>;
  const kept = async () => ({ documents: Number((await h.meta.db.selectFrom('adminium_documents').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst())!.n), files: Number((await h.meta.db.selectFrom('adminium_files').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst())!.n) });
  const create = (url: string, payload: unknown) => served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${h.connectionId}/${url}`, headers: { cookie: cashierCookie }, payload: payload as never });

  beforeAll(async () => {
    if (!available) return;
    const module = {
      key: CARDS_KIT,
      kinds: () => [{ id: 'gift-card', formats: ['html'], paper: ['a6', 'receipt-80mm'] }, { id: 'card-note', formats: ['html'], paper: ['a4'] }],
      describe: (kind: string) => ({ slots: kind === 'gift-card' ? [{ id: 'title', type: 'text' }, { id: 'code', type: 'text' }] : [{ id: 'title', type: 'text' }] }),
      render: (input: { kind: string; subject: Doc }) => {
        drawn.push({ kind: input.kind, subject: input.subject });
        return Promise.resolve([{ format: 'html', filename: `${input.kind}.html`, mediaType: 'text/html; charset=utf-8', bytes: new TextEncoder().encode(`<p>${JSON.stringify(input.subject)}</p>`), locale: 'en-US', warnings: [] }]);
      },
    };
    h = await addOnHarness(dialect, { unbuiltWords: {}, documents: { runtime: () => state as never }, onRebuild: () => state.providers.set('document-render@1', [{ addOnKey: CARDS_KIT, contract: 'document-render', version: 1, module }]) });
    await h.stageAddOn(kit());
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: [] } });
    expect(installed.statusCode, installed.body).toBe(200);
    await h.rows("INSERT INTO cards_kit_cards (id, code, label, status, balance) VALUES (1, 'GC-7K2MW3HNQ4XP', 'Birthday', 'active', 50)");
    await h.rows("INSERT INTO cards_kit_notes (id, card_id, text) VALUES (1, 1, 'Wrapped')");

    // A cashier: makes cards and reads them without their codes. Another person with the same role.
    const role = await rolesRepo(h.meta).create({ slug: 'cashier', name: 'Cashier' } as never);
    await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${await tableId('cards_kit_cards')}`, { read: true, create: true, update: true, delete: false, export: false, import: false, readLimit: { readable: ['id', 'label', 'status', 'balance', 'code_last4'] } } as never);
    cashier = await usersRepo(h.meta).create({ email: 'cashier@cards.dev', name: 'Cashier', passwordHash: await adminPasswordHash() });
    other = await usersRepo(h.meta).create({ email: 'other@cards.dev', name: 'Other', passwordHash: await adminPasswordHash() });
    for (const user of [cashier, other]) await rolesRepo(h.meta).assignToUser(user.id, role.id);
    // The staff data routes, as the composed server mounts them; the print tokens are this process's own, whoever mints one.
    served = await servePublic(h as never, null, {});
    cashierCookie = sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'cashier@cards.dev', password: ADMIN_PASSWORD } })).headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('is read from the mapping, never from the kind\'s name', async () => {
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const cards = await tableId('cards_kit_cards');
    const notes = await tableId('cards_kit_notes');
    const card = await profileOf('gift-card');
    const note = await profileOf('card-note');
    expect(moneyCodeOf(view, card)).toEqual({ table: cards, column: 'code' });
    expect(moneyCodeOf(view, note)).toBeNull();
    // The same kind over a mapping that prints no code is an ordinary document.
    expect(moneyCodeOf(view, { ...card, mapping: { title: { column: 'label' } } } as never)).toBeNull();
    // However the mapping reaches it: a linked row's column, the rows listed under it, the column its documents are numbered by.
    expect(moneyCodeOf(view, { ...note, mapping: { title: { ref: 'card_id', column: 'code' } } } as never)).toEqual({ table: cards, column: 'code' });
    expect(moneyCodeOf(view, { ...note, mapping: { title: { ref: 'card_id', column: 'label' } } } as never)).toBeNull();
    expect(moneyCodeOf(view, { ...card, table: notes, mapping: { lines: { collection: { table: cards, fkColumn: 'id', columns: { code: 'code' } } } } } as never)).toEqual({ table: cards, column: 'code' });
    expect(moneyCodeOf(view, { ...card, mapping: { title: { column: 'label' } }, options: { numberColumn: 'code' } } as never)).toEqual({ table: cards, column: 'code' });
    // A code nothing keeps the last four of is a code, not a money code.
    expect(moneyCodeColumns({ columns: [{ name: 'code', code: {} }, { name: 'link_token', code: {} }, { name: 'last4', codeLast4: { of: 'code' } }] } as never)).toEqual(['code']);
    expect(moneyCodeColumns(undefined)).toEqual([]);
  });

  it.skipIf(!available)('leaves no register row and no file; the print address is one print, sandboxed and never cached; the audit row names the card and not its code', async () => {
    const before = await kept();
    const res = await ask({});
    expect(res.statusCode, res.body).toBe(200);
    const reply = res.json() as { printUrl: string; ephemeral: boolean };
    expect(reply.ephemeral).toBe(true);
    expect(reply.printUrl).toMatch(/^\/api\/v1\/documents\/print-once\/[A-Za-z0-9_-]{40,}$/);
    // Nothing is drawn until the address is opened.
    expect(drawn.filter((one) => one.kind === 'gift-card')).toHaveLength(0);
    const page = await print(reply.printUrl);
    expect(page.statusCode, page.body).toBe(200);
    expect(page.body).toContain('GC-7K2M-W3HN-Q4XP');
    expect(page.headers?.['cache-control']).toBe('no-store');
    expect(page.headers?.['content-security-policy']).toContain('sandbox');
    expect(page.headers?.['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers?.['x-content-type-options']).toBe('nosniff');
    // One print: the same address answers nothing again.
    expect((await print(reply.printUrl)).statusCode).toBe(404);
    expect(await kept()).toEqual(before);
    expect(JSON.stringify(await h.meta.db.selectFrom('adminium_documents').selectAll().execute())).not.toContain('7K2M');
    const printed = (await auditRepo(h.meta).list({ limit: 50 })).filter((row) => row.action === 'document.printed');
    expect(printed).toHaveLength(1);
    expect(JSON.stringify(printed[0])).toContain('gift-card');
    expect(JSON.stringify(printed[0])).not.toMatch(/7K2M|W3HN|Q4XP|Birthday/);
  });

  it.skipIf(!available)('a print address is the asker\'s only, and dies after a minute', async () => {
    const mine = (await ask({})).json() as { printUrl: string };
    expect((await print(mine.printUrl, other)).statusCode).toBe(404);
    expect((await print(mine.printUrl, null)).statusCode).toBe(401);
    // Another's try spends nothing: it is still the asker's one print.
    expect((await print(mine.printUrl)).statusCode).toBe(200);
    let at = 1_000;
    const store = createPrintStore(() => at);
    const ticket = store.mintTicket({ userId: 'u1', profileId: 'p', pk: { id: 1 }, once: false });
    at += PRINT_TICKET_MS;
    expect(store.takeTicket(ticket, 'u1')).toBeNull();
    const row = printRow('cnx_a', 't', 1);
    const token = store.mintToken('u1', row);
    expect(store.takeToken(token, 'u2', row)).toBe(false);
    expect(store.takeToken(token, 'u1', printRow('cnx_a', 't', 2))).toBe(false);
    // The same table and key in another database is another row.
    expect(store.takeToken(token, 'u1', printRow('cnx_b', 't', 1))).toBe(false);
    // Looked at, it is not spent; taken, it is.
    expect(store.holdsToken(token, 'u1', row)).toBe(true);
    expect(store.holdsToken(token, 'u2', row)).toBe(false);
    expect(store.holdsToken(token, 'u1', printRow('cnx_a', 't', 2))).toBe(false);
    expect(store.takeToken(token, 'u1', row)).toBe(true);
    expect(store.holdsToken(token, 'u1', row)).toBe(false);
    expect(store.takeToken(token, 'u1', row)).toBe(false);
    const late = store.mintToken('u1', row);
    at += PRINT_TOKEN_MS;
    expect(store.holdsToken(late, 'u1', row)).toBe(false);
    expect(store.takeToken(late, 'u1', row)).toBe(false);
  });

  it.skipIf(!available)('the record page\'s Make a document answers a print address for a card, and a job for a note', async () => {
    const card = await h.inject({ method: 'POST', url: '/documents/render', payload: { profileId: (await profileOf('gift-card')).id, pk: { id: 1 } } });
    expect(card.statusCode, card.body).toBe(200);
    expect(card.json()).toMatchObject({ ephemeral: true, printUrl: expect.stringContaining('/documents/print-once/') });
    const note = await h.inject({ method: 'POST', url: '/documents/render', payload: { profileId: (await profileOf('card-note')).id, pk: { id: 1 } } });
    expect(note.statusCode, note.body).toBe(200);
    expect(note.json()).toEqual({ jobId: 'job_1' });
  });

  it.skipIf(!available)('no other door stores one: a render that keeps what it draws refuses a money-code kind, and a note is stored as ever', async () => {
    const before = await kept();
    const refused = await renderDocument(h.pipeline!, { profileId: (await profileOf('gift-card')).id, pk: { id: 1 }, actorKind: 'system' });
    expect(refused).toMatchObject({ status: 'failed', document: null });
    expect(await kept()).toEqual(before);
    const note = await renderDocument(h.pipeline!, { profileId: (await profileOf('card-note')).id, pk: { id: 1 }, actorKind: 'system' });
    expect(note.status).toBe('rendered');
    expect((await kept()).documents).toBe(before.documents + 1);
  });

  it.skipIf(!available)('the maker\'s reply carries the code once, whatever their role reads; the token prints once, for its maker only; without it a role that does not read the code prints nothing', async () => {
    const made = await create(encodeURIComponent(await tableId('cards_kit_cards')), { values: { label: 'Sold at the till', balance: '25.00' } });
    expect(made.statusCode, made.body).toBe(201);
    const reply = made.json() as { data: Doc; once?: { table: string; key: string; column: string; value: string; print: string }[] };
    // The row as the cashier reads it has no code; the code is theirs this once.
    expect(reply.data).not.toHaveProperty('code');
    expect(reply.once).toHaveLength(1);
    const [once] = reply.once!;
    expect(once).toMatchObject({ table: await tableId('cards_kit_cards'), key: String(reply.data['id']), column: 'code' });
    expect(once!.value).toMatch(/^GC-[0-9A-Z]{12}$/);
    const row = { key: Number(once!.key) };

    // No token: a role that does not read the code prints nothing — of this card or any other.
    expect((await ask({ ...row }, cashier)).statusCode).toBe(404);
    expect((await ask({ key: 1 }, cashier)).statusCode).toBe(404);
    // Somebody else's ask with the cashier's token is nothing, and spends nothing; nor does the token print another card.
    expect((await ask({ ...row, once: once!.print }, other)).statusCode).toBe(404);
    expect((await ask({ key: 1, once: once!.print }, cashier)).statusCode).toBe(404);
    const allowed = await ask({ ...row, once: once!.print }, cashier);
    expect(allowed.statusCode, allowed.body).toBe(200);
    const page = await print((allowed.json() as { printUrl: string }).printUrl, cashier);
    expect(page.statusCode, page.body).toBe(200);
    expect(page.body).toContain(once!.value.slice(3, 7));
    // A paper the card is not drawn on is refused by name — and costs the maker nothing: the token is spent only by an ask that gets its address.
    const second = await create(encodeURIComponent(await tableId('cards_kit_cards')), { values: { label: 'Another' } });
    const [again] = (second.json() as { once: { key: string; print: string }[] }).once;
    expect((await ask({ key: Number(again!.key), once: again!.print, paper: 'letter' }, cashier)).statusCode).toBe(400);
    expect((await ask({ key: Number(again!.key), once: again!.print, paper: 'receipt-80mm' }, cashier)).statusCode).toBe(200);
    // The token prints once: a second ask is 404.
    expect((await ask({ ...row, once: once!.print }, cashier)).statusCode).toBe(404);
    const printed = (await auditRepo(h.meta).list({ limit: 50 })).filter((entry) => entry.action === 'document.printed' && JSON.stringify(entry.changes).includes('"once":true'));
    expect(printed).toHaveLength(1);
  });

  it.skipIf(!available)('rows made one by one each carry their code once; a row changed carries none; a note carries none', async () => {
    const cards = encodeURIComponent(await tableId('cards_kit_cards'));
    const batch = await create(`${cards}/one-by-one`, { creates: [{ label: 'One' }, { label: 'Two' }] });
    expect(batch.statusCode, batch.body).toBe(200);
    const results = (batch.json() as { results: { ok: boolean; id: unknown; once?: { value: string; key: string }[] }[] }).results;
    expect(results.map((result) => result.once?.length)).toEqual([1, 1]);
    expect(new Set(results.map((result) => result.once![0]!.value)).size).toBe(2);
    expect(results.map((result) => result.once![0]!.key)).toEqual(results.map((result) => String(result.id)));
    const changed = await create(`${cards}/one-by-one`, { ids: [results[0]!.id], values: { label: 'Renamed' } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(JSON.stringify(changed.json())).not.toContain('"once"');
  });
});
