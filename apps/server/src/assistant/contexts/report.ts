// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report builder as a context.
 *
 * A report block holds TYPED-IN VALUES — a KPI is a string, a bar series is a
 * list of `{ label, value }` points, a table is pairs of strings. No block
 * names a query. So the assistant computes the numbers with `aggregate` and
 * writes them into the blocks, and records the descriptor it used for each
 * block beside them, in the artefact's `sources`.
 *
 * That list is what makes the numbers refreshable: *Run full preview* re-runs
 * the stored descriptors and shows what they say today. It is not a binding —
 * the block still holds the values that were written — and a live-bound block
 * is a different feature.
 *
 * A save from here lands a DRAFT. Publishing is a person's act on this page's
 * own primary button, and nothing the assistant does sets that status.
 */

import { reportDocumentsRepo } from '@adminium/meta';
import { z } from 'zod';

import {
  acceptReportBody,
  REPORT_BLOCK_KINDS,
  reportBodyInputSchema,
  type ReportBody,
} from '../../report-documents/document.js';
import { starterCards } from '../../report-documents/starters.js';
import { connectionsSection, countLabel, documentNamesSection, readableConnections, tablesSummary } from '../page-facts.js';
import { aggregateTool } from '../tools/aggregate.js';
import type { AssistantArtefactCheck, AssistantContextAdapter, AssistantDetailRow, AssistantResample } from '../types.js';
import { blockVocabulary, clip, jsonSchemaOf } from './format.js';

const BLOCK_MEANINGS: Readonly<Record<string, string>> = {
  heading: 'a section heading',
  text: 'a paragraph',
  kpi: 'a row of headline figures, each a label and a value written as text',
  bar: 'a bar chart: points of `{ label, value }`',
  line: 'a line chart: points of `{ label, value }`',
  table: 'a two-column table of string pairs',
  signature: 'a signature line',
  terms: 'terms the reader accepts',
  attachments: 'files that travel with the document',
  approval: 'who approved it, and whether they have',
  qr: 'a QR code with its caption',
  latefees: 'a late-payment rate and its grace days',
  poterms: 'a purchase-order reference and its terms',
  multicurrency: 'the same amount in other currencies',
  recurring: 'what recurs, how often, and when next',
  discount: 'discount codes with what each takes off',
  taxbreak: 'tax lines with their rates',
  payhistory: 'payments already made',
  legal: 'legal small print',
  refund: 'the refund window',
  contact: 'who to ask about this report',
  loyalty: 'points or standing in a loyalty scheme',
  delivery: 'delivery steps and where an order has reached',
  image: 'one image',
  divider: 'a horizontal rule',
};

/** One block's figures and where they came from. */
const sourceSchema = z.object({
  /** The block these numbers were written into. */
  blockId: z.string().min(1).max(64),
  /** The `aggregate` descriptor that produced them, so they can be re-run. */
  descriptor: z.record(z.string(), z.unknown()),
  /** One line on why this source answers the question. */
  reason: z.string().max(200).optional(),
});

const artefactSchema = z.object({
  name: z.string().min(1).max(120),
  body: reportBodyInputSchema,
  sources: z.array(sourceSchema).max(40).optional(),
});

