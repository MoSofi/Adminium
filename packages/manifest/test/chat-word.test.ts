// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live chat in a manifest: an add-on's `chat` word, which names its tables
 * for the conversations, the messages, the answers and the answerer's
 * choices, each holding the columns the engine reads and writes, and its
 * settings table; and an app's entry under the reserved key `chat`, which
 * opens a table to a question a visitor leaves outside hours and to nothing
 * else. Each refusal is one broken thing of a fixture that validates.
 */
import { describe, expect, it } from 'vitest';

import { CHAT_COLUMNS, CHAT_PARTS, CHAT_SETTINGS_COLUMNS, chatEntriesOf, chatOf, formsEntriesOf, installFloorWords, installsLikeAnApp, validateManifest, WORD_FLOORS } from '../src/index.js';
import { chatAddOn } from './chat-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const tableOf = (doc: Doc, ref: string) => ((doc['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === ref) as Doc & { columns: Doc[] });
const columnOf = (doc: Doc, table: string, ref: string) => tableOf(doc, table).columns.find((column) => column['ref'] === ref)!;
const block = (doc: Doc) => (doc['addOn'] as Doc)['chat'] as Doc;
const changed = (edit: (doc: Doc) => void, start: () => Doc = chatAddOn): Doc => {
  const doc = start();
  edit(doc);
  return doc;
};
const one = (edit: (d: Doc) => void) => issuesOf(changed(edit)).join('\n');
const role = (doc: Doc) => (doc['roles'] as { permissions: string[] }[])[0]!;

