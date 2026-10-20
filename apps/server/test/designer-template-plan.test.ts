// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The template plan as the server checks it: the person's answer against the card it is for, what the
 * approved plan lets strangers and roles do, the short section the prompt carries, and the check before
 * going live narrowed to what the plan did not approve.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { answerFor } from '../src/designer/cards.js';
import { outsideChanges, withApproved, type AppliedSnapshot } from '../src/designer/outside-check.js';
import { approvedOf, planBrief, planFor, planProposalSchema, presetChoice, readTemplatePlan, writeTemplatePlan, type TemplatePlanFile, type TemplatePlanRequest } from '../src/designer/site/template-plan.js';
import { googleFonts } from '../src/designer/site/use-site.js';

const CARD: TemplatePlanRequest & { id: string } = {
  id: 'c1',
  type: 'template-plan',
  site: { attachment: 'att_00000000000000000001', name: 'furni', pages: 9, files: 64 },
  tables: [
    { table: 'products', label: 'Products', columns: [{ column: 'name', label: 'name' }], shownOn: ['Home'], fromTemplate: 12, filler: 4, madeUp: 0, publicRead: ['id', 'name'] },
    { table: 'categories', label: 'Categories', columns: [{ column: 'name', label: 'name' }], shownOn: [], fromTemplate: 0, filler: 0, madeUp: 3, publicRead: ['name'] },
  ],
  forms: [{ form: 'form-1', label: 'Contact', table: 'messages', tableLabel: 'Messages', writable: ['name', 'body'], perHour: 5 }],
  report: [
    { id: 'nav', label: 'Navigation', where: 'On every page', status: 'works', buildServerCode: false },
    { id: 'payments', label: 'Card payments', where: 'On the Order page', status: 'not-available', build: 'a payment link', buildServerCode: true, replace: 'pay on delivery', leave: 'the form comes off' },
    { id: 'chat', label: 'Chat widget', where: 'On every page', status: 'not-available', build: 'a contact form', buildServerCode: false, leave: 'the bubble comes off' },
  ],
  links: [{ id: 'link-1', label: 'Instagram' }],
  roles: [{ role: 'staff', tables: ['products', 'messages', 'orders'] }],
  added: [{ id: 'package:react', kind: 'package', name: 'react', version: '19.2.0', role: 'screens' }],
};

describe('the person’s answer to the plan', () => {
  it('keeps only what the card offered, and starts each choice on Replace where there is one, else Leave out: never Build', () => {
    const answer = answerFor(CARD, { tables: ['products', 'payments', 'nope'], decisions: {}, links: {}, added: ['package:react', 'package:evil'] });
    expect(answer).toEqual({ type: 'template-plan', tables: ['products'], decisions: { payments: 'replace', chat: 'leave' }, links: { 'link-1': '' }, takeOutEmpty: true, added: ['package:react'] });
    expect(presetChoice({ replace: undefined })).toBe('leave');
  });

  it('takes Build when the person picked it, and never a Replace the card did not offer', () => {
    const answer = answerFor(CARD, { tables: [], decisions: { payments: 'build', chat: 'replace', nav: 'build' } });
    expect(answer).toMatchObject({ decisions: { payments: 'build', chat: 'leave' } });
    expect(Object.keys((answer as { decisions: object }).decisions)).toEqual(['payments', 'chat']);
  });

  it('refuses an address that is not https, mailto, tel or a path of the site', () => {
    for (const address of ['javascript:alert(1)', 'http://plain.example', 'https://a b', 'data:text/html,x', '//evil.example']) {
      expect(answerFor(CARD, { tables: [], links: { 'link-1': address } }), address).toBeNull();
    }
    for (const address of ['https://instagram.com/furni', 'mailto:hi@furni.example', 'tel:+45 12 34 56 78', '/shop']) {
      expect(answerFor(CARD, { tables: [], links: { 'link-1': address } }), address).toMatchObject({ links: { 'link-1': address } });
    }
  });

  it('carries the changes the person asked for, trimmed, and refuses a book', () => {
    expect(answerFor(CARD, { tables: [], changes: '  Keep Categories as text.  ' })).toMatchObject({ changes: 'Keep Categories as text.' });
    expect(answerFor(CARD, { tables: [], changes: 'x'.repeat(4001) })).toBeNull();
    expect(answerFor(CARD, { tables: [], changes: '   ' })).not.toHaveProperty('changes');
  });
});

