// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's role on an add-on's table may read its personal columns
 * (`read_pii`, beside `read`) and remove rows (`delete`), and hold up to
 * twenty-four such grants. A table a ledger's code writes stays the ledger's:
 * an app's role reads it, and adds rows and changes the add-on's own columns
 * there only where the add-on allows it by name (`appGrants`) — never a
 * column the ledger's code writes, never a remove.
 */
import { describe, expect, it } from 'vitest';

import { addOnRoleTableHold, holdWider, installFloorWords, isAddOnManifest, roleTableHold, validateManifest, type AddOnManifest, type RoleAddOnTable } from '../src/index.js';
import { LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;
type TableDoc = { ref: string; columns: Doc[]; appGrants?: Doc };

const said = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

/** An app whose desk role holds `tables` of the add-on `kit`. */
function app(tables: unknown[], floor = '0.3.47'): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Front Desk',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A front desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: { tables: [{ ref: 'visits', columns: [{ ref: 'id', type: 'int', role: 'pk' }] }] },
    pages: [{ ref: 'desk-visits', template: 'page-crud', title: { key: 't', fallback: 'Visits' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'visits' } }],
    roles: [{ key: 'desk', name: 'Desk', screensOnly: true, permissions: ['table:@visits:read'], tables }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    addOns: { suggests: [{ key: 'kit', range: '>=1.0.0', reason: { 'en-US': 'Designs.' } }] },
  };
}

/** The ledger kit, with a column of `holds` no ledger writes (`memo`), and `appGrants` on some tables. */
function kit(grants: Record<string, Doc | undefined>, floor = '0.3.47'): Doc {
  const doc = structuredClone(LEDGER_KIT) as unknown as { compatibility: Doc; requiredSchema: { tables: TableDoc[] } };
  doc.compatibility = { minAdminiumVersion: floor };
  for (const table of doc.requiredSchema.tables) {
    if (table.ref === 'holds') table.columns.push({ ref: 'memo', type: 'text', maxLength: 200, nullable: true });
    const set = grants[table.ref];
    if (set !== undefined) table.appGrants = set;
  }
  return doc as unknown as Doc;
}

const parsed = (doc: Doc): AddOnManifest => {
  const result = validateManifest(doc);
  if (!result.ok || !isAddOnManifest(result.manifest)) throw new Error(JSON.stringify(result));
  return result.manifest;
};

const grant = (table: string, actions: RoleAddOnTable['actions'], limit?: RoleAddOnTable['limit']): RoleAddOnTable => ({ addOn: 'ledger-kit', table, actions, ...(limit === undefined ? {} : { limit }) });

describe("an app's role on an add-on's table: personal columns, removing rows, twenty-four tables", () => {
  it('takes read_pii beside read, and delete, at the release that reads them', () => {
    const doc = app([{ addOn: 'kit', table: 'designs', actions: ['read', 'read_pii'] }, { addOn: 'kit', table: 'files', actions: ['read', 'create', 'delete'] }]);
    expect(said(doc)).toEqual([]);
    expect(installFloorWords(doc).filter((found) => found.word === 'roles.addOnActions').map((found) => found.path)).toEqual(['roles.0.tables.0.actions', 'roles.0.tables.1.actions']);
    expect(said(app([{ addOn: 'kit', table: 'designs', actions: ['read', 'read_pii'] }], '0.3.46')).join('\n')).toContain('"roles.addOnActions" is read by Adminium 0.3.47 and later');
  });

  it('refuses read_pii without the read it shows', () => {
    expect(said(app([{ addOn: 'kit', table: 'designs', actions: ['read_pii'] }]))).toEqual(['roles.0.tables.0.actions: "read_pii" shows the personal columns of what the role reads: give it "read" too']);
  });

  it('a remove may be limited to some rows, as an own table\'s is', () => {
    expect(said(app([{ addOn: 'kit', table: 'files', actions: ['read', 'delete'], limit: { rows: { delete: { reach: 'all', while: { column: 'kind', in: ['print'] } } } } }]))).toEqual([]);
    expect(said(app([{ addOn: 'kit', table: 'files', actions: ['read'], limit: { rows: { delete: { reach: 'all', while: { column: 'kind', in: ['print'] } } } } }])).join('\n')).toContain('the grant has no "delete", so there is nothing for its rows to limit');
  });

  it('holds twenty-four add-on tables, not twenty-five; more than twelve needs the release that reads them', () => {
    const many = (count: number) => app(Array.from({ length: count }, (_, at) => ({ addOn: 'kit', table: `t${String(at)}`, actions: ['read'] })));
    expect(said(many(24))).toEqual([]);
    expect(said(many(25)).join('\n')).toContain('roles.0.tables');
    expect(installFloorWords(many(13)).map((found) => found.word)).toContain('roles.addOnActions');
    expect(installFloorWords(many(12)).map((found) => found.word)).not.toContain('roles.addOnActions');
  });
});

