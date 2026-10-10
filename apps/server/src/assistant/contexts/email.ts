// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email page as a context.
 *
 * The format spec is generated from the page's OWN input schema rather than
 * described in prose, and the artefact is accepted by the SAME two functions
 * `PUT /email-templates/:id` runs. That is the whole reason a draft the
 * assistant proposes can be saved at all: if it validates here it validates
 * there, and if it does not, the model is told in the page's own words.
 */

import { OTHERWISE_BLOCKS, showWhenOf } from '@adminium/manifest';
import { emailTemplatesRepo, filesRepo, settingsRepo } from '@adminium/meta';
import { z } from 'zod';

import {
  emailDocumentInputSchema,
  normalizeDocument,
  validateDocument,
  type EmailDocument,
} from '../../email/document.js';
import { EMAIL_BLOCK_KINDS } from '../../email/render.js';
import { renderStarter } from '../../email/starters.js';
import { connectionsSection, countLabel, documentNamesSection, readableConnections, tablesSummary } from '../page-facts.js';
import type {
  AssistantArtefactCheck,
  AssistantContextAdapter,
  AssistantDocument,
  AssistantDetailRow,
  AssistantToolDeps,
} from '../types.js';
import { blockVocabulary, clip, jsonSchemaOf, varsUsedIn } from './format.js';

/** One line per block kind, in the vocabulary's own order. */
const BLOCK_MEANINGS: Readonly<Record<string, string>> = {
  'email.heading': 'a headline',
  'email.text': 'a paragraph of body copy',
  'email.button': 'a call-to-action button with a label and a URL',
  'email.divider': 'a horizontal rule',
  'email.spacer': 'vertical space',
  'email.footer': 'a closing block (the envelope also carries a footer line)',
  'email.image': 'one image, by URL',
  'email.two-col': 'two columns of copy side by side',
  'email.list': 'a bulleted or numbered list',
  'email.quote': 'a pulled-out quotation',
  'email.social': 'a row of social links',
  'email.html': 'raw HTML, for what the other blocks cannot express',
  'email.box': 'a tinted panel around a short message',
  'email.stats': 'a row of labelled numbers',
  'email.product': 'a product card: image, name, price',
  'email.multi-currency': 'the same amount in several currencies',
  'email.tax-breakdown': 'tax lines with their rates',
  'email.discount-codes': 'discount codes with what each takes off',
  'email.payment-history': 'past payments against this account',
  'email.recurring': 'what recurs, how often, and when next',
  'email.loyalty': 'points or standing in a loyalty scheme',
  'email.delivery': 'delivery steps and where the order has reached',
  'email.po-terms': 'a purchase-order reference and its terms',
  'email.legal': 'legal small print',
  'email.refund-policy': 'the refund window and how to use it',
  'email.contact': 'who to reply to, and how',
};

/** The envelope the assistant writes for this page. */
const artefactSchema = z.object({
  kind: z.enum(['template', 'campaign']),
  name: z.string().min(1).max(120),
  locale: z.string().min(2).max(10),
  /** An existing document this one is a language variation of. */
  basedOn: z.string().max(64).optional(),
  document: emailDocumentInputSchema,
});

/** The From addresses a document may use — the SMTP identity plus the list. */
async function configuredSenders(deps: AssistantToolDeps): Promise<string[]> {
  const settings = settingsRepo(deps.meta);
  const smtp = await settings.get('email.smtp');
  const list = await settings.get('email.senders');
  return [...(smtp === null ? [] : [smtp.from]), ...list.map((sender) => sender.address)];
}

const CONDITION_SHAPE = '{ "block": "email.text", "showWhen": { "var": "<name>" }, "otherwise": "<the other words>", "data": { … } }';

