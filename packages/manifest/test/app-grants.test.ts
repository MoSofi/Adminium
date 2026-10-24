// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `appGrants`: what an app's role may be given of an add-on's table. The
 * add-on says it of its own tables; an app's grant is cut to it, named, and
 * never written whole on such a table. An add-on that says nothing is held
 * only by its own shape, as before the word.
 */
import { describe, expect, it } from 'vitest';

import { addOnRoleTableHold, holdWider, installFloorWords, isAddOnManifest, validateManifest, type AddOnManifest, type RoleAddOnTable } from '../src/index.js';
import { LEDGER_HOST, LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;
type TableDoc = { ref: string; columns: Doc[]; appGrants?: Doc };

/** The kit with `appGrants` on some of its tables, at the release that reads them. */
function kit(grants: Record<string, Doc | undefined>, floor = '0.3.28'): Doc {
  const doc = structuredClone(LEDGER_KIT) as unknown as { compatibility: Doc; requiredSchema: { tables: TableDoc[] } };
  doc.compatibility = { minAdminiumVersion: floor };
  for (const table of doc.requiredSchema.tables) {
    const set = grants[table.ref];
    if (set !== undefined) table.appGrants = set;
  }
  return doc as unknown as Doc;
}

const messages = (doc: Doc): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

const parsed = (doc: Doc): AddOnManifest => {
  const result = validateManifest(doc);
  if (!result.ok || !isAddOnManifest(result.manifest)) throw new Error(JSON.stringify(result));
  return result.manifest;
};

const ACCOUNTS = { actions: ['read', 'update'], readable: ['id', 'name', 'balance', 'reorder_at', 'low'], writable: ['name', 'reorder_at'] };
const grant = (table: string, actions: RoleAddOnTable['actions'], limit?: RoleAddOnTable['limit']): RoleAddOnTable => ({ addOn: 'ledger-kit', table, actions, ...(limit === undefined ? {} : { limit }) });

describe('appGrants on an add-on\'s table', () => {
  it('validates, and asks for the release that reads it', () => {
    const doc = kit({ accounts: ACCOUNTS, entries: { actions: ['read'], never: ['note'] }, requests: { actions: ['read', 'create'], creatable: ['account_id', 'quantity'] } });
    expect(messages(doc)).toEqual([]);
    expect(installFloorWords(doc).filter((found) => found.word === 'table.appGrants').map((found) => found.path)).toEqual([
      'requiredSchema.tables.0.appGrants',
      'requiredSchema.tables.1.appGrants',
      'requiredSchema.tables.4.appGrants',
    ]);
    // A release before it cannot read the word: the floor says so.
    expect(messages(kit({ accounts: ACCOUNTS }, '0.3.27')).some((line) => line.includes('appGrants'))).toBe(true);
  });

  it('names a column the table has not, a list with no action, a write with no columns', () => {
    expect(messages(kit({ accounts: { actions: ['read'], readable: ['id', 'cost'] } }))).toEqual(['requiredSchema.tables.0.appGrants.readable.1: "accounts" has no column "cost"']);
    expect(messages(kit({ accounts: { actions: ['read'], writable: ['name'] } }))).toEqual(['requiredSchema.tables.0.appGrants.writable: "update" is not allowed here, so there is nothing for "writable" to name']);
    expect(messages(kit({ accounts: { actions: ['read', 'update'] } }))).toEqual(['requiredSchema.tables.0.appGrants.writable: an app\'s role may change rows here: name the columns it may change ("writable")']);
    expect(messages(kit({ requests: { actions: ['create'] } }))).toEqual(['requiredSchema.tables.4.appGrants.creatable: an app\'s role may add rows here: name the columns it may fill ("creatable")']);
    expect(messages(kit({ accounts: { actions: ['read', 'read'] } }))).toEqual(['requiredSchema.tables.0.appGrants.actions: an action is listed once']);
  });

  it('refuses a column both listed and never, and the key in never; a link may be kept from every app', () => {
    expect(messages(kit({ accounts: { actions: ['read'], readable: ['id', 'name'], never: ['name'] } }))).toEqual(['requiredSchema.tables.0.appGrants.readable.1: "name" is listed in "never" too']);
    expect(messages(kit({ entries: { actions: ['read'], never: ['id'] } }))).toEqual([
      'requiredSchema.tables.1.appGrants.never.0: "id" is the table\'s key, which every read shows: leave it out of "writable" and "creatable" instead',
    ]);
    // A link is a column like any other since 0.3.35: a read that does not list it does not show it.
    expect(messages(kit({ entries: { actions: ['read'], never: ['account_id'] } }))).toEqual([]);
  });

  it('refuses it on a ledger\'s receipts, and any write on a table a ledger\'s code writes', () => {
    expect(messages(kit({ postings: { actions: ['read'] } }))).toEqual(['requiredSchema.tables.3.appGrants: "postings" is a ledger\'s receipt table, which no app\'s role ever holds: take "appGrants" off it']);
    expect(messages(kit({ holds: { actions: ['read', 'update'], writable: ['state'] } }))).toEqual(['requiredSchema.tables.2.appGrants.actions.1: a ledger\'s code writes "holds": an app\'s role may only read it']);
  });

  it('is an add-on\'s word: an app\'s own table is refused it', () => {
    const app = structuredClone(LEDGER_HOST) as unknown as { compatibility: Doc; requiredSchema: { tables: TableDoc[] } };
    app.compatibility = { minAdminiumVersion: '0.3.28' };
    app.requiredSchema.tables[0]!.appGrants = { actions: ['read'] };
    expect(messages(app as unknown as Doc)).toContain('requiredSchema.tables.0.appGrants: an app\'s table is granted by its own roles: "appGrants" is how an add-on says what an app may be given of its tables');
  });
});

describe('an app\'s grant, cut to the add-on\'s words', () => {
  it('an add-on that says nothing: its shape alone, as before the word', () => {
    const plain = parsed(kit({}));
    expect(addOnRoleTableHold(grant('accounts', ['read', 'update']), plain)).toEqual({ actions: ['read', 'update'] });
    expect(addOnRoleTableHold(grant('entries', ['read', 'create']), plain)).toEqual({ actions: ['read'], narrowed: { actions: ['create'] }, skipped: 'ledger-table' });
    expect(addOnRoleTableHold(grant('postings', ['read']), plain)).toEqual({ actions: [], narrowed: { actions: ['read'] }, skipped: 'ledger-table' });
    expect(addOnRoleTableHold(grant('accounts', ['read'], { readable: ['id', 'cost'] }), plain)).toEqual({ actions: [], skipped: 'unknown-column', narrowed: { actions: ['read'] } });
    expect(addOnRoleTableHold(grant('shelves', ['read']), plain)).toMatchObject({ actions: [], skipped: 'unknown-table' });
  });

  it('cuts actions and columns past the ceiling and names them; never wider', () => {
    const ceiling = parsed(kit({ accounts: ACCOUNTS, entries: { actions: ['read'], never: ['note'] } }));
    // Asked for more than the ceiling: the update's `allow_below` and the read's `taken` are left out, by name.
    const hold = addOnRoleTableHold(grant('accounts', ['read', 'update'], { readable: ['id', 'name', 'taken'], writable: ['name', 'allow_below'], writableValues: { allow_below: [true] } }), ceiling);
    expect(hold).toEqual({
      actions: ['read', 'update'],
      readable: ['id', 'name'],
      writable: ['name'],
      limit: { readable: ['id', 'name'], writable: ['name'] },
      narrowed: { actions: [], readable: ['taken'], writable: ['allow_below'] },
      skipped: 'ceiling',
    });
    // A create the add-on does not allow here.
    expect(addOnRoleTableHold(grant('accounts', ['read', 'create'], { readable: ['id', 'name'] }), ceiling)).toEqual({
      actions: ['read'],
      readable: ['id', 'name'],
      limit: { readable: ['id', 'name'] },
      narrowed: { actions: ['create'] },
      skipped: 'ceiling',
    });
  });

  it('a grant asked whole is written with the add-on\'s columns, and what it keeps back is said', () => {
    const ceiling = parsed(kit({ accounts: ACCOUNTS, entries: { actions: ['read'], never: ['note'] } }));
    expect(addOnRoleTableHold(grant('accounts', ['read', 'update']), ceiling)).toEqual({
      actions: ['read', 'update'],
      readable: ['id', 'name', 'balance', 'reorder_at', 'low'],
      writable: ['name', 'reorder_at'],
      limit: { readable: ['id', 'name', 'balance', 'reorder_at', 'low'], writable: ['name', 'reorder_at'] },
      narrowed: { actions: [], readable: ['opening', 'taken', 'allow_below'], writable: ['id', 'opening', 'taken', 'balance', 'allow_below', 'low'] },
      skipped: 'ceiling',
    });
    // `never` alone: every column but those.
    expect(addOnRoleTableHold(grant('entries', ['read']), ceiling)).toEqual({
      actions: ['read'],
      readable: ['id', 'account_id', 'amount', 'kind', 'receipt_id'],
      limit: { readable: ['id', 'account_id', 'amount', 'kind', 'receipt_id'] },
      narrowed: { actions: [], readable: ['note'] },
      skipped: 'ceiling',
    });
  });

  it('a table the add-on gives to no app is given to no app\'s role, once the add-on says it of any', () => {
    const ceiling = parsed(kit({ accounts: ACCOUNTS }));
    expect(addOnRoleTableHold(grant('requests', ['read']), ceiling)).toEqual({ actions: [], narrowed: { actions: ['read'] }, skipped: 'not-offered' });
  });

  it('an action left with no column is left out; the values and the rows it reaches go with it', () => {
    const ceiling = parsed(kit({ accounts: ACCOUNTS }));
    const hold = addOnRoleTableHold(
      grant('accounts', ['read', 'update'], { readable: ['id'], writable: ['allow_below'], writableValues: { allow_below: [true] }, rows: { update: { reach: 'all', while: { column: 'low', in: [1] } } } }),
      ceiling,
    );
    expect(hold).toEqual({ actions: ['read'], readable: ['id'], limit: { readable: ['id'] }, narrowed: { actions: ['update'], writable: ['allow_below'] }, skipped: 'ceiling' });
  });

  it('a row limit on a column an app may not read leaves the whole entry out: which rows it reaches would tell the value', () => {
    const ceiling = parsed(kit({ accounts: ACCOUNTS }));
    const byValue = (limit: RoleAddOnTable['limit']) => addOnRoleTableHold(grant('accounts', ['read', 'update'], limit), ceiling);
    expect(byValue({ readable: ['id'], rows: { read: { reach: 'all', while: { column: 'taken', in: [0] } } } })).toEqual({ actions: [], narrowed: { actions: ['read', 'update'] }, skipped: 'ceiling' });
    expect(byValue({ writable: ['name'], writableFrom: { allow_below: [true] } })).toEqual({ actions: [], narrowed: { actions: ['read', 'update'] }, skipped: 'ceiling' });
    // On a column it may read, the limit stands and narrows.
    expect(byValue({ readable: ['id', 'low'], writable: ['name'], writableFrom: { low: [1] } })).toMatchObject({ actions: ['read', 'update'], limit: { readable: ['id', 'low'], writable: ['name'], writableFrom: { low: [1] } } });
  });

  it('a secret is never read through "every column"', () => {
    const doc = kit({ accounts: { actions: ['read'] } }) as { requiredSchema: { tables: TableDoc[] } };
    doc.requiredSchema.tables[0]!.columns.push({ ref: 'pin', type: 'text', maxLength: 8, nullable: true, rules: { secret: true } });
    const hold = addOnRoleTableHold(grant('accounts', ['read']), parsed(doc as unknown as Doc));
    expect(hold.readable).not.toContain('pin');
    expect(hold.readable).toContain('balance');
  });
});

describe('what a new grant holds more than the old', () => {
  it('names a new action, a new column, and a list that became every column', () => {
    expect(holdWider({ actions: ['read'], readable: ['id', 'name'] }, { actions: ['read'], readable: ['id', 'name'] })).toBeNull();
    expect(holdWider({ actions: ['read'], readable: ['id', 'name'] }, { actions: ['read'], readable: ['id'] })).toBeNull();
    expect(holdWider({ actions: ['read'], readable: ['id', 'name'] }, { actions: ['read'], readable: ['id', 'name', 'email'] })).toEqual({ actions: [], columns: ['email'] });
    expect(holdWider({ actions: ['read'], readable: ['id'] }, { actions: ['read', 'update'], readable: ['id'], writable: ['email'] })).toEqual({ actions: ['update'], columns: ['email'] });
    expect(holdWider({ actions: ['read'], readable: ['id'] }, { actions: ['read'] })).toEqual({ actions: [], columns: ['*'] });
    expect(holdWider({ actions: ['read'] }, { actions: ['read'], readable: ['id'] })).toBeNull();
    expect(holdWider(null, { actions: ['read'], readable: ['id'] })).toEqual({ actions: ['read'], columns: ['id'] });
  });
});
