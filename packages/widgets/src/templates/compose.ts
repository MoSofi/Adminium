// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `composeTemplate` — the page-template composition engine (04-widget-registry.md
 * §10, task 04-T07).
 *
 * Fills each manifest slot with the highest-scoring **accepted** candidate,
 * repeating slots take the top-N, unfilled *optional* slots are dropped or
 * empty-stated, and composition fails only when a slot marked `required: true`
 * is unfillable — which surfaces as a Studio warning rather than an exception,
 * matching the `buildDashboardEnvelope` → `null` + caller-records-a-warning
 * idiom already used by `@adminium/engine/generate`.
 *
 * WHAT THIS IS NOT: the return value is an **in-memory intermediate**. Nothing
 * here persists, and nothing here builds the stored envelope — the Engine wraps
 * `ComposedPage` into `v`/`kind`/`id`/`template`/`title`/`source`/`nav`/`access`/
 * `config` (01-architecture.md §6.1) with `layout` under `config.layout` and
 * `toolbar`/`overlays` in the template's config body. Keeping the wrap out of
 * this package is what lets `@adminium/widgets` stay free of engine imports.
 *
 * DETERMINISM: generation output is content-hashed (`generated_hash`, H5), so a
 * re-run over an unchanged schema must produce a byte-identical page. Every
 * ordering decision below is therefore total — candidate ties break on widget id
 * then on the caller's original array index, never on `Array.prototype.sort`
 * stability alone.
 */
import { pageLayoutSchema, type LayoutItem, type PageLayout } from '../page-config/layout.js';
import type { DataShape } from '../page-config/data-shapes.js';
import { GRID_COLUMNS } from '../grid/layout-math.js';
import { pageTemplateManifests } from './manifests.js';
import { slotCapacity, type PageTemplate, type TemplateSlot } from './template-schema.js';

/** Registry id of the widget used for `fallback: 'empty-state'` slots (annex §12). */
export const EMPTY_STATE_WIDGET_ID = 'empty-state';

/**
 * Envelope `kind` per template (09-generated-app.md §3.2 mapping table). Grid-
 * composed dashboards are `kind: 'dashboard'`; every other template the
 * Generated App renders is `kind: 'page'`. Checked in rather than derived: the
 * §10 manifest schema has no `kind` field (and must not grow one — it is the
 * published contract third-party manifests are written against), and the
 * mapping is a property of the *envelope* spec, not of the template's layout.
 */
const DASHBOARD_KIND_TEMPLATES: ReadonlySet<string> = new Set(['page-dashboard', 'page-hub-home']);

/** The envelope `kind` the Engine should wrap a composed template into. */
export type ComposedPageKind = 'page' | 'dashboard';

export function templateKind(templateId: string): ComposedPageKind {
  return DASHBOARD_KIND_TEMPLATES.has(templateId) ? 'dashboard' : 'page';
}

/**
 * One ranked widget the Engine's candidate rules (04-T08/T15) emitted for this
 * page. `shape` is the contract the candidate's binding produces — it is what a
 * slot's `accepts.shapes` matches on; `widget` is what `accepts.widgets` matches
 * on. `config` is passed through verbatim into the layout item (it already
 * carries `title` + `binding`, exactly as `@adminium/engine/generate` builds
 * them today).
 */
export interface TemplateCandidate {
  /** Registry id — must be a registered widget (`ctx.isRegistered` enforces it). */
  widget: string;
  /** The data-contract shape this candidate's binding produces (04 §3). */
  shape: DataShape;
  /** Higher wins. Ties break deterministically on widget id, then input order. */
  score: number;
  /** Stored instance config (`title`, `binding`, widget-specific keys). */
  config?: Record<string, unknown>;
  /** Stable instance id; defaults to `<slot>-<n>` when omitted. */
  instanceId?: string;
}

export type ComposeWarningCode =
  /** No manifest is registered under the requested id. */
  | 'unknown-template'
  /** A `required: true` slot had no accepted candidate — composition failed. */
  | 'required-slot-unfillable'
  /** An optional slot had no accepted candidate and was dropped. */
  | 'optional-slot-omitted'
  /** An optional slot wanted `fallback: 'empty-state'` but `empty-state` is not registered yet. */
  | 'empty-state-unavailable'
  /** A candidate named a widget id the registry does not know — dropped before matching. */
  | 'candidate-unregistered'
  /** A `chrome.toolbar` / `chrome.overlays` id is not registered yet — dropped from the output. */
  | 'chrome-widget-unregistered'
  /** The composed layout failed `pageLayoutSchema` — a manifest geometry bug. */
  | 'invalid-layout';

