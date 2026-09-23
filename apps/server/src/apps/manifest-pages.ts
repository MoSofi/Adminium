// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's declared pages, written into Adminium when it is installed or
 * updated.
 *
 * An app manifest has always declared `pages`, and nothing on the server read
 * them: an app installed its tables and its own surface, and the pages its
 * manifest listed — a calendar over its appointments, a list of its services —
 * simply never appeared. This builds them, each composed from the app's REAL
 * table by the same pipeline the create screen uses, so an app's calendar is
 * the same calendar an operator would have built by hand.
 *
 * ─── Provenance and edits ─────────────────────────────────────────────────
 *
 * Each page is stored with `origin: 'manifest'` and the installed row's id —
 * the vocabulary the pages table has carried since it was created and nothing
 * wrote. The document carries `config.generatedHash`, the generator's own
 * "untouched since I made it" stamp, so an UPDATE can tell the two apart:
 * a page nobody edited is recomposed for the new version, and a page someone
 * edited is left exactly as they left it. Uninstall does not touch pages.
 *
 * ─── Where they live ──────────────────────────────────────────────────────
 *
 * In the app's own sidebar section: the row's group is `app`, and the group
 * the manifest names (`manage`, `records`) is kept in the document's
 * `nav.group`, where the section reads it. A page's form and an Overview's
 * layout come from the manifest, bound to the real tables
 * (`manifest-page-config.ts`), and are part of what the stamp covers.
 *
 * ─── What never blocks an install ─────────────────────────────────────────
 *
 * A page that cannot be built — no binding, a table that cannot back its
 * template, an unknown template, a slug someone else's page already has — is
 * REPORTED and the install goes on. Every released app shipped before pages
 * were read; refusing them now would break installs that worked. An unbound
 * page is still created, and shows the "this page has no table" notice that
 * leads to the fix. An app's own CI is where these are refused
 * (`checkManifestPages`).
 */

