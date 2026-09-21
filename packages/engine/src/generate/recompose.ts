// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recompose ONE page against a chosen table — the Studio page editor's
 * "change the data this page shows" write.
 *
 * `generatePages` composes the whole app from a snapshot and decides every
 * template itself. `composeRequestedArchetype` composes one page but only for
 * the nine archetypes, because it delegates to `buildArchetypeEnvelope`,
 * which returns null for anything outside `ARCHETYPE_NAV`. Neither serves an
 * admin who picked `page-crud` for a table by hand, which is the most common
 * thing to pick.
 *
 * This is the missing third entry point: same classify → candidates → compose
 * prelude those two share, dispatching to `buildCrudEnvelope` for `page-crud`
 * and `buildArchetypeEnvelope` for the archetypes. It exists so the server can
 * rebuild a page's body from live schema instead of leaving hand-created pages
 * permanently empty.
 *
 * NOT every template is table-bound. `page-dashboard` composes from a DOMAIN
 * (a cluster of tables) rather than one table and is edited widget-by-widget in
 * the dashboard builder; `page-builder`, `page-wizard` and `page-settings` are
 * tool surfaces whose bodies the renderers ignore. Asking for those returns
 * `bindable: false` with a null envelope, so the caller can keep whatever the
 * page already had rather than blanking it.
 */

import {
  crudDisplayColumns,
  emitCandidates,
  isRegisteredWidgetId,
  type CandidateContext,
} from '@adminium/widgets/generate';

import type { ClassifiedTable } from '../classify/index.js';
import { isTableBoundTemplate } from '../config-schema/table-bound.js';
import type { DatabaseModel } from '../schema-model.js';
import { buildArchetypeEnvelope } from './archetype.js';
import { buildCrudEnvelope } from './crud.js';
import { bindableSet } from './fit.js';
import { TITLE_THROUGH_TEMPLATES, applyTitleThrough, titleThroughEntry } from './title-through.js';

export { TABLE_BOUND_TEMPLATES, isTableBoundTemplate } from '../config-schema/table-bound.js';

export interface RecomposeContext {
  connectionId: string;
  slug: string;
  /** The page's existing id — the envelope embeds it, and it must not change. */
  id: string;
  navGroup: 'workspace' | 'library' | 'planning' | 'people' | 'account';
  navIcon: string;
  navOrder: number;
  /** Views and PK-less tables compose read-only regardless of this. */
  readOnly?: boolean;
  isRegistered?: (id: string) => boolean;
  /**
   * Title each row through this FK column of the bound table (remedy 2): the
   * referenced table's display column arrives as a lookup, and the calendar's
   * composer writes the key. Calendar only; absent ⇒ the table's own title.
   */
  titleThrough?: string | undefined;
}

export interface RecomposeResult {
  /** Null when the template is not table-bound, or composition failed. */
  envelope: Record<string, unknown> | null;
  /** False ⇒ the caller should keep the page's current body untouched. */
  bindable: boolean;
  /** Why `envelope` is null, when it is and the template WAS bindable. */
  reason: string;
}

export function composeRequestedPage(
  model: DatabaseModel,
  tableId: string,
  template: string,
  ctx: RecomposeContext,
): RecomposeResult {
  if (!isTableBoundTemplate(template)) {
    return { envelope: null, bindable: false, reason: '' };
  }

  // The prelude comes from `./fit.ts` rather than being repeated here: it is
  // what decides which tables can carry a page (`generatePages`' own splitTables
  // rule — system and join tables never earn one), and `templateFit` PREDICTS
  // this function's outcome. Two copies of the include rule would let the
  // prediction and the composition disagree about the same table.
  const { tables, candidateModel } = bindableSet(model);
  const table = tables.find((t) => t.id === tableId);
  if (table === undefined) {
    return {
      envelope: null,
      bindable: true,
      reason: `table ${tableId} is not available (excluded from this connection, or a system/join table)`,
    };
  }

  const isRegistered = ctx.isRegistered ?? isRegisteredWidgetId;
  const entry = candidateModel.find((e) => e.table.id === tableId);
  if (entry === undefined) {
    return { envelope: null, bindable: true, reason: `table ${tableId} could not be classified` };
  }

  if (template === 'page-crud') {
    const envelope = buildCrudEnvelope(entry, {
      connectionId: ctx.connectionId,
      slug: ctx.slug,
      navGroup: ctx.navGroup,
      navIcon: ctx.navIcon,
      navOrder: ctx.navOrder,
      readOnly: ctx.readOnly ?? false,
      // Detail tabs may only link tables that actually have pages. Every
      // non-system table of this connection qualifies — the generator emits a
      // page-crud for each — so the full set is the honest allowlist here.
      includedTableIds: new Set(tables.map((t) => t.id)),
      relations: model.relations,
      displayColumns: crudDisplayColumns(candidateModel),
    });
    // `CrudBuildContext` has no `id`: the generator derives one with
    // `pageIdFor(connectionId, slug)` because it is MINTING pages. Here the
    // page already exists and is stored under `ctx.id`, so letting the derived
    // id through would leave the document claiming to be a different page than
    // the row holding it. `buildArchetypeEnvelope` already accepts `ctx.id`;
    // this is the crud path catching up.
    return { bindable: true, reason: '', envelope: { ...envelope, id: ctx.id } };
  }

  const candidateCtx: CandidateContext = {
    connectionId: ctx.connectionId,
    model: candidateModel,
    isRegistered,
  };
  let composedEntry = entry;
  let through: ReturnType<typeof titleThroughEntry> | null = null;
  if (ctx.titleThrough !== undefined) {
    if (!TITLE_THROUGH_TEMPLATES.includes(template)) {
      return {
        envelope: null,
        bindable: true,
        reason: `a ${template} cannot take its title through a foreign key`,
      };
    }
    through = titleThroughEntry(entry, candidateModel, ctx.titleThrough, ctx.connectionId);
    if ('reason' in through) return { envelope: null, bindable: true, reason: through.reason };
    composedEntry = through.entry;
  }
  const candidates = emitCandidates(composedEntry.table, composedEntry.classified, candidateCtx);
  const built = buildArchetypeEnvelope(
    table,
    { template, score: 0, reasons: ['chosen in Studio → Pages'] },
    candidates,
    { ...ctx, isRegistered },
  );
  if (built.envelope === null) {
    const detail = built.warnings.map((w) => w.message).join('; ');
    return {
      envelope: null,
      bindable: true,
      reason: detail || `this table has no columns the ${template} layout can bind`,
    };
  }
  return {
    envelope:
      through === null || 'reason' in through
        ? built.envelope
        : applyTitleThrough(built.envelope, through),
    bindable: true,
    reason: '',
  };
}

/** Re-export so callers need one import for the classified-table type. */
export type { ClassifiedTable };