describe('an add-on\'s chat', () => {
  it('names its four tables and a settings table, each with the columns the engine reads and writes: it validates and installs like an app', () => {
    const doc = chatAddOn();
    expect(issuesOf(doc)).toEqual([]);
    const result = validateManifest(doc);
    expect(result.ok && installsLikeAnApp(result.manifest)).toBe(true);
    expect(result.ok && chatOf(result.manifest)).toEqual({ conversations: 'conversations', messages: 'messages', answers: 'answers', choices: 'choices' });
  });

  it('installs like an app on its chat alone', () => {
    const bare = changed((d) => {
      delete d['roles'];
      delete (d['requiredSchema'] as Doc)['prefixed'];
      delete (d['addOn'] as Doc)['settingsTable'];
    });
    const withSettings = changed((d) => {
      delete d['roles'];
      delete (d['requiredSchema'] as Doc)['prefixed'];
    });
    // Without a settings table it is refused for that alone; with one, it validates as an app.
    expect(issuesOf(bare)).toEqual(['addOn.settingsTable: an add-on that declares chat keeps its hours, words and answerer in a one-row settings table: name it in addOn.settingsTable']);
    const result = validateManifest(withSettings);
    expect(result.ok && installsLikeAnApp(result.manifest)).toBe(true);
  });

  it('needs its floor, 0.3.64', () => {
    expect(WORD_FLOORS['addOn.chat']).toBe('0.3.64');
    expect(installFloorWords(chatAddOn())).toContainEqual({ word: 'addOn.chat', path: 'addOn.chat' });
    expect(one((d) => (d['compatibility'] = { minAdminiumVersion: '0.3.63' }))).toContain('"addOn.chat" is read by Adminium 0.3.64 and later');
  });

  it('is filed under marketing', () => {
    expect(issuesOf(changed((d) => (d['categories'] = ['data'])))).toEqual(['categories: an add-on that declares chat is filed under the "marketing" category']);
    expect(issuesOf(changed((d) => (d['categories'] = ['data', 'marketing'])))).toEqual([]);
  });

  it('names all four parts, tables of its own, each a table of its own, and no other word', () => {
    expect(one((d) => (block(d)['answers'] = 'replies'))).toContain('addOn.chat.answers: "replies" is not one of this add-on\'s tables');
    expect(one((d) => (block(d)['choices'] = 'messages'))).toContain('addOn.chat.choices: "messages" holds the messages already: each part of chat is a table of its own');
    for (const part of CHAT_PARTS) expect(one((d) => delete block(d)[part]), part).toContain(`addOn.chat.${part}`);
    expect(one((d) => (block(d)['settings'] = 'chat_settings'))).toContain('addOn.chat');
  });

  it('refuses a table without a column the engine reads', () => {
    for (const part of CHAT_PARTS) {
      for (const name of Object.keys(CHAT_COLUMNS[part])) {
        const doc = changed((d) => (tableOf(d, part).columns = tableOf(d, part).columns.filter((column) => column['ref'] !== name)));
        expect(issuesOf(doc).join('\n'), `${part}.${name}`).toContain(`"${part}" holds the ${part}, so it has a column "${name}"`);
      }
    }
  });

  it('refuses a column of the wrong kind', () => {
    expect(one((d) => (columnOf(d, 'conversations', 'outside_hours')['type'] = 'text'))).toContain('"conversations.outside_hours" is read and written by Adminium as bool, not text');
    expect(one((d) => (columnOf(d, 'messages', 'sent_at')['type'] = 'date'))).toContain('"messages.sent_at" is read and written by Adminium as timestamptz, not date');
    expect(one((d) => (columnOf(d, 'answers', 'versions')['type'] = 'text'))).toContain('"answers.versions" is read and written by Adminium as json, not text');
    expect(one((d) => (columnOf(d, 'choices', 'message_id')['type'] = 'text'))).toContain('"choices.message_id" is read and written by Adminium as int or bigint, not text');
    // A whole number is an int or a bigint.
    expect(one((d) => (columnOf(d, 'choices', 'tokens_in')['type'] = 'bigint'))).toBe('');
  });

  it('refuses a text too short for what the engine writes', () => {
    expect(one((d) => (columnOf(d, 'messages', 'body')['maxLength'] = 1000))).toContain('"messages.body" takes up to 2000 characters: leave out maxLength, or make it at least that');
    expect(one((d) => (columnOf(d, 'conversations', 'email')['maxLength'] = 254))).toContain('"conversations.email" takes up to 320 characters');
    expect(one((d) => (columnOf(d, 'conversations', 'came_from')['maxLength'] = 1000))).toContain('"conversations.came_from" takes up to 2048 characters');
    // Unbounded, or longer, is fine.
    expect(one((d) => delete columnOf(d, 'messages', 'body')['maxLength'])).toBe('');
  });

  it('refuses an enum whose values are not exactly the engine\'s', () => {
    expect(one((d) => (columnOf(d, 'conversations', 'state')['enum'] = ['bot', 'waiting', 'open']))).toContain('"conversations.state" takes exactly "bot", "waiting", "open", "closed"');
    expect(one((d) => (columnOf(d, 'messages', 'kind')['enum'] = ['visitor', 'staff', 'automatic', 'system', 'note']))).toContain('"messages.kind" takes exactly "visitor", "staff", "automatic", "system"');
    expect(one((d) => (columnOf(d, 'choices', 'outcome')['enum'] = ['answered', 'hand-over']))).toContain('"choices.outcome" takes exactly');
  });

  it('refuses a column whose emptiness is not the engine\'s, either way', () => {
    expect(one((d) => delete columnOf(d, 'conversations', 'taken_by')['nullable'])).toContain('"conversations.taken_by" is written empty until there is something to put in it: make it nullable');
    expect(one((d) => (columnOf(d, 'messages', 'body')['nullable'] = true))).toContain('"messages.body" always holds a value, which Adminium reads: make it not nullable');
    expect(one((d) => (columnOf(d, 'answers', 'versions')['nullable'] = true))).toContain('"answers.versions" always holds a value');
  });

  it('refuses a link to the wrong part, and an answer\'s ref that is not unique', () => {
    expect(one((d) => (columnOf(d, 'choices', 'conversation_id')['references'] = 'messages'))).toContain('"choices.conversation_id" links to the conversations ("conversations")');
    expect(one((d) => (columnOf(d, 'messages', 'conversation_id')['references'] = 'answers'))).toContain('"messages.conversation_id" links to the conversations ("conversations")');
    expect(one((d) => delete columnOf(d, 'answers', 'ref')['unique'])).toContain('"answers.ref" names one row: make it unique');
  });

  it('refuses a key that is not numbered, on any of the four', () => {
    for (const part of CHAT_PARTS) {
      expect(one((d) => (columnOf(d, part, 'id')['type'] = 'id')), part).toContain(`"${part}" holds the ${part}, so its rows are numbered: its key "id" is an int or a bigint, not id`);
      expect(
        one((d) => (tableOf(d, part).columns = [{ ref: 'uid', type: 'text', maxLength: 36, unique: true }, ...tableOf(d, part).columns.filter((column) => column['ref'] !== 'id')])),
        part,
      ).toContain(`"${part}" holds the ${part}, so its rows are numbered: give it an int key (role "pk")`);
    }
  });

  it('refuses no settings table, and one missing a settings column or holding one of the wrong kind', () => {
    expect(one((d) => delete (d['addOn'] as Doc)['settingsTable'])).toContain('addOn.settingsTable: an add-on that declares chat keeps its hours, words and answerer in a one-row settings table');
    for (const name of Object.keys(CHAT_SETTINGS_COLUMNS)) {
      const doc = changed((d) => (tableOf(d, 'chat_settings').columns = tableOf(d, 'chat_settings').columns.filter((column) => column['ref'] !== name)));
      expect(issuesOf(doc).join('\n'), name).toContain(`"chat_settings" holds the chat's settings, so it has a column "${name}"`);
    }
    expect(one((d) => (columnOf(d, 'chat_settings', 'daily_tokens')['type'] = 'decimal'))).toContain('"chat_settings.daily_tokens" is read and written by Adminium as int or bigint, not decimal');
    expect(one((d) => (columnOf(d, 'chat_settings', 'theme')['enum'] = ['light', 'dark']))).toContain('"chat_settings.theme" takes exactly "light", "dark", "visitor"');
    expect(one((d) => (columnOf(d, 'chat_settings', 'closed_until')['type'] = 'timestamptz'))).toContain('"chat_settings.closed_until" is read and written by Adminium as date, nullable, not timestamptz');
    expect(one((d) => (columnOf(d, 'chat_settings', 'time_zone')['maxLength'] = 32))).toContain('"chat_settings.time_zone" takes up to 64 characters');
  });

  it('lets Adminium alone write the conversations, the messages and the choices', () => {
    const grants = (extra: string[]) => issuesOf(changed((d) => role(d).permissions.push(...extra))).join('\n');
    expect(grants(['table:@conversations:update'])).toContain('"agent" may update "conversations", and the conversations are written by Adminium alone');
    expect(grants(['table:@messages:create'])).toContain('"agent" may create "messages", and the messages are written by Adminium alone');
    expect(grants(['table:@choices:import'])).toContain('"agent" may import "choices", and the choices are written by Adminium alone');
    expect(grants(['table:@*:create'])).toContain('"agent" may create "conversations"');
    // Staff delete them, and write the answers and the settings.
    expect(grants(['table:@conversations:delete', 'table:@messages:delete'])).toBe('');
    // Through the role it clones too.
    expect(
      issuesOf(
        changed((d) => {
          (d['roles'] as Doc[]).push({ key: 'helper', name: 'Helper', cloneFrom: 'agent', permissions: [] });
          role(d).permissions.push('table:@messages:update');
        }),
      ).join('\n'),
    ).toContain('"helper" may update "messages"');
    // An app's grant reads them, and does no more.
    expect(one((d) => (tableOf(d, 'conversations')['appGrants'] = { actions: ['read'] }))).not.toContain('Adminium alone');
    expect(one((d) => (tableOf(d, 'conversations')['appGrants'] = { actions: ['read', 'update'], writable: ['name'] }))).toContain(
      "the conversations are written by Adminium alone: an app's role may only read \"conversations\"",
    );
  });

  it('gives no step of its own a row of the conversations, messages or choices', () => {
    const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];
    const words = (t: string) => Object.fromEntries(LOCALES.map((locale) => [locale, t]));
    const step = (table: string, values: Doc) => ({ key: 'note', name: words('Add a note'), does: words('Adds a line'), inputs: [{ key: 'body', label: words('Text'), kind: 'text', required: true }], writes: { table, values } });
    const withStep = (table: string, values: Doc) => changed((d) => ((d['addOn'] as Doc)['steps'] = [step(table, values)]));
    expect(issuesOf(withStep('messages', { body: { input: 'body' } })).join('\n')).toContain('the messages are written by Adminium alone: the step "note" may not write a row of "messages"');
    expect(issuesOf(withStep('answers', { ref: { input: 'body' } })).join('\n')).not.toContain('Adminium alone');
  });

  it('opens none of its four tables to the public', () => {
    for (const part of CHAT_PARTS) {
      const doc = changed((d) => {
        d['publicAccess'] = [{ table: part, methods: ['GET'], select: ['id'] }];
      });
      expect(issuesOf(doc).join('\n'), part).toContain(`"${part}" holds the ${part}, which Adminium alone serves to strangers: no public entry opens it`);
    }
  });

  it('leaves no column of a table Adminium alone writes unfilled', () => {
    expect(one((d) => tableOf(d, 'messages').columns.push({ ref: 'rating', type: 'text', maxLength: 10 }))).toContain('"messages" is written by Adminium alone, which never fills "rating": make it nullable or give it a default');
    expect(one((d) => tableOf(d, 'messages').columns.push({ ref: 'rating', type: 'text', maxLength: 10, nullable: true }))).toBe('');
    // Staff write the answers: a column of their own is theirs to fill.
    expect(one((d) => tableOf(d, 'answers').columns.push({ ref: 'note', type: 'text', maxLength: 10 }))).toBe('');
  });

  it('is never declared beside forms: each is a package of its own', () => {
    const doc = changed((d) => ((d['addOn'] as Doc)['forms'] = { forms: 'answers', answers: 'choices' }));
    expect(issuesOf(doc).join('\n')).toContain('addOn.chat: an add-on declares forms or chat, not both: each is a package of its own');
  });
});

