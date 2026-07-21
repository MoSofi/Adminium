/**
 * LLM page-row materialization (06-llm-assist.md §8.3 step 3).
 *
 * The apply executor seeds `origin: 'llm'` page rows with a minimal config —
 * `{source, llmRunId}` for template pages, `{domain, tables, layout, source,
 * llmRunId}` for dashboards — and defers the full §6.1 envelope to "the
 * regeneration hook". This module IS that expansion. `runGeneration` calls it
 * after every persist, so the post-apply hook AND any manual regeneration
 * repair seed rows into envelopes the client can parse; `upsertGenerated`
 * itself never touches non-generated origins (user delta wins, 04 §6.3), so
 * without this pass a seed row would stay an invalid-config card forever.
 *
 * Failure is per-row and non-fatal: a table that is excluded from the run, a
 * template whose required slot cannot fill, or an envelope the frozen contract
 * rejects leaves the seed's config untouched, records a warning on the run,
 * and DISABLES the row — a parked page beats the invalid-config card the
 * client would otherwise render forever. Every later run retries; success
 * re-enables.
 *
 * A successful expansion also syncs the ROW's nav projection (title, nav
 * group, icon back-fill) from the validated envelope: the bootstrap tree and
 * the client's `/p/$slug` resolver read the row columns, not the document, so
 * without the sync a materialized llm page would stay invisible and
 * unreachable. An §8.3 nav-group re-placement still wins — the envelope
 * follows the row's group when one was stamped.
 */

import { composeRequestedArchetype, hashEnvelope, type DatabaseModel } from '@adminium/engine';
import { pageEnvelopeSchema, widgetConfigSchema } from '@adminium/engine/config';
import { pagesRepo, type MetaDb, type Page } from '@adminium/meta';

export interface MaterializeLlmResult {
  /** Page ids whose seed config became a validated envelope this run. */
  materialized: string[];
  warnings: string[];
}

/** A stored config counts as materialized once it carries the envelope `v`. */
function isEnvelope(config: unknown): boolean {
  return typeof config === 'object' && config !== null && 'v' in (config as Record<string, unknown>);
}

function seedOf(page: Page): Record<string, unknown> {
  return typeof page.config === 'object' && page.config !== null
    ? (page.config as Record<string, unknown>)
    : {};
}

/** The seed's bound table (`config.source.table`), or null. */
function seedTable(seed: Record<string, unknown>): string | null {
  const source = seed['source'];
  if (typeof source !== 'object' || source === null) return null;
  const table = (source as Record<string, unknown>)['table'];
  return typeof table === 'string' ? table : null;
}

/** Compose the §14 archetype envelope a template-page seed asked for. */
function templateEnvelope(
  page: Page,
  seed: Record<string, unknown>,
  model: DatabaseModel,
  connectionId: string,
): { envelope: Record<string, unknown> | null; reason: string } {
  const table = seedTable(seed);
  if (table === null) return { envelope: null, reason: 'seed carries no source.table' };
  const built = composeRequestedArchetype(model, table, page.type, {
    connectionId,
    slug: page.slug,
    id: page.id,
    navOrder: page.navOrder,
  });
  if (built.envelope === null) {
    const detail = built.warnings.map((w) => w.message).join('; ');
    return {
      envelope: null,
      reason: detail || `table ${table} is not part of this run (excluded/system/join)`,
    };
  }
  // The row's nav column is authoritative for the tree; a §8.3 nav-group write
  // may have re-placed the row after seeding, so the envelope follows the row.
  const nav = built.envelope['nav'] as Record<string, unknown>;
  if (page.navGroup !== null) nav['group'] = page.navGroup;
  return { envelope: built.envelope, reason: '' };
}

