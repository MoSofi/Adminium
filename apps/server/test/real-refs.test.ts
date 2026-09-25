// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one mapper every writer takes a manifest's tables to real ones through:
 * every nested ref, in a rule, a document's states, a booking, an outbox and
 * a public entry, and — the live-model check — the refs it could not find.
 */
import BetterSqlite3 from 'better-sqlite3';
import type { Manifest } from '@adminium/manifest';
import { appOutboxesRepo, createSqliteMetaDb, firstRun } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { installOutbox, outboxRefs } from '../src/apps/manifest-outbox.js';
import { nestedRefs } from '../src/apps/manifest-public.js';
import { bookingValue, realRuleRefs } from '../src/apps/manifest-rules.js';
import { mapTableRefs, tableRefsIn } from '../src/apps/real-refs.js';

const REAL: Record<string, string> = {
  invoices: 'main.st_invoices',
  lines: 'main.st_lines',
  payments: 'main.st_payments',
  terms: 'main.st_terms',
  clauses: 'main.st_clauses',
  settings: 'main.st_settings',
  projects: 'main.st_projects',
  messages: 'main.st_messages',
  clients: 'main.st_clients',
};
const real = (ref: string) => REAL[ref];

describe('the one mapper', () => {
  it('maps a rollup’s child, a setting’s row and a fingerprint’s tables, and leaves columns and add-on settings alone', () => {
    expect(realRuleRefs('column.rollup', { from: 'lines', via: 'document_id', sum: 'amount' }, (r) => real(r) ?? '').value).toEqual({
      from: 'main.st_lines',
      via: 'document_id',
      sum: 'amount',
    });
    // `from` is a column (a copy) or a fill's source anywhere else.
    expect(realRuleRefs('column.copy', { via: 'client_id', from: 'tax_rate' }, (r) => real(r) ?? '').value).toEqual({ via: 'client_id', from: 'tax_rate' });
    expect(realRuleRefs('column.default', { kind: 'from', from: { table: 'settings', column: 'currency' } }, (r) => real(r) ?? '').value).toEqual({
      kind: 'from',
      from: { table: 'main.st_settings', column: 'currency' },
    });
    expect(realRuleRefs('column.default', { kind: 'from', from: { addOn: 'invoices', setting: 'tax' } }, (r) => real(r) ?? '').value).toEqual({
      kind: 'from',
      from: { addOn: 'invoices', setting: 'tax' },
    });
    const stamp = realRuleRefs(
      'column.stamp',
      {
        set: {
          hashOf: {
            columns: ['total'],
            children: [{ table: 'lines', via: 'document_id', columns: ['amount'] }],
            linked: [{ table: 'terms', via: 'terms_id', columns: ['text'], children: [{ table: 'clauses', via: 'terms_id', columns: ['body'] }] }],
          },
        },
        on: 'create',
      },
      (r) => real(r) ?? '',
    ).value as { set: { hashOf: { children: { table: string }[]; linked: { table: string; children: { table: string }[] }[] } } };
    expect(stamp.set.hashOf.children[0]!.table).toBe('main.st_lines');
    expect(stamp.set.hashOf.linked[0]!.table).toBe('main.st_terms');
    expect(stamp.set.hashOf.linked[0]!.children[0]!.table).toBe('main.st_clauses');
  });

  it('maps every table a document’s states name: its children, a move’s children, what locks it', () => {
    const { value } = realRuleRefs(
      'table.states',
      {
        column: 'status',
        initial: 'draft',
        moves: { draft: [{ to: 'sent', requires: { children: { lines: 1 } } }, 'void'] },
        children: { lines: { via: 'document_id', lock: true }, payments: { via: 'document_id', parentIn: ['sent'] } },
        lockedWhenReferencedBy: [{ table: 'invoices', via: 'terms_id', in: ['sent'] }],
      },
      (r) => real(r) ?? '',
    );
    const states = value as { moves: { draft: { requires: { children: Record<string, number> } }[] }; children: Record<string, unknown>; lockedWhenReferencedBy: { table: string }[] };
    expect(Object.keys(states.children)).toEqual(['main.st_lines', 'main.st_payments']);
    expect(Object.keys(states.moves.draft[0]!.requires.children)).toEqual(['main.st_lines']);
    expect(states.lockedWhenReferencedBy[0]!.table).toBe('main.st_invoices');
  });

  it('maps a booking’s tables at every depth', () => {
    const value = bookingValue(
      {
        eligible: { table: 'projects', order: { table: 'clients', column: 'position' } },
        hours: { practice: { table: 'settings' } },
        closures: { table: 'terms' },
        grid: { table: 'settings', column: 'grid' },
      } as never,
      (r) => real(r) ?? r,
    ) as { eligible: { table: string; order: { table: string } }; hours: { practice: { table: string } }; closures: { table: string }; grid: { table: string } };
    expect([value.eligible.table, value.eligible.order.table, value.hours.practice.table, value.closures.table, value.grid.table]).toEqual([
      'main.st_projects',
      'main.st_clients',
      'main.st_settings',
      'main.st_terms',
      'main.st_settings',
    ]);
  });

  it('maps an outbox’s log, person, settings, producers, gates, due settings and the row a sent message changes', () => {
    const outbox = {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to' },
      links: { invoice: 'invoice_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email' },
      settings: { table: 'settings' },
      kinds: { rung: 'studio-rung' },
      producers: [
        {
          kind: 'rung',
          link: 'invoice_id',
          onChange: { table: 'invoices', column: 'status', to: 'sent' },
          gate: { setting: { table: 'settings', column: 'reminders_on' } },
          due: { date: 'due_on', days: { setting: { table: 'settings', column: 'ladder' } } },
          onSent: { table: 'projects', via: 'project_id', set: { status: 'paused' } },
        },
      ],
    } as unknown as NonNullable<Extract<Manifest, { kind: 'app' }>['outbox']>;
    const { value, missing } = outboxRefs(outbox, real);
    expect(missing).toEqual([]);
    expect(tableRefsIn(value).sort()).toEqual(['main.st_clients', 'main.st_invoices', 'main.st_messages', 'main.st_projects', 'main.st_settings']);
    // Nothing that is a column moved.
    expect((value as { links: Record<string, string> }).links).toEqual({ invoice: 'invoice_id' });
  });

  it('maps a public entry’s nested tables: the settings it waits on, the venue, who claims it, the parent it is seen with', () => {
    const { value, missing } = nestedRefs(
      {
        table: 'lines',
        methods: ['GET'],
        requireSetting: [{ table: 'settings', column: 'portal_on' }],
        claimedBy: { table: 'clients', column: 'client_id' },
        visibleWith: { table: 'invoices', via: 'document_id' },
      } as never,
      real,
    );
    expect(missing).toEqual([]);
    expect(value.requireSetting![0]!.table).toBe('main.st_settings');
    expect(value.claimedBy!.table).toBe('main.st_clients');
    expect(value.visibleWith!.table).toBe('main.st_invoices');
  });

  it('says which refs it could not find — the live-model check each writer refuses by', () => {
    expect(mapTableRefs({ children: { lines: {}, ghosts: {} }, table: 'invoices' }, real).missing).toEqual(['ghosts']);
    expect(realRuleRefs('column.rollup', { from: 'gone', via: 'x', sum: 'y' }, (r) => real(r) ?? '').missing).toEqual(['gone']);
    expect(nestedRefs({ table: 'lines', methods: ['GET'], visibleWith: { table: 'nowhere', via: 'x' } } as never, real).missing).toEqual(['nowhere']);
  });

  it('refuses to store an outbox that names a table the app does not have here', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const outbox = {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to' },
      recipient: { via: 'client_id', table: 'clients', email: 'email' },
      kinds: { rung: 'studio-rung' },
      producers: [{ kind: 'rung', link: 'invoice_id', onChange: { table: 'invoices', column: 'status', to: 'sent' }, onSent: { table: 'projects', via: 'project_id', set: { status: 'paused' } } }],
    };
    const manifest = { kind: 'app', key: 'studio', outbox } as unknown as Manifest;
    await expect(
      installOutbox({
        meta,
        manifest,
        manifestId: 'mft_1',
        connectionId: 'conn_1',
        realId: (ref) => REAL[ref] ?? ref,
        exists: (id) => id !== 'main.st_projects',
      }),
    ).rejects.toThrow('"projects"');
    expect(await appOutboxesRepo(meta).findByApp('studio')).toBeNull();
    await meta.db.destroy();
  });
});
