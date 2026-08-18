// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Contract tests between the SHIPPED SURFACES and the DOCS SITE.
 *
 * Why these live here and not in the docs app: `starlightLinksValidator` only
 * validates links internal to the docs site, so every claim the product makes
 * ABOUT the docs — the in-app Knowledge Base's deep links, the Changelog's "All
 * releases" button, the CLI reference's "every command" promise — was
 * unguarded. All 16 KB articles linked to routes that do not exist and the whole
 * in-app help surface 404'd, with nothing in CI to notice.
 *
 * These read files rather than importing across app boundaries (01 §2.3), which
 * is also what lets one suite check both sides of a cross-app promise.
 */

import { existsSync, readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { envSchema } from '../src/config/env.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const docsRoot = join(repoRoot, 'apps', 'docs', 'src', 'content', 'docs');

/** Every route the docs site publishes, as the in-app links address them. */
function docsRoutes(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), prefix === '' ? entry.name : `${prefix}/${entry.name}`);
        continue;
      }
      const md = /\.mdx?$/.exec(entry.name);
      if (md === null) continue;
      const base = entry.name.replace(/\.mdx?$/, '');
      // Starlight serves `<dir>/index.md` at `<dir>/`.
      routes.add(base === 'index' ? prefix : prefix === '' ? base : `${prefix}/${base}`);
    }
  };
  walk(docsRoot, '');
  return routes;
}

