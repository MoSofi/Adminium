// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE THAT ASKS AN ADD-ON'S WORDS, on SQLite, Postgres and MySQL.
 *
 * "Tell me when it's back": a request names the stock it waits for through
 * a link; a rule's condition step asks the add-on's stock words about that
 * row, and only when it is back does the rule stamp the request and write
 * the mail. The words come by the path the staff's and the public pages'
 * do; nothing of the add-on is written, and no step of it runs.
 *
 *  - an item counted back from 0 to 6 lets both its waiting requests through,
 *    each once: the stamp the first run writes takes the row out of the next;
 *  - a sold-out item, a request linked to nothing, an add-on that cannot
 *    answer, and one switched off for the rule's app let nobody through —
 *    `is_not` included: what cannot be told is false;
 *  - "low" with a whole unit left counts as in; the condition is refused
 *    anywhere but a condition or branch step.
 */
import { automationsRepo, type Automation, type AutomationGraph, type AutomationTriggerEvent } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { walkRule } from '../src/automations/runner.js';
import { askWords, wordsHold } from '../src/automations/words-condition.js';
import { resolveRule } from '../src/automations/validate.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import type { LedgerRuntime } from '../src/ledgers/registry.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

const BACK = { left: { words: 'ledger-kit:units-left', of: 'account_id' }, op: 'is' as const, right: 'in' };

describe('what a rule hears of the words', () => {
  const line = (state: 'in' | 'low' | 'out', left?: string) => ({ id: '1', state, ...(left === undefined ? {} : { left }) });
  it('in: one whole unit or more; low with one left is in; none left is out', () => {
    expect(wordsHold(BACK, line('in', '6.000'))).toBe(true);
    expect(wordsHold(BACK, line('low', '1.000'))).toBe(true);
    expect(wordsHold(BACK, line('low', '0.500'))).toBe(false);
    expect(wordsHold(BACK, line('out', '0.000'))).toBe(false);
    expect(wordsHold({ op: 'is', right: 'out' }, line('out', '0.000'))).toBe(true);
    expect(wordsHold({ op: 'is', right: 'low' }, line('low', '1.000'))).toBe(true);
  });
  it('a row the add-on does not count, or no answer at all, holds nothing — is_not too', () => {
    // A row linked to no stock: the page reads "in", with no figure.
    expect(wordsHold(BACK, line('in'))).toBe(false);
    expect(wordsHold({ op: 'is_not', right: 'in' }, line('in'))).toBe(false);
    expect(wordsHold(BACK, null)).toBe(false);
    expect(wordsHold({ op: 'is_not', right: 'out' }, null)).toBe(false);
  });
});

