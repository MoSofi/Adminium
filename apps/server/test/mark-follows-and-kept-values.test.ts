// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two shapes an app with deals and quotes leans on, each proved on its own:
 *
 * A MARK THAT FOLLOWS. One open row per deal says where a colleague's deal
 * stands (its company, its stage, its state, its owner) and nothing else.
 * Each of the four is a copy through the mark's link to the deal that follows
 * the deal — a link, a state column and a staff column among them.
 *
 * A VALUE KEPT FOR ONE ROLE, BESIDE THE STATES COLUMN. A quote's `status` is
 * its states column; its `approval` is a plain column next to it. A rep may
 * ask for approval and nothing more; the manager approves or refuses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rolesRepo, usersRepo } from '@adminium/meta';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const follow = (from: string) => ({ rules: { copy: { via: 'deal_id', from, mode: 'always', follow: true } } });

const manifest = (): Record<string, unknown> => ({
  ...invoicingManifest([
    { ref: 'companies', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
    { ref: 'stages', columns: [id, { ref: 'label', type: 'text', maxLength: 40 }] },
    {
      ref: 'deals',
      columns: [
        id,
        { ref: 'company_id', type: 'fk', references: 'companies' },
        { ref: 'stage_id', type: 'fk', references: 'stages' },
        { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
        { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'], default: 'open' },
      ],
      states: { column: 'state', initial: 'open', moves: { open: ['won', 'lost'], won: ['open'], lost: ['open'] } },
    },
    {
      ref: 'deal_marks',
      columns: [
        id,
        { ref: 'deal_id', type: 'fk', references: 'deals', unique: true },
        { ref: 'company_id', type: 'int', nullable: true, ...follow('company_id') },
        { ref: 'stage_id', type: 'int', nullable: true, ...follow('stage_id') },
        { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, ...follow('owner_id') },
        { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'], nullable: true, ...follow('state') },
      ],
    },
    {
      ref: 'quotes',
      columns: [
        id,
        { ref: 'title', type: 'text', maxLength: 80 },
        { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'accepted'], default: 'draft' },
        { ref: 'approval', type: 'enum', enum: ['none', 'asked', 'approved', 'refused'], default: 'none' },
        { ref: 'ask_reason', type: 'text', maxLength: 200, nullable: true },
      ],
      states: { column: 'status', initial: 'draft', moves: { draft: ['sent'], sent: ['accepted'] } },
    },
  ]),
  compatibility: { minAdminiumVersion: '0.3.27' },
  pages: [{ ref: 'studio-quotes', template: 'page-crud', title: { key: 't', fallback: 'Quotes' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'quotes' } }],
  roles: [
    {
      key: 'rep',
      name: 'Rep',
      permissions: ['table:@quotes:read', 'table:@quotes:update', 'page:@studio-quotes:view'],
      // Asks, and says why; never approves, never sends by hand what the manager has not passed.
      limits: { quotes: { writable: ['title', 'approval', 'ask_reason', 'status'], writableValues: { approval: ['asked'] } } },
    },
    { key: 'manager', name: 'Manager', permissions: ['table:@quotes:read', 'table:@quotes:update', 'page:@studio-quotes:view'] },
  ],
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a mark that follows, and a value kept for one role, on ${dialect}`, () => {
    let h: InvoicingHarness;
    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest());
    }, 240_000);
    afterAll(async () => {
      await h.close();
    });

    it('a deal\'s mark copies its company, stage, owner and state, and follows each as the deal changes', async () => {
      const w = await writerFor(h);
      const user = await usersRepo(h.meta).create({ email: `rep-${dialect}@marks.dev`, name: 'Rep' });
      const other = await usersRepo(h.meta).create({ email: `other-${dialect}@marks.dev`, name: 'Other' });
      const co = [await w.create('companies', { name: 'Cobalt' }), await w.create('companies', { name: 'Juno' })];
      const stage = [await w.create('stages', { label: 'Proposal' }), await w.create('stages', { label: 'Verbal' })];
      const deal = await w.create('deals', { company_id: co[0]!['id'], stage_id: stage[0]!['id'], owner_id: user.id });
      const mark = await w.create('deal_marks', { deal_id: deal['id'] });
      const read = async () => {
        const [row] = await h.rows(`SELECT company_id, stage_id, owner_id, state FROM ${h.real('deal_marks')} WHERE id = ${String(mark['id'])}`);
        return [Number(row!['company_id']), Number(row!['stage_id']), row!['owner_id'], row!['state']];
      };
      expect(await read()).toEqual([Number(co[0]!['id']), Number(stage[0]!['id']), user.id, 'open']);
      // The stage moves, the deal is handed over, it is won, it goes to another company: the mark says so each time.
      await w.update('deals', deal['id'], { stage_id: stage[1]!['id'] });
      expect(await read()).toEqual([Number(co[0]!['id']), Number(stage[1]!['id']), user.id, 'open']);
      await w.update('deals', deal['id'], { owner_id: other.id });
      expect((await read())[2]).toBe(other.id);
      await w.update('deals', deal['id'], { state: 'won' });
      expect((await read())[3]).toBe('won');
      await w.update('deals', deal['id'], { company_id: co[1]!['id'] });
      expect((await read())[0]).toBe(Number(co[1]!['id']));
      // The copy is not a lock: a write to the mark's own row can still set a copied column, until the deal next
      // changes. So no role is given an update on such a table; the copy is kept true by nobody writing it.
      await w.update('deal_marks', mark['id'], { state: 'lost' });
      expect((await read())[3]).toBe('lost');
      await w.update('deals', deal['id'], { state: 'open' });
      expect((await read())[3]).toBe('open');
    });

    it('a rep asks for approval and cannot give it; the manager can; the states column beside it moves as before', async () => {
      const app = (await servePublic(h, null)).composed.app;
      const view = await loadSnapshotView(h.meta, h.connectionId);
      const quotes = view.model.tables.find((table) => table.name === h.real('quotes'))!.id;
      const signedIn = async (name: string, slug: string): Promise<string> => {
        const user = await usersRepo(h.meta).create({ email: `${name}-${dialect}@quotes.dev`, name, passwordHash: await adminPasswordHash() });
        await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
        const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: ADMIN_PASSWORD } });
        expect(login.statusCode, login.body).toBe(200);
        return sessionCookie(login.headers['set-cookie']);
      };
      const rep = await signedIn('rep', 'studio-rep');
      const manager = await signedIn('manager', 'studio-manager');
      await h.rows(`INSERT INTO ${h.real('quotes')} (title, status, approval) VALUES ('Desk rows', 'draft', 'none')`);
      const [made] = await h.rows(`SELECT id FROM ${h.real('quotes')}`);
      const url = `/api/v1/data/${h.connectionId}/${encodeURIComponent(quotes)}/${String(made!['id'])}`;
      const patch = (cookie: string, values: Record<string, unknown>, from?: string) => app.inject({ method: 'PATCH', url, headers: { cookie }, payload: { values, ...(from === undefined ? {} : { from }) } });
      const stored = async () => (await h.rows(`SELECT status, approval, ask_reason FROM ${h.real('quotes')}`))[0];

      const asked = await patch(rep, { approval: 'asked', ask_reason: 'Another supplier is cheaper on the desks' });
      expect(asked.statusCode, asked.body).toBe(200);
      expect(await stored()).toMatchObject({ approval: 'asked', ask_reason: 'Another supplier is cheaper on the desks' });
      // The rep's own "approved", and their own "refused", and taking the ask back to "none": each refused.
      for (const value of ['approved', 'refused', 'none']) {
        const tried = await patch(rep, { approval: value });
        expect(tried.statusCode, `${value}: ${tried.body}`).toBeGreaterThanOrEqual(400);
      }
      expect((await stored())!['approval']).toBe('asked');
      const approved = await patch(manager, { approval: 'approved' });
      expect(approved.statusCode, approved.body).toBe(200);
      expect((await stored())!['approval']).toBe('approved');
      // And the quote's own state still moves as its moves say, for the rep too.
      const sent = await patch(rep, { status: 'sent' }, 'draft');
      expect(sent.statusCode, sent.body).toBe(200);
      const skipped = await patch(rep, { status: 'draft' }, 'sent');
      expect(skipped.statusCode).toBeGreaterThanOrEqual(400);
      expect(await stored()).toMatchObject({ status: 'sent', approval: 'approved' });
    });
  });
}