/** `## The audit log` → `the-audit-log` — Starlight's heading slugs. */
function headingAnchors(route: string): Set<string> {
  const candidates = [
    join(docsRoot, `${route}.md`),
    join(docsRoot, `${route}.mdx`),
    join(docsRoot, route, 'index.md'),
    join(docsRoot, route, 'index.mdx'),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (file === undefined) return new Set();
  const anchors = new Set<string>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = /^#{2,4}\s+(.*)$/.exec(line);
    if (heading === null) continue;
    anchors.add(
      (heading[1] as string)
        .replace(/`/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-'),
    );
  }
  return anchors;
}

function read(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

describe('in-app help links resolve to real docs pages', () => {
  it('every Knowledge Base article deep-links to a route the docs site publishes', () => {
    // THE BUG THIS PINS. articles.ts linked to `install`, `connect`,
    // `api/authentication`, `self-host/docker`, … — an IA that was never built.
    // The docs site publishes `getting-started/*`, `guides/*`, `reference/*`,
    // `self-hosting/*`. The set intersection was EMPTY: opening /help and
    // clicking any row went to a 404.
    const source = read('apps/dashboard/src/kb/articles.ts');
    const paths = [...source.matchAll(/docsPath: '([^']+)'/g)].map((match) => match[1] as string);
    expect(paths.length).toBeGreaterThan(0);

    const routes = docsRoutes();
    for (const path of paths) {
      const [route, anchor] = path.split('#') as [string, string | undefined];
      expect(routes, `KB links to /${path}, which the docs site does not publish`).toContain(route);
      if (anchor !== undefined) {
        expect(headingAnchors(route), `/${path} has no such heading`).toContain(anchor);
      }
    }
  });

  it('does not link to /search — Starlight search is a modal, not a route', () => {
    // The one escape hatch offered at the moment in-app help has already failed
    // the user must not itself 404. `pagefind: true` gives a search MODAL; no
    // `/search` page route exists and no `?q=` prefills it.
    expect(docsRoutes()).not.toContain('search');
    expect(read('apps/dashboard/src/kb/KnowledgeBasePage.tsx')).not.toMatch(/search\?q=/);
  });

  it('the Changelog links releases at GitHub, not a docs page that does not exist', () => {
    // `${DOCS_BASE_URL}/releases` 404'd — the same defect as the comp's
    // non-functional RSS button the header comment says was dropped because "a
    // button that lies about a capability is worse than no button".
    expect(docsRoutes()).not.toContain('releases');
    const links = read('apps/dashboard/src/kb/docsLinks.ts');
    expect(links).toMatch(/RELEASES_URL = 'https:\/\/github\.com\/MoSofi\/Adminium\/releases'/);
    // And it is the SAME url the update-available notice points at.
    expect(read('apps/server/src/telemetry/update-check.ts')).toContain(
      'https://github.com/MoSofi/Adminium/releases',
    );
    const changelog = read('apps/dashboard/src/changelog/ChangelogPage.tsx');
    expect(changelog).toContain('RELEASES_URL');
    expect(changelog).not.toMatch(/DOCS_BASE_URL\}\/releases/);
  });
});

describe('the docs describe the build that shipped', () => {
  it('documents `import-zip`, which the CLI registers and the docs claimed to cover', () => {
    // THE BUG THIS PINS. `import-zip` is a registered command backed by a
    // 615-line service, and `grep -rn import-zip apps/docs/` returned ZERO hits
    // — in a reference page whose own description promises "Every adminium
    // command and flag". The restore path was discoverable only by running
    // `adminium --help` against the binary, and `--dry-run` not at all.
    const cli = read('apps/docs/src/content/docs/reference/cli.md');
    expect(cli).toContain('## `import-zip`');
    expect(cli).toContain('--in');
    expect(cli).toContain('--dry-run');

    // The page that describes restoring must name the command that does it.
    expect(read('apps/docs/src/content/docs/self-hosting/export-zip.md')).toContain(
      'adminium import-zip',
    );
  });

  it('the REST reference names every operation the API actually serves', () => {
    // THE BUG THIS PINS. The page's hand-written route-group table listed 18
    // prefixes. The API has 31, over 161 operations — so 52 operations, a third
    // of the surface, appeared NOWHERE: exports, imports, scheduled-reports,
    // email-templates, search, i18n, users and permissions were unnamed, and
    // three rows named prefixes no route has ever used (`/views/*`,
    // `/generate/*`, `/schema/*` are all nested under other resources). A
    // reference page missing a third of the API is worse than none, because it
    // reads as complete. The page's two derived blocks are now written from this
    // same document by `apps/docs/scripts/sync-rest-api.mjs`.
    const spec = JSON.parse(
      readFileSync(join(repoRoot, 'apps', 'server', 'openapi.json'), 'utf8'),
    ) as { paths: Record<string, Record<string, unknown>> };
    const page = read('apps/docs/src/content/docs/reference/rest-api.md');

    const operations: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        if (methods[method] === undefined) continue;
        operations.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(operations.length).toBeGreaterThan(150);

    const missing = operations.filter((operation) => !page.includes(operation));
    expect(
      missing,
      `rest-api.md omits ${String(missing.length)} of ${String(operations.length)} operations — ` +
        'regenerate it: pnpm --filter @adminium/docs run rest-api',
    ).toEqual([]);
  });

  it('the REST reference invents no route prefix', () => {
    // The other half of the same defect: three rows pointed readers at
    // namespaces that do not exist. Every `/api/v1/<prefix>` the page names must
    // be one the spec serves.
    const spec = JSON.parse(
      readFileSync(join(repoRoot, 'apps', 'server', 'openapi.json'), 'utf8'),
    ) as { paths: Record<string, unknown> };
    const real = new Set(
      Object.keys(spec.paths).map((path) => path.replace('/api/v1/', '').split('/')[0] as string),
    );
    const page = read('apps/docs/src/content/docs/reference/rest-api.md');

    // Only the group table's own rows — prose deliberately names the three
    // prefixes that do NOT exist, to say so.
    const table = page.slice(
      page.indexOf('<!-- BEGIN GENERATED: groups -->'),
      page.indexOf('<!-- END GENERATED: groups -->'),
    );
    const named = [...table.matchAll(/`\/api\/v1\/([a-z0-9-]+)/g)].map((m) => m[1] as string);
    expect(named.length).toBeGreaterThan(25);
    for (const prefix of named) {
      expect(real, `rest-api.md names /api/v1/${prefix}, which no route serves`).toContain(prefix);
    }
  });

  it('points readers at the machine-readable spec, and the docs site serves it', () => {
    // An accurate generated spec that the docs never link is a spec nobody
    // reads. The endpoint is what makes the URL real rather than aspirational.
    const page = read('apps/docs/src/content/docs/reference/rest-api.md');
    expect(page).toContain('https://docs.adminium.dev/openapi.json');
    expect(read('apps/docs/src/pages/openapi.json.ts')).toContain('server/openapi.json?raw');
  });

  it('documents the desktop app for the people who run it, not just release it', () => {
    // THE GAP THIS PINS. The docs had exactly one desktop page —
    // `contributing/release-desktop.md`, about cutting a tag — and nothing at
    // all for someone who downloaded the installer: no install, no first run, no
    // backup, no LAN share, and no Desktop section in the sidebar to look in.
    const routes = docsRoutes();
    for (const route of ['desktop', 'desktop/first-run', 'desktop/backups', 'desktop/lan-share']) {
      expect(routes, `the docs site does not publish /${route}`).toContain(route);
    }
    // And the sidebar is explicit, so a page nobody links is a page nobody finds.
    const config = read('apps/docs/astro.config.mjs');
    expect(config).toContain("label: 'Desktop app'");
    for (const link of ['/desktop/', '/desktop/first-run/', '/desktop/backups/', '/desktop/lan-share/']) {
      expect(config, `the sidebar does not link ${link}`).toContain(`link: '${link}'`);
    }
  });

  it('tells desktop users the one thing a backup alone will not restore', () => {
    // `ADMINIUM_SECRET` lives in config.json and never in the backup zip, by
    // design — and every DSN and LLM key in the archive is encrypted with it. A
    // backup page that does not say so documents a restore that fails on a new
    // machine.
    const backups = read('apps/docs/src/content/docs/desktop/backups.md');
    expect(backups).toContain('ADMINIUM_SECRET');
    expect(backups).toContain('config.json');
    expect(backups).toMatch(/pre-restore/);
  });

  it('does not claim the update check is governed by the telemetry opt-in', () => {
    // THE BUG THIS PINS. The page said the update check "is governed by the same
    // opt-in", while update-check.ts states the opposite in a design note and a
    // test asserts the contradiction. An operator who opted out of telemetry kept
    // calling api.github.com hourly, disclosing their IP + version — and the page
    // named no way to stop it, because `updates.checkEnabled` appeared nowhere in
    // the docs at all.
    const page = read('apps/docs/src/content/docs/self-hosting/telemetry.md');
    expect(page).not.toMatch(/governed by the same opt-in/);
    expect(page).toContain('updates.checkEnabled');
    expect(page).toMatch(/separate consent/i);
  });

  it('the env-vars page\'s "complete list" is complete, and lists nothing removed', () => {
    // THE BUG THIS PINS, twice over. Under a heading reading "The complete list"
    // the page omitted 4 of the 16 variables `envSchema` validates (the whole
    // desktop block) and carried a `DATABASE_URL` row plus a section describing
    // it as the first-boot connection seed — a variable no product code ever
    // read. Both halves are now derived from the schema rather than maintained
    // by hand, so a new variable that never reaches the docs fails here.
    const page = read('apps/docs/src/content/docs/self-hosting/env-vars.md');
    const table = page.slice(page.indexOf('## The complete list'), page.indexOf('An empty string'));
    for (const name of Object.keys(envSchema.shape)) {
      expect(table, `env-vars.md does not list ${name}`).toContain(`\`${name}\``);
    }
    // And the removed one is gone from the page entirely, except where the page
    // deliberately explains its absence.
    expect(table).not.toContain('`DATABASE_URL`');
  });

  it('describes ADMINIUM_TELEMETRY as the override it now is', () => {
    for (const file of [
      'apps/docs/src/content/docs/self-hosting/telemetry.md',
      'apps/docs/src/content/docs/self-hosting/env-vars.md',
    ]) {
      const page = read(file);
      expect(page, `${file} must not present unset as "off"`).not.toMatch(
        /ADMINIUM_TELEMETRY=off\s+# the default/,
      );
      expect(page).toMatch(/override/i);
    }
  });
});
