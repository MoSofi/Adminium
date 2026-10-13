// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A move's last day (`requires.notPast`), a column a public write is asked for
 * only with a choice (`requiresWhen`), and a share link's key that goes with
 * its part: the schema, the floor each word asks for, and what is refused.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, notPastIssues, publicAccessSchema, stateMoveSchema, withoutModules, WORD_FLOORS } from '../src/index.js';

describe('requires.notPast', () => {
  const typeOf = (ref: string) => ({ valid_until: 'date', sent_at: 'timestamptz', status: 'enum' })[ref];

  it('is a date column of the table, on a move a person makes', () => {
    const move = (requires: Record<string, unknown>, more: Record<string, unknown> = {}) => stateMoveSchema.parse({ to: 'accepted', requires, ...more });
    expect(notPastIssues('quotes', 'status', move({ notPast: 'valid_until' }), typeOf)).toEqual([]);
    expect(notPastIssues('quotes', 'status', 'accepted', typeOf)).toEqual([]);
    expect(notPastIssues('quotes', 'status', move({ notPast: 'nope' }), typeOf)[0]).toEqual({ path: ['requires', 'notPast'], message: '"quotes" has no column "nope"' });
    expect(notPastIssues('quotes', 'status', move({ notPast: 'sent_at' }), typeOf)[0]!.message).toContain('is not a date');
    expect(notPastIssues('quotes', 'status', move({ notPast: 'status' }), typeOf)[0]!.message).toBe('the state is no date');
    expect(notPastIssues('quotes', 'status', move({ notPast: 'valid_until' }, { undo: true }), typeOf)[0]!.message).toContain('an undo');
    expect(notPastIssues('quotes', 'status', move({ notPast: 'valid_until' }, { planned: true }), typeOf)[0]!.message).toContain('a planned move');
  });

  it('asks for the release that reads it', () => {
    const doc = { kind: 'app', requiredSchema: { tables: [{ ref: 'quotes', states: { moves: { sent: [{ to: 'accepted', requires: { notPast: 'valid_until' } }, 'declined'] } } }] } };
    expect(installFloorWords(doc)).toContainEqual({ word: 'states.notPast', path: 'requiredSchema.tables.0.states.moves.sent.0.requires.notPast' });
    expect(WORD_FLOORS['states.notPast']).toBe('0.3.28');
  });
});

describe('publicAccess.requiresWhen', () => {
  const entry = (requiresWhen: unknown) => publicAccessSchema.safeParse({ table: 'quotes', methods: ['PATCH'], writable: ['status', 'accepted_name'], requiresWhen });

  it('names a column, the one other column and its values', () => {
    expect(entry({ accepted_name: { status: ['accepted'] } }).success).toBe(true);
    expect(entry({ accepted_name: { status: ['accepted'], kind: ['big'] } }).success).toBe(false);
    expect(entry({ accepted_name: { status: [] } }).success).toBe(false);
    expect(entry({}).success).toBe(false);
  });

  it('asks for the release that reads it', () => {
    const doc = { kind: 'app', publicAccess: [{ table: 'quotes', requiresWhen: { accepted_name: { status: ['accepted'] } } }] };
    expect(installFloorWords(doc)).toContainEqual({ word: 'publicAccess.requiresWhen', path: 'publicAccess.0.requiresWhen' });
    expect(WORD_FLOORS['publicAccess.requiresWhen']).toBe('0.3.28');
  });
});

describe('a key whose entries all went with a part', () => {
  const doc = (keys: Record<string, unknown>, entries: Record<string, unknown>[]) => ({
    kind: 'app',
    requiredSchema: { tables: [{ ref: 'deals', module: 'selling', columns: [] }, { ref: 'quotes', module: 'quotes', columns: [] }] },
    publicKeys: keys,
    publicAccess: entries,
  });

  it('goes with it; one that still serves something, or never served anything, stays', () => {
    const quote = { table: 'quotes', key: 'quote', module: 'quotes' };
    expect(withoutModules(doc({ quote: {} }, [quote]), ['quotes'])).not.toHaveProperty('publicKeys');
    // An entry on a table of the part, with no module said, goes with the table: the key too.
    expect(withoutModules(doc({ quote: {} }, [{ table: 'quotes', key: 'quote' }]), ['quotes'])).not.toHaveProperty('publicKeys');
    const both = withoutModules(doc({ quote: {}, deal: {} }, [quote, { table: 'deals', key: 'deal' }]), ['quotes']);
    expect(both.publicKeys).toEqual({ deal: {} });
    const mixed = withoutModules(doc({ quote: {} }, [quote, { table: 'deals', key: 'quote' }]), ['quotes']);
    expect(mixed.publicKeys).toEqual({ quote: {} });
    expect(withoutModules(doc({ quote: {}, idle: {} }, [quote]), ['quotes']).publicKeys).toEqual({ idle: {} });
    // Nothing left out: nothing taken.
    expect(withoutModules(doc({ quote: {} }, [quote]), []).publicKeys).toEqual({ quote: {} });
  });
});
