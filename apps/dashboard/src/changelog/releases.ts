/**
 * The checked-in release feed behind `/changelog` (M10-T06).
 *
 * SOURCE CHOICE. The repo versions with changesets (`.changeset/config.json`,
 * `fixed: [["@adminium/*"]]`), which generates a per-package `CHANGELOG.md` at
 * `changeset version` time. At the v0.5 gate none exists yet: every workspace
 * is still `0.0.0` and no release has been cut, so there is nothing to parse.
 * Reading a file that does not exist would mean shipping a page that renders
 * empty on the very release it announces.
 *
 * So this module is the canonical feed for now: hand-authored, checked in, Zod-
 * validated at import, and shaped so a future `CHANGELOG.md` parser can fill it
 * mechanically (`parseChangelogMarkdown() → Release[]`) without touching the
 * page. It is a data file, not an array inlined in a component — the page never
 * hardcodes copy.
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
 * The comp's tag taxonomy (`designs/Changelog.dc.html`), preserved verbatim —
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
    version: '0.5.0',
    date: '2026-07-16',
    title: 'Self-host & distribution — public beta',
    summary:
      'Adminium is now fully self-hostable: one npx command or one docker run takes a clean machine to a generated admin app.',
    changes: [
      { tag: 'New', text: 'npx adminium — init wizard plus start, introspect, migrate and export-zip subcommands.' },
      { tag: 'New', text: 'Official Docker image (multi-arch, non-root) and a docker-compose.yml with an optional separate meta database.' },
      { tag: 'New', text: 'export-zip bundles your server config for a standalone run, and replays back on import.' },
      { tag: 'New', text: 'First-run wizard creates the super admin; telemetry is opt-in and off by default.' },
      { tag: 'New', text: 'In-app Knowledge Base, Changelog and API keys, plus an About screen with version and licence.' },
      { tag: 'Security', text: 'API keys are stored as a SHA-256 hash — the plaintext is shown once at creation and is never retrievable.' },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-06-25',
    title: 'Widgets, dashboards and the dashboard builder',
    summary:
      'The full widget vocabulary landed — 37 charts, boards, calendars, org charts and Gantt — with drag-and-drop dashboards on top.',
    changes: [
      { tag: 'New', text: 'Dashboard Builder: drag, drop and resize widgets on a grid; layouts persist per page.' },
      { tag: 'New', text: 'Kanban boards with swimlanes, a calendar scheduler, org charts and Gantt timelines.' },
      { tag: 'New', text: 'Realtime bindings keep widget data live without a page refresh.' },
      { tag: 'Improved', text: 'Charts mirror correctly in right-to-left locales.' },
      { tag: 'Fixed', text: 'Drawers rendered off-screen on tall pages.' },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-06-04',
    title: 'MySQL, SQLite and schema files',
    summary: 'Three engines, and a path that needs no live database connection at all.',
    changes: [
      { tag: 'New', text: 'Connect MySQL/MariaDB and SQLite alongside PostgreSQL.' },
      { tag: 'New', text: 'Upload a Prisma schema, a Django models.py, a Rails schema.rb or a .sql dump — no connection required.' },
      { tag: 'Improved', text: 'Per-engine capability detection degrades gracefully instead of failing.' },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-05-14',
    title: 'AI assist and eight locales',
    summary: 'Optional AI enrichment for generated apps, and the full internationalization layer.',
    changes: [
      { tag: 'New', text: 'AI assist proposes labels, groupings and starter dashboards from your schema — always reviewed before it applies.' },
      { tag: 'New', text: 'Bring your own LLM: copy the prompt, paste the response, no key required and nothing leaves your machine.' },
      { tag: 'New', text: '8 locales with full right-to-left support.' },
      { tag: 'Security', text: 'Schema only — the enrichment prompt never contains your row data.' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-04-22',
    title: 'First generated admin app',
    summary: 'Point Adminium at a Postgres database and get a working admin panel.',
    changes: [
      { tag: 'New', text: 'Connect a database, introspect the schema and generate a full CRUD admin app.' },
      { tag: 'New', text: 'Roles and permissions, audit log and API keys.' },
      { tag: 'Security', text: 'Introspection reads schema metadata only, never your rows.' },
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
