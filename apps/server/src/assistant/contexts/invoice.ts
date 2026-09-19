// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two invoice contexts — the template editor and the `/invoices` manager.
 *
 * They share a document format and differ in what a draft MEANS. On the
 * editor, a draft is a reusable template: no customer, no number, the optional
 * sections switched on or off. On the manager, a draft is one invoice built
 * from a named template, with a customer and lines filled in from rows the
 * assistant read — and its number deliberately left empty, because a number is
 * minted when the row is created and never by a model.
 *
 * MONEY IS NEVER THE MODEL'S ARITHMETIC. Totals are computed from the lines by
 * the page's own integer money code at every point one is shown. What the
 * model writes is the lines.
 */

import { invoiceDocumentsRepo } from '@adminium/meta';
import { z } from 'zod';

import {
  acceptInvoiceBody,
  normalizeInvoiceBody,
  DEFAULT_BLOCK_ORDER,
  invoiceBodyInputSchema,
  type InvoiceBody,
} from '../../invoices/document.js';
import { formatMoney, totalsOf } from '../../invoices/money.js';
import { TEMPLATE_NUMBER } from '../../invoices/numbering.js';
import { starterCards, STARTER_KEYS } from '../../invoices/starters.js';
import { connectionsSection, countLabel, documentNamesSection, readableConnections, tablesSummary } from '../page-facts.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import type {
  AssistantArtefactCheck,
  AssistantContextAdapter,
  AssistantDetailRow,
  AssistantResample,
  AssistantToolDeps,
} from '../types.js';
import { clip, jsonSchemaOf } from './format.js';

/** The grant every save on these pages rides — the blurb says plainly whether this session holds it. */
const SETTINGS_MANAGE = PERMISSIONS.settingsManage;

/** One line per optional section, in the page's own order. */
const SECTION_MEANINGS: Readonly<Record<string, string>> = {
  parties: 'who issues this document and who receives it',
  shipping: 'a separate ship-to address',
  meta: 'the number, the dates and the terms',
  items: 'the line items',
  totals: 'subtotal, tax, discount and total — computed, never typed',
  paynotes: 'how to pay, and any note under it',
  signature: 'a signature line',
  terms: 'terms the customer accepts',
  attachments: 'files that travel with the document',
  approval: 'who approved it, and whether they have',
  qr: 'a QR code with its caption',
  latefees: 'the late-payment rate and its grace days',
  poterms: 'a purchase-order reference and its terms',
  multicurrency: 'the same total in other currencies',
  recurring: 'what recurs, how often, and when next',
  discount: 'discount codes with what each takes off',
  taxbreak: 'tax lines with their rates',
  payhistory: 'payments already made',
  legal: 'legal small print',
  refund: 'the refund window',
  contact: 'who to ask about this document',
  loyalty: 'points or standing in a loyalty scheme',
  delivery: 'delivery steps and where the order has reached',
};

const templateArtefactSchema = z.object({
  name: z.string().min(1).max(120),
  topic: z.string().max(40).optional(),
  lang: z.string().max(10).optional(),
  body: invoiceBodyInputSchema,
});

const invoiceArtefactSchema = z.object({
  /** The template this invoice is built from; the model must name a real one. */
  basedOn: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  body: invoiceBodyInputSchema,
});

function bodyOf(artefact: Record<string, unknown>): Record<string, unknown> | null {
  const body = artefact.body;
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function issuesOf(error: z.ZodError): { path: string; code: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: 'ARTEFACT_INVALID',
    message: issue.message,
  }));
}

/** Run the page's own acceptor and report what it refused. */
function acceptBody(raw: unknown): { body: InvoiceBody } | { errors: { path: string; code: string; message: string }[] } {
  try {
    return { body: acceptInvoiceBody(raw) };
  } catch (error) {
    return {
      errors: [
        { path: 'body', code: 'BODY_INVALID', message: error instanceof Error ? error.message : String(error) },
      ],
    };
  }
}

/** The lines a diff compares: the header facts, then one line per item. */
function projectForDiff(artefact: Record<string, unknown>): string[] {
  const body = bodyOf(artefact);
  if (body === null) return [];
  const lines = [
    `title: ${str(body.title)}`,
    `number: ${str(body.number)}`,
    `customer: ${str(body.customerName)}`,
    'items:',
  ];
  const items = Array.isArray(body.items) ? body.items : [];
  for (const entry of items) {
    const item = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    lines.push(`  ${clip(str(item.desc) || str(item.name), 60)} × ${str(item.qty)} @ ${str(item.rate)}`);
  }
  lines.push(`tax: ${str(body.taxRate)}`);
  lines.push(`discount: ${str(body.discountRate)}`);
  lines.push('sections:');
  for (const section of DEFAULT_BLOCK_ORDER) {
    const shown = sectionShown(body, section);
    if (shown !== null) lines.push(`  ${section}: ${shown ? 'on' : 'off'}`);
  }
  return lines;
}

