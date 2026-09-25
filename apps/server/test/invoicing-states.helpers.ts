// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoicing app with its documents' lives switched on, for the tests of
 * states, locks and fingerprints: invoices move draft → sent → void (a void
 * of a sent invoice kept for the studio's managers, and only while nothing is
 * paid), their lines lock once sent, payments are taken only on a sent
 * invoice and clear the client's "I've paid"; a payment's date is never
 * after today nor before its invoice was issued; a proposal's terms version
 * locks once a proposal naming it is sent, a proposal's `valid_until` only
 * moves later, and an accepted proposal is sealed with a fingerprint of what
 * it said — its signature, its lines and its terms with their clauses.
 */
import { invoicingManifest } from './invoicing-install.helpers.js';
import { writeTables } from './invoicing-writes.helpers.js';

type Table = { ref: string; columns: Record<string, unknown>[] } & Record<string, unknown>;

export function statesTables(): Record<string, unknown>[] {
  const tables = (writeTables() as Table[]).map((table): Table => {
    if (table.ref === 'invoices') {
      const states = table['states'] as Record<string, unknown>;
      return {
        ...table,
        columns: [
          ...table.columns,
          { ref: 'void_reason', type: 'text', maxLength: 200, nullable: true },
          { ref: 'voided_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'status', values: ['void'] } } } },
          { ref: 'voided_by', type: 'text', maxLength: 120, nullable: true, rules: { stamp: { set: 'user-name', on: { column: 'status', values: ['void'] } } } },
        ],
        states: {
          ...states,
          moves: {
            draft: [{ to: 'sent', requires: { children: { invoice_lines: 1 }, where: [{ column: 'total', gt: 0 }] } }, 'void'],
            sent: [{ to: 'void', requires: { where: [{ column: 'paid', eq: 0 }] }, roles: ['manager'] }],
          },
          lock: { when: ['sent', 'void'], except: ['due_on', 'client_paid_at', 'void_reason'] },
        },
      };
    }
    if (table.ref === 'payments') {
      return {
        ...table,
        columns: [
          ...table.columns,
          { ref: 'paid_on', type: 'date', nullable: true, rules: { notAfter: 'today', notBefore: { column: 'issued_on', via: 'invoice_id' } } },
        ],
      };
    }
    if (table.ref === 'proposals') {
      return {
        ...table,
        columns: [
          ...table.columns
            .filter((column) => column['ref'] !== 'fingerprint')
            .concat([
              { ref: 'valid_until', type: 'date', nullable: true },
              { ref: 'terms_id', type: 'fk', references: 'terms', nullable: true },
              {
                ref: 'fingerprint',
                type: 'text',
                maxLength: 64,
                nullable: true,
                rules: {
                  stamp: {
                    set: {
                      hashOf: {
                        columns: ['signed_name', 'valid_until'],
                        children: [{ table: 'proposal_lines', via: 'proposal_id', columns: ['position', 'amount'], orderBy: 'position' }],
                        linked: [
                          {
                            via: 'terms_id',
                            table: 'terms',
                            columns: ['version'],
                            children: [{ table: 'terms_clauses', via: 'terms_id', columns: ['position', 'body'], orderBy: 'position' }],
                          },
                        ],
                      },
                    },
                    on: [{ column: 'status', values: ['accepted'] }, { column: 'signed_name', filled: true }],
                  },
                },
              },
            ]),
        ],
        states: {
          column: 'status',
          initial: 'draft',
          moves: { draft: ['sent'], sent: ['accepted'] },
          noDelete: { when: ['accepted'] },
          onlyLater: ['valid_until'],
        },
      };
    }
    return table;
  });
  // The terms a proposal names: a version, and its clauses.
  const terms: Table = {
    ref: 'terms',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'version', type: 'text', maxLength: 24 },
      { ref: 'status', type: 'enum', enum: ['current', 'retired'], default: 'current' },
    ],
    states: {
      column: 'status',
      initial: 'current',
      moves: { current: ['retired'] },
      lock: { when: ['retired'] },
      children: { terms_clauses: { via: 'terms_id', lock: true } },
      lockedWhenReferencedBy: [{ table: 'proposals', via: 'terms_id', in: ['sent', 'accepted'] }],
    },
  };
  const clauses: Table = {
    ref: 'terms_clauses',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'terms_id', type: 'fk', references: 'terms' },
      { ref: 'position', type: 'int', default: 0 },
      { ref: 'body', type: 'text', maxLength: 1000 },
    ],
  };
  // Referenced tables first: the installer creates them in order.
  const at = tables.findIndex((table) => table.ref === 'proposals');
  tables.splice(at, 0, terms, clauses);
  return tables;
}

/** The app, with a manager role a void of a sent invoice is kept for. */
export function statesManifest(): Record<string, unknown> {
  return { ...invoicingManifest(statesTables()), roles: [{ key: 'manager', name: 'Studio manager' }] };
}
