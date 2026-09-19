// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The buttons on the result card.
 *
 * Every case here starts from a draft that a turn produced and a person who
 * clicked something. What is being proved is that the row which lands is the
 * one the host page's own route would have written — a draft, numbered by this
 * workspace's own sequence, readable back through the page's own repo — and
 * that a role without the page's save grant gets nothing but a refusal.
 */

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  auditRepo,
  createSqliteMetaDb,
  emailTemplatesRepo,
  firstRun,
  invoiceDocumentsRepo,
  reportDocumentsRepo,
  type MetaDb,
} from '@adminium/meta';

import { runAssistantAction, type AssistantActionInput } from '../src/assistant/actions.js';
import { acceptInvoiceBody } from '../src/invoices/document.js';
import { normalizeDocument } from '../src/email/document.js';
import { ConflictError, ForbiddenError, ValidationFailedError } from '../src/errors.js';

const AT = 1_750_000_000_000;

let meta: MetaDb;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
});

afterEach(async () => {
  await meta.db.destroy();
});

/** One action, as the acting person: by default one who may save. */
function act(
  overrides: Partial<AssistantActionInput> & Pick<AssistantActionInput, 'action' | 'context' | 'artefact'>,
): Promise<Awaited<ReturnType<typeof runAssistantAction>>> {
  return runAssistantAction({
    meta,
    sessionId: 'ast_session',
    turnId: 'atn_turn',
    actor: { kind: 'user', id: null, label: 'Drafter' },
    can: () => Promise.resolve(true),
    now: () => AT,
    ...overrides,
  });
}

/** The email draft these cases save. */
function emailArtefact(name = 'Welcome'): Record<string, unknown> {
  return {
    kind: 'template',
    name,
    locale: 'en_US',
    document: normalizeDocument({
      subject: 'Welcome aboard',
      blocks: [{ block: 'email.heading', data: { text: 'Welcome' } }],
    }) as unknown as Record<string, unknown>,
  };
}

async function auditRows() {
  return auditRepo(meta).list({ limit: 50 });
}