/** Wrap a dashboard seed's bound layout (§8.3 `dashboard`+`widget`) per §6.1. */
function dashboardEnvelope(
  page: Page,
  seed: Record<string, unknown>,
  connectionId: string,
): { envelope: Record<string, unknown> | null; reason: string } {
  const layout = seed['layout'];
  if (typeof layout !== 'object' || layout === null) {
    return { envelope: null, reason: 'seed carries no config.layout' };
  }
  return {
    reason: '',
    envelope: {
      v: 1,
      kind: 'dashboard',
      id: page.id,
      template: 'page-dashboard',
      title: { key: `nav.${page.slug}`, fallback: page.title },
      source: { connectionId, table: null },
      nav: {
        group: page.navGroup ?? 'workspace',
        icon: page.icon ?? 'layout-dashboard',
        order: page.navOrder,
        slug: page.slug,
      },
      access: { minRole: 'viewer', permissions: [] },
      config: {
        domain: seed['domain'] ?? null,
        tables: seed['tables'] ?? [],
        layout,
      },
    },
  };
}

/**
 * Expand every still-seed `origin: 'llm'` page row of a connection into a
 * validated §6.1 envelope. Idempotent — materialized rows (config carries `v`)
 * are never re-touched, so a user's later layout edits survive regeneration.
 */
export async function materializeLlmPages(opts: {
  meta: MetaDb;
  model: DatabaseModel;
  connectionId: string;
  at?: number | undefined;
}): Promise<MaterializeLlmResult> {
  const repo = pagesRepo(opts.meta);
  const result: MaterializeLlmResult = { materialized: [], warnings: [] };

  /** Park a seed that cannot compose: warn + hide it from nav/GET until a run succeeds. */
  const park = async (page: Page, reason: string): Promise<void> => {
    result.warnings.push(
      `llm page ${page.id} (${page.slug}) not materialized — ${reason}; page disabled until a regeneration can compose it`,
    );
    if (page.isEnabled) {
      await repo.setEnabled(page.id, false, opts.at ?? Date.now());
    }
  };

  for (const page of await repo.listForConnection(opts.connectionId)) {
    if (page.origin !== 'llm' || isEnvelope(page.config)) continue;
    const seed = seedOf(page);
    const { envelope, reason } =
      page.type === 'page-dashboard'
        ? dashboardEnvelope(page, seed, opts.connectionId)
        : templateEnvelope(page, seed, opts.model, opts.connectionId);
    if (envelope === null) {
      await park(page, reason);
      continue;
    }

    // Provenance survives the expansion; the hash goes on last (it excludes
    // only itself), then the frozen contract gets the final word.
    const config = envelope['config'] as Record<string, unknown>;
    config['llmRunId'] = seed['llmRunId'] ?? null;
    config['generatedHash'] = hashEnvelope(envelope);
    const parsed = pageEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      await park(page, `envelope invalid: ${first?.message ?? 'unknown'}`);
      continue;
    }
    if (parsed.data.kind === 'dashboard') {
      const layout = parsed.data.config['layout'] as { items: unknown[] };
      const bad = layout.items.find((item) => !widgetConfigSchema.safeParse(item).success);
      if (bad !== undefined) {
        await park(page, 'a layout item fails the widget contract');
        continue;
      }
    }

    // Sync the row's nav projection (title/group/icon) from the envelope: the
    // bootstrap tree and the `/p/$slug` resolver read the ROW columns, so a
    // seed left with its apply-time `nav_group` (null, or an §8.3 llm group
    // slug) would materialize into an unreachable page. The envelope already
    // encodes the §8.3 precedence — a nav-group write on the row wins,
    // otherwise the archetype's fixed group — so the row simply follows it.
    const icon = (envelope['nav'] as Record<string, unknown>)['icon'];
    await repo.replaceConfig(page.id, parsed.data, {
      icon: typeof icon === 'string' ? icon : null,
      title: parsed.data.title.fallback,
      navGroup: parsed.data.nav.group,
      ...(opts.at === undefined ? {} : { at: opts.at }),
    });
    if (!page.isEnabled) {
      await repo.setEnabled(page.id, true, opts.at ?? Date.now());
    }
    result.materialized.push(page.id);
  }

  return result;
}
