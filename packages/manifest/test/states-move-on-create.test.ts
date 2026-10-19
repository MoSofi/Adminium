// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A new child row that moves its parent (`states.children.<table>.moveOnCreate`),
 * as the manifest check reads it: a sign-off made on site signs its job off,
 * by the job's own listed move. What it may name, what it is refused for, and
 * the release that runs it.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, stateChildSchema, validateManifest, WORD_FLOORS } from '../src/index.js';

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };

type Doc = Record<string, unknown>;

/** Jobs and their sign-offs; a sign-off moves its job to signed-off. */
function firm(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'firm',
    name: 'Firm',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.firm.desc', fallback: 'A firm.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.30', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'work', label: en('Work'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'jobs',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'state', type: 'enum', enum: ['open', 'installed', 'signed-off', 'billed'], default: 'open' },
            { ref: 'blocking_snags', type: 'int', default: 0 },
            { ref: 'signed_off_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'state', values: ['signed-off'] } } } },
          ],
          states: {
            column: 'state',
            initial: 'open',
            moves: {
              open: ['installed'],
              installed: [{ to: 'signed-off', requires: { children: { sign_offs: 1 }, where: [{ column: 'blocking_snags', eq: 0 }] } }],
              'signed-off': ['billed'],
            },
            children: { sign_offs: { via: 'job_id', createIn: ['open', 'installed', 'signed-off'], moveOnCreate: 'signed-off' } },
          },
        },
        {
          ref: 'sign_offs',
          columns: [id, { ref: 'job_id', type: 'fk', references: 'jobs' }, { ref: 'signer_name', type: 'text', maxLength: 80 }, { ref: 'corrects_id', type: 'fk', references: 'sign_offs', nullable: true }],
        },
      ],
    },
    roles: [{ key: 'crew', name: 'Crew', permissions: ['table:@sign_offs:read', 'table:@sign_offs:create', 'page:@firm-sign-offs:view'] }],
    pages: [{ ref: 'firm-sign-offs', template: 'page-crud', title: { key: 't.so', fallback: 'Sign-offs' }, nav: { group: 'work', icon: 'list', order: 1 }, bindings: { rows: 'sign_offs' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const tables = (doc: Doc) => (doc['requiredSchema'] as { tables: Doc[] }).tables;
const jobs = (doc: Doc) => tables(doc)[0]!['states'] as Doc;
const child = (doc: Doc) => (jobs(doc)['children'] as Record<string, Doc>)['sign_offs']!;
const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
};
const said = (edit: (doc: Doc) => void): string => {
  const doc = firm();
  edit(doc);
  return issuesOf(doc).join('\n');
};
const AT = 'requiredSchema.tables.0.states.children.sign_offs.moveOnCreate';

describe('states.children.<table>.moveOnCreate', () => {
  it('validates, is kept as written, and asks for 0.3.30', () => {
    expect(issuesOf(firm())).toEqual([]);
    const result = validateManifest(firm());
    if (!result.ok) throw new Error('expected a manifest');
    expect(result.manifest.requiredSchema.tables[0]!.states!.children!['sign_offs']!.moveOnCreate).toBe('signed-off');
    expect(installFloorWords(firm())).toContainEqual({ word: 'states.moveOnCreate', path: 'requiredSchema.tables.0.states.children.sign_offs.moveOnCreate' });
    expect(WORD_FLOORS['states.moveOnCreate']).toBe('0.3.30');
    // At 0.3.29 the release that reads it is named.
    expect(said((doc) => ((doc['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.29'))).toMatch(/states\.moveOnCreate/);
  });

  it('is a state, and alone ties a child to its parent', () => {
    expect(stateChildSchema.safeParse({ via: 'job_id', moveOnCreate: 'signed-off' }).success).toBe(true);
    expect(stateChildSchema.safeParse({ via: 'job_id', moveOnCreate: '' }).success).toBe(false);
    expect(stateChildSchema.safeParse({ via: 'job_id', moveOnCreate: ['signed-off'] }).success).toBe(false);
    expect(said((doc) => (jobs(doc)['children'] = { sign_offs: { via: 'job_id', moveOnCreate: 'signed-off' } }))).toBe('');
  });

  it('names a state a listed move goes to', () => {
    expect(said((doc) => (child(doc)['moveOnCreate'] = 'closed'))).toContain(`${AT}: "closed" is not a value of "jobs.state"`);
    expect(said((doc) => (child(doc)['moveOnCreate'] = 'open'))).toContain(`${AT}: no listed move goes to "open", so a new "sign_offs" row has nothing to move this row by`);
  });

  it('refuses a move no new row could make: an undo, a ledger\'s own, one waiting for another row', () => {
    expect(
      said((doc) => {
        const moves = jobs(doc)['moves'] as Record<string, unknown[]>;
        moves['installed'] = [];
        moves['signed-off'] = ['billed', { to: 'installed', undo: true }];
        child(doc)['moveOnCreate'] = 'installed';
        child(doc)['createIn'] = ['open', 'signed-off'];
        moves['open'] = [];
      }),
    ).toContain('every move of "jobs" to "installed" is an undo, which only a person makes');
    expect(
      said((doc) => {
        (jobs(doc)['moves'] as Record<string, unknown[]>)['installed'] = [{ to: 'signed-off', planned: true }];
      }),
    ).toContain(`${AT}: every move to "signed-off" is made by an add-on's ledger alone, so a new "sign_offs" row cannot make it`);
    expect(
      said((doc) => {
        tables(doc).push({ ref: 'deals', columns: [id, { ref: 'won', type: 'bool', default: false }] });
        (tables(doc)[0]!['columns'] as unknown[]).push({ ref: 'deal_id', type: 'fk', references: 'deals' });
        (jobs(doc)['moves'] as Record<string, unknown[]>)['installed'] = [{ to: 'signed-off', requires: { linked: [{ via: 'deal_id', where: [{ column: 'won', eq: true }] }] } }];
      }),
    ).toContain(`${AT}: the move of "jobs" to "signed-off" waits for another row, so an effect cannot make it`);
  });

  it('refuses a parent whose move would set off its own effects, a line of another table, or a table that keeps a limit', () => {
    const chain = firm();
    tables(chain).push({ ref: 'sites', columns: [id, { ref: 'state', type: 'enum', enum: ['live', 'done'], default: 'live' }], states: { column: 'state', initial: 'live', moves: { live: ['done'] } } });
    (tables(chain)[0]!['columns'] as unknown[]).push({ ref: 'site_id', type: 'fk', references: 'sites', nullable: true });
    jobs(chain)['effects'] = [{ on: { to: 'signed-off' }, via: 'site_id', set: { state: 'done' } }];
    expect(issuesOf(chain).join('\n')).toContain(`${AT}: "jobs" sets off effects of its own; an effect moves one row, never a chain`);

    const line = firm();
    tables(line).push({
      ref: 'deals',
      columns: [id, { ref: 'state', type: 'enum', enum: ['open', 'won'], default: 'open' }],
      states: { column: 'state', initial: 'open', moves: { open: ['won'] }, children: { jobs: { via: 'deal_id', lock: true } }, lock: { when: ['won'] } },
    });
    (tables(line)[0]!['columns'] as unknown[]).push({ ref: 'deal_id', type: 'fk', references: 'deals' });
    expect(issuesOf(line).join('\n')).toContain(`${AT}: "jobs" rows are lines of "deals", which would be held after this write's own rows`);

    const limited = firm();
    tables(limited).push({ ref: 'crews', columns: [id, { ref: 'slots', type: 'int', default: 3 }] });
    (tables(limited)[0]!['columns'] as unknown[]).push({ ref: 'crew_id', type: 'fk', references: 'crews' });
    tables(limited)[0]!['capacity'] = { kind: 'parent', via: 'crew_id', size: { column: 'slots' } };
    expect(issuesOf(limited).join('\n')).toContain(`${AT}: "jobs" keeps a limit, whose lock a new "sign_offs" row's write cannot take for it`);
  });

  it('refuses a move that could never start from a state the child is added in', () => {
    expect(said((doc) => (child(doc)['createIn'] = ['open', 'signed-off']))).toContain(
      `${AT}: no listed move goes to "signed-off" from a state a "sign_offs" row is added in (open, signed-off), so it never moves this row`,
    );
    // Added only while the job is open, where a move straight to signed-off is listed: fine.
    expect(
      said((doc) => {
        child(doc)['createIn'] = ['open'];
        (jobs(doc)['moves'] as Record<string, unknown[]>)['open'] = ['installed', 'signed-off'];
      }),
    ).toBe('');
  });

  it('is refused on a private table: another table\'s new row does not move its rows', () => {
    expect(
      said((doc) => {
        tables(doc)[0]!['private'] = true;
        tables(doc)[0]!['belongs'] = [{ column: 'owner_id' }];
        (tables(doc)[0]!['columns'] as unknown[]).push({ ref: 'owner_id', type: 'text', maxLength: 36, rules: { staff: true } });
      }),
    ).toContain(`${AT}: "jobs" is private: only the people its rows belong to read it, so another table's new row does not move its rows`);
  });
});
