// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Forms in a manifest: an add-on's `forms` word, which names its tables for
 * the forms, the answers, the invitations and the files, each holding the
 * columns the engine reads and writes; and an app's entry under the reserved
 * key `forms`, which opens a table to a form's answers and to nothing else.
 * Each refusal is one broken thing of a fixture that validates.
 */
import { describe, expect, it } from 'vitest';

import { FORMS_COLUMNS, decidedColumnsOf, formsEntriesOf, formsOf, installFloorWords, installsLikeAnApp, validateManifest } from '../src/index.js';
import { formsAddOn, nullable, text } from './forms-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const tableOf = (doc: Doc, ref: string) => ((doc['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === ref) as Doc & { columns: Doc[] });
const columnOf = (doc: Doc, table: string, ref: string) => tableOf(doc, table).columns.find((column) => column['ref'] === ref)!;
const block = (doc: Doc) => (doc['addOn'] as Doc)['forms'] as Doc;
const changed = (edit: (doc: Doc) => void, start: () => Doc = formsAddOn): Doc => {
  const doc = start();
  edit(doc);
  return doc;
};

describe('an add-on\'s forms', () => {
  it('names its four tables, each with the columns the engine reads and writes: it validates and installs like an app', () => {
    const doc = formsAddOn();
    expect(issuesOf(doc)).toEqual([]);
    const result = validateManifest(doc);
    expect(result.ok && installsLikeAnApp(result.manifest)).toBe(true);
    expect(result.ok && formsOf(result.manifest)).toEqual({ forms: 'forms', answers: 'answers', invitations: 'invitations', files: 'answer_files' });
    expect(installFloorWords(doc).map((word) => word.word)).toContain('addOn.forms');
  });

  it('installs like an app on its forms alone, and is checked as one', () => {
    const bare = () =>
      changed((d) => {
        delete d['roles'];
        delete (d['requiredSchema'] as Doc)['prefixed'];
      });
    expect(issuesOf(bare())).toEqual([]);
    const result = validateManifest(bare());
    expect(result.ok && installsLikeAnApp(result.manifest)).toBe(true);
    expect(issuesOf(changed((d) => (columnOf(d, 'answers', 'values')['type'] = 'text'), bare)).join('\n')).toContain('"answers.values" is read and written by Adminium as json');
  });

  it('needs only the forms and the answers', () => {
    const doc = changed((d) => {
      block(d)['invitations'] = undefined;
      block(d)['files'] = undefined;
      const tables = (d['requiredSchema'] as { tables: Doc[] }).tables;
      (d['requiredSchema'] as { tables: Doc[] }).tables = tables.filter((table) => table['ref'] === 'forms' || table['ref'] === 'answers');
      tableOf(d, 'answers').columns = tableOf(d, 'answers').columns.filter((column) => column['ref'] !== 'invitation_id');
      (d['roles'] as { permissions: string[] }[])[0]!.permissions = ['table:@forms:read', 'table:@answers:read'];
    });
    expect(issuesOf(doc)).toEqual([]);
  });

  it('needs its floor, 0.3.40', () => {
    expect(issuesOf(changed((d) => (d['compatibility'] = { minAdminiumVersion: '0.3.39' }))).join('\n')).toContain('"addOn.forms" is read by Adminium 0.3.40 and later');
  });

  it('is filed under marketing', () => {
    expect(issuesOf(changed((d) => (d['categories'] = ['data'])))).toEqual(['categories: an add-on that declares forms is filed under the "marketing" category']);
    expect(issuesOf(changed((d) => (d['categories'] = ['data', 'marketing'])))).toEqual([]);
  });

  it('names tables of its own, each part a table of its own, and no other word', () => {
    expect(issuesOf(changed((d) => (block(d)['answers'] = 'replies')))).toContain('addOn.forms.answers: "replies" is not one of this add-on\'s tables');
    expect(issuesOf(changed((d) => (block(d)['files'] = 'answers'))).join('\n')).toContain('addOn.forms.files: "answers" holds the answers already: each part of forms is a table of its own');
    expect(issuesOf(changed((d) => (block(d)['pages'] = 'forms'))).join('\n')).toContain('addOn.forms');
    expect(issuesOf(changed((d) => delete block(d)['answers'])).join('\n')).toContain('addOn.forms.answers');
  });

  it('refuses a table without a column the engine reads', () => {
    for (const [part, ref] of [['forms', 'forms'], ['answers', 'answers'], ['invitations', 'invitations'], ['files', 'answer_files']] as const) {
      for (const name of Object.keys(FORMS_COLUMNS[part])) {
        const doc = changed((d) => (tableOf(d, ref).columns = tableOf(d, ref).columns.filter((column) => column['ref'] !== name)));
        expect(issuesOf(doc).join('\n'), `${ref}.${name}`).toContain(`"${ref}" holds the ${part}, so it has a column "${name}"`);
      }
    }
    // The answers link their invitation when the add-on keeps invitations.
    expect(issuesOf(changed((d) => (tableOf(d, 'answers').columns = tableOf(d, 'answers').columns.filter((column) => column['ref'] !== 'invitation_id')))).join('\n')).toContain('so it has a column "invitation_id"');
  });

  it('refuses a column of the wrong kind, values, link, width, emptiness or uniqueness', () => {
    const one = (edit: (d: Doc) => void) => issuesOf(changed(edit)).join('\n');
    expect(one((d) => (columnOf(d, 'answers', 'values')['type'] = 'text'))).toContain('"answers.values" is read and written by Adminium as json, not text');
    expect(one((d) => (columnOf(d, 'answers', 'submitted_at')['type'] = 'date'))).toContain('"answers.submitted_at" is read and written by Adminium as timestamptz, not date');
    expect(one((d) => (columnOf(d, 'forms', 'state')['enum'] = ['draft', 'live']))).toContain('"forms.state" takes exactly "draft", "live", "closed"');
    expect(one((d) => (columnOf(d, 'invitations', 'class')['enum'] = ['marketing', 'service', 'other']))).toContain('"invitations.class" takes exactly "marketing", "service"');
    expect(one((d) => (columnOf(d, 'answer_files', 'answer_id')['references'] = 'forms'))).toContain('"answer_files.answer_id" links to the answers ("answers")');
    expect(one((d) => (columnOf(d, 'answers', 'email')['maxLength'] = 254))).toContain('"answers.email" takes up to 320 characters');
    expect(one((d) => (columnOf(d, 'answers', 'sent_from')['maxLength'] = 1000))).toContain('"answers.sent_from" takes up to 2048 characters');
    expect(one((d) => delete columnOf(d, 'answers', 'name')['nullable'])).toContain('"answers.name" is written empty until there is something to put in it: make it nullable');
    expect(one((d) => delete columnOf(d, 'forms', 'slug')['unique'])).toContain('"forms.slug" names one row: make it unique');
    expect(one((d) => (columnOf(d, 'answer_files', 'size')['type'] = 'int'))).toBe('');
  });

  it('lets Adminium alone write the answers and the files', () => {
    const roleGrants = (grants: string[]) => issuesOf(changed((d) => ((d['roles'] as { permissions: string[] }[])[0]!.permissions = ['table:@answers:read', ...grants]))).join('\n');
    expect(roleGrants(['table:@answers:create'])).toContain('"marketer" may create "answers", and the answers are written by Adminium alone');
    expect(roleGrants(['table:@answers:update'])).toContain('"marketer" may update "answers"');
    expect(roleGrants(['table:@answer_files:import'])).toContain('"marketer" may import "answer_files"');
    expect(roleGrants(['table:@*:update'])).toContain('"marketer" may update "answers"');
    expect(roleGrants(['table:@answers:delete'])).toBe('');
    // Through the role it clones too.
    expect(
      issuesOf(
        changed((d) => {
          (d['roles'] as Doc[]).push({ key: 'helper', name: 'Helper', cloneFrom: 'marketer', permissions: [] });
          (d['roles'] as { permissions: string[] }[])[0]!.permissions.push('table:@answers:update');
        }),
      ).join('\n'),
    ).toContain('"helper" may update "answers"');
    // An app's grant reads them, and does no more.
    expect(issuesOf(changed((d) => (tableOf(d, 'answers')['appGrants'] = { actions: ['read'] }))).join('\n')).not.toContain('Adminium alone');
    expect(issuesOf(changed((d) => (tableOf(d, 'answers')['appGrants'] = { actions: ['read', 'update'], writable: ['name'] }))).join('\n')).toContain(
      "the answers are written by Adminium alone: an app's role may only read \"answers\"",
    );
  });

  it('gives no step of its own a row of the answers', () => {
    const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];
    const words = (t: string) => Object.fromEntries(LOCALES.map((locale) => [locale, t]));
    const step = (table: string, values: Doc) => ({ key: 'invite', name: words('Send a survey'), does: words('Invites a person'), inputs: [{ key: 'email', label: words('E-mail'), kind: 'email', required: true }], writes: { table, values } });
    const withStep = (table: string, values: Doc) => changed((d) => ((d['addOn'] as Doc)['steps'] = [step(table, values)]));
    expect(issuesOf(withStep('answers', { email: { input: 'email' } })).join('\n')).toContain('the answers are written by Adminium alone: the step "invite" may not write a row of "answers"');
    expect(issuesOf(withStep('invitations', { email: { input: 'email' } })).join('\n')).not.toContain('Adminium alone');
  });

  it('opens none of its tables to the public', () => {
    const doc = changed((d) => {
      d['publicAccess'] = [{ table: 'forms', methods: ['GET'], select: ['id', 'title'] }];
      d['publicKeys'] = {};
    });
    expect(issuesOf(doc).join('\n')).toContain('"forms" holds the forms, which Adminium alone serves to strangers: no public entry opens it');
  });

  it('leaves no column of a table Adminium alone writes unfilled', () => {
    const doc = changed((d) => tableOf(d, 'answers').columns.push(text('rating', 10)));
    expect(issuesOf(doc).join('\n')).toContain('"answers" is written by Adminium alone, which never fills "rating": make it nullable or give it a default');
    expect(issuesOf(changed((d) => tableOf(d, 'answers').columns.push(text('rating', 10, nullable))))).toEqual([]);
    expect(issuesOf(changed((d) => tableOf(d, 'answers').columns.push(text('rating', 10, { default: 'none' }))))).toEqual([]);
  });
});