/** A structured, localizable-by-code warning the Studio surfaces on a generation run. */
export interface ComposeWarning {
  code: ComposeWarningCode;
  templateId: string;
  slot?: string;
  widgetId?: string;
  message: string;
}

/**
 * The in-memory intermediate (04 §10). `type` is the envelope `kind` the Engine
 * must wrap this into (09 §3.2).
 */
export interface ComposedPage {
  type: ComposedPageKind;
  template: string;
  templateVersion: number;
  layout: PageLayout;
  toolbar: string[];
  overlays: string[];
}

export interface ComposeResult {
  /** `null` ⇔ a `required` slot was unfillable (or the template id is unknown). */
  page: ComposedPage | null;
  warnings: readonly ComposeWarning[];
}

export interface ComposeContext {
  /**
   * Live registry membership test. Supplying it is what keeps an unregistered id
   * — a manifest slot allow-listing a widget whose family has not shipped, or a
   * chrome id from a future wave — out of the generated page. Omitted ⇒ every id
   * is treated as registered (useful in unit tests with synthetic candidates).
   */
  isRegistered?: (widgetId: string) => boolean;
  /** Override the manifest source (marketplace templates, tests). */
  templates?: ReadonlyMap<string, PageTemplate>;
  /** Instance-id generator; defaults to `<slot>-<n>` (1-based) unless the candidate names one. */
  makeInstanceId?: (slot: string, index: number, candidate: TemplateCandidate) => string;
}

/** Does `slot.accepts` admit this candidate? (04 §10 — shape contract OR id allowlist.) */
export function slotAccepts(slot: TemplateSlot, candidate: TemplateCandidate): boolean {
  const byWidget = slot.accepts.widgets?.includes(candidate.widget) ?? false;
  const byShape = slot.accepts.shapes?.includes(candidate.shape) ?? false;
  return byWidget || byShape;
}

interface RankedCandidate {
  candidate: TemplateCandidate;
  /** Index in the caller's array — the final, total tiebreak. */
  order: number;
}

/** Total order: score desc, then widget id asc, then input order asc. */
function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  return (
    b.candidate.score - a.candidate.score ||
    a.candidate.widget.localeCompare(b.candidate.widget) ||
    a.order - b.order
  );
}

/**
 * Geometry of the n-th instance of a (possibly repeating) slot. `flow: 'row'`
 * tiles along x and wraps to a new band once the 12-column grid is full;
 * `flow: 'column'` stacks along y. A non-repeating slot always yields `area`.
 */
export function slotInstanceArea(
  slot: TemplateSlot,
  index: number,
): { x: number; y: number; w: number; h: number } {
  const { x, y, w, h } = slot.area;
  if (slot.repeat === undefined || index === 0) return { x, y, w, h };
  if (slot.repeat.flow === 'column') return { x, y: y + index * h, w, h };

  // Row flow: advance along x, wrapping back to the slot's origin column when
  // the next instance would overflow the 12-column grid.
  const perBand = Math.max(1, Math.floor((GRID_COLUMNS - x) / Math.max(1, w)));
  const band = Math.floor(index / perBand);
  const withinBand = index % perBand;
  return { x: x + withinBand * w, y: y + band * h, w, h };
}

function instanceId(
  slot: TemplateSlot,
  index: number,
  candidate: TemplateCandidate,
  ctx: ComposeContext,
): string {
  if (ctx.makeInstanceId !== undefined) return ctx.makeInstanceId(slot.slot, index, candidate);
  if (candidate.instanceId !== undefined) return candidate.instanceId;
  return slotCapacity(slot) > 1 ? `${slot.slot}-${index + 1}` : slot.slot;
}

/** Registry filter for chrome ids — an unregistered id would render `widget-missing`. */
function filterChrome(
  ids: readonly string[] | undefined,
  kind: 'toolbar' | 'overlays',
  templateId: string,
  ctx: ComposeContext,
  warnings: ComposeWarning[],
): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (ctx.isRegistered !== undefined && !ctx.isRegistered(id)) {
      warnings.push({
        code: 'chrome-widget-unregistered',
        templateId,
        widgetId: id,
        message: `Template '${templateId}' declares ${kind} widget '${id}', which is not registered; dropped from the composed page`,
      });
      continue;
    }
    out.push(id);
  }
  return out;
}

