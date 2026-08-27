// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-crud` envelope generation — one per included table (research/
 * widget-registry.md §14: "Every included table"; 01-architecture.md §6.1
 * fixes the config body shape: `columns[]`, `defaultSort`, `pageSize`,
 * `detail`).
 *
 * The body vocabulary — column selection, tones, form-field mapping — lives in
 * `@adminium/widgets/generate` (`composeCrudBody`; 04 §8: the Registry owns
 * what a generated page contains). This module keeps only what the leaf cannot
 * know: slug/id allocation, nav placement, and the §6.1 envelope wrap. Inputs
 * arrive pre-adapted through `./archetype.ts`'s `toCandidateModel` — the single
 * place the engine and registry vocabularies meet.
 */

import {
  composeCrudBody,
  type CandidateRelation,
  type CandidateTableInput,
} from '@adminium/widgets/generate';

import { humanize, pageIdFor } from './util.js';

/**
 * The §7.1 rule-7 tone map moved into the leaf with the rest of the body
 * vocabulary; re-exported because the generate surface is public API of the
 * self-host package (`@adminium/engine` root re-exports this module).
 */
export { enumTones, type CrudEnumTone } from '@adminium/widgets/generate';

export interface CrudBuildContext {
  connectionId: string | null;
  slug: string;
  navGroup: 'workspace' | 'library' | 'planning' | 'people' | 'account';
  navIcon: string;
  navOrder: number;
  /**
   * Emit `nav.hidden` — the cascade-owned-child default (see
   * `isCascadeOwnedChild` in generate/index.ts). `navGroup` is still required:
   * hidden is a sidebar fact, not a homelessness fact.
   */
  navHidden?: boolean;
  /** read-only-analytics intent, no-PK tables, and views render read-only. */
  readOnly: boolean;
  /** Tables included in this generation run (detail tabs only link these). */
  includedTableIds: ReadonlySet<string>;
  /** Every model relation — the leaf derives detail tabs from the inbound ones. */
  relations: readonly CandidateRelation[];
  /**
   * Referenced-table display columns (tableId → column name) — the leaf stamps
   * `fk.display` from it so FK chips show names, not raw ids
   * (`crudDisplayColumns` over the included candidate model builds it).
   */
  displayColumns?: ReadonlyMap<string, string> | undefined;
}

/** Build the (unhashed, unvalidated) `page-crud` envelope for one table. */
export function buildCrudEnvelope(
  entry: CandidateTableInput,
  ctx: CrudBuildContext,
): Record<string, unknown> {
  const { table, classified } = entry;
  const body = composeCrudBody(table, classified, {
    readOnly: ctx.readOnly,
    includedTableIds: ctx.includedTableIds,
    relations: ctx.relations,
    displayColumns: ctx.displayColumns,
  });

  return {
    v: 1,
    kind: 'page',
    id: pageIdFor(ctx.connectionId, ctx.slug),
    template: 'page-crud',
    title: { key: `nav.${ctx.slug}`, fallback: table.label ?? humanize(table.name) },
    source: { connectionId: ctx.connectionId, table: table.id },
    nav: {
      group: ctx.navGroup,
      icon: ctx.navIcon,
      order: ctx.navOrder,
      slug: ctx.slug,
      ...(ctx.navHidden === true ? { hidden: true } : {}),
    },
    access: {
      minRole: 'viewer',
      permissions: [`table:${table.id}:read`],
    },
    config: { ...body },
  };
}
