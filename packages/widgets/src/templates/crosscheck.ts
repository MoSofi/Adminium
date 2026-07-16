/**
 * Registry cross-check for page-template manifests.
 *
 * A manifest is JSON: nothing in the type system stops it naming a widget id
 * that does not exist. Two failure modes follow, with very different blast
 * radii, so this module grades them:
 *
 *   - **A `required: true` slot NO registered widget can fill** is fatal. No
 *     candidate can ever carry an unregistered id, so if every id the slot
 *     allow-lists is unregistered *and* it accepts no shape, the slot is
 *     permanently unfillable and `composeTemplate` returns `page: null` — the
 *     template is dead on arrival, for every schema, forever. This is graded per
 *     SLOT, not per id: a required slot that also accepts a registered widget (or
 *     any `accepts.shapes` entry) still fills, so a single pending id among its
 *     accepts is inert — and that is precisely the ahead-of-delivery workflow
 *     `PENDING_TEMPLATE_WIDGET_IDS` exists to support.
 *   - **An *optional* slot (or `chrome`) naming an unregistered id** is inert.
 *     Optional slot allowlists are matched against candidates, and candidates
 *     only ever carry registered ids, so the slot simply never fills and is
 *     omitted; chrome ids are filtered by `composeTemplate` before they reach
 *     the output. These are how a manifest records the annex §14 composition
 *     ahead of the family that implements it.
 *
 * The inert case is therefore *allowed but must be declared*: every such id
 * lives in `PENDING_TEMPLATE_WIDGET_IDS` below with the family that will deliver
 * it. This is the `qa/annex-catalog.ts` `WAVE1_PENDING` discipline — the list is
 * a checked-in expectation, so BOTH an undeclared unregistered id AND a stale
 * entry (an id that has since been registered) fail the gate, forcing the list
 * to shrink to empty as the families land. An id that is neither registered nor
 * declared is always an error, wherever it appears.
 */
import type { PageTemplate } from './template-schema.js';

/**
 * Annex §14 widget ids referenced by a shipped manifest whose family has not
 * been built yet, mapped to the family that will deliver them. Every one appears
 * only in an optional slot (`fallback: 'omit'`) or in `chrome`, both of which
 * degrade to nothing at compose time. Delete an entry the moment its widget
 * registers — `crosscheck.test.ts` fails on stale entries.
 */
export const PENDING_TEMPLATE_WIDGET_IDS: Readonly<Record<string, string>> = {
  // NOTE: the forms (§10) and chrome (§11) entries that used to live here —
  // filter-chip-bar, modal-wizard, segmented-control, breadcrumb, global-search,
  // tab-bar — were delivered by Track FCS in M7 Wave 3 and are now registered,
  // so they were removed per the shrink-to-empty discipline above.
  // NOTE: the kpi (§1) entries — auto-insights, micro-kpi-subtitle,
  // stat-pair-card — and the feeds (§4) overlay `toast-stack` were delivered by
  // TRACK KPI-FEEDS in M7 Wave 4 and are now registered, so they were removed
  // per the same discipline (`crosscheck.test.ts` fails on a stale entry —
  // `stale-pending-entry` — which is what forced this edit). Their manifest
  // sites needed no change: the slots were already holding open with
  // `fallback: 'omit'` / sitting in `chrome`, so registering the ids is what
  // fills them.
  // NOTE: the calendar (§5) entries — calendar-legend-filter, date-range-picker,
  // upcoming-events-list — and the boards (§6) inline-compose-card were
  // delivered by TRACK TABLES-CAL-BOARDS in M7 Wave 4 and are now registered, so
  // they were removed per the shrink-to-empty discipline above. Their manifest
  // sites needed no edit: page-calendar's `legend`/`upcoming` and page-board's
  // `compose` were already holding the slots open with `fallback: 'omit'`, and
  // the pickers were already listed in the calendar/scheduler/log-viewer/
  // dashboard toolbars — registering the ids is what fills them.
  // NOTE: `call-widget` (§9, page-chat's optional `call` slot) was delivered by
  // TRACK COMM-GEO in M7 Wave 4 and is now registered, so it was removed per the
  // shrink-to-empty discipline above — `crosscheck.test.ts` fails on a stale
  // entry (`stale-pending-entry`), which is what forced this edit.

  // §13, referenced by `page-builder`'s `chrome.overlays` (TRACK BUILDER, M7
  // Wave 4). The modal starter picker is the one id in the §14 `page-builder`
  // composition the document half does not deliver — TRACK OPS owns it, in the
  // same wave. Declared here so the manifest can record the annex composition
  // ahead of it: `composeTemplate` filters unregistered chrome ids before they
  // reach the output, so until it registers the picker simply does not mount.
  // TRACK OPS: delete this line when `starter-template-picker` registers —
  // `crosscheck.test.ts` fails on the stale entry and will point you here.
  'starter-template-picker': 'domain',
};

export type CrossCheckCode =
  /** A `required: true` slot no registered widget and no shape can fill. */
  | 'required-slot-unregistered'
  /** An unregistered id nowhere declared in `PENDING_TEMPLATE_WIDGET_IDS`. */
  | 'unregistered-widget'
  /** A declared-pending id that is now registered — delete it from the list. */
  | 'stale-pending-entry'
  /** A slot with neither `accepts.shapes` nor `accepts.widgets`: nothing can fill it. */
  | 'slot-accepts-nothing'
  /** A pending id used somewhere `composeTemplate` cannot degrade it away. */
  | 'pending-id-not-degradable';

