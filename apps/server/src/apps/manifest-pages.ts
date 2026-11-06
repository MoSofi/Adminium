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
 * template, an unknown template — is REPORTED and the install goes on. Every
 * released app shipped before pages were read; refusing them now would break
 * installs that worked. An unbound page is still created, and shows the "this
 * page has no table" notice that leads to the fix. An app's own CI is where
 * these are refused (`checkManifestPages`).
 *
 * ─── A page saved from a dashboard ────────────────────────────────────────
 *
 * A self-made app's page may carry its whole `envelope` and its shared
 * `views`: made the target's own by `manifest-envelopes.ts` and
 * `manifest-views.ts`. One that cannot be made stops an install that is
 * `strict`, and is reported otherwise.
 *
 * ─── A page already at the address ────────────────────────────────────────
 *
 * A slug held on the database by a page that is not this app's — the
 * operator's own, a generated one, one an uninstalled app left — is a choice
 * on the check step (`planPageSlugs`): REPLACE it when nobody edited it,
 * RENAME it to an address the operator gives (the app's page takes the slug,
 * so its roles' grants and its next update find it), or SKIP the app's page.
 * With no answer the install is refused; nothing is skipped silently.
 * Another app's page is never offered: the plan refuses it.
 */

import {
  composeRequestedPage,
  isKnownPageTemplate,
  isTableBoundTemplate,
  pageSourceTable,
  parseDatabaseModel,
  type DatabaseModel,
} from '@adminium/engine';
import { keptFromStaff, type Manifest } from '@adminium/manifest';
import { BUILTIN_NAV_GROUP_KEYS } from '@adminium/add-on-contracts';
import { newId, overridesRepo, pagesRepo, permissionsRepo, snapshotsRepo, type MetaDb, type PageSummary } from '@adminium/meta';

import { ownsBlocks } from './owns-blocks.js';
import { isSavedFile } from './saved-file.js';
import { tableIdOrNull } from '../installs/table-id.js';
import type { RefTarget } from './envelope-refs.js';
import { appTableRefs, envelopeFromFile, targetTableFor } from './manifest-envelopes.js';
import { bindForm, bindLayout, bindListConfig, boardOf, calendarOf } from './manifest-page-config.js';
import { writePageViews } from './manifest-views.js';
import { applyCompositionOverrides, applyOverrides, withEffectiveLabels } from '../connections/effective-schema.js';
import { SnapshotView } from '../crud/identifiers.js';
import { ValidationFailedError } from '../errors.js';
import { isUntouched, stamped } from '../pages/generated-stamp.js';
import { seedPageGrants } from '../pages/page-grants.js';
import { buildUserPageEnvelope } from '../routes/pages/envelope.js';

type NavGroup = (typeof BUILTIN_NAV_GROUP_KEYS)[number];

/** What the operator chose for a page whose address is taken, by the app page's slug. */
export type PageChoice = { action: 'replace' } | { action: 'rename-existing'; to: string } | { action: 'skip' };
export type PageChoiceAction = PageChoice['action'];

/** An address one of the app's pages wants, held by a page that is not this app's. */
export interface PageClash {
  /** The app's page (its ref, which is its slug). */
  page: string;
  /** The title of the page there now. */
  title: string;
  /** Whose it is: the operator's (`yours`), the generator's, or an app uninstalled since. */
  holder: 'yours' | 'generated' | 'orphan';
  /** Nobody has edited it since it was made: it may be replaced. */
  untouched: boolean;
  offers: PageChoiceAction[];
  action: PageChoiceAction | 'undecided';
  /** For `rename-existing`: the address the page there moves to. */
  renameTo?: string;
}

/** A slug as a page's address takes it (`pageSlug` in the pages routes). */
const PAGE_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PAGE_SLUG_MAX = 31;

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
    | 'PAGE_LAYOUT_INVALID'
    // Created, plotted by the columns Adminium picks rather than the ones it named.
    | 'PAGE_CALENDAR_INVALID'
    // Created empty: the board it named cannot be built, and no other board is built in its place.
    | 'PAGE_BOARD_INVALID'
    | 'PAGE_FILTERS_INVALID'
    | 'PAGE_DEFAULT_FILTERS_INVALID'
    | 'PAGE_TABS_INVALID'
    | 'PAGE_TAB_UNKNOWN'
    | 'PAGE_BULK_INVALID'
    | 'PAGE_COLUMNS_INVALID'
    // A page saved from a dashboard that cannot be made here, or its shared views: not written.
    | 'PAGE_ENVELOPE_INVALID'
    | 'PAGE_VIEWS_INVALID'
    // Created, without a column of the file the table here cannot show.
    | 'PAGE_COLUMN_DROPPED'
    // The operator's answer for a taken address: the app's page left out, or the page there moved.
    | 'PAGE_SKIPPED'
    | 'PAGE_MOVED';
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
  /** The operator's answers for the addresses other pages hold, by the app page's slug. */
  choices?: Readonly<Record<string, PageChoice>> | undefined;
  /**
   * A page that cannot be made stops the caller (an install, a strict update)
   * instead of being reported: a page saved from a dashboard, its views, a
   * taken address with no answer. A released app's page that cannot be bound
   * is still made empty, as ever.
   */
  strict?: boolean | undefined;
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

/**
 * Whose a page at one of the app's addresses is: this app's (`this`), another
 * installed app's or the system's (`app`, never offered), or one the operator
 * may choose about.
 */
async function holderOf(
  meta: MetaDb,
  row: PageSummary,
  appKey: string,
  manifestRowId: string,
  owners: ReadonlyMap<string, string>,
): Promise<PageClash['holder'] | 'this' | 'app'> {
  if (row.origin === 'manifest') {
    // An orphan's envelope says whose it was; nothing else does.
    const orphan = owners.has(row.manifestId ?? '') ? null : await pagesRepo(meta).findById(row.id);
    if (isThisAppsPage({ ...row, config: orphan?.config }, appKey, manifestRowId, owners)) return 'this';
    return owners.has(row.manifestId ?? '') ? 'app' : 'orphan';
  }
  if (row.origin === 'system') return 'app';
  return row.origin === 'generated' ? 'generated' : 'yours';
}

export type PageSlugProblemCode = 'PAGE_SLUG_TAKEN' | 'PAGE_SLUG_UNANSWERED' | 'PAGE_SLUG_ANSWER_INVALID';

/**
 * The app's addresses other pages hold on this database: each a choice for the
 * check step, and what is wrong — another app's page, a clash nobody answered,
 * an answer that cannot be done.
 */
export async function planPageSlugs(
  meta: MetaDb,
  manifest: Manifest,
  connectionId: string,
  /** This app's install on the database, or '' for none yet. */
  manifestRowId: string,
  choices: Readonly<Record<string, PageChoice>> = {},
): Promise<{ clashes: PageClash[]; problems: { code: PageSlugProblemCode; table: string; message: string }[] }> {
  const clashes: PageClash[] = [];
  const problems: { code: PageSlugProblemCode; table: string; message: string }[] = [];
  if (!ownsBlocks(manifest)) return { clashes, problems };
  const slugs = new Set((manifest.pages ?? []).map((page) => page.ref));
  const here = (await pagesRepo(meta).listAll()).filter((row) => row.connectionId === connectionId);
  const taken = new Set(here.map((row) => row.slug));
  const owners = await pageOwners(meta);
  const movedTo = new Set<string>();
  for (const row of here) {
    if (!slugs.has(row.slug)) continue;
    const holder = await holderOf(meta, row, manifest.key, manifestRowId, owners);
    if (holder === 'this') continue;
    if (holder === 'app') {
      const name = owners.get(row.manifestId ?? '') ?? 'another app';
      problems.push({
        code: 'PAGE_SLUG_TAKEN',
        table: row.slug,
        message: `The page /p/${row.slug} on this database belongs to "${name}". Installing here would take it over, so uninstall "${name}" or install against a different database.`,
      });
      continue;
    }
    const stored = await pagesRepo(meta).findById(row.id);
    const untouched = stored !== null && isUntouched(stored.config);
    const offers: PageChoiceAction[] = untouched ? ['replace', 'rename-existing', 'skip'] : ['rename-existing', 'skip'];
    const clash: PageClash = { page: row.slug, title: row.title, holder, untouched, offers, action: 'undecided' };
    clashes.push(clash);
    const choice = choices[row.slug];
    const refuse = (code: PageSlugProblemCode, message: string) => problems.push({ code, table: row.slug, message });
    if (choice === undefined) {
      // A released app's page at a taken address is left out with a warning, as before, until the install review can ask; a saved file is asked now.
      if (!isSavedFile(manifest)) continue;
      refuse('PAGE_SLUG_UNANSWERED', `A page is already at /p/${row.slug} on this database. Pick what to do with it before you install: ${untouched ? 'replace it, ' : ''}rename it, or leave the app's page out.`);
    } else if (!offers.includes(choice.action)) {
      refuse('PAGE_SLUG_ANSWER_INVALID', `The page at /p/${row.slug} has been edited since it was made, so it is not replaced: rename it, or leave the app's page out.`);
    } else if (choice.action === 'rename-existing') {
      const to = choice.to;
      clash.renameTo = to;
      if (!PAGE_SLUG.test(to) || to.length > PAGE_SLUG_MAX) {
        refuse('PAGE_SLUG_ANSWER_INVALID', `"${to}" cannot be the address of the page at /p/${row.slug}: it must be lower-case words joined by "-", at most ${String(PAGE_SLUG_MAX)} characters.`);
      } else if (taken.has(to) || slugs.has(to) || movedTo.has(to)) {
        refuse('PAGE_SLUG_ANSWER_INVALID', `"${to}" cannot be the address of the page at /p/${row.slug}: another page has it, or will.`);
      } else {
        movedTo.add(to);
        clash.action = 'rename-existing';
      }
    } else {
      clash.action = choice.action;
    }
  }
  return { clashes, problems };
}

export async function materialiseManifestPages(input: MaterialiseInput): Promise<MaterialiseResult> {
  const { meta, manifest, connectionId } = input;
  const pages = pagesRepo(meta);
  const result: MaterialiseResult = { created: [], recomposed: [], kept: [], warnings: [] };
  // Generated pages, of an app or of an add-on that installs like one. An
  // add-on's `addOn.pages` are its own bundle's screens, a different thing entirely.
  const declared = ownsBlocks(manifest) ? (manifest.pages ?? []) : [];
  if (declared.length === 0) return result;

  const composed = connectionId === null ? null : await compositionModel(meta, connectionId);
  const model = composed?.model ?? null;
  const names = input.names ?? {};
  const all = await pages.listAll();
  const owners = await pageOwners(meta);
  const known = appTableRefs(manifest);
  // The tables a saved page's views name, as the target has them.
  const target: RefTarget | null =
    connectionId === null || model === null
      ? null
      : { connectionId, postgres: model.dialect === 'postgres', table: (ref) => targetTableFor(model, names, known, ref) };
  const appSlugs = new Set(declared.map((page) => page.ref));

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
    // What cannot be made: an install stops, anything else says so and goes on without the page.
    const fail = (reason: ManifestPageSkip['reason'], message: string): void => {
      if (input.strict === true) throw new ValidationFailedError(`The page "${page.ref}": ${message}.`, { reason, page: page.ref });
      result.warnings.push({ page: page.ref, reason, message });
    };

    const slug = page.ref;
    // Slugs are unique per CONNECTION, so that is where a clash can be.
    let holder = all.find((row) => row.slug === slug && row.connectionId === connectionId);
    // What the operator chose for a page at this address that is not this app's, done once the app's page is made.
    let settle: (() => Promise<void>) | null = null;
    if (holder !== undefined) {
      const whose = await holderOf(meta, holder, manifest.key, input.manifestRowId, owners);
      if (whose !== 'this') {
        const there = holder;
        const choice = input.choices?.[slug];
        if (whose === 'app' || choice === undefined) {
          // Another app's page is never clobbered (the install check refuses it before here); the operator's is only by their answer.
          if (whose !== 'app' && input.strict === true && isSavedFile(manifest)) {
            throw new ValidationFailedError(`A page is already at /p/${slug}: pick what to do with it before you install.`, { reason: 'PAGE_SLUG_UNANSWERED', page: slug });
          }
          result.warnings.push({ page: page.ref, reason: 'PAGE_SLUG_TAKEN', message: `a page at /p/${slug} already exists and is not this app's` });
          continue;
        }
        if (choice.action === 'skip') {
          result.warnings.push({ page: page.ref, reason: 'PAGE_SKIPPED', message: `a page is already at /p/${slug}, and the app's page was left out` });
          continue;
        }
        if (choice.action === 'replace') {
          const stored = await pages.findById(there.id);
          if (stored === null || !isUntouched(stored.config)) {
            fail('PAGE_SLUG_TAKEN', `the page at /p/${slug} has been edited since it was made, so it is not replaced`);
            continue;
          }
          settle = async () => {
            // Its grants first: a grant is a string no foreign key reaches, and a page made later at the same id would inherit it.
            await permissionsRepo(meta).revokeAllForResource('page', there.id);
            await pages.delete(there.id);
          };
        } else {
          const to = choice.to;
          if (!PAGE_SLUG.test(to) || to.length > PAGE_SLUG_MAX || appSlugs.has(to) || (await pages.findBySlug(connectionId, to)) !== null) {
            fail('PAGE_SLUG_TAKEN', `"${to}" cannot be the address of the page at /p/${slug}: it is not a free address`);
            continue;
          }
          settle = async () => {
            await pages.updateMeta(there.id, { slug: to });
            result.warnings.push({ page: page.ref, reason: 'PAGE_MOVED', message: `the page that was at /p/${slug} is now at /p/${to}` });
          };
        }
        // The app's page is a new one at the address.
        holder = undefined;
      }
    }

    const navGroup = navGroupFor(page.nav.group, template);
    // The app's section, whatever the manifest calls the group within it.
    const rowGroup = ownsBlocks(manifest) ? 'app' : navGroup;
    const title = page.title.fallback;
    const id = holder?.id ?? newId('page');

    // The table this page reads, as the snapshot names it.
    const shortRef = bound ? pageSourceTable(page) : null;
    const tableRef = shortRef === null ? null : (input.names?.[shortRef] ?? shortRef);
    const tableId =
      tableRef === null || model === null
        ? null
        : tableIdOrNull(model, tableRef);

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
      const context = { connectionId, slug, id, navGroup, navIcon: page.nav.icon, navOrder: page.nav.order };
      // A calendar plots by the columns the app names; failing that, by the
      // time its table's booking rule books — never a date of birth that
      // happens to come first.
      const booked = composed?.view.table(tableId).table.booking?.start;
      const hinted = booked === undefined ? undefined : { start: booked };
      const named = calendarOf(page);
      // A board is drawn with the columns the app names: the rows of a table its cards link to, or an enum's values.
      const board = template === 'page-board' ? boardOf(page, model, input.names) : null;
      let built = composeRequestedPage(model, tableId, template, { ...context, calendar: named ?? hinted, ...(board === null ? {} : { board }) });
      if (built.envelope === null && named !== null) {
        result.warnings.push({
          page: page.ref,
          reason: 'PAGE_CALENDAR_INVALID',
          message: `${built.reason}, so it plots by the columns Adminium picks`,
        });
        built = composeRequestedPage(model, tableId, template, { ...context, calendar: hinted });
      }
      if (built.envelope === null && board !== null) {
        /*
         * The board the app named cannot be built — and no other board is
         * built in its place. Composed again with the columns Adminium finds
         * (the table's workflow enum), a board of the OPEN deals by stage
         * became one of every deal by state: a different board under the same
         * name, with nothing on screen to say so. The page is made empty, as
         * one whose table cannot back its template is, and the reason is
         * reported.
         */
        result.warnings.push({
          page: page.ref,
          reason: 'PAGE_BOARD_INVALID',
          message: `${built.reason}, so the page was created empty`,
        });
      } else if (built.envelope === null) {
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
    // A page saved from a dashboard: the body the person arranged, made this database's own on the page just composed.
    if (page.envelope !== undefined) {
      const made =
        connectionId === null || composed === null
          ? { problem: 'it is saved from a database, and this install has none' }
          : envelopeFromFile({ page, manifest, frame: envelope, connectionId, model: composed.model, view: composed.view, tableId, names });
      if ('problem' in made) {
        fail('PAGE_ENVELOPE_INVALID', `it cannot be made here: ${made.problem}`);
        continue;
      }
      for (const message of made.warnings) result.warnings.push({ page: page.ref, reason: 'PAGE_COLUMN_DROPPED', message });
      envelope = made.envelope;
    }
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
    // What a records page says of itself beside its form — the list's filters and the ones it opens with, its columns, the words
    // of its tabs, its bulk actions — bound to the real tables and written BEFORE the page is stamped, so a fresh
    // page does not read as one somebody edited.
    if (template === 'page-crud' && composed !== null && tableId !== null && page.envelope === undefined) {
      const current = (envelope['config'] ?? {}) as Record<string, unknown>;
      const bound = bindListConfig(page.config, composed.view, composed.view.table(tableId), names, current);
      for (const warning of bound.warnings) result.warnings.push({ page: page.ref, ...warning });
      // A code only its last four characters are shown of, and a code staff never see, are on no list, form or peek.
      // By the table's id: `sales.orders` and `public.orders` are two tables, and each keeps its own codes.
      const declared = (manifest.requiredSchema?.tables ?? []).find((candidate) => tableIdOrNull(composed.view.model, names[candidate.ref] ?? candidate.ref) === tableId);
      // After the manifest's own columns are laid on: they are filtered the same way.
      const merged = { ...current, ...bound.config };
      const columns = merged['columns'];
      const shown = declared === undefined || !Array.isArray(columns) ? undefined : columns.filter((column) => keptFromStaff(declared, String((column as { name?: unknown }).name)) === null);
      envelope = { ...envelope, config: { ...merged, ...(shown === undefined ? {} : { columns: shown }) } };
    }
    // The manifest's own title: its key, its English, its translations
    //, and `from` — the English it came with, so the sidebar can
    // tell a page the operator renamed (its title no longer matches) and stop
    // translating it. Its group within the app's section is the manifest's.
    const nav = (envelope['nav'] ?? {}) as Record<string, unknown>;
    envelope = {
      ...envelope,
      app: manifest.key,
      // The part of the app it belongs to: the page route and the menu read it here.
      ...('module' in page && typeof page.module === 'string' ? { module: page.module } : { module: undefined }),
      // Kept off the sidebar: the menu reads it here.
      ...(page.nav.offRail === true ? { offRail: true } : { offRail: undefined }),
      nav: { ...nav, group: page.nav.group },
      title: {
        key: page.title.key,
        fallback: title,
        from: title,
        ...(page.titles === undefined ? {} : { titles: { ...page.titles } }),
      },
    };
    const document = stamped(envelope);
    // The app's shared views of the page, written on it as it now stands.
    const writeViews = async (pageId: string): Promise<void> => {
      if (page.views === undefined) return;
      const written = await writePageViews(meta, pageId, page.views, target ?? { connectionId: connectionId ?? '', postgres: false, table: () => null });
      if ('problem' in written) fail('PAGE_VIEWS_INVALID', `its views were not written: ${written.problem}`);
    };

    if (holder === undefined) {
      // The page that was at the address goes, or moves, only now that the app's page is ready to take it.
      if (settle !== null) await settle();
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
      // The audience its sibling pages already have. An add-on's page is seen by the roles
      // the add-on itself declares, never by "every role that sees a page of this database".
      if (manifest.kind === 'app') await seedPageGrants(meta, { id, connectionId });
      result.created.push(slug);
      await writeViews(id);
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
      /*
       * A page its owner changed is theirs and is left as it is — but for the
       * part of the app it belongs to, which is the app's to say: without it
       * the page would stay in the menu, and answer, while its part is off.
       */
      const held = stored === null || typeof stored.config !== 'object' || stored.config === null ? null : (stored.config as Record<string, unknown>);
      const part = 'module' in page && typeof page.module === 'string' ? page.module : undefined;
      // Whether it is on the sidebar of the app's section is the app's to say too.
      const offRail = page.nav.offRail === true ? true : undefined;
      if (held !== null && (held['module'] !== part || held['offRail'] !== offRail)) {
        const { module: _was, offRail: _rail, ...rest } = held;
        await pages.replaceConfig(holder.id, { ...rest, ...(part === undefined ? {} : { module: part }), ...(offRail === undefined ? {} : { offRail }) });
      }
      result.kept.push(slug);
      await writeViews(holder.id);
      continue;
    }
    await pages.replaceConfig(holder.id, document, { title, navGroup: rowGroup, icon: page.nav.icon });
    result.recomposed.push(slug);
    await writeViews(holder.id);
  }
  return result;
}