/** A CRM-shaped app that opens its enquiries to forms. */
function crm(entries: Doc[] = [formsEntry()]): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'An app' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.40' },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'enquiries',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            text('name', 80),
            text('email', 254, { nullable: true, rules: { normalize: 'email', validation: { format: 'email' } } }),
            text('company', 80, nullable),
            text('message', 1000, nullable),
            text('source', 40, { default: 'form' }),
            { ref: 'state', type: 'enum', enum: ['new', 'claimed', 'done'], default: 'new' },
            { ref: 'claimed_by_id', type: 'int', nullable: true },
            text('code', 16, { nullable: true, unique: true, rules: { code: { length: 12 } } }),
          ],
        },
        { ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('body', 200)] },
      ],
    },
    pages: [{ ref: 'home', template: 'page-crud', title: { key: 't', fallback: 'Home' }, nav: { group: 'records', icon: 'list', order: 1 } }],
    frontends: [
      { side: 'staff', kind: 'spa', placement: 'internal' },
      { side: 'customer', kind: 'spa' },
    ],
    publicAccess: entries,
  };
}

function formsEntry(over: Doc = {}): Doc {
  return {
    table: 'enquiries',
    methods: ['POST'],
    key: 'forms',
    writable: ['name', 'email', 'company', 'message', 'source'],
    defaults: { state: 'new' },
    anonymous: { perValue: { columns: ['email'], n: 5 }, perKeyHour: 200, plainText: ['name', { column: 'company', max: 80, digits: 2 }] },
    ...over,
  };
}