/** A CRM-shaped app that opens its enquiries to forms and to chat. */
function crm(entries: Doc[] = [formsEntry(), chatEntry()]): Doc {
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
    compatibility: { minAdminiumVersion: '0.3.64' },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'enquiries',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { normalize: 'email', validation: { format: 'email' } } },
            { ref: 'message', type: 'text', maxLength: 1000, nullable: true },
            { ref: 'source', type: 'enum', enum: ['form', 'phone', 'show', 'chat'], default: 'form' },
            { ref: 'state', type: 'enum', enum: ['new', 'claimed', 'done'], default: 'new' },
          ],
        },
        { ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'body', type: 'text', maxLength: 200 }] },
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
  return { table: 'enquiries', methods: ['POST'], key: 'forms', writable: ['name', 'email', 'message'], defaults: { state: 'new', source: 'form' }, anonymous: { perKeyHour: 200 }, ...over };
}

function chatEntry(over: Doc = {}): Doc {
  return {
    table: 'enquiries',
    methods: ['POST'],
    key: 'chat',
    writable: ['name', 'email', 'message'],
    defaults: { state: 'new', source: 'chat' },
    anonymous: { perValue: { columns: ['email'], n: 5 }, perKeyHour: 100, plainText: ['name'] },
    ...over,
  };
}

