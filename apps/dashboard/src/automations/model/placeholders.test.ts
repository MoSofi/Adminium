// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What fills an email step's placeholders — the rule the server's send
 * follows, restated for the inspector and for the warning a save gives.
 */
import { describe, expect, it } from 'vitest';

import type { SourceTable, Sources } from '../api.js';
import type { Action, Graph } from './graph.js';
import { columnOfValue, firstUnfilledEmail, listPlaceholders, placeholderRows, varsFor } from './placeholders.js';

type EmailAction = Extract<Action, { kind: 'email' }>;

const ORDERS: SourceTable = {
  id: 'main.orders',
  label: 'orders',
  canRead: true,
  canCreate: true,
  canUpdate: true,
  watch: { created: null, updated: null },
  columns: ['id', 'name', 'total'].map((name) => ({
    name,
    label: name,
    logicalType: 'varchar',
    isPk: name === 'id',
    pii: false,
    emailLike: false,
    dateLike: false,
  })),
  children: [],
  pageSlug: null,
};

const THANKS = {
  key: 'thanks',
  name: 'Thanks',
  placeholders: ['first_name', 'record.total', 'name', 'order.number', 'appName'],
  ownedByApp: false,
};

const SOURCES: Sources = { connections: [], templates: [THANKS], roles: [] };

function email(vars?: Record<string, string>): EmailAction {
  return { kind: 'email', templateKey: 'thanks', to: { kind: 'fixed', addresses: ['a@b.test'] }, ...(vars === undefined ? {} : { vars }) };
}

function graphOf(action: Action): Graph {
  return {
    version: 1,
    nodes: [
      { id: 'n1', kind: 'trigger', title: 'An order is created' },
      { id: 'n2', kind: 'action', title: 'Say thanks', onError: false, action },
    ],
  };
}

describe('what fills an email step’s placeholders', () => {
  it('a column fills its own name bare or as record.<column>; the rule fills its four; the rest is unfilled', () => {
    expect(placeholderRows(email(), THANKS, ORDERS)).toEqual([
      { name: 'first_name', state: 'unfilled' },
      { name: 'record.total', state: 'record' },
      { name: 'name', state: 'record' },
      { name: 'order.number', state: 'unfilled' },
      { name: 'appName', state: 'rule' },
    ]);
  });

  it('the step’s own entry fills one — an empty text too, which sends nothing in its place', () => {
    const rows = placeholderRows(email({ first_name: '{{record.name}}', 'order.number': '' }), THANKS, ORDERS);
    expect(rows.filter((row) => row.state === 'mapped').map((row) => row.name)).toEqual(['first_name', 'order.number']);
  });

  it('with no record to read — a bare schedule — only the rule’s four are filled', () => {
    expect(placeholderRows(email(), THANKS, null).filter((row) => row.state !== 'unfilled')).toEqual([
      { name: 'appName', state: 'rule' },
    ]);
  });

  it('names the first email step that would send a placeholder as written', () => {
    const found = firstUnfilledEmail(graphOf(email({ first_name: 'friend' })), SOURCES, ORDERS);
    expect(found?.node.id).toBe('n2');
    expect(found?.names).toEqual(['order.number']);
    expect(firstUnfilledEmail(graphOf(email({ first_name: 'friend', 'order.number': '{{record.id}}' })), SOURCES, ORDERS)).toBeNull();
    // A template this build was not told about has nothing to warn of.
    expect(firstUnfilledEmail(graphOf({ ...email(), templateKey: 'gone' }), SOURCES, ORDERS)).toBeNull();
  });

  it('reads a value back as a column only when it is exactly one', () => {
    expect(columnOfValue('{{record.name}}', ORDERS)).toBe('name');
    expect(columnOfValue('Dear {{record.name}}', ORDERS)).toBeNull();
    expect(columnOfValue('{{record.nope}}', ORDERS)).toBeNull();
  });

  it('a newly picked template keeps only the entries it reads', () => {
    const other = { key: 'other', name: 'Other', placeholders: ['first_name'], ownedByApp: false };
    expect(varsFor(email({ first_name: 'a', 'order.number': 'b' }), other)).toEqual({ first_name: 'a' });
    expect(varsFor(email({ first_name: 'a' }), null)).toEqual({});
  });

  it('lists three and counts the rest', () => {
    expect(listPlaceholders(['a', 'b'])).toBe('{{a}}, {{b}}');
    expect(listPlaceholders(['a', 'b', 'c', 'd', 'e'])).toBe('{{a}}, {{b}}, {{c}} +2');
  });
});