describe('a table an app opens to forms', () => {
  it('is an entry under the key "forms", with no browser key of that name: it validates', () => {
    const doc = crm();
    expect(issuesOf(doc)).toEqual([]);
    expect(installFloorWords(doc).map((word) => word.word)).toContain('publicAccess.forms');
    expect(issuesOf({ ...doc, compatibility: { minAdminiumVersion: '0.3.39' } }).join('\n')).toContain('"publicAccess.forms" is read by Adminium 0.3.40 and later');
  });

  it('hands the forms door its table, columns, defaults, decided columns and limits', () => {
    const result = validateManifest(crm());
    if (!result.ok) throw new Error('crm does not validate');
    expect(formsEntriesOf(result.manifest)).toEqual([
      {
        table: 'enquiries',
        writable: ['name', 'email', 'company', 'message', 'source'],
        writableValues: {},
        defaults: { state: 'new' },
        requires: [],
        decided: ['code'],
        plainText: [
          { column: 'name', max: 80 },
          { column: 'company', max: 80, digits: 2 },
        ],
        anonymous: { perValue: { columns: ['email'], n: 5 }, perKeyHour: 200 },
        requireSetting: [],
      },
    ]);
    expect(decidedColumnsOf(result.manifest).get('enquiries')?.has('code')).toBe(true);
    const plain = validateManifest(crm([{ table: 'notes', methods: ['POST'], writable: ['body'] }]));
    expect(plain.ok && formsEntriesOf(plain.manifest)).toEqual([]);
  });

  it('may not be a browser key\'s name', () => {
    expect(issuesOf({ ...crm(), publicKeys: { forms: {} } }).join('\n')).toContain('"forms" is the name of the entries forms write through, and no browser key');
  });

  it('only adds a row: POST, under anonymous limits, naming what a form may fill', () => {
    expect(issuesOf(crm([formsEntry({ methods: ['GET', 'POST'] })])).join('\n')).toContain('a forms entry adds a row and does nothing else: its methods are ["POST"]');
    expect(issuesOf(crm([formsEntry({ anonymous: undefined })])).join('\n')).toContain('a form is sent by strangers: a forms entry says its anonymous limits');
    expect(issuesOf(crm([formsEntry({ writable: [] })])).join('\n')).toContain('a forms entry names the columns a form may fill (writable)');
  });

  it('says nothing of reading, claims, sessions, children, a dry run, a cap of open rows or its own mail', () => {
    const refusedWord = (over: Doc, word: string) => expect(issuesOf(crm([formsEntry(over)])).join('\n'), word).toContain(`publicAccess.0.${word}: a forms entry only lets a form add a row: "${word}" is not said on it`);
    refusedWord({ claim: { match: ['email'] } }, 'claim');
    refusedWord({ claimedBy: { table: 'enquiries', column: 'id', optional: true } }, 'claimedBy');
    refusedWord({ children: { notes: { via: 'id', max: 3, writable: ['body'] } } }, 'children');
    refusedWord({ dryRun: true }, 'dryRun');
    refusedWord({ level: 'verified' }, 'level');
    refusedWord({ maxOpen: { column: 'state', values: ['new'], n: 2 } }, 'maxOpen');
    refusedWord({ confirm: { template: 'booking-confirmation', to: 'email' } }, 'confirm');
    refusedWord({ select: ['id'] }, 'select');
    refusedWord({ humanCheck: true }, 'humanCheck');
  });

  it('keeps what an entry means today: decided columns are never writable', () => {
    expect(issuesOf(crm([formsEntry({ writable: ['name', 'code'] })])).join('\n')).toContain('"code" is decided by Adminium and cannot be written publicly');
  });

  it('names its table, with the app\'s key, short enough for every answer to keep whole', () => {
    // `<app>:<table>` at 64 characters fits; one more does not. An unprefixed app's table name is its ref.
    const table = (length: number) => `t${'x'.repeat(length - 1)}`;
    const app = (key: string, ref: string): Doc => {
      const doc = crm([formsEntry({ table: ref, writable: ['note'], defaults: {}, anonymous: { perKeyHour: 200 } })]);
      doc['key'] = key;
      const schema = doc['requiredSchema'] as Doc;
      delete schema['prefixed'];
      schema['tables'] = [...(schema['tables'] as Doc[]), { ref, columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('note', 200)] }];
      return doc;
    };
    const key = `crm-${'k'.repeat(16)}`;
    expect(issuesOf(app(key, table(64 - key.length - 1)))).toEqual([]);
    expect(issuesOf(app(key, table(64 - key.length))).join('\n')).toContain(`at most 64 characters: "${key}:${table(64 - key.length)}" is 65`);
  });

  it('is one per table, and no entry lets anyone read the rows strangers add through it', () => {
    expect(issuesOf(crm([formsEntry(), formsEntry()])).join('\n')).toContain('"enquiries" is opened to forms by another entry already: one forms entry per table');
    expect(issuesOf(crm([formsEntry(), { table: 'enquiries', methods: ['GET'], select: ['id', 'state'] }])).join('\n')).toContain(
      'strangers add rows to "enquiries" through forms, and entry 1 lets anyone read its rows',
    );
    // An app's own create on the same table stands beside it.
    expect(issuesOf(crm([formsEntry(), { table: 'enquiries', methods: ['POST'], select: ['id'], writable: ['name', 'email'], anonymous: { perKeyHour: 50 } }]))).toEqual([]);
  });

  it('is not an add-on\'s to declare', () => {
    const doc = formsAddOn();
    tableOf(doc, 'forms').columns.push(text('note', 80, nullable));
    doc['publicAccess'] = [{ table: 'forms', methods: ['POST'], key: 'forms', writable: ['note'], anonymous: { perKeyHour: 10 } }];
    expect(issuesOf(doc).join('\n')).toContain('"forms" is neither');
  });
});

