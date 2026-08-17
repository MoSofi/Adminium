// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Email blocks ⇄ document-canvas doc mapping (M7-T06 Email Templates surface).
 *
 * The server persists `adminium_email_templates.blocks` as the meta-store
 * `emailBlocksSchema` payload — an ordered array of open block records
 * (packages/meta json-payloads.ts: "the concrete block schema is owned by
 * 09-generated-app.md §email-editor"). This module pins that concrete shape
 * for the editor:
 *
 *   { block: '<block-* registry id>', id?: string, label?: string, data?: unknown }
 *
 * and projects it onto the `DocRecord` the `document-canvas` renders. UNKNOWN
 * entries (no recognizable `block` id — e.g. a future server-side block kind)
 * are preserved verbatim and re-emitted at their original positions on
 * serialize, so an editor round trip never destroys what it doesn't render —
 * the same forward-compatibility rule the page envelope follows (01 §6.2).
 */
import {
  docBlockInstancesOf,
  isBlockId,
  type DocBlockInstance,
  type DocRecord,
} from '@adminium/widgets';
import type { EmailBlock } from '../../api/emailTemplates.js';

interface KnownEntry {
  kind: 'known';
  instance: DocBlockInstance;
  data: unknown;
}

interface UnknownEntry {
  kind: 'unknown';
  raw: EmailBlock;
  /** Index in the stored array — unknown entries re-emit at their slot. */
  at: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEntries(blocks: readonly EmailBlock[]): { known: KnownEntry[]; unknown: UnknownEntry[] } {
  const known: KnownEntry[] = [];
  const unknown: UnknownEntry[] = [];
  blocks.forEach((raw, index) => {
    const block = isRecord(raw) ? raw['block'] : undefined;
    if (!isBlockId(block)) {
      unknown.push({ kind: 'unknown', raw, at: index });
      return;
    }
    const id = typeof raw['id'] === 'string' ? raw['id'] : `${block}-${index}`;
    const label = typeof raw['label'] === 'string' ? raw['label'] : undefined;
    known.push({
      kind: 'known',
      instance: { id, block, ...(label === undefined ? {} : { label }) },
      data: raw['data'],
    });
  });
  return { known, unknown };
}

export interface EmailDocState {
  doc: DocRecord;
  /** Unknown stored entries, preserved for `docToEmailBlocks`. */
  unknown: UnknownEntry[];
}

/** Stored blocks → the doc the canvas renders (+ the preserved remainder). */
export function emailBlocksToDoc(
  blocks: readonly EmailBlock[],
  meta: { name: string; subject: string },
): EmailDocState {
  const { known, unknown } = parseEntries(blocks);
  const doc: DocRecord = {
    docType: 'email',
    title: meta.subject === '' ? meta.name : meta.subject,
    blockOrder: known.map((entry) => entry.instance),
    blocks: Object.fromEntries(
      known.filter((entry) => entry.data !== undefined).map((entry) => [entry.instance.block, entry.data]),
    ),
  };
  return { doc, unknown };
}

/** The edited doc → the stored `emailBlocksSchema` array (unknowns restored). */
export function docToEmailBlocks(doc: DocRecord, unknown: readonly UnknownEntry[] = []): EmailBlock[] {
  const ordered = docBlockInstancesOf(doc, 'email')
    .filter((instance) => doc.flags?.[instance.block] !== false)
    .map((instance): EmailBlock => {
      const data = doc.blocks?.[instance.block];
      return {
        block: instance.block,
        id: instance.id,
        ...(instance.label === undefined ? {} : { label: instance.label }),
        ...(data === undefined ? {} : { data }),
      };
    });
  // Restore unknown entries at (or as near as possible to) their stored slots.
  const out = [...ordered];
  for (const entry of [...unknown].sort((a, b) => a.at - b.at)) {
    out.splice(Math.min(entry.at, out.length), 0, entry.raw);
  }
  return out;
}