describe('the model’s proposal', () => {
  it('is cleaned of what could hide or reorder text, and cut', () => {
    const parsed = planProposalSchema.parse({ tables: [{ table: 'products', label: `Pro\u202educts${'x'.repeat(100)}`, columns: [{ column: 'name', label: 'name\u0007' }] }] });
    expect(parsed.tables[0]?.label).not.toContain('\u202e');
    expect([...(parsed.tables[0]?.label ?? '')].length).toBeLessThanOrEqual(60);
    expect(parsed.tables[0]?.columns[0]?.label).toBe('name');
  });

  it('refuses a ref that is not one, and anything it does not know', () => {
    expect(planProposalSchema.safeParse({ tables: [{ table: 'Products', label: 'P', columns: [{ column: 'name', label: 'n' }] }] }).success).toBe(false);
    expect(planProposalSchema.safeParse({ tables: [], sneaky: true }).success).toBe(false);
    expect(planProposalSchema.safeParse({ report: [{ id: 'a', label: 'A', where: 'Here', status: 'broken' }] }).success).toBe(false);
  });
});

describe('what an approved plan allows', () => {
  it('is the ticked tables’ public reads and every form’s create, and the roles only on the plan’s tables', () => {
    const { type: _type, id: _id, ...plan } = CARD;
    expect(approvedOf(plan, { tables: ['products'] })).toEqual({
      access: [
        { table: 'products', methods: ['GET'], select: ['id', 'name'] },
        { table: 'messages', methods: ['POST'], writable: ['name', 'body'], humanCheck: true },
      ],
      roles: [{ role: 'staff', tables: ['products', 'messages'] }],
    });
  });
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-template-plan-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const FILE = (sha256: string): TemplatePlanFile => {
  const { type: _type, id: _id, ...plan } = CARD;
  const answer = { tables: ['products'], decisions: { payments: 'leave' as const, chat: 'leave' as const }, links: { 'link-1': 'https://instagram.com/furni' }, takeOutEmpty: true, added: [] };
  return { version: 1, site: { attachment: CARD.site.attachment, name: 'furni', sha256 }, at: '2026-10-20T00:00:00.000Z', plan, answer, approved: approvedOf(plan, answer) };
};

describe('the kept plan', () => {
  it('is read back as written, and only for the very template it was made for', () => {
    writeTemplatePlan(root, 'shop', FILE('a'.repeat(64)));
    expect(readTemplatePlan(root, 'shop')?.site.name).toBe('furni');
    expect(planFor(root, 'shop', 'a'.repeat(64))).not.toBeNull();
    expect(planFor(root, 'shop', 'b'.repeat(64))).toBeNull();
  });

  it('is said short in the prompt: what to build and what was decided, and where the whole plan is', () => {
    const brief = planBrief('shop', FILE('a'.repeat(64)));
    expect(brief).toContain('apps/shop/template-plan.json');
    expect(brief).toContain('products (12 sample rows from the template)');
    expect(brief).toContain('Kept as fixed text: categories');
    expect(brief).toContain('form-1 → messages');
    expect(brief).toContain('payments: leave');
    // The plan's own words are the model's, made from the template's: none of them rides in the prompt.
    for (const words of ['Contact', 'Card payments', 'Chat widget', 'Products', 'furni', 'Instagram']) expect(brief).not.toContain(words);
    expect(brief).toContain('never ask for it again');
    expect(brief.length).toBeLessThan(1200);
  });
});

describe('the check before going live, with an approved plan', () => {
  const snap = (access: AppliedSnapshot['access'], roles: AppliedSnapshot['roles'] = {}): AppliedSnapshot => ({ access, roles, calls: [] });
  const approved = FILE('a'.repeat(64)).approved;

  it('asks nothing for what the plan approved: its reads, its forms with their check, its role’s rights and pages', () => {
    const now = snap([{ table: 'products', methods: ['GET'], select: ['id', 'name'], writable: [] }, { table: 'messages', methods: ['POST'], select: [], writable: ['name', 'body'], humanCheck: true }], { staff: ['table:@products:read', 'table:@messages:read', 'page:@shop-products:view', 'limits:null'] });
    expect(outsideChanges(root, 'shop', withApproved(null, now, approved, new Map([['shop-products', 'products']])), now)).toEqual([]);
  });

  it('asks for a page of a table the plan did not name', () => {
    const now = snap([], { staff: ['page:@shop-secrets:view'] });
    expect(outsideChanges(root, 'shop', withApproved(null, now, approved, new Map([['shop-secrets', 'secrets']])), now).map((change) => change.view)).toEqual([{ kind: 'role', role: 'staff', isNew: false }]);
  });

  it('asks for what goes beyond it: another method, another column, another table, a grant the plan did not name', () => {
    const now = snap([{ table: 'products', methods: ['GET', 'PATCH'], select: ['id', 'name', 'cost'], writable: [] }, { table: 'messages', methods: ['POST'], select: [], writable: ['name', 'body', 'phone'] }, { table: 'bookings', methods: ['POST'], select: [], writable: ['when'] }], { staff: ['table:@products:read', 'table:@secrets:read'] });
    const lines = outsideChanges(root, 'shop', withApproved(null, now, approved), now).map((change) => change.line);
    expect(lines).toEqual(['strangers could change rows of products', 'strangers could read cost of products', 'strangers could write phone of messages', 'strangers could add rows to bookings', 'the role "staff" could do more than before (1 new right)']);
  });

  it('asks when access widens without a new name: every column, the human check taken off, rows no longer kept back', () => {
    const before = snap([{ table: 'products', methods: ['GET'], select: ['name'], writable: [], rows: '{"filters":{"published":true}}' }, { table: 'messages', methods: ['POST'], select: [], writable: ['body'], humanCheck: true }]);
    const now = snap([{ table: 'products', methods: ['GET'], select: ['*'], writable: [], rows: '{}' }, { table: 'messages', methods: ['POST'], select: [], writable: ['body'], humanCheck: false }]);
    expect(outsideChanges(root, 'shop', before, now).map((change) => change.view.kind === 'access' && change.view.verb)).toEqual(['read-all', 'hidden-rows', 'no-check']);
  });

  it('names every column it opens, and every change past twelve', () => {
    const before = snap([{ table: 'products', methods: ['GET'], select: ['name'], writable: [] }]);
    const columns = Array.from({ length: 20 }, (_, n) => `c${String(n)}`);
    const now = snap([{ table: 'products', methods: ['GET'], select: ['name', ...columns], writable: [] }, ...Array.from({ length: 14 }, (_, n) => ({ table: `t${String(n)}`, methods: ['POST'], select: [], writable: ['a'] }))]);
    const changes = outsideChanges(root, 'shop', before, now);
    expect(changes).toHaveLength(15);
    expect(changes[0]?.view).toMatchObject({ verb: 'read-columns', columns });
    expect(changes[0]?.line).toContain('and 16 more');
  });

  it('without a plan, is what was applied', () => {
    const before = snap([]);
    expect(withApproved(before, before, undefined)).toBe(before);
  });
});

describe('a template’s Google fonts', () => {
  it('are read from both kinds of address, with the weights they name', () => {
    expect(
      googleFonts([
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;family=Playfair+Display:ital,wght@0,400;1,700&display=swap" rel="stylesheet">',
        "@import url('https://fonts.googleapis.com/css?family=Lora:400,700|Open+Sans');",
      ]),
    ).toEqual([
      { family: 'Inter', weights: [400, 700] },
      { family: 'Playfair Display', weights: [400, 700] },
      { family: 'Lora', weights: [400, 700] },
      { family: 'Open Sans', weights: [] },
    ]);
  });

  it('take nothing that is not a family’s name', () => {
    expect(googleFonts(['https://fonts.googleapis.com/css2?family=../../etc&family=%3Cscript%3E', 'https://fonts.example.com/css2?family=Inter'])).toEqual([]);
  });
});