/** What is wrong with the `showWhen` / `otherwise` of a draft's blocks, block by block. */
function conditionErrors(blocks: readonly unknown[]): { path: string; code: string; message: string }[] {
  const out: { path: string; code: string; message: string }[] = [];
  blocks.forEach((block, index) => {
    if (typeof block !== 'object' || block === null) return;
    const record = block as Record<string, unknown>;
    const at = `document.blocks.${String(index)}`;
    const tied = showWhenOf(record) !== null;
    if (record['showWhen'] !== undefined && !tied) {
      out.push({ path: `${at}.showWhen`, code: 'SHOW_WHEN_INVALID', message: `showWhen names one variable: { "var": "<name>" }. Written whole: ${CONDITION_SHAPE}` });
    }
    if (record['otherwise'] === undefined) return;
    if (typeof record['otherwise'] !== 'string') {
      out.push({ path: `${at}.otherwise`, code: 'OTHERWISE_INVALID', message: 'otherwise is a text: the words sent in the block\'s place.' });
    } else if (!tied) {
      out.push({ path: `${at}.otherwise`, code: 'OTHERWISE_ALONE', message: `otherwise belongs on the block that carries showWhen, not on a block of its own. Move it onto that block and remove this one: ${CONDITION_SHAPE}` });
    } else if (!OTHERWISE_BLOCKS.includes(String(record['block']))) {
      out.push({ path: `${at}.otherwise`, code: 'OTHERWISE_NOT_TEXT', message: `Only ${OTHERWISE_BLOCKS.join(' and ')} can say other words. A ${String(record['block'])} tied to a value is left out when the value is missing: take otherwise off it, or add a text block for those readers.` });
    }
  });
  return out;
}

async function acceptArtefact(
  artefact: Record<string, unknown>,
  deps: AssistantToolDeps,
): Promise<AssistantArtefactCheck> {
  const parsed = artefactSchema.safeParse(artefact);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: 'ARTEFACT_INVALID',
        message: issue.message,
      })),
    };
  }
  // The page's own validator lets an unknown block kind THROUGH on purpose:
  // a document written by a newer server has to round-trip rather than be
  // refused. A model inventing one is the opposite case — nothing will render
  // it — and telling it so costs one correction instead of a saved document
  // that draws a blank space.
  const invented = (parsed.data.document.blocks ?? [])
    .map((block, index) => ({ index, kind: (block as { block?: unknown }).block }))
    .filter((entry) => typeof entry.kind === 'string' && !(EMAIL_BLOCK_KINDS as readonly string[]).includes(entry.kind));
  if (invented.length > 0) {
    return {
      ok: false,
      errors: invented.map((entry) => ({
        path: `document.blocks.${String(entry.index)}.block`,
        code: 'UNKNOWN_BLOCK_KIND',
        message: `${String(entry.kind)} is not a block kind on this page. The kinds are: ${EMAIL_BLOCK_KINDS.join(', ')}.`,
      })),
    };
  }

  // A block's condition is dropped by the page's own save when it is not one
  // (like a style nobody recognises). From a model that is a paragraph lost
  // without a word: say what is wrong, where, and how it is written.
  const misplaced = conditionErrors(parsed.data.document.blocks ?? []);
  if (misplaced.length > 0) return { ok: false, errors: misplaced };

  let document: EmailDocument;
  try {
    document = normalizeDocument(parsed.data.document);
    const sizes = new Map<string, number | null>();
    for (const attachment of document.attachments) {
      if (attachment.kind !== 'file') continue;
      const file = await filesRepo(deps.meta).findById(attachment.fileId);
      sizes.set(attachment.fileId, file === null || file.deletedAt !== null ? null : file.sizeBytes);
    }
    // The page's own save runs exactly this, with exactly these inputs.
    validateDocument(document, {
      senders: await configuredSenders(deps),
      maxAttachmentBytes: await settingsRepo(deps.meta).get('email.maxAttachmentBytes'),
      attachmentSizes: sizes,
    });
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          path: 'document',
          code: 'DOCUMENT_INVALID',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  return {
    ok: true,
    artefact: { ...parsed.data, document: document as unknown as Record<string, unknown> },
  };
}

/** Subject, preheader, one line per block, footer — the diff's canonical form. */
function projectForDiff(artefact: Record<string, unknown>): string[] {
  const document = documentOf(artefact);
  if (document === null) return [];
  const lines = [
    `subject: ${asString(document.subject)}`,
    `preheader: ${asString(document.preheader)}`,
    'blocks:',
  ];
  const blocks = Array.isArray(document.blocks) ? document.blocks : [];
  for (const entry of blocks) {
    const block = asRecord(entry);
    if (block === null) continue;
    lines.push(`  ${asString(block.block) || '?'}: ${summaryOfBlock(block)}`);
  }
  lines.push(`footer: ${asString(document.footer)}`);
  return lines;
}

