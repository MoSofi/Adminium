// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tools that read this instance's OWN documents and settings, and the
 * replay that makes a second question answerable.
 *
 * Separate from `assistant-tools.test.ts`, which is about refusing to read
 * customer rows. Nothing here touches a connection: these are the tools a
 * turn uses to find out what the page already holds, what the workspace is
 * called, which variables a document may use — and, at the end, what the
 * model is shown of the conversation so far.
 */

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assistantSessionsRepo,
  createSqliteMetaDb,
  emailTemplatesRepo,
  firstRun,
  invoiceDocumentsRepo,
  reportDocumentsRepo,
  settingsRepo,
  type MetaDb,
} from '@adminium/meta';

import { openingMessage, replayTranscript } from '../src/assistant/sessions.js';
import { setUpTurn } from '../src/assistant/turn-setup.js';
import { acceptInvoiceBody } from '../src/invoices/document.js';
import { acceptReportBody } from '../src/report-documents/document.js';
import type { ConnectionManager } from '../src/connections/manager.js';

const AT = 1_750_000_000_000;

let meta: MetaDb;

/** No connection at all: these tools must work on an instance that has none. */
const noConnections = {
  connections: { list: () => Promise.resolve([]), findById: () => Promise.resolve(null) },
} as unknown as ConnectionManager;

async function setup(context: 'email' | 'invoice-template' | 'invoices' | 'report') {
  return setUpTurn({
    meta,
    manager: noConnections,
    context,
    host: { connectionIds: [] },
    userId: null,
    can: () => Promise.resolve(true),
  });
}

async function seedEmail(name: string, key: string, locale = 'en_US') {
  return emailTemplatesRepo(meta).create(
    {
      kind: 'template',
      key,
      locale,
      name,
      category: 'lifecycle',
      starter: 'welcome',
      enabled: false,
      subject: `${name} subject`,
      preheader: 'Preview',
      blocks: [{ block: 'email.heading', data: { text: 'Hello' } }],
      footer: 'Footer line',
      brand: null,
      attachments: [],
    },
    AT,
  );
}

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
});

afterEach(async () => {
  await meta.db.destroy();
});