describe('a table an app opens to a chat\'s left question', () => {
  it('may carry both a forms and a chat entry: it validates', () => {
    expect(issuesOf(crm())).toEqual([]);
    expect(issuesOf(crm([chatEntry()]))).toEqual([]);
    expect(installFloorWords(crm()).map((word) => word.word)).toEqual(expect.arrayContaining(['publicAccess.forms', 'publicAccess.chat']));
  });

  it('needs its floor, 0.3.64', () => {
    expect(WORD_FLOORS['publicAccess.chat']).toBe('0.3.64');
    expect(issuesOf({ ...crm([chatEntry()]), compatibility: { minAdminiumVersion: '0.3.63' } }).join('\n')).toContain('"publicAccess.chat" is read by Adminium 0.3.64 and later');
  });

  it('hands the chat door its table, columns, defaults and limits, and the forms door only its own', () => {
    const result = validateManifest(crm());
    if (!result.ok) throw new Error('crm does not validate');
    expect(chatEntriesOf(result.manifest)).toEqual([
      {
        table: 'enquiries',
        writable: ['name', 'email', 'message'],
        writableValues: {},
        defaults: { state: 'new', source: 'chat' },
        requires: [],
        decided: [],
        plainText: [{ column: 'name', max: 80 }],
        anonymous: { perValue: { columns: ['email'], n: 5 }, perKeyHour: 100 },
        requireSetting: [],
      },
    ]);
    expect(formsEntriesOf(result.manifest).map((entry) => entry.defaults['source'])).toEqual(['form']);
    const plain = validateManifest(crm([formsEntry()]));
    expect(plain.ok && chatEntriesOf(plain.manifest)).toEqual([]);
  });

  it('is one per table', () => {
    expect(issuesOf(crm([chatEntry(), chatEntry()])).join('\n')).toContain('publicAccess.1.table: "enquiries" is opened to chat by another entry already: one chat entry per table');
  });

  it('may not be a browser key\'s name', () => {
    expect(issuesOf({ ...crm(), publicKeys: { chat: {} } }).join('\n')).toContain('"chat" is the name of the entries a chat\'s left questions write through, and no browser key');
  });

  it('only adds a row: POST, under anonymous limits, naming what a question may fill', () => {
    expect(issuesOf(crm([chatEntry({ methods: ['GET', 'POST'] })])).join('\n')).toContain('a chat entry adds a row and does nothing else: its methods are ["POST"]');
    expect(issuesOf(crm([chatEntry({ anonymous: undefined })])).join('\n')).toContain('a question is left by strangers: a chat entry says its anonymous limits');
    expect(issuesOf(crm([chatEntry({ writable: [] })])).join('\n')).toContain('a chat entry names the columns a left question may fill (writable)');
  });

  it('says nothing a forms entry may not, and names no source', () => {
    const refusedWord = (over: Doc, word: string) => expect(issuesOf(crm([chatEntry(over)])).join('\n'), word).toContain(`publicAccess.0.${word}: a chat entry only lets a left question add a row: "${word}" is not said on it`);
    refusedWord({ source: 'message' }, 'source');
    refusedWord({ claim: { match: ['email'] } }, 'claim');
    refusedWord({ select: ['id'] }, 'select');
    refusedWord({ dryRun: true }, 'dryRun');
    refusedWord({ humanCheck: true }, 'humanCheck');
    // And the forms entry's own refusal of a source on another key is not said twice.
    expect(issuesOf(crm([chatEntry({ source: 'message' })])).join('\n')).not.toContain('a source is said only on a forms entry');
  });

  it('lets nobody read the rows strangers add through it', () => {
    expect(issuesOf(crm([chatEntry(), { table: 'enquiries', methods: ['GET'], select: ['id', 'state'] }])).join('\n')).toContain(
      'strangers add rows to "enquiries" through chat, and entry 1 lets anyone read its rows',
    );
  });

  it('names its table, with the app\'s key, short enough for every conversation to keep whole', () => {
    const table = (length: number) => `t${'x'.repeat(length - 1)}`;
    const app = (key: string, ref: string): Doc => {
      const doc = crm([chatEntry({ table: ref, writable: ['note'], defaults: {}, anonymous: { perKeyHour: 200 } })]);
      doc['key'] = key;
      const schema = doc['requiredSchema'] as Doc;
      delete schema['prefixed'];
      schema['tables'] = [...(schema['tables'] as Doc[]), { ref, columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'note', type: 'text', maxLength: 200 }] }];
      return doc;
    };
    const key = `crm-${'k'.repeat(16)}`;
    expect(issuesOf(app(key, table(64 - key.length - 1)))).toEqual([]);
    expect(issuesOf(app(key, table(64 - key.length))).join('\n')).toContain(`at most 64 characters: "${key}:${table(64 - key.length)}" is 65`);
  });

  it('is not an add-on\'s to declare', () => {
    const doc = chatAddOn();
    tableOf(doc, 'answers').columns.push({ ref: 'note', type: 'text', maxLength: 80, nullable: true });
    doc['publicAccess'] = [{ table: 'answers', methods: ['POST'], key: 'chat', writable: ['note'], anonymous: { perKeyHour: 10 } }];
    expect(issuesOf(doc).join('\n')).toContain('"chat" is neither');
  });
});