describe.each(LEGS)('a rule that asks an add-on whether stock is back — %s', (dialect, available) => {
  let w: LedgerWorld;
  let requests: string;
  let mails: string;
  let rule: Automation;

  const graph = (condition: unknown): AutomationGraph =>
    ({
      version: 1,
      nodes: [
        { id: 'n1', kind: 'trigger', title: 'Every 15 minutes' },
        { id: 'n2', kind: 'condition', title: 'Only if it is back', onError: false, condition },
        // Stamped first, so a mail that fails is never sent twice.
        { id: 'n3', kind: 'action', title: 'Stamp the request', onError: false, action: { kind: 'record.update', values: { notified_at: { now: true } } } },
        { id: 'n4', kind: 'action', title: 'Write the mail', onError: false, action: { kind: 'record.create', table: null, values: { request_id: '{{record.id}}' } } },
      ],
    }) as unknown as AutomationGraph;

  /** One visit of the rule's 15-minute scan: every request not yet told, each run once. */
  const tick = async (runtime: LedgerRuntime = w.runtime, over: Partial<Automation> = {}): Promise<boolean[]> => {
    const waiting = await w.h.rows(`SELECT id FROM restock_requests WHERE notified_at IS NULL ORDER BY id`);
    const told: boolean[] = [];
    for (const { id } of waiting) {
      const event: AutomationTriggerEvent = { event: 'record.updated', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: w.h.connectionId, table: requests, pk: { id: Number(id) }, label: String(id) }, snapshot: { id }, occurredAt: Date.now() };
      const outcome = await walkRule({ meta: w.h.meta, manager: w.h.manager, secret: TEST_SECRET, now: () => Date.now(), ledgers: runtime }, { rule: { ...rule, ...over }, runId: `arun_${String(id)}_${String(Math.random()).slice(2, 8)}`, event });
      if (outcome.kind !== 'finished') throw new Error('expected a finished run');
      expect(outcome.status, JSON.stringify(outcome.trace.steps.map((step) => step.log))).toBe('succeeded');
      told.push(outcome.trace.steps[1]?.log === 'evaluated → true');
    }
    return told;
  };
  const mailed = async () => (await w.h.rows(`SELECT request_id FROM sent_mails ORDER BY request_id`)).map((row) => Number(row['request_id']));
  const setBalance = (account: number, balance: number) => w.h.rows(`UPDATE ledger_kit_accounts SET balance = ${String(balance)}, opening = ${String(balance)} WHERE id = ${String(account)}`);

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, {
      restock_requests: { columns: 'account_id INT NULL REFERENCES ledger_kit_accounts(id), email VARCHAR(200) NULL, notified_at VARCHAR(40) NULL', postings: [] },
      sent_mails: { columns: 'request_id INT NULL', postings: [] },
    });
    // 1: sold out, then counted back to 6. 2: sold out and staying so. 3: at its reorder level, one left.
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Slate M', 0, 0, 0, ${w.flag(false)}, 2), (2, 'Ember S', 0, 0, 0, ${w.flag(false)}, 2), (3, 'Moss L', 1, 0, 1, ${w.flag(false)}, 2)`);
    // Two waiting for 1, one for 2, one linked to nothing.
    await w.h.rows(`INSERT INTO restock_requests (account_id, email) VALUES (1, 'a@example.test'), (1, 'b@example.test'), (2, 'c@example.test'), (NULL, 'd@example.test')`);
    await w.h.introspect();
    const view = await loadSnapshotView(w.h.meta, w.h.connectionId);
    const idOf = (name: string) => view.model.tables.find((table) => table.name === name)!.id;
    requests = idOf('restock_requests');
    mails = idOf('sent_mails');
    rule = await automationsRepo(w.h.meta).create(
      {
        connectionId: w.h.connectionId,
        name: 'Tell them it is back',
        enabled: true,
        trigger: { kind: 'schedule', connectionId: w.h.connectionId, schedule: { kind: 'interval', everyMinutes: '15' }, forEach: { table: requests, where: [{ left: { field: 'notified_at' }, op: 'is_empty' }], once: false } } as never,
        graph: graph(BACK),
      },
      Date.now(),
    );
    // The mail is a row of its own table.
    rule = { ...rule, graph: { ...rule.graph, nodes: rule.graph.nodes.map((node) => (node.id === 'n4' ? { ...node, action: { kind: 'record.create', table: mails, values: { request_id: '{{record.id}}' } } } : node)) } as AutomationGraph };
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a sold-out item and a request linked to nothing let nobody through', async () => {
    expect(await tick()).toEqual([false, false, false, false]);
    expect(await mailed()).toEqual([]);
  });

  it.skipIf(!available)('an add-on that cannot answer lets nobody through, is_not included', async () => {
    await setBalance(1, 6);
    // Its code is not loaded: no answer, no mail.
    expect(await tick({ ...w.runtime, actionOf: () => null })).toEqual([false, false, false, false]);
    // Asked the other way round, still nobody: what cannot be told is false.
    const ruleNot = { graph: graph({ ...BACK, op: 'is_not' }) };
    expect(await tick({ ...w.runtime, actionOf: () => null }, ruleNot)).toEqual([false, false, false, false]);
    expect(await mailed()).toEqual([]);
  });

  it.skipIf(!available)('counted back from 0 to 6, both waiting requests are told, each once', async () => {
    expect(await tick()).toEqual([true, true, false, false]);
    expect((await mailed()).length).toBe(2);
    // The next visits find only the two still waiting, and tell neither.
    expect(await tick()).toEqual([false, false]);
    expect(await tick()).toEqual([false, false]);
    const rows = await w.h.rows(`SELECT r.id FROM restock_requests r JOIN sent_mails m ON m.request_id = r.id ORDER BY r.id`);
    expect(rows.map((row) => Number(row['id']))).toEqual([1, 2]);
  });

  it.skipIf(!available)('switched off for the app the rule is of: nobody, though the stock is there', async () => {
    const view = await loadSnapshotView(w.h.meta, w.h.connectionId, { forOthers: true });
    const { db } = await w.h.manager.data(w.h.connectionId);
    const ask = (runtime: LedgerRuntime, app: string | null, account: number) =>
      askWords({ words: 'ledger-kit:units-left', of: 'account_id' }, { ledgers: runtime, view, db, timezone: 'Europe/London', app, table: view.table(requests), row: { id: 9, account_id: account }, now: new Date() });
    // The workspace's own rule: asked, and back.
    expect(wordsHold(BACK, await ask(w.runtime, null, 1))).toBe(true);
    // An app's rule, the add-on off for that app: no answer.
    expect(await ask({ ...w.runtime, onFor: () => false }, 'shop', 1)).toBeNull();
    expect(wordsHold(BACK, await ask({ ...w.runtime, onFor: () => true }, 'shop', 1))).toBe(true);
    // At its reorder level with one left: low, and counted as in.
    const low = await ask(w.runtime, null, 3);
    expect(low?.state).toBe('low');
    expect(wordsHold(BACK, low)).toBe(true);
  });

  it.skipIf(!available)('is asked only in a condition or branch step, about a link', async () => {
    const view = await loadSnapshotView(w.h.meta, w.h.connectionId);
    const ctx = { view, templateKeys: new Set<string>() } as never;
    const trigger = (when: unknown[]) => ({ kind: 'record', event: 'updated', connectionId: w.h.connectionId, table: requests, watch: false, when });
    const plain = { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'T' }] } as unknown as AutomationGraph;
    expect(() => resolveRule(trigger([BACK]) as never, plain, ctx)).toThrow(/asked in a condition or branch step/);
    expect(() => resolveRule(trigger([]) as never, graph({ ...BACK, left: { ...BACK.left, of: 'email' } }), ctx)).toThrow(/is not a link/);
    expect(() => resolveRule(trigger([]) as never, graph(BACK), ctx)).not.toThrow();
  });
});
