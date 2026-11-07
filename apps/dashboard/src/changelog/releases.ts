// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The checked-in release feed behind `/changelog`.
 *
 * SOURCE CHOICE. The repo versions with changesets (`.changeset/config.json`,
 * `fixed: [["@adminium/*"]]`), which generates a per-package `CHANGELOG.md` at
 * `changeset version` time. Those files now exist, but they are per-package and
 * written for people reading a registry listing ("Updated dependencies"), not a
 * product changelog — so the feed stays hand-authored and checked in, Zod-
 * validated at import, and shaped so a future `CHANGELOG.md` parser can fill it
 * mechanically (`parseChangelogMarkdown() → Release[]`) without touching the
 * page. It is a data file, not an array inlined in a component — the page never
 * hardcodes copy.
 *
 * ONLY TAGGED RELEASES, AND NOT EVERY ONE. The feed must never run ahead of
 * the version the About screen reports (`apps/server/src/version.ts` →
 * apps/server/package.json). It once listed 0.2.0–0.5.0 before any of them
 * were cut, which made a fresh install look four releases stale to its own
 * operator. Add an entry only when its tag exists; small patch releases are
 * left out and their changes read in the per-package CHANGELOG.md.
 *
 * It is a `.ts` module rather than `.json` on purpose: this repo deliberately
 * avoids JSON imports (see `packages/i18n/scripts/gen-resources.mjs` — the TS
 * mirrors exist precisely so nothing needs JSON import attributes under
 * NodeNext + the browser bundler).
 *
 * TRANSLATION NOTE. Release notes are NOT localized, and that is deliberate:
 * they are a historical record of what shipped, written once at release time.
 * Localizing them would mean either shipping 8 stale translations or blocking
 * every release on a translation round-trip. The page CHROME (title, filters,
 * empty state) is fully localized; the entries stay in the language they were
 * written in — the same call GitHub, Stripe and Linear all make.
 */
import { z } from 'zod';

/**
 * The comp's tag taxonomy (`Changelog.dc.html`), preserved verbatim —
 * It is a keeper: "tag taxonomy New/Improved/Fixed/
 * Security w/ empty-release hiding".
 */
export const CHANGE_TAGS = ['New', 'Improved', 'Fixed', 'Security'] as const;
export type ChangeTag = (typeof CHANGE_TAGS)[number];

export const changeSchema = z.object({
  tag: z.enum(CHANGE_TAGS),
  text: z.string().min(1),
});