/** `shipShow`, `sigShow`, … — the switch a section is drawn by, when it has one. */
function sectionShown(body: Record<string, unknown>, section: string): boolean | null {
  const key = `${SECTION_SWITCHES[section] ?? ''}Show`;
  if (SECTION_SWITCHES[section] === undefined) return null;
  const value = body[key];
  return typeof value === 'boolean' ? value : null;
}

/** The section name → the prefix of its `*Show` flag, where the two differ. */
const SECTION_SWITCHES: Readonly<Record<string, string>> = {
  shipping: 'ship',
  signature: 'sig',
  terms: 'terms',
  attachments: 'attach',
  approval: 'approval',
  qr: 'qr',
  latefees: 'late',
  poterms: 'po',
  multicurrency: 'mc',
  recurring: 'recur',
  discount: 'disc',
  taxbreak: 'tax',
  payhistory: 'pay',
  legal: 'legal',
  refund: 'refund',
  contact: 'contact',
  loyalty: 'loyal',
  delivery: 'deliv',
};

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

/** The format section both invoice contexts share. */
function invoiceFormatSpec(extra: string): string {
  return [
    'The document body, as JSON Schema:',
    jsonSchemaOf(invoiceBodyInputSchema),
    '',
    'Money and quantities are DECIMAL TEXT ("1250.00", "19.5"), never numbers. Subtotal, tax, discount and total are computed from the lines — do not write them.',
    '',
    'The sections a document can show, in their fixed order:',
    DEFAULT_BLOCK_ORDER.map((section) => `- ${section} — ${SECTION_MEANINGS[section] ?? 'a section of this document'}`).join('\n'),
    '',
    extra,
  ].join('\n');
}

/** Two of the page's own starters, as worked examples of the real format. */
function invoiceExamples(): string[] {
  const cards = starterCards().filter((card) => STARTER_KEYS.includes(card.key));
  return cards.slice(0, 2).map((card) => JSON.stringify({ starter: card.key, name: card.name, title: card.title }));
}

async function invoicePageFacts(deps: AssistantToolDeps, primary: string, canWrite: boolean) {
  const documents = invoiceDocumentsRepo(deps.meta);
  const counts = await documents.counts();
  const rows = await documents.list({});
  const connections = await readableConnections(deps);
  const summary = tablesSummary(connections);
  return {
    values: {
      templates: counts.template,
      invoices: counts.invoice,
      tables: summary.tables,
      pattern: TEMPLATE_NUMBER,
      write: canWrite,
    },
    scope: { primary, extra: summary.tables },
    prompt: [
      `This page holds ${countLabel(counts.template, 'template', 'templates')} and ${countLabel(counts.invoice, 'invoice', 'invoices')}.`,
      `Documents: ${documentNamesSection(rows.map((row) => row.name))}.`,
      `A template's number reads ${TEMPLATE_NUMBER}; an invoice's is minted when the row is created.`,
      '',
      'Connected databases and the tables this person may read:',
      connectionsSection(connections),
    ].join('\n'),
  };
}

async function baseForDiff(basedOn: string, deps: AssistantToolDeps): Promise<string[] | null> {
  const row = await invoiceDocumentsRepo(deps.meta).findById(basedOn);
  if (row === null) return null;
  return projectForDiff({ body: row.body as Record<string, unknown> });
}

/** The lines' total, computed the way every other surface computes it. */
function totalLine(body: InvoiceBody): string {
  const totals = totalsOf(body);
  return formatMoney(totals.total, body.currency, body.cents);
}