describe('the document tools', () => {
  it('lists the email page`s own documents, with what the manager shows', async () => {
    const live = await seedEmail('Welcome', 'welcome');
    await emailTemplatesRepo(meta).patch(live.id, { enabled: true }, AT);
    await seedEmail('Reminder', 'reminder');

    const email = await setup('email');
    const listed = await email.execute({ id: 'c1', tool: 'list_documents', args: {} });
    const documents = (listed.result as { documents: { name: string; status: string }[] }).documents;
    expect(documents.map((document) => document.name).sort()).toEqual(['Reminder', 'Welcome']);
    // "Enabled" is what the manager draws as Live; a draft is the other one.
    expect(documents.find((document) => document.name === 'Welcome')?.status).toBe('live');
    expect(documents.find((document) => document.name === 'Reminder')?.status).toBe('draft');
  });

  it('reads one email document back as a document, not as columns', async () => {
    const row = await seedEmail('Welcome', 'welcome');
    const email = await setup('email');
    const read = await email.execute({ id: 'c1', tool: 'read_document', args: { id: row.id } });
    const result = read.result as { document: { subject: string; blocks: unknown[]; footer: string } };
    expect(result.document.subject).toBe('Welcome subject');
    expect(result.document.blocks).toHaveLength(1);
    expect(result.document.footer).toBe('Footer line');
  });

  it('tells the model to look first when it names a document that is not there', async () => {
    const email = await setup('email');
    const missing = await email.execute({ id: 'c1', tool: 'read_document', args: { id: 'tpl_nope' } });
    expect(missing.error?.code).toBe('DOCUMENT_NOT_FOUND');
    expect(missing.error?.message).toContain('list_documents');

    const empty = await email.execute({ id: 'c2', tool: 'read_document', args: {} });
    expect(empty.error?.code).toBe('BAD_ARGS');
  });

  it('lists and reads an invoice document, with the language and the number', async () => {
    const row = await invoiceDocumentsRepo(meta).create(
      {
        kind: 'template',
        name: 'Consulting',
        topic: 'services',
        lang: 'de',
        number: 'INV-1000',
        body: { ...acceptInvoiceBody({ title: 'Rechnung' }) },
        summary: {
          number: 'INV-1000',
          customerName: '',
          title: 'Rechnung',
          logoText: '',
          logoIcon: 'receipt',
          accent: '#4f46e5',
          currency: '$',
          cents: true,
          totalMinor: 0,
          itemCount: 0,
        },
      },
      AT,
    );
    const invoices = await setup('invoices');
    const listed = await invoices.execute({ id: 'c1', tool: 'list_documents', args: { kind: 'template' } });
    expect((listed.result as { documents: { locale?: string }[] }).documents[0]?.locale).toBe('de');

    const read = await invoices.execute({ id: 'c2', tool: 'read_document', args: { id: row.id } });
    expect(read.result).toMatchObject({ lang: 'de', number: 'INV-1000', status: 'draft' });
  });

  it('lists and reads a report document', async () => {
    const row = await reportDocumentsRepo(meta).create(
      {
        kind: 'template',
        name: 'Quarterly',
        body: { ...acceptReportBody({ reportTitle: 'Quarterly' }) },
        summary: {
          reportTitle: 'Quarterly',
          kicker: '',
          accent: '#4f46e5',
          blockCount: 0,
          kpiCount: 0,
          series: [],
          starterIcon: 'file-text',
        },
      },
      AT,
      { at: 'first' },
    );
    const report = await setup('report');
    const listed = await report.execute({ id: 'c1', tool: 'list_documents', args: {} });
    expect((listed.result as { documents: { name: string }[] }).documents[0]?.name).toBe('Quarterly');
    const read = await report.execute({ id: 'c2', tool: 'read_document', args: { id: row.id } });
    expect(read.result).toMatchObject({ status: 'draft' });
    expect((read.result as { body: { reportTitle: string } }).body.reportTitle).toBe('Quarterly');
  });

  it('offers each page its own starters', async () => {
    for (const [context, expected] of [
      ['email', 'welcome'],
      ['invoice-template', 'standard'],
      ['report', 'scorecard'],
    ] as const) {
      const turn = await setup(context);
      const listed = await turn.execute({ id: 'c1', tool: 'list_starters', args: {} });
      const keys = (listed.result as { starters: { key: string }[] }).starters.map((card) => card.key);
      expect(keys.length, context).toBeGreaterThan(0);
      expect(keys.some((key) => key.includes(expected)), `${context} has a ${expected} starter`).toBe(true);
    }
  });
});

describe('the workspace tools', () => {
  it('reads the allow-listed settings and nothing else', async () => {
    const settings = settingsRepo(meta);
    await settings.set('branding.appName', 'Northwind Ops');
    await settings.set('llm.apiKey', 'enc:v1:not-a-real-key');

    const email = await setup('email');
    const read = await email.execute({ id: 'c1', tool: 'workspace_settings', args: {} });
    const result = read.result as Record<string, unknown>;
    expect(result.appName).toBe('Northwind Ops');
    expect(result.defaultLocale).toBe('en_US');
    // Not on the list, so not in the answer — whatever it is named.
    expect(JSON.stringify(result)).not.toContain('not-a-real-key');
    expect(Object.keys(result)).not.toContain('apiKey');
  });

  it('gives the sender list to the email page and to no other', async () => {
    await settingsRepo(meta).set('email.senders', [
      { address: 'billing@example.test', name: 'Billing' },
    ] as never);

    const email = await setup('email');
    const withSenders = await email.execute({ id: 'c1', tool: 'workspace_settings', args: {} });
    expect((withSenders.result as { senders: { address: string }[] }).senders[0]?.address).toBe(
      'billing@example.test',
    );

    const invoices = await setup('invoices');
    const without = await invoices.execute({ id: 'c1', tool: 'workspace_settings', args: {} });
    expect((without.result as Record<string, unknown>).senders).toBeUndefined();
    // What the invoice pages get instead: how a number is made.
    expect((without.result as { numbering: { mintedOnSave: boolean } }).numbering.mintedOnSave).toBe(true);
  });

  it('answers which variables an email document may use', async () => {
    const email = await setup('email');
    const blank = await email.execute({ id: 'c1', tool: 'email_variables', args: {} });
    const vars = (blank.result as { variables: string[]; syntax: string }).variables;
    expect(vars).toContain('appName');
    expect((blank.result as { syntax: string }).syntax).toBe('{{variable}}');

    // A starter family adds its own on top of the workspace set — `reminder`
    // is one that has some, which is the case worth asserting.
    const fromStarter = await email.execute({ id: 'c2', tool: 'email_variables', args: { starter: 'reminder' } });
    const result = fromStarter.result as { variables: string[]; starterVariables: string[] };
    expect(result.starterVariables).toContain('date');
    expect(result.variables).toContain('date');
    expect(result.variables).toContain('appName');
  });
});