export const releaseSchema = z.object({
  /** Semver, displayed in the version gutter. */
  version: z.string().min(1),
  /** ISO-8601 date — rendered through the Intl layer, never pre-formatted. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO-8601 date (YYYY-MM-DD)'),
  title: z.string().min(1),
  summary: z.string().min(1),
  changes: z.array(changeSchema).min(1),
});

export type Change = z.infer<typeof changeSchema>;
export type Release = z.infer<typeof releaseSchema>;

/** Newest first — the page renders in array order. */
const RAW: unknown = [
  {
    version: '0.3.49',
    date: '2026-11-07',
    title: 'Your own apps, and workspaces',
    summary:
      'Save what you built on a database as an app of your own and install it on another server. Group a server’s databases into workspaces, one per team or business, each with its own menu and its own mail sender.',
    changes: [
      { tag: 'New', text: 'Save as app: turn a database’s tables, pages, roles, rules, mails, documents and reports into an app file, from Hosted apps or a connection’s card. Check lists what needs a choice and what the new owner fills in after installing. People, secrets and history never go in.' },
      { tag: 'New', text: 'Choose which rows travel with a saved app: up to 200 starting rows or 5,000 sample rows per table, picked by the page’s order or a saved view. Personal columns stay empty unless you include them.' },
      { tag: 'New', text: 'Saved from here lists every app version saved on this server, with its fingerprint, Download again and Save a newer version.' },
      { tag: 'New', text: 'Installing your own app shows where it was made, checks it against the fingerprint shown when it was saved, can use the tables already there with no change to them, and asks about each page whose address is taken.' },
      { tag: 'New', text: 'After you install: the app’s page lists the addresses, keys and senders to fill in after installing, and ticks each one off when it is done.' },
      { tag: 'New', text: 'Install the same app once on each database. Each copy has its own page, settings, roles, templates and keys, and Update every copy keeps them on one version.' },
      { tag: 'New', text: 'Workspaces group a server’s databases. Show them all in one menu or one at a time with a switcher; each browser tab keeps its own current workspace, and Library pages follow it.' },
      { tag: 'New', text: 'Each workspace can have its own mail sender, so mail about a record goes from its own business, with its own postal address on marketing mail. A template can name who it always goes as.' },
      { tag: 'New', text: 'Shown in: list an email template, campaign or report layout in chosen workspaces only. It narrows lists and pickers, never what is sent.' },
      { tag: 'New', text: 'Save workspace puts one app per database into a single file. Installing it chooses a database for each app, can create the workspace, and finishes with Install the rest after a stop.' },
      { tag: 'New', text: 'A saved app can carry the server’s look and words. It is applied only when someone who manages settings ticks it, and Undo on the app’s page puts back what was there.' },
      { tag: 'New', text: 'Download an app you made in a project folder, with its screens’ source; Make it editable here copies that source into another project.' },
      { tag: 'Improved', text: 'A saved app keeps its columns’ own names, such as orderDate or Order Total.' },
      { tag: 'Improved', text: 'An update that stops part way says where, and Finish the update completes it, even after a reload.' },
      { tag: 'Improved', text: 'The server as a whole is now called the server everywhere, and the sidebar group that held your pages is called Pages. Workspace means a group of databases.' },
      { tag: 'Security', text: 'Rules in an installed app file that send data out arrive switched off and empty, whatever the file says. Only someone who manages automations turns them on.' },
      { tag: 'Security', text: 'Before a file is saved, Adminium looks for every secret this server holds, whole, in pieces and encoded, and never writes one.' },
      { tag: 'Security', text: 'Workspaces organise the menu and are not a security wall: roles still decide who sees what. The do-not-email list stays one for the whole server.' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-21',
    title: 'First public release',
    summary:
      'Point Adminium at a database and get a real admin panel — read-and-write, self-hosted, and open source under AGPL-3.0.',
    changes: [
      { tag: 'New', text: 'Connect a database, introspect the schema and generate a full CRUD admin app.' },
      { tag: 'New', text: 'PostgreSQL, MySQL/MariaDB and SQLite — or upload a Prisma schema, a Django models.py, a Rails schema.rb or a .sql dump and connect nothing at all.' },
      { tag: 'New', text: 'Studio: rename, regroup and re-shape the generated app, with every change stored as configuration rather than emitted code.' },
      { tag: 'New', text: 'The widget vocabulary — charts, Kanban boards with swimlanes, a calendar scheduler, org charts and Gantt timelines — with a drag-and-drop dashboard builder on top.' },
      { tag: 'New', text: 'Optional AI assist proposes labels, groupings and starter dashboards from your schema, always reviewed before it applies. Bring your own key, or copy the prompt and paste the response so nothing leaves your machine.' },
      { tag: 'New', text: 'Roles and permissions, audit log, API keys, jobs and notifications.' },
      { tag: 'New', text: '8 locales with full right-to-left support.' },
      { tag: 'New', text: 'Self-host your way: the adminium CLI (init wizard plus start, introspect, migrate, export-zip and import-zip), a multi-arch non-root Docker image with docker-compose.yml, or the desktop app.' },
      { tag: 'New', text: 'In-app Knowledge Base, Changelog and About screen with version, licence and the AGPL source offer.' },
      { tag: 'Security', text: 'Introspection and the AI prompt read schema metadata only — never your rows.' },
      { tag: 'Security', text: 'Stored database credentials and provider keys are encrypted at rest with a key derived from ADMINIUM_SECRET.' },
      { tag: 'Security', text: 'API keys are stored as a SHA-256 hash — the plaintext is shown once at creation and is never retrievable.' },
      { tag: 'Security', text: 'Telemetry and update checks are both opt-in and off by default; an opted-out instance makes no outbound call.' },
    ],
  },
];

/**
 * Parsed at module load: a malformed feed is a build-time mistake, and failing
 * here (loudly, once) beats a page that renders half a release.
 */
export const RELEASES: readonly Release[] = z.array(releaseSchema).min(1).parse(RAW);

/** The newest release — the sidebar version pill's source of truth. */
export const LATEST_RELEASE: Release = RELEASES[0] as Release;

// --- pure filtering (unit-tested without a DOM) ------------------------------

export interface FilteredRelease extends Release {
  changes: Change[];
}

/**
 * Filters a release feed to one tag, dropping releases left with nothing to say.
 *
 * The empty-release hiding is a keeper, and it is what makes the filter honest:
 * showing "v0.3.0" with an empty card under a Security filter implies a
 * security change nobody made.
 */
export function filterReleases(
  releases: readonly Release[],
  tag: ChangeTag | null,
): FilteredRelease[] {
  if (tag === null) return releases.map((release) => ({ ...release, changes: [...release.changes] }));
  return releases
    .map((release) => ({ ...release, changes: release.changes.filter((change) => change.tag === tag) }))
    .filter((release) => release.changes.length > 0);
}

/** Tags actually present in the feed — a filter chip for a tag nobody used is a dead end. */
export function availableTags(releases: readonly Release[]): ChangeTag[] {
  const present = new Set<ChangeTag>();
  for (const release of releases) {
    for (const change of release.changes) present.add(change.tag);
  }
  return CHANGE_TAGS.filter((tag) => present.has(tag));
}
