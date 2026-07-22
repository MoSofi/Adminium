/**
 * The checked-in release feed behind `/changelog` (M10-T06).
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
 * ONE ENTRY, AND THAT IS CORRECT. The feed must agree with the version the
 * About screen reports (`apps/server/src/version.ts` → apps/server/package.json).
 * It previously listed 0.2.0–0.5.0 as shipped releases; none of them were ever
 * cut — `git tag -l` is `v0.1.0` and nothing else — which made a freshly
 * installed instance look four releases stale to its own operator. Add an entry
 * here only when a tag exists for it.
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
 * `ia-mapping.md` §4 lists it as a keeper: "tag taxonomy New/Improved/Fixed/
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
 * The empty-release hiding is a `ia-mapping.md` §4 keeper, and it is what makes
 * the filter honest: showing "v0.3.0" with an empty card under a Security
 * filter implies a security change nobody made.
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