/**
 * Compose a page from a template manifest + the ranked candidates the Engine's
 * rules emitted for it.
 *
 * @param template  A registered template id, or a parsed manifest (marketplace / test).
 * @param candidates Ranked candidates; each is placed into at most one slot.
 */
export function composeTemplate(
  template: string | PageTemplate,
  candidates: readonly TemplateCandidate[],
  ctx: ComposeContext = {},
): ComposeResult {
  const warnings: ComposeWarning[] = [];

  let manifest: PageTemplate;
  if (typeof template === 'string') {
    const found = (ctx.templates ?? pageTemplateManifests).get(template);
    if (found === undefined) {
      warnings.push({
        code: 'unknown-template',
        templateId: template,
        message: `No page-template manifest registered as '${template}'`,
      });
      return { page: null, warnings };
    }
    manifest = found;
  } else {
    manifest = template;
  }
  const templateId = manifest.id;

  // Drop candidates naming an unregistered widget before any matching happens —
  // they must never reach the layout (they would render `widget-missing`).
  const pool: RankedCandidate[] = [];
  candidates.forEach((candidate, order) => {
    if (ctx.isRegistered !== undefined && !ctx.isRegistered(candidate.widget)) {
      warnings.push({
        code: 'candidate-unregistered',
        templateId,
        widgetId: candidate.widget,
        message: `Candidate widget '${candidate.widget}' is not registered; dropped before slot matching`,
      });
      return;
    }
    pool.push({ candidate, order });
  });

  const taken = new Set<number>(); // consumed `order` values — one slot per candidate
  const items: LayoutItem[] = [];
  let failed = false;

  for (const slot of manifest.slots) {
    const capacity = slotCapacity(slot);
    const picks = pool
      .filter((entry) => !taken.has(entry.order) && slotAccepts(slot, entry.candidate))
      .sort(compareCandidates)
      .slice(0, capacity);

    if (picks.length === 0) {
      if (slot.required) {
        failed = true;
        warnings.push({
          code: 'required-slot-unfillable',
          templateId,
          slot: slot.slot,
          message: `Required slot '${slot.slot}' of '${templateId}' has no accepted candidate`,
        });
        continue;
      }
      if (slot.fallback === 'empty-state') {
        if (ctx.isRegistered !== undefined && !ctx.isRegistered(EMPTY_STATE_WIDGET_ID)) {
          warnings.push({
            code: 'empty-state-unavailable',
            templateId,
            slot: slot.slot,
            widgetId: EMPTY_STATE_WIDGET_ID,
            message: `Slot '${slot.slot}' of '${templateId}' wanted an '${EMPTY_STATE_WIDGET_ID}' fallback, which is not registered; omitted instead`,
          });
          continue;
        }
        const area = slotInstanceArea(slot, 0);
        items.push({ i: slot.slot, widget: EMPTY_STATE_WIDGET_ID, ...area, config: {} });
        continue;
      }
      warnings.push({
        code: 'optional-slot-omitted',
        templateId,
        slot: slot.slot,
        message: `Optional slot '${slot.slot}' of '${templateId}' had no accepted candidate; omitted`,
      });
      continue;
    }

    picks.forEach((entry, index) => {
      taken.add(entry.order);
      items.push({
        i: instanceId(slot, index, entry.candidate, ctx),
        widget: entry.candidate.widget,
        ...slotInstanceArea(slot, index),
        config: { ...entry.candidate.config },
      });
    });
  }

  if (failed) return { page: null, warnings };

  const layout = pageLayoutSchema.safeParse({ version: 1, items });
  if (!layout.success) {
    warnings.push({
      code: 'invalid-layout',
      templateId,
      message: `Composed layout for '${templateId}' is not a valid pageLayout: ${layout.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    });
    return { page: null, warnings };
  }

  return {
    page: {
      type: templateKind(templateId),
      template: templateId,
      templateVersion: manifest.version,
      layout: layout.data,
      toolbar: filterChrome(manifest.chrome?.toolbar, 'toolbar', templateId, ctx, warnings),
      overlays: filterChrome(manifest.chrome?.overlays, 'overlays', templateId, ctx, warnings),
    },
    warnings,
  };
}