describe('save', () => {
  it('creates an email document the page reads back as a draft', async () => {
    const outcome = await act({ action: 'save', context: 'email', artefact: emailArtefact() });

    expect(outcome.echo).toEqual({ kind: 'saved', open: false, name: 'Welcome' });
    const id = outcome.created?.id ?? '';
    const row = await emailTemplatesRepo(meta).findById(id);
    expect(row).not.toBeNull();
    // A draft, which is what the manager's Draft pill reads from.
    expect(row?.enabled).toBe(false);
    expect(row?.name).toBe('Welcome');
    expect(row?.locale).toBe('en_US');
    // The document survives the round trip as VALUES, not as bytes.
    expect(row?.subject).toBe('Welcome aboard');
    expect(row?.blocks[0]).toMatchObject({ block: 'email.heading' });
    // A key was minted from the name, the way the page's own create does.
    expect(row?.key).toContain('welcome');
  });

  it('carries the person`s rename onto the row', async () => {
    const outcome = await act({
      action: 'save',
      context: 'email',
      artefact: emailArtefact('Draft name'),
      name: 'Onboarding note',
    });
    const row = await emailTemplatesRepo(meta).findById(outcome.created?.id ?? '');
    expect(row?.name).toBe('Onboarding note');
  });

  it('mints the invoice number from this workspace`s sequence, not from the draft', async () => {
    const repo = invoiceDocumentsRepo(meta);
    const template = await repo.create(
      {
        kind: 'template',
        name: 'Consulting',
        topic: 'services',
        lang: 'en',
        number: 'INV-1000',
        body: { ...acceptInvoiceBody({}) },
        summary: summaryFixture(),
      },
      AT,
    );

    const outcome = await act({
      action: 'save',
      context: 'invoices',
      artefact: {
        basedOn: template.id,
        name: 'March — Company 1',
        body: { customerName: 'Company 1', number: '', items: [{ desc: 'Work', qty: '2', rate: '100.00' }] },
      },
    });

    const row = await repo.findById(outcome.created?.id ?? '');
    expect(row?.kind).toBe('invoice');
    expect(row?.status).toBe('draft');
    // Minted here; the model left it empty on purpose.
    expect(row?.number).not.toBe('');
    expect(row?.body).toMatchObject({ number: row?.number });
    // And it remembers where it came from.
    expect(row?.originId).toBe(template.id);
  });

  it('refuses an invoice whose template does not exist', async () => {
    await expect(
      act({ action: 'save', context: 'invoices', artefact: { basedOn: 'inv_nothing', name: 'X', body: {} } }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('saves a report as a draft and never as published', async () => {
    const outcome = await act({
      action: 'save',
      context: 'report',
      artefact: {
        name: 'Quarterly',
        body: { reportTitle: 'Quarterly', blocks: [] },
        // What the turn recorded about where the figures came from; the row is
        // the document, and this rides along with it.
        sources: [{ blockId: 'b1', descriptor: {} }],
      },
    });
    const row = await reportDocumentsRepo(meta).findById(outcome.created?.id ?? '');
    expect(row?.status).toBe('draft');
    expect(row?.status).not.toBe('sent');
    expect(row?.name).toBe('Quarterly');
  });

  it('leaves exactly one audit row, naming the page, the verb and the turn', async () => {
    const outcome = await act({ action: 'save', context: 'email', artefact: emailArtefact() });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('assistant.email.create');
    expect(rows[0]?.category).toBe('settings');
    expect(rows[0]?.changes?.after).toMatchObject({
      id: outcome.created?.id,
      sessionId: 'ast_session',
      turnId: 'atn_turn',
    });
  });

  it('asks for the editor to open when the person chose that', async () => {
    const outcome = await act({ action: 'save', context: 'email', artefact: emailArtefact(), open: true });
    expect(outcome.echo).toMatchObject({ kind: 'saved', open: true });
    // Opening is the dashboard's move; what the server owes it is the id.
    expect(outcome.created?.id).toBeTruthy();
  });
});

describe('a role that cannot save', () => {
  it('is refused, and writes nothing at all', async () => {
    const refused = act({
      action: 'save',
      context: 'email',
      artefact: emailArtefact(),
      can: () => Promise.resolve(false),
    });
    await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
    expect(await emailTemplatesRepo(meta).list({})).toHaveLength(0);
    // No row, and no audit entry claiming one.
    expect(await auditRows()).toHaveLength(0);
  });

  it('is refused for a test send and for a language too', async () => {
    await expect(
      act({
        action: 'test-send',
        context: 'email',
        artefact: emailArtefact(),
        to: 'drafter@example.test',
        can: () => Promise.resolve(false),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      act({
        action: 'language.add',
        context: 'email',
        artefact: { ...emailArtefact(), basedOn: 'tpl_x' },
        locale: 'de_DE',
        can: () => Promise.resolve(false),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('language.add', () => {
  it('adds a variation to the family rather than a document of its own', async () => {
    const templates = emailTemplatesRepo(meta);
    const source = await templates.create(
      {
        kind: 'template',
        key: 'welcome',
        locale: 'en_US',
        name: 'Welcome',
        category: 'lifecycle',
        starter: null,
        enabled: false,
        subject: 'Welcome',
        preheader: '',
        blocks: [],
        footer: '',
        brand: null,
        attachments: [],
      },
      AT,
    );

    const outcome = await act({
      action: 'language.add',
      context: 'email',
      artefact: { ...emailArtefact('Willkommen'), basedOn: source.id },
      locale: 'de_DE',
    });

    const row = await templates.findById(outcome.created?.id ?? '');
    // Same family key, different language: that is what makes it a variation.
    expect(row?.key).toBe('welcome');
    expect(row?.locale).toBe('de_DE');
    expect(outcome.echo).toEqual({ kind: 'language-added', locale: 'de_DE', name: 'Willkommen' });
    expect((await auditRows())[0]?.action).toBe('assistant.email.language.add');
  });

  it('refuses a second variation in a language the family already has', async () => {
    const templates = emailTemplatesRepo(meta);
    const source = await templates.create(
      {
        kind: 'template',
        key: 'welcome',
        locale: 'en_US',
        name: 'Welcome',
        category: 'lifecycle',
        starter: null,
        enabled: false,
        subject: 'Welcome',
        preheader: '',
        blocks: [],
        footer: '',
        brand: null,
        attachments: [],
      },
      AT,
    );
    await expect(
      act({
        action: 'language.add',
        context: 'email',
        artefact: { ...emailArtefact(), basedOn: source.id },
        locale: 'en_US',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a variation with nothing to vary', async () => {
    await expect(
      act({ action: 'language.add', context: 'email', artefact: emailArtefact(), locale: 'de_DE' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });
});

describe('test-send', () => {
  it('answers the SMTP conflict rather than pretending to send', async () => {
    // Nothing is configured on a fresh store, which is the state the card has
    // to explain — and it is the same 409 the editor's own test send answers.
    await expect(
      act({ action: 'test-send', context: 'email', artefact: emailArtefact(), to: 'drafter@example.test' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await auditRows()).toHaveLength(0);
  });

  it('needs an address to send to', async () => {
    await expect(
      act({ action: 'test-send', context: 'email', artefact: emailArtefact() }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('is an email-page action only', async () => {
    await expect(
      act({ action: 'test-send', context: 'report', artefact: { name: 'x' }, to: 'a@b.test' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });
});

describe('sample', () => {
  it('re-draws the preview, writes nothing, and leaves no audit row', async () => {
    const outcome = await act({
      action: 'sample',
      context: 'invoices',
      artefact: { name: 'March', body: { customerName: 'Company 7' } },
      // Deliberately a person who cannot save: a preview is not a change.
      can: () => Promise.resolve(false),
    });
    expect(outcome.echo).toEqual({ kind: 'sampled', label: 'Company 7' });
    expect(outcome.sample?.label).toBe('Company 7');
    expect(await auditRows()).toHaveLength(0);
    expect(await invoiceDocumentsRepo(meta).list({})).toHaveLength(0);
  });
});

/** The denormalised card facts an invoice row carries. */
function summaryFixture() {
  return {
    number: 'INV-1000',
    customerName: '',
    title: 'Invoice',
    logoText: '',
    logoIcon: 'receipt',
    accent: '#4f46e5',
    currency: '$',
    cents: true,
    totalMinor: 0,
    itemCount: 0,
  };
}