export interface CrossCheckIssue {
  code: CrossCheckCode;
  templateId: string;
  slot?: string;
  widgetId?: string;
  message: string;
}

/** Where in a manifest an id was referenced, with everything grading it needs. */
type Site =
  | { kind: 'slot'; slot: string; degradesToNothing: boolean }
  | { kind: 'chrome'; slot: string };

function sitesOf(
  manifest: PageTemplate,
  isRegistered: (widgetId: string) => boolean,
): { site: Site; widgetId: string }[] {
  const out: { site: Site; widgetId: string }[] = [];
  for (const slot of manifest.slots) {
    const widgets = slot.accepts.widgets ?? [];
    // A pending id in this slot is never load-bearing if the slot can still
    // resolve without it: it omits rather than empty-states, OR it accepts a
    // shape (reachable by other candidates), OR it allow-lists some OTHER widget
    // that IS registered. Only a slot with none of those holds space for a widget
    // that cannot render.
    const degradesToNothing =
      slot.fallback === 'omit' ||
      (slot.accepts.shapes ?? []).length > 0 ||
      widgets.some((widgetId) => isRegistered(widgetId));
    for (const widgetId of widgets) {
      out.push({ site: { kind: 'slot', slot: slot.slot, degradesToNothing }, widgetId });
    }
  }
  for (const widgetId of manifest.chrome?.toolbar ?? []) {
    out.push({ site: { kind: 'chrome', slot: 'chrome.toolbar' }, widgetId });
  }
  for (const widgetId of manifest.chrome?.overlays ?? []) {
    out.push({ site: { kind: 'chrome', slot: 'chrome.overlays' }, widgetId });
  }
  return out;
}

/**
 * Cross-check one manifest against the live registry.
 *
 * @param isRegistered membership test against the assembled `widgetRegistry`.
 * @returns issues, empty when the manifest is clean.
 */
export function crossCheckTemplate(
  manifest: PageTemplate,
  isRegistered: (widgetId: string) => boolean,
  pending: Readonly<Record<string, string>> = PENDING_TEMPLATE_WIDGET_IDS,
): CrossCheckIssue[] {
  const issues: CrossCheckIssue[] = [];
  /** Slots already reported as structurally dead — their ids need no further grading. */
  const deadSlots = new Set<string>();

  for (const slot of manifest.slots) {
    const shapes = slot.accepts.shapes ?? [];
    const widgets = slot.accepts.widgets ?? [];
    if (shapes.length === 0 && widgets.length === 0) {
      issues.push({
        code: 'slot-accepts-nothing',
        templateId: manifest.id,
        slot: slot.slot,
        message: `Slot '${slot.slot}' of '${manifest.id}' declares neither accepts.shapes nor accepts.widgets, so no candidate can ever fill it`,
      });
      deadSlots.add(slot.slot);
      continue;
    }
    // Fatal only when NOTHING can fill the slot: no shape-accept, and every
    // allow-listed widget unregistered. One pending id beside a registered
    // sibling is inert — `composeTemplate` just never matches it.
    if (!slot.required) continue;
    if (shapes.length > 0 || widgets.some((widgetId) => isRegistered(widgetId))) continue;
    issues.push({
      code: 'required-slot-unregistered',
      templateId: manifest.id,
      slot: slot.slot,
      widgetId: widgets[0] as string,
      message: `Required slot '${slot.slot}' of '${manifest.id}' accepts no shapes and allow-lists only unregistered widgets (${widgets
        .map((widgetId) => `'${widgetId}'`)
        .join(', ')}); the slot can never be filled`,
    });
    deadSlots.add(slot.slot);
  }

  for (const { site, widgetId } of sitesOf(manifest, isRegistered)) {
    // The slot's own verdict already covers every id it lists — one issue per
    // reference, as before.
    if (site.kind === 'slot' && deadSlots.has(site.slot)) continue;
    if (isRegistered(widgetId)) {
      if (Object.hasOwn(pending, widgetId)) {
        issues.push({
          code: 'stale-pending-entry',
          templateId: manifest.id,
          slot: site.slot,
          widgetId,
          message: `'${widgetId}' is now registered — remove it from PENDING_TEMPLATE_WIDGET_IDS`,
        });
      }
      continue;
    }

    if (!Object.hasOwn(pending, widgetId)) {
      issues.push({
        code: 'unregistered-widget',
        templateId: manifest.id,
        slot: site.slot,
        widgetId,
        message: `'${manifest.id}' references unregistered widget '${widgetId}' at ${site.slot}; register it, remove the reference, or declare it in PENDING_TEMPLATE_WIDGET_IDS`,
      });
      continue;
    }

    // Declared-pending in an optional slot — clean only if the slot actually
    // degrades to nothing. A slot that empty-states instead would hold space for
    // a widget that cannot render.
    if (site.kind === 'slot' && !site.degradesToNothing) {
      issues.push({
        code: 'pending-id-not-degradable',
        templateId: manifest.id,
        slot: site.slot,
        widgetId,
        message: `Slot '${site.slot}' of '${manifest.id}' only accepts pending widget '${widgetId}' but does not fall back to 'omit'`,
      });
    }
  }

  return issues;
}

/** Cross-check every shipped manifest; the CI gate asserts this is empty. */
export function crossCheckTemplates(
  manifests: Iterable<PageTemplate>,
  isRegistered: (widgetId: string) => boolean,
  pending: Readonly<Record<string, string>> = PENDING_TEMPLATE_WIDGET_IDS,
): CrossCheckIssue[] {
  return [...manifests].flatMap((manifest) => crossCheckTemplate(manifest, isRegistered, pending));
}
