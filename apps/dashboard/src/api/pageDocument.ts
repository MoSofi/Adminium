// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page document's reader: the code that runs zod over a page document,
 * in a chunk of its own.
 *
 * Every schema of a page document (`@adminium/engine/config`, and the layout
 * and query-descriptor schemas it re-exports from `@adminium/widgets`) is
 * zod, and zod is the largest single package a page needs that the first
 * paint does not: 30,700 bytes gz of the entry at zod 4.6.7 (chunk-budget.json,
 * 2026-10-25). Imported from `pages.ts`, `widgetData.ts` or `PageRenderer.tsx`
 * it rode in the entry on every route for every user, the sign-in form
 * included. Here it loads with the first page
 * document instead: `pageQuery` starts this import beside its request, so a
 * page waits for the slower of the two and not their sum (`pageReader.ts`).
 *
 * Nothing here is async: a page's data only exists after this module has
 * run, so the parse and the layout reads stay the plain functions they were.
 * Import this module only from code that is itself lazy (a template, the
 * project kit, a test); an import from the first paint puts zod back in the
 * entry, which `check-entry-budget` measures. It imports nothing of the
 * dashboard but types (`pageFacts.ts`), so `pageReader.ts` can load it
 * without an import cycle.
 */
import {
  ConfigMigrationError,
  configMigrations,
  latestConfigVersion,
  pageEnvelopeSchema,
  pageLayoutSchema,
  queryDescriptorSchema,
  runConfigMigrations,
  type ConfigMigration,
  type PageEnvelope,
  type QueryDescriptor,
} from '@adminium/engine/config';

import type { PageDocumentResult } from './pageFacts.js';

export interface WidgetDataRequest {
  instanceId: string;
  descriptor: QueryDescriptor;
}

export interface ExtractedBindings {
  requests: WidgetDataRequest[];
  /** instanceId → validation message for items whose binding failed Zod. */
  invalid: Map<string, string>;
}

/**
 * Post-migration envelope validator — structural so tests can inject a
 * variant schema alongside injected migrations (the real chain and the real
 * envelope schema always agree on the latest version).
 */
export interface EnvelopeValidator {
  safeParse(input: unknown):
    | { success: true; data: PageEnvelope }
    | { success: false; error: { issues: Array<{ path: ReadonlyArray<string | number>; message: string }> } };
}

export interface ParsePageOptions {
  /** Migration-chain override (test seam; defaults to the registered chain). */
  migrations?: readonly ConfigMigration[] | undefined;
  /** Envelope-schema override (test seam; defaults to `pageEnvelopeSchema`). */
  schema?: EnvelopeValidator | undefined;
}

function versionOf(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = (raw as Record<string, unknown>)['v'];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/** migrate → validate; every failure mode is a value, never a throw. */
export function parsePageDocument(raw: unknown, options: ParsePageOptions = {}): PageDocumentResult {
  const migrations = options.migrations ?? configMigrations;
  let migrated: unknown;
  try {
    migrated = runConfigMigrations(raw, migrations);
  } catch (error) {
    if (!(error instanceof ConfigMigrationError)) throw error;
    const v = versionOf(raw);
    const latest = latestConfigVersion(migrations);
    if (v !== null && v > latest) return { status: 'too-new', v, latest };
    return { status: 'invalid', issues: [error.message] };
  }

  const schema: EnvelopeValidator = options.schema ?? (pageEnvelopeSchema as EnvelopeValidator);
  const parsed = schema.safeParse(migrated);
  if (!parsed.success) {
    return {
      status: 'invalid',
      issues: parsed.error.issues.map((issue) =>
        issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }
  // The per-caller server capabilities are not part of the stored document —
  // the query wrapper fills them from the response. `canEditLayout` defaults
  // closed (false routes builder saves to the personal override); the write
  // capabilities default OPEN, because absent means "not computed" (a
  // source-less page, or a server predating the field), and hiding every
  // write affordance there would be a regression, not honesty.
  return {
    status: 'ok',
    page: parsed.data,
    revision: null,
    canEditLayout: false,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    canAttach: true,
    // Closed default, unlike the write capabilities: a reveal button is only
    // honest when the server said it sent PII in clear.
    canUnmask: false,
    stateActions: [],
    bulkActions: [],
    recordTabs: [],
    columnFacts: {},
    formColumns: [],
    formRelations: [],
    formChildren: [],
    tableLabelSingular: null,
    tableLabelPlural: null,
    removalReason: null,
  };
}

/**
 * Collect `config.binding` query descriptors from a dashboard document's
 * layout. Invalid descriptors surface as per-instance errors, never a throw.
 */
export function extractBindings(page: PageEnvelope): ExtractedBindings {
  const requests: WidgetDataRequest[] = [];
  const invalid = new Map<string, string>();
  if (page.kind !== 'dashboard') return { requests, invalid };
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  if (!layout.success) return { requests, invalid };
  for (const item of layout.data.items) {
    const binding = item.config['binding'];
    if (binding === undefined) continue;
    const descriptor = queryDescriptorSchema.safeParse(binding);
    if (descriptor.success) {
      requests.push({ instanceId: item.i, descriptor: descriptor.data });
    } else {
      invalid.set(item.i, descriptor.error.issues.map((issue) => issue.message).join('; '));
    }
  }
  return { requests, invalid };
}

/** Whether the page's layout carries the day control (`toolbar.day`). */
export function layoutHasDay(page: PageEnvelope): boolean {
  return pageLayoutSchema.safeParse(page.config['layout']).data?.toolbar?.day === true;
}

/**
 * The batch's poll interval: the shortest `refreshInterval` (seconds) any
 * widget of the layout asks for, in ms; `false` when none does.
 */
export function layoutRefreshMs(page: PageEnvelope): number | false {
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  if (!layout.success) return false;
  const intervals = layout.data.items
    .map((item) => item.config['refreshInterval'])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return intervals.length === 0 ? false : Math.min(...intervals) * 1000;
}

/** What `pageReader.ts` hands out once this chunk is in. */
export const pageReader = { parsePageDocument, extractBindings, layoutHasDay, layoutRefreshMs };