export const invoiceTemplateContext: AssistantContextAdapter = {
  key: 'invoice-template',
  pageLabel: 'Invoice builder',
  toolNames: [
    'list_documents',
    'read_document',
    'list_starters',
    'workspace_settings',
    'list_connections',
    'describe_schema',
    'read_rows',
    'sample_record',
  ],

  pageFacts: async (deps) => invoicePageFacts(deps, '', await deps.can(SETTINGS_MANAGE)),

  formatSpec() {
    return invoiceFormatSpec(
      'You are writing a TEMPLATE: a reusable layout. Leave `customerName`, `customer` and `items` as the example content the template should carry, leave `number` as the template placeholder, and decide which optional sections belong on it.',
    );
  },
  examples: invoiceExamples,

  acceptArtefact(artefact): Promise<AssistantArtefactCheck> {
    const parsed = templateArtefactSchema.safeParse(artefact);
    if (!parsed.success) return Promise.resolve({ ok: false, errors: issuesOf(parsed.error) });
    const accepted = acceptBody(parsed.data.body);
    if ('errors' in accepted) return Promise.resolve({ ok: false, errors: accepted.errors });
    return Promise.resolve({
      ok: true,
      artefact: { ...parsed.data, body: accepted.body as unknown as Record<string, unknown> },
    });
  },


  /**
   * *Preview another sample*: draw the drafted TEMPLATE over a different real
   * invoice.
   *
   * A template is a layout, and what it looks like depends on the document it
   * is filled with — a preview over one record proves less than a preview over
   * two. So this reaches for a real invoice in this workspace, not a fixture,
   * and re-renders the same template body with that record's parties, dates,
   * numbering and lines. The template itself is unchanged, the figures stay
   * this page's own arithmetic, and nothing is written.
   *
   * With no invoice to borrow from it redraws the draft as it stands and SAYS
   * so: a sample of nothing, reported as a sample, is the failure this avoids.
   */
  async resample(artefact, deps): Promise<AssistantResample> {
    const body = bodyOf(artefact);
    if (body === null) return { artefact, refreshed: 0, refused: [] };
    const rows = await invoiceDocumentsRepo(deps.meta).list({ kind: 'invoice' });
    const source = rows[0];
    if (source === undefined) {
      return {
        artefact,
        refreshed: 0,
        refused: [{ blockId: '', message: 'There is no invoice in this workspace to draw a sample from.' }],
      };
    }
    const full = await invoiceDocumentsRepo(deps.meta).findById(source.id);
    if (full === null) return { artefact, refreshed: 0, refused: [] };
    const record = normalizeInvoiceBody(full.body as unknown as Record<string, unknown>);
    // The TEMPLATE's own look — accent, logo, title, blocks, tax and discount
    // rates — over the RECORD's parties, dates, numbering and lines.
    const filled = {
      ...body,
      number: record.number,
      issued: record.issued,
      due: record.due,
      customerName: record.customerName,
      customer: [...record.customer],
      from: [...record.from],
      items: record.items.map((item) => ({ ...item })),
    };
    return {
      artefact: { ...artefact, body: filled as unknown as Record<string, unknown> },
      refreshed: 1,
      refused: [],
      label: record.customerName === '' ? record.number : record.customerName,
    };
  },

  projectForDiff,
  baseForDiff,

  details(artefact): AssistantDetailRow[] {
    const body = bodyOf(artefact);
    const on = DEFAULT_BLOCK_ORDER.filter((section) => sectionShown(body ?? {}, section) === true);
    return [
      { kind: 'formatInvoice', args: { sections: on.length } },
      { kind: 'taxLines', args: { rate: str(body?.taxRate) } },
    ];
  },
};

export const invoicesContext: AssistantContextAdapter = {
  key: 'invoices',
  pageLabel: 'Invoices',
  toolNames: [
    'list_documents',
    'read_document',
    'list_starters',
    'workspace_settings',
    'list_connections',
    'describe_schema',
    'read_rows',
    'aggregate',
    'sample_record',
  ],

  pageFacts: async (deps) => invoicePageFacts(deps, '', await deps.can(SETTINGS_MANAGE)),

  formatSpec() {
    return invoiceFormatSpec(
      [
        'You are drafting ONE INVOICE from an existing template. Name that template as `basedOn` (an id from list_documents), fill `customerName`, `customer`, `items`, `issued` and `due` from what you read, and leave `number` as an empty string — a number is minted when the row is created.',
        'You never change a customer row. Reading them is all that happens here.',
      ].join('\n'),
    );
  },
  examples: invoiceExamples,

  async acceptArtefact(artefact, deps): Promise<AssistantArtefactCheck> {
    const parsed = invoiceArtefactSchema.safeParse(artefact);
    if (!parsed.success) return { ok: false, errors: issuesOf(parsed.error) };
    const template = await invoiceDocumentsRepo(deps.meta).findById(parsed.data.basedOn);
    if (template === null || template.kind !== 'template') {
      return {
        ok: false,
        errors: [
          {
            path: 'basedOn',
            code: 'TEMPLATE_NOT_FOUND',
            message: `${JSON.stringify(parsed.data.basedOn)} is not an invoice template on this page. Use list_documents to find one.`,
          },
        ],
      };
    }
    const accepted = acceptBody(parsed.data.body);
    if ('errors' in accepted) return { ok: false, errors: accepted.errors };
    if (accepted.body.number !== '') {
      return {
        ok: false,
        errors: [
          {
            path: 'body.number',
            code: 'NUMBER_NOT_YOURS',
            message: 'Leave `number` as an empty string — the invoice number is minted when the row is created.',
          },
        ],
      };
    }
    return {
      ok: true,
      artefact: { ...parsed.data, body: accepted.body as unknown as Record<string, unknown> },
    };
  },

  projectForDiff,
  baseForDiff,

  details(artefact): AssistantDetailRow[] {
    const body = bodyOf(artefact);
    const items = Array.isArray(body?.items) ? body.items.length : 0;
    const accepted = body === null ? null : acceptBody(body);
    const total = accepted !== null && 'body' in accepted ? totalLine(accepted.body) : '—';
    return [
      { kind: 'record', args: {} },
      { kind: 'lines', args: { lines: items, total } },
      // The comp drew "marks as billed"; nothing here writes a customer row,
      // and saying so is more useful than leaving the reader to wonder.
      { kind: 'notTouched', args: {} },
    ];
  },
};