describe('what the model is shown of the conversation so far', () => {
  async function session() {
    return assistantSessionsRepo(meta).create(
      { context: 'email', host: { connectionIds: [] }, draft: { subject: 'On screen' } },
      AT,
    );
  }

  it('replays the editor`s unsaved document, then every turn that happened', async () => {
    const repo = assistantSessionsRepo(meta);
    const row = await session();
    const first = await repo.createTurn({ sessionId: row.id, askText: 'Draft it' }, AT);
    await repo.finishTurn(first.id, {
      status: 'done',
      transcript: [
        { role: 'user', content: 'Draft it' },
        { role: 'assistant', content: '{"say":"here"}' },
      ],
      finishedAt: AT + 10,
    });
    const second = await repo.createTurn({ sessionId: row.id, askText: 'Shorter' }, AT + 20);

    const turns = await repo.listTurns(row.id);
    const replayed = replayTranscript((await repo.findSession(row.id))!, turns, second.id);
    // The draft comes first, so "make it shorter" knows what is on screen.
    expect(replayed[0]?.content).toContain('open_document');
    expect(replayed.slice(1).map((message) => message.content)).toEqual([
      'Draft it',
      '{"say":"here"}',
    ]);
  });

  it('leaves out a turn that failed or was cancelled', async () => {
    const repo = assistantSessionsRepo(meta);
    const row = await session();
    const failed = await repo.createTurn({ sessionId: row.id, askText: 'Draft it' }, AT);
    await repo.finishTurn(failed.id, {
      status: 'failed',
      transcript: [
        { role: 'user', content: 'Draft it' },
        { role: 'assistant', content: 'not json' },
      ],
      finishedAt: AT + 10,
    });
    const next = await repo.createTurn({ sessionId: row.id, askText: 'Try again' }, AT + 20);

    const turns = await repo.listTurns(row.id);
    const replayed = replayTranscript((await repo.findSession(row.id))!, turns, next.id);
    // Only the open document: a failed turn's messages end in an error the
    // model would try to answer, and nothing it produced is a fact.
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.content).toContain('open_document');
  });

  it('sends the labels a person saw beside the keys they picked', async () => {
    const repo = assistantSessionsRepo(meta);
    const row = await session();
    const asked = await repo.createTurn({ sessionId: row.id, askText: 'Bill last month' }, AT);
    await repo.finishTurn(asked.id, {
      status: 'awaiting_picks',
      ask: {
        groups: [
          {
            key: 'tpl',
            title: 'Template',
            options: [
              { key: 't1', label: 'Standard', detail: '' },
              { key: 't2', label: 'EU reverse charge', detail: '' },
            ],
          },
        ],
      },
      finishedAt: AT + 10,
    });
    const answered = await repo.createTurn({ sessionId: row.id, picks: { tpl: 't2' } }, AT + 20);

    const turns = await repo.listTurns(row.id);
    const message = openingMessage(turns[1]!, turns[0]!);
    // `{"tpl":"t2"}` says nothing a turn later; the label says everything.
    expect(message.content).toContain('EU reverse charge');
    expect(message.content).toContain('"tpl":"t2"');
    expect(answered.askText).toBeNull();
  });

  it('opens with what the person typed when there are no picks', async () => {
    const repo = assistantSessionsRepo(meta);
    const row = await session();
    const turn = await repo.createTurn({ sessionId: row.id, askText: 'Draft a welcome email' }, AT);
    expect(openingMessage(turn, null)).toEqual({ role: 'user', content: 'Draft a welcome email' });
  });
});
