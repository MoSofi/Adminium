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
    expect(links).toMatch(/RELEASES_URL = 'https:\/\/github\.com\/adminium\/adminium\/releases'/);
    // And it is the SAME url the update-available notice points at.
    expect(read('apps/server/src/telemetry/update-check.ts')).toContain(
      'https://github.com/adminium/adminium/releases',
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