import {
  composeRequestedPage,
  isKnownPageTemplate,
  isTableBoundTemplate,
  pageSourceTable,
  parseDatabaseModel,
  type DatabaseModel,
} from '@adminium/engine';
import type { Manifest } from '@adminium/manifest';
import { BUILTIN_NAV_GROUP_KEYS } from '@adminium/add-on-contracts';
import { newId, overridesRepo, pagesRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';

import { bindForm, bindLayout } from './manifest-page-config.js';
import { applyCompositionOverrides, applyOverrides, withEffectiveLabels } from '../connections/effective-schema.js';
import { SnapshotView } from '../crud/identifiers.js';
import { isUntouched, stamped } from '../pages/generated-stamp.js';
import { seedPageGrants } from '../pages/page-grants.js';
import { buildUserPageEnvelope } from '../routes/pages/envelope.js';

type NavGroup = (typeof BUILTIN_NAV_GROUP_KEYS)[number];

export interface ManifestPageSkip {
  page: string;
  reason:
    | 'PAGE_TEMPLATE_UNKNOWN'
    | 'PAGE_SLUG_TAKEN'
    | 'PAGE_UNBOUND'
    | 'PAGE_BINDING_UNKNOWN'
    | 'PAGE_UNFIT'
    // Created, without the form or layout the manifest gave it.
    | 'PAGE_FORM_INVALID'
    | 'PAGE_LAYOUT_INVALID';
  message: string;
}

export interface MaterialiseResult {
  /** Slugs of pages created. */
  created: string[];
  /** Untouched pages rebuilt for this version. */
  recomposed: string[];
  /** Pages an operator edited, left as they are. */
  kept: string[];
  /**
   * Pages not built, or built without a table, and why. An entry with reason
   * `PAGE_UNBOUND`/`PAGE_UNFIT`/`PAGE_BINDING_UNKNOWN` WAS created — as an
   * empty page that shows the "no table" notice.
   */
  warnings: ManifestPageSkip[];
}

export interface MaterialiseInput {
  meta: MetaDb;
  manifest: Manifest;
  /** The installed app row the pages belong to. */
  manifestRowId: string;
  connectionId: string | null;
  createdBy: string | null;
  /**
   * Short name → real table, for an app whose tables are prefixed or recorded
   * under other names. A page binds the manifest's short name; the snapshot
   * knows only real ones. Absent, the two are the same.
   */
  names?: Readonly<Record<string, string>> | undefined;
}

/**
 * The built-in group a page's composition is made with. The page itself lives
 * in the app's section (`app`); this only feeds the generator, which composes
 * for one of the five groups.
 */
function navGroupFor(requested: string, template: string): NavGroup {
  if ((BUILTIN_NAV_GROUP_KEYS as readonly string[]).includes(requested)) return requested as NavGroup;
  if (template === 'page-calendar' || template === 'page-board' || template === 'page-scheduler') {
    return 'planning';
  }
  if (template === 'page-directory') return 'people';
  if (template === 'page-dashboard' || template === 'page-queue-inbox') return 'workspace';
  return 'library';
}

async function compositionModel(
  meta: MetaDb,
  connectionId: string,
): Promise<{ model: DatabaseModel; view: SnapshotView } | null> {
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  if (snapshot === null) return null;
  const overrides = await overridesRepo(meta).listForConnection(connectionId, { status: 'active' });
  const base = parseDatabaseModel(snapshot.schema);
  return {
    // Named as the app and the operator name its tables and columns.
    model: withEffectiveLabels(applyCompositionOverrides(base, overrides), overrides),
    // What a form's relations are read through, as the data routes read them.
    view: new SnapshotView(connectionId, applyOverrides(base, overrides)),
  };
}

/** Every manifest row's id → its app key; a page's `manifestId` names one of these, or nothing. */
async function pageOwners(meta: MetaDb): Promise<Map<string, string>> {
  const rows = await meta.db.selectFrom('adminium_manifests').select(['id', 'manifestKey']).execute();
  return new Map(rows.map((row) => [row.id, row.manifestKey]));
}

/**
 * Whether a page holding a slug is this app's to rebuild.
 *
 * It must be a manifest page, and belong to this app: named by this install's
 * row, or by another row of the same app key, or — for a page an earlier
 * uninstall orphaned (its row is gone) — stamped with this app's key. An
 * orphan written before pages carried the key is taken to be this app's: its
 * slug came from this app's manifest in the first place.
 *
 * Before this, ANY manifest page with the slug was rebuilt, so installing a
 * second app with a page called `payments` took over the first app's.
 */
export function isThisAppsPage(
  holder: { origin: string; manifestId: string | null; config?: unknown },
  appKey: string,
  manifestRowId: string,
  owners: ReadonlyMap<string, string>,
): boolean {
  if (holder.origin !== 'manifest') return false;
  if (holder.manifestId === manifestRowId) return true;
  const owner = holder.manifestId === null ? undefined : owners.get(holder.manifestId);
  if (owner !== undefined) return owner === appKey;
  const stamped = envelopeAppKey(holder.config);
  return stamped === null || stamped === appKey;
}

/** The app key a page's envelope carries, or null for a page written before it did. */
export function envelopeAppKey(config: unknown): string | null {
  const parsed: unknown = typeof config === 'string' ? safeParse(config) : config;
  if (typeof parsed !== 'object' || parsed === null) return null;
  const app = (parsed as Record<string, unknown>)['app'];
  return typeof app === 'string' ? app : null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function materialiseManifestPages(input: MaterialiseInput): Promise<MaterialiseResult> {
  const { meta, manifest, connectionId } = input;
  const pages = pagesRepo(meta);
  const result: MaterialiseResult = { created: [], recomposed: [], kept: [], warnings: [] };
  // Only an app declares engine pages; an add-on's `addOn.pages` are its own
  // bundle's screens, a different thing entirely.
  const declared = manifest.kind === 'app' ? (manifest.pages ?? []) : [];
  if (declared.length === 0) return result;

  const composed = connectionId === null ? null : await compositionModel(meta, connectionId);
  const model = composed?.model ?? null;
  const names = input.names ?? {};
  const all = await pages.listAll();
  const owners = await pageOwners(meta);

  for (const page of declared) {
    const template = page.template;
    const bound = isTableBoundTemplate(template);
    if (!isKnownPageTemplate(template)) {
      result.warnings.push({
        page: page.ref,
        reason: 'PAGE_TEMPLATE_UNKNOWN',
        message: `"${template}" is not a page template this server knows`,
      });
      continue;
    }

    const slug = page.ref;
    // Slugs are unique per CONNECTION, so that is where a clash can be.
    const holder = all.find((row) => row.slug === slug && row.connectionId === connectionId);
    // An orphan's envelope says whose it was; nothing else does.
    const orphan =
      holder !== undefined && holder.origin === 'manifest' && !owners.has(holder.manifestId ?? '')
        ? await pages.findById(holder.id)
        : null;
    if (
      holder !== undefined &&
      !isThisAppsPage({ ...holder, config: orphan?.config }, manifest.key, input.manifestRowId, owners)
    ) {
      // Somebody else's page — the operator's, or another app's. Never
      // clobbered; the app's page is just not built.
      // The install check refuses another app's page before it gets here.
      result.warnings.push({
        page: page.ref,
        reason: 'PAGE_SLUG_TAKEN',
        message: `a page at /p/${slug} already exists and is not this app's`,
      });
      continue;
    }

    const navGroup = navGroupFor(page.nav.group, template);
    // The app's section, whatever the manifest calls the group within it.
    const rowGroup = manifest.kind === 'app' ? 'app' : navGroup;
    const title = page.title.fallback;
    const id = holder?.id ?? newId('page');

    // The table this page reads, as the snapshot names it.
    const shortRef = bound ? pageSourceTable(page) : null;
    const tableRef = shortRef === null ? null : (input.names?.[shortRef] ?? shortRef);
    const tableId =
      tableRef === null || model === null
        ? null
        : (model.tables.find((t) => t.name === tableRef)?.id ?? null);

    let envelope: Record<string, unknown> | null = null;
    if (bound && tableRef === null) {
      result.warnings.push({
        page: page.ref,
        reason: 'PAGE_UNBOUND',
        message: 'the manifest binds this page to no table, so it was created empty',
      });
    } else if (bound && tableId === null) {
      result.warnings.push({
        page: page.ref,
        reason: 'PAGE_BINDING_UNKNOWN',
        message: `"${String(tableRef)}" is not a table of this connection, so the page was created empty`,
      });
    } else if (bound && connectionId !== null && model !== null && tableId !== null) {
      const built = composeRequestedPage(model, tableId, template, {
        connectionId,
        slug,
        id,
        navGroup,
        navIcon: page.nav.icon,
        navOrder: page.nav.order,
      });
      if (built.envelope === null) {
        result.warnings.push({
          page: page.ref,
          reason: 'PAGE_UNFIT',
          message: `"${tableRef as string}" cannot back ${template}: ${built.reason}`,
        });
      } else {
        envelope = { ...built.envelope };
      }
    }
    envelope ??= buildUserPageEnvelope({
      id,
      slug,
      title,
      template,
      navGroup,
      navOrder: page.nav.order,
      icon: page.nav.icon,
      connectionId,
      table: null,
    });
    // The form and the layout the manifest wrote, bound to the real tables.
    const own = (envelope['config'] ?? {}) as Record<string, unknown>;
    const form = page.config?.['form'];
    if (form !== undefined && composed !== null && tableId !== null) {
      const bound = bindForm(form, composed.view, composed.view.table(tableId), names);
      if ('problem' in bound) {
        result.warnings.push({ page: page.ref, reason: 'PAGE_FORM_INVALID', message: `${bound.problem}, so it has the form Adminium makes` });
      } else {
        envelope = { ...envelope, config: { ...own, form: bound.form } };
      }
    }
    const layout = page.config?.['layout'];
    if (template === 'page-dashboard' && layout !== undefined && connectionId !== null && model !== null) {
      const bound = bindLayout(layout, connectionId, model, names);
      if ('problem' in bound) {
        result.warnings.push({ page: page.ref, reason: 'PAGE_LAYOUT_INVALID', message: `${bound.problem}, so it was created empty` });
      } else {
        envelope = { ...envelope, config: { ...own, layout: bound.layout } };
      }
    }
    // The manifest's own title: its key, its English, its translations
    //, and `from` — the English it came with, so the sidebar can
    // tell a page the operator renamed (its title no longer matches) and stop
    // translating it. Its group within the app's section is the manifest's.
    const nav = (envelope['nav'] ?? {}) as Record<string, unknown>;
    envelope = {
      ...envelope,
      app: manifest.key,
      nav: { ...nav, group: page.nav.group },
      title: {
        key: page.title.key,
        fallback: title,
        from: title,
        ...(page.titles === undefined ? {} : { titles: { ...page.titles } }),
      },
    };
    const document = stamped(envelope);

    if (holder === undefined) {
      await pages.create({
        id,
        connectionId,
        slug,
        type: template,
        title,
        icon: page.nav.icon,
        navGroup: rowGroup,
        navOrder: page.nav.order,
        config: document,
        origin: 'manifest',
        manifestId: input.manifestRowId,
        createdBy: input.createdBy,
      });
      // The audience its sibling pages already have.
      await seedPageGrants(meta, { id, connectionId });
      result.created.push(slug);
      continue;
    }

    const stored = await pages.findById(holder.id);
    // Re-point whatever happens: a re-install replaces the app's row, and a
    // page left naming the old one would belong to nothing.
    await meta.db
      .updateTable('adminium_pages')
      .set({ manifestId: input.manifestRowId } as never)
      .where('id', '=', holder.id)
      .execute();
    if (stored === null || !isUntouched(stored.config)) {
      result.kept.push(slug);
      continue;
    }
    await pages.replaceConfig(holder.id, document, { title, navGroup: rowGroup, icon: page.nav.icon });
    result.recomposed.push(slug);
  }
  return result;
}
