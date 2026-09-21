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
  hashEnvelope,
  isKnownPageTemplate,
  isTableBoundTemplate,
  pageSourceTable,
  parseDatabaseModel,
  type DatabaseModel,
} from '@adminium/engine';
import type { Manifest } from '@adminium/manifest';
import { BUILTIN_NAV_GROUP_KEYS } from '@adminium/add-on-contracts';
import { newId, overridesRepo, pagesRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';

import { applyCompositionOverrides } from '../connections/effective-schema.js';
import { buildUserPageEnvelope } from '../routes/pages/envelope.js';

type NavGroup = (typeof BUILTIN_NAV_GROUP_KEYS)[number];

export interface ManifestPageSkip {
  page: string;
  reason:
    | 'PAGE_TEMPLATE_UNKNOWN'
    | 'PAGE_SLUG_TAKEN'
    | 'PAGE_UNBOUND'
    | 'PAGE_BINDING_UNKNOWN'
    | 'PAGE_UNFIT';
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
}

/**
 * The sidebar group a page lands in. A manifest may name any string, but only
 * the built-in groups render — anything else is filed as HIDDEN by the nav
 * builder — so a group the sidebar does not have falls back to where that
 * template's pages go when Adminium generates them.
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

async function compositionModel(meta: MetaDb, connectionId: string): Promise<DatabaseModel | null> {
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  if (snapshot === null) return null;
  const overrides = await overridesRepo(meta).listForConnection(connectionId, { status: 'active' });
  return applyCompositionOverrides(parseDatabaseModel(snapshot.schema), overrides);
}

/** A stored document's own stamp still matches it: nobody has edited it. */
function untouched(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const body = (config as Record<string, unknown>)['config'];
  const stamp =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)['generatedHash']
      : undefined;
  return typeof stamp === 'string' && stamp === hashEnvelope(config as Record<string, unknown>);
}

function stamped(envelope: Record<string, unknown>): Record<string, unknown> {
  const body = { ...(envelope['config'] as Record<string, unknown>) };
  delete body['generatedHash'];
  const plain = { ...envelope, config: body };
  return { ...plain, config: { ...body, generatedHash: hashEnvelope(plain) } };
}

export async function materialiseManifestPages(input: MaterialiseInput): Promise<MaterialiseResult> {
  const { meta, manifest, connectionId } = input;
  const pages = pagesRepo(meta);
  const result: MaterialiseResult = { created: [], recomposed: [], kept: [], warnings: [] };
  // Only an app declares engine pages; an add-on's `addOn.pages` are its own
  // bundle's screens, a different thing entirely.
  const declared = manifest.kind === 'app' ? (manifest.pages ?? []) : [];
  if (declared.length === 0) return result;

  const model = connectionId === null ? null : await compositionModel(meta, connectionId);
  const all = await pages.listAll();

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
    const holder = all.find((row) => row.slug === slug);
    if (holder !== undefined && holder.origin !== 'manifest') {
      // Somebody else's page. Never clobbered; the app's page is just not built.
      result.warnings.push({
        page: page.ref,
        reason: 'PAGE_SLUG_TAKEN',
        message: `a page at /p/${slug} already exists and is not this app's`,
      });
      continue;
    }

    const navGroup = navGroupFor(page.nav.group, template);
    const title = page.title.fallback;
    const id = holder?.id ?? newId('page');

    // The table this page reads, as the snapshot names it.
    const tableRef = bound ? pageSourceTable(page) : null;
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
        const composedTitle = built.envelope['title'];
        envelope = {
          ...built.envelope,
          title:
            typeof composedTitle === 'object' && composedTitle !== null
              ? { ...(composedTitle as Record<string, unknown>), fallback: title }
              : { key: `nav.${slug}`, fallback: title },
        };
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
    const document = stamped(envelope);

    if (holder === undefined) {
      await pages.create({
        id,
        connectionId,
        slug,
        type: template,
        title,
        icon: page.nav.icon,
        navGroup,
        navOrder: page.nav.order,
        config: document,
        origin: 'manifest',
        manifestId: input.manifestRowId,
        createdBy: input.createdBy,
      });
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
    if (stored === null || !untouched(stored.config)) {
      result.kept.push(slug);
      continue;
    }
    await pages.replaceConfig(holder.id, document, { title, navGroup, icon: page.nav.icon });
    result.recomposed.push(slug);
  }
  return result;
}