describe("an add-on's appGrants: personal columns, removing rows, a ledger's table", () => {
  it('may allow adding rows and changing its own columns of a table a ledger writes, at the release that reads it', () => {
    const doc = kit({ holds: { actions: ['read', 'create', 'update'], creatable: ['account_id', 'amount', 'memo'], writable: ['memo'] }, accounts: { actions: ['read', 'read_pii', 'delete'] } });
    expect(said(doc)).toEqual([]);
    expect(installFloorWords(doc).filter((found) => found.word === 'appGrants.more').map((found) => found.path)).toEqual(['requiredSchema.tables.0.appGrants.actions', 'requiredSchema.tables.2.appGrants.actions']);
    expect(said(kit({ holds: { actions: ['read', 'update'], writable: ['memo'] } }, '0.3.46')).join('\n')).toContain('"appGrants.more" is read by Adminium 0.3.47 and later');
  });

  it('never a column the ledger writes, never a remove there, never personal columns without the read', () => {
    expect(said(kit({ holds: { actions: ['read', 'update'], writable: ['memo', 'state'] } }))).toEqual(['requiredSchema.tables.2.appGrants.writable.1: a ledger\'s code writes "holds.state": no app\'s role changes it']);
    expect(said(kit({ holds: { actions: ['read', 'delete'] } }))).toEqual(['requiredSchema.tables.2.appGrants.actions.1: a ledger\'s code writes "holds": no app\'s role removes its rows']);
    expect(said(kit({ accounts: { actions: ['read_pii'] } }))).toEqual(['requiredSchema.tables.0.appGrants.actions: "read_pii" shows the personal columns of what a role reads: allow "read" too']);
  });
});

describe("an app's grant on a ledger's table, cut to the add-on's words", () => {
  it('an add-on that says nothing: read, and its personal columns; no add, change or remove', () => {
    const plain = parsed(kit({}));
    expect(addOnRoleTableHold(grant('holds', ['read', 'read_pii', 'create', 'update', 'delete']), plain)).toEqual({ actions: ['read', 'read_pii'], narrowed: { actions: ['create', 'update', 'delete'] }, skipped: 'ledger-table' });
    // A table no ledger writes: every action asked, the remove and the personal columns too.
    expect(addOnRoleTableHold(grant('requests', ['read', 'read_pii', 'delete']), plain)).toEqual({ actions: ['read', 'read_pii', 'delete'] });
  });

  it('an add-on that allows it: rows added and its own columns changed, never what the ledger copied', () => {
    const allows = parsed(kit({ holds: { actions: ['read', 'read_pii', 'create', 'update'], creatable: ['account_id', 'amount', 'memo'], writable: ['memo'] }, accounts: { actions: ['read'] } }));
    expect(addOnRoleTableHold(grant('holds', ['read', 'read_pii', 'create', 'update', 'delete'], { creatable: ['account_id', 'amount', 'memo'], writable: ['memo'] }), allows)).toEqual({
      actions: ['read', 'read_pii', 'create', 'update'],
      readable: ['id', 'account_id', 'amount', 'state', 'receipt_id', 'memo'],
      writable: ['memo'],
      creatable: ['account_id', 'amount', 'memo'],
      limit: { readable: ['id', 'account_id', 'amount', 'state', 'receipt_id', 'memo'], writable: ['memo'], creatable: ['account_id', 'amount', 'memo'] },
      narrowed: { actions: ['delete'] },
      skipped: 'ledger-table',
    });
    // Personal columns the add-on does not allow an app: the read stands, read_pii is said.
    expect(addOnRoleTableHold(grant('accounts', ['read', 'read_pii']), allows)).toMatchObject({ actions: ['read'], narrowed: { actions: ['read_pii'] }, skipped: 'ceiling' });
  });

  it('an update never reaches a column the ledger writes, even where the add-on\'s words list it', () => {
    // A shape no manifest passes (the validator refuses it): the hold still keeps the ledger's column out.
    const shape = { tables: [{ ref: 'holds', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'state', type: 'text' }, { ref: 'memo', type: 'text' }], appGrants: { actions: ['read', 'update'] as RoleAddOnTable['actions'], writable: ['state', 'memo'] } }], ledgers: [{ receipts: 'postings', writes: { holds: { update: { by: ['id'], set: ['state'] } } } }] };
    const hold = roleTableHold(grant('holds', ['read', 'update'], { writable: ['state', 'memo'] }), shape);
    expect(hold).toMatchObject({ actions: ['read', 'update'], writable: ['memo'], narrowed: { writable: ['state'] } });
  });

  it('personal columns go with a read the add-on cuts', () => {
    const noRead = parsed(kit({ requests: { actions: ['create'], creatable: ['account_id', 'quantity'] } }));
    expect(addOnRoleTableHold(grant('requests', ['read', 'read_pii', 'create'], { creatable: ['account_id'] }), noRead)).toMatchObject({ actions: ['create'], narrowed: { actions: ['read', 'read_pii'] } });
  });

  it('personal columns never stand without the read, even where an add-on\'s words would allow them alone', () => {
    // A shape no manifest passes (the validator refuses `read_pii` without `read`): the hold still drops it.
    const shape = { tables: [{ ref: 'designs', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'words', type: 'text' }], appGrants: { actions: ['read_pii', 'create'] as RoleAddOnTable['actions'], creatable: ['words'] } }], ledgers: [] };
    expect(roleTableHold(grant('designs', ['read', 'read_pii', 'create'], { creatable: ['words'] }), shape)).toMatchObject({ actions: ['create'], narrowed: { actions: ['read', 'read_pii'] } });
  });

  it('a new personal-column read or remove is a widening, said by its action', () => {
    expect(holdWider({ actions: ['read'] }, { actions: ['read', 'read_pii'] })).toEqual({ actions: ['read_pii'], columns: [] });
    expect(holdWider({ actions: ['read', 'delete'] }, { actions: ['read', 'delete'] })).toBeNull();
  });
});