/** One block as one readable line: its first piece of text, or nothing. */
function summaryOfBlock(block: Record<string, unknown>): string {
  const data = asRecord(block.data) ?? {};
  for (const key of ['text', 'title', 'label', 'heading', 'html', 'url']) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) return clip(value, 80);
  }
  return '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function documentOf(artefact: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(artefact.document);
}

/** What this page drafts: its format, its worked examples, its own validator and what a diff compares. */
const emailDocument: AssistantDocument = {
  formatSpec() {
    return [
      'A document is `{ kind, name, locale, document }`, plus `basedOn` when it is a language variation of an existing document.',
      'The `document` envelope, as JSON Schema:',
      jsonSchemaOf(emailDocumentInputSchema),
      '',
      'Every block is `{ block: <kind>, data: { … }, style?: { … }, showWhen?: { var: <name> }, otherwise?: <text> }`. The kinds:',
      blockVocabulary(EMAIL_BLOCK_KINDS, BLOCK_MEANINGS),
      '',
      'Variables are written `{{name}}` and must come from `email_variables`. A name outside that list renders as literal text.',
      'A value may be missing for some readers. Say what to write then: `{{first_name|there}}` writes "there" when there is no first name (`{{first_name|}}` writes nothing).',
      'When a backup word cannot keep the sentence right, tie the whole block to the value: `showWhen: { var: "first_name" }` sends the block only when the value is there. To send other words to everyone else, put `otherwise` ON THAT SAME BLOCK (email.text and email.heading only); never add a second block for them:',
      '{ "block": "email.text", "showWhen": { "var": "first_name" }, "otherwise": "We saved your favourites.", "data": { "paras": ["We saved your favourites, {{first_name}}."] } }',
    ].join('\n');
  },

  examples(deps) {
    // The page's own starters, rendered by the page's own code — a worked
    // example of the real format rather than an approximation of it that can
    // drift.
    return (['welcome', 'reminder'] as const).map((key) => {
      const starter = renderStarter(key, deps.t);
      return JSON.stringify({
        kind: 'template',
        name: starter.name,
        locale: deps.locale,
        document: starter.document,
      });
    });
  },

  acceptArtefact,
  projectForDiff,

  async baseForDiff(basedOn, deps) {
    const row = await emailTemplatesRepo(deps.meta).findById(basedOn);
    if (row === null) return null;
    // The row stores the document's halves as columns; the page's own
    // normalizer is what puts them back together, legacy footers included.
    return projectForDiff({ document: normalizeDocument(row) as unknown as Record<string, unknown> });
  },

  details(artefact): AssistantDetailRow[] {
    const document = documentOf(artefact);
    const blocks = Array.isArray(document?.blocks) ? document.blocks.length : 0;
    const vars = varsUsedIn(JSON.stringify(document ?? {}));
    return [
      { kind: 'formatEmail', args: { blocks } },
      { kind: 'variables', args: { variables: vars.join(', ') } },
    ];
  },
};

export const emailContext: AssistantContextAdapter = {
  key: 'email',
  pageLabel: 'Email templates',
  toolNames: [
    'list_documents',
    'read_document',
    'list_starters',
    'workspace_settings',
    'email_variables',
    'list_connections',
    'describe_schema',
    'read_rows',
    'aggregate',
  ],

  async pageFacts(deps) {
    const templates = emailTemplatesRepo(deps.meta);
    const counts = await templates.counts(false);
    const rows = await templates.list({});
    const connections = await readableConnections(deps);
    const summary = tablesSummary(connections);
    const locales = [...new Set(rows.map((row) => row.locale))];

    return {
      values: { templates: counts.template, campaigns: counts.campaign, tables: summary.tables },
      scope: { primary: '', extra: summary.tables },
      prompt: [
        `This page holds ${countLabel(counts.template, 'template', 'templates')} and ${countLabel(counts.campaign, 'campaign', 'campaigns')}.`,
        `Documents: ${documentNamesSection(rows.map((row) => row.name))}.`,
        `Languages in use: ${locales.length === 0 ? 'none yet' : locales.join(', ')}.`,
        '',
        'Connected databases and the tables this person may read:',
        connectionsSection(connections),
      ].join('\n'),
    };
  },

  document: emailDocument,
};