describe('the column a form\'s "Source" goes into', () => {
  const sourced = (over: Doc = {}, floor = '0.3.41') => ({ ...crm([formsEntry({ source: 'source', ...over })]), compatibility: { minAdminiumVersion: floor } });

  it('is one of the entry\'s writable text columns: it validates, the forms door is told it, and it needs 0.3.41', () => {
    expect(issuesOf(sourced())).toEqual([]);
    const result = validateManifest(sourced());
    expect(result.ok && formsEntriesOf(result.manifest)[0]?.source).toBe('source');
    expect(installFloorWords(sourced()).map((word) => word.word)).toContain('publicAccess.forms.source');
    expect(issuesOf(sourced({}, '0.3.40')).join('\n')).toContain('"publicAccess.forms.source" is read by Adminium 0.3.41 and later');
    // An entry that names none hands the door none.
    const plain = validateManifest(crm());
    expect(plain.ok && 'source' in (formsEntriesOf(plain.manifest)[0] ?? {})).toBe(false);
  });

  it('is a column a form may fill, holding words, never a link', () => {
    expect(issuesOf(sourced({ writable: ['name', 'email'] })).join('\n')).toContain('publicAccess.0.source: a form\'s source goes into one of the columns a form may fill: put "source" in writable');
    expect(issuesOf(sourced({ source: 'state', writable: ['name', 'state'] })).join('\n')).toContain('publicAccess.0.source: "state" holds enum: a form\'s source is words, so it goes into a text column');
    const linked = sourced({ source: 'claimed_by_id', writable: ['name', 'claimed_by_id'] }) as Doc & { requiredSchema: { tables: Doc[] } };
    const enquiries = linked.requiredSchema.tables[0] as Doc & { columns: Doc[] };
    enquiries.columns = enquiries.columns.map((column) => (column['ref'] === 'claimed_by_id' ? { ref: 'claimed_by_id', type: 'fk', references: 'notes', nullable: true } : column));
    expect(issuesOf(linked).join('\n')).toContain('publicAccess.0.source: "claimed_by_id" links to another row: a form\'s source is words, so it goes into a text column');
  });

  it('is said only on a forms entry', () => {
    const doc = { ...crm([formsEntry(), { table: 'notes', methods: ['POST'], writable: ['body'], source: 'body' }]), compatibility: { minAdminiumVersion: '0.3.41' } };
    expect(issuesOf(doc).join('\n')).toContain('publicAccess.1.source: a source is said only on a forms entry (key "forms")');
  });
});

describe('how long a forms add-on keeps its answers', () => {
  const settingsColumn = (doc: Doc) => columnOf(doc, 'forms_settings', 'answers_months');

  it('is a whole number of months its settings table may leave empty', async () => {
    const { formsWithInvitations } = await import('./forms-invitations-fixture.js');
    expect(issuesOf(formsWithInvitations())).toEqual([]);
    expect(issuesOf(changed((d) => (settingsColumn(d)['type'] = 'text'), formsWithInvitations)).join('\n')).toContain('"forms_settings.answers_months" is how many months answers are kept, a whole number: int, not text');
    expect(issuesOf(changed((d) => delete settingsColumn(d)['nullable'], formsWithInvitations)).join('\n')).toContain('"forms_settings.answers_months" is empty while answers are kept until removed: make it nullable');
    // A settings table without it: nothing to check.
    expect(issuesOf(changed((d) => (tableOf(d, 'forms_settings').columns = tableOf(d, 'forms_settings').columns.filter((column) => column['ref'] !== 'answers_months')), formsWithInvitations))).toEqual([]);
  });
});