function bodyOf(artefact: Record<string, unknown>): Record<string, unknown> | null {
  const body = artefact.body;
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function blocksOf(artefact: Record<string, unknown>): Record<string, unknown>[] {
  const body = bodyOf(artefact);
  const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
  return blocks.filter(
    (block): block is Record<string, unknown> =>
      typeof block === 'object' && block !== null && !Array.isArray(block),
  );
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Kicker, title, subtitle, then one line per block — the diff's canonical form. */
function projectForDiff(artefact: Record<string, unknown>): string[] {
  const body = bodyOf(artefact);
  if (body === null) return [];
  const lines = [
    `kicker: ${str(body.kicker)}`,
    `title: ${str(body.reportTitle)}`,
    `subtitle: ${str(body.subtitle)}`,
  ];
  for (const block of blocksOf(artefact)) {
    lines.push(`block: ${str(block.block) || str(block.kind) || '?'} "${clip(str(block.title), 60)}" (${str(block.w) || 'full'})`);
  }
  return lines;
}

/** The blocks a descriptor can fill — the ones that hold figures. */
const FIGURE_BLOCKS: readonly string[] = ['kpi', 'bar', 'line', 'table'];

/** A number as a block writes it: the block's fields are TEXT, not numbers. */
function figure(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** A delta as the KPI entry shows it — the comp's signed percentage. */
function delta(fraction: number): string {
  const pct = fraction * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
}

/**
 * Today's answer, written into the block it belongs to.
 *
 * ONE SHAPE PER BLOCK KIND, and a shape a kind cannot hold is left alone: a
 * `bar` cannot show a single metric and a `kpi` cannot show a time series, and
 * overwriting one with the other would be worse than showing the figure the
 * draft was made with. Every field written is a STRING, because that is what
 * the block holds — the arithmetic happened in the database.
 */
function writeFigures(block: Record<string, unknown>, shaped: Record<string, unknown>): boolean {
  const kind = str(block.kind) || str(block.block);
  const shape = str(shaped.shape);

  if (kind === 'kpi' && (shape === 'single-metric' || shape === 'metric+delta')) {
    const entries = Array.isArray(block.kpis) ? block.kpis : [];
    const first = entries[0];
    if (typeof first !== 'object' || first === null || Array.isArray(first)) return false;
    const entry = first as Record<string, unknown>;
    entry.value = figure(typeof shaped.value === 'number' ? shaped.value : 0);
    if (typeof shaped.deltaPct === 'number') entry.delta = delta(shaped.deltaPct);
    return true;
  }

  if ((kind === 'bar' || kind === 'line') && (shape === 'categorical' || shape === 'timeseries')) {
    const points =
      shape === 'categorical'
        ? (Array.isArray(shaped.items) ? shaped.items : []).map((item) => {
            const row = item as { label?: unknown; value?: unknown };
            return { label: str(row.label), value: figure(typeof row.value === 'number' ? row.value : 0) };
          })
        : (Array.isArray(shaped.points) ? shaped.points : []).map((point) => {
            const row = point as { t?: unknown; v?: unknown };
            return { label: str(row.t).slice(0, 10), value: figure(typeof row.v === 'number' ? row.v : 0) };
          });
    if (points.length === 0) return false;
    block.series = points;
    return true;
  }

  if (kind === 'table' && shape === 'categorical') {
    const rows = (Array.isArray(shaped.items) ? shaped.items : []).map((item) => {
      const row = item as { label?: unknown; value?: unknown };
      return [str(row.label), figure(typeof row.value === 'number' ? row.value : 0)];
    });
    if (rows.length === 0) return false;
    block.rows = rows;
    return true;
  }

  return false;
}

export const reportContext: AssistantContextAdapter = {
  key: 'report',
  pageLabel: 'Report builder',
  toolNames: [
    'list_documents',
    'read_document',
    'list_starters',
    'workspace_settings',
    'list_connections',
    'describe_schema',
    'read_rows',
    'aggregate',
  ],

  async pageFacts(deps) {
    const documents = reportDocumentsRepo(deps.meta);
    const counts = await documents.counts();
    const rows = await documents.list({});
    const connections = await readableConnections(deps);
    const summary = tablesSummary(connections);
    // One connection is worth naming; several are not, and the chip says how
    // many tables instead.
    const named = summary.connections === 1 ? (connections.find((entry) => entry.tables.length > 0)?.name ?? '') : '';
    return {
      values: {
        templates: counts.template,
        reports: counts.report,
        tables: summary.tables,
        ...(named === '' ? {} : { connection: named }),
      },
      scope: { primary: named, extra: summary.tables },
      prompt: [
        `This page holds ${countLabel(counts.template, 'template', 'templates')} and ${countLabel(counts.report, 'report', 'reports')}.`,
        `Documents: ${documentNamesSection(rows.map((row) => row.name))}.`,
        '',
        'Connected databases and the tables this person may read:',
        connectionsSection(connections),
      ].join('\n'),
    };
  },

  formatSpec() {
    return [
      'A report is `{ name, body, sources }`. The `body`, as JSON Schema:',
      jsonSchemaOf(reportBodyInputSchema),
      '',
      // `kind`, NOT `block`: this page's acceptor reads `kind` and degrades a
      // block without one to a text block saying "unknown block". The email
      // page's field IS called `block`, which is how the two came to be
      // swapped here; `reportFormatNamesTheAcceptedField` pins it.
      'Every block is `{ id, kind: <kind>, title, w: "full" | "half", show: true, … }`. The kinds:',
      blockVocabulary(REPORT_BLOCK_KINDS, BLOCK_MEANINGS),
      '',
      'Blocks hold VALUES, not queries. Compute the figures with `aggregate` and write them into the block.',
      'For every block you filled from an aggregate, add `{ blockId, descriptor, reason }` to `sources` — the same descriptor you ran. That is what lets the person re-run the numbers later.',
      'A report you draft is saved as a draft. Publishing is the person`s own act.',
    ].join('\n');
  },

  examples() {
    return starterCards()
      .slice(0, 2)
      .map((card) => JSON.stringify({ starter: card.key, name: card.name, title: card.reportTitle, blocks: card.blockCount }));
  },

  acceptArtefact(artefact): Promise<AssistantArtefactCheck> {
    const parsed = artefactSchema.safeParse(artefact);
    if (!parsed.success) {
      return Promise.resolve({
        ok: false,
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: 'ARTEFACT_INVALID',
          message: issue.message,
        })),
      });
    }
    let body: ReportBody;
    try {
      body = acceptReportBody(parsed.data.body);
    } catch (error) {
      return Promise.resolve({
        ok: false,
        errors: [
          { path: 'body', code: 'BODY_INVALID', message: error instanceof Error ? error.message : String(error) },
        ],
      });
    }
    // A source that names no block is a descriptor nothing can re-run, so it
    // is refused rather than stored as decoration.
    const ids = new Set(body.blocks.map((block) => block.id));
    const orphans = (parsed.data.sources ?? []).filter((source) => !ids.has(source.blockId));
    if (orphans.length > 0) {
      return Promise.resolve({
        ok: false,
        errors: orphans.map((source) => ({
          path: 'sources',
          code: 'SOURCE_BLOCK_UNKNOWN',
          message: `sources names blockId ${JSON.stringify(source.blockId)}, which is not a block of this report.`,
        })),
      });
    }
    return Promise.resolve({
      ok: true,
      artefact: {
        name: parsed.data.name,
        body: body as unknown as Record<string, unknown>,
        sources: parsed.data.sources ?? [],
        // Never `sent`. A person publishes; this page's assistant does not.
        status: 'draft',
      },
    });
  },

  projectForDiff,

  async baseForDiff(basedOn, deps) {
    const row = await reportDocumentsRepo(deps.meta).findById(basedOn);
    if (row === null) return null;
    return projectForDiff({ body: row.body as Record<string, unknown> });
  },

  /**
   * *Run full preview*: re-run every stored descriptor and write what it says
   * today into the block it filled.
   *
   * It goes through the `aggregate` TOOL rather than the compiler directly,
   * so a re-run inherits the same two refusals a draft was built under — the
   * acting person's per-table grants, and the compiler's refusal to aggregate
   * a masked column. A source that refuses is REPORTED, not dropped: the
   * block keeps the figure it was drafted with, and the person is told which
   * one did not move and why. Silently leaving a stale number beside fresh
   * ones is the failure this avoids.
   */
  async resample(artefact, deps): Promise<AssistantResample> {
    const sources = Array.isArray(artefact.sources) ? artefact.sources : [];
    // A deep copy: the stored artefact is the draft as it was proposed, and a
    // re-run must not edit the row a save would write.
    const next = JSON.parse(JSON.stringify(artefact)) as Record<string, unknown>;
    const blocks = blocksOf(next);
    const byId = new Map(blocks.map((block) => [str(block.id), block]));
    const refused: { blockId: string; message: string }[] = [];
    let refreshed = 0;

    for (const entry of sources) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const source = entry as { blockId?: unknown; descriptor?: unknown };
      const blockId = str(source.blockId);
      const block = byId.get(blockId);
      if (block === undefined) continue;
      const descriptor = source.descriptor;
      if (typeof descriptor !== 'object' || descriptor === null || Array.isArray(descriptor)) continue;
      const connectionId = str((descriptor as Record<string, unknown>).connectionId);
      if (connectionId === '') {
        refused.push({ blockId, message: 'That source names no connection.' });
        continue;
      }
      const outcome = await aggregateTool.run({ connectionId, descriptor }, deps);
      if (outcome.error !== undefined) {
        refused.push({ blockId, message: outcome.error.message });
        continue;
      }
      const result = outcome.result;
      const shaped =
        typeof result === 'object' && result !== null && !Array.isArray(result)
          ? (result as { data?: unknown }).data
          : null;
      if (typeof shaped !== 'object' || shaped === null || Array.isArray(shaped)) continue;
      if (writeFigures(block, shaped as Record<string, unknown>)) refreshed += 1;
    }

    return { artefact: next, refreshed, refused };
  },

  details(artefact): AssistantDetailRow[] {
    const sources = Array.isArray(artefact.sources) ? artefact.sources : [];
    const figures = blocksOf(artefact).filter((block) => FIGURE_BLOCKS.includes(str(block.block)));
    const chosen = sources
      .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}))
      .map((entry) => `${str(entry.blockId)}${str(entry.reason) === '' ? '' : ` — ${clip(str(entry.reason), 80)}`}`);
    return [
      { kind: 'sourcesChosen', args: { sources: chosen.join('; ') } },
      { kind: 'figures', args: { blocks: figures.length } },
      { kind: 'notPublished', args: {} },
    ];
  },
};
