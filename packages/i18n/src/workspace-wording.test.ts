// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Workspace" means ONE thing in the product: a named group of a server's
 * databases. Before workspaces existed the word meant the whole server (the
 * whole Adminium), in some 70 catalogue strings, Milo's prompts, error
 * messages, the desktop app and the guides. Those now say "server", and the
 * sidebar group whose key is `workspace` is labelled "Pages".
 *
 * Nothing else would notice the old meaning creeping back: a string that says
 * "Ask a workspace admin" reads fine to a reviewer who has not met the new
 * groups. So this suite reads every place a person or the assistant reads
 * product words from, and fails on any "workspace" that is not in the
 * reviewed allow-lists below.
 *
 * What it reads:
 * - the en-US catalogues (`locales/en-US/*.json`), every value;
 * - the product source of the dashboard, the server and the desktop app: every
 *   string literal, template piece and JSX text, parsed with the TypeScript
 *   AST (so a `t()` fallback under a line wrap counts) — tests and stories
 *   excluded, comments never read;
 * - the desktop app's HTML shells, comments stripped;
 * - the skills and the guides (`skills/**`, `apps/docs/src/content/docs/**`),
 *   code blocks and `inline code` stripped.
 *
 * What counts as words, in source: a literal that holds "workspace" and either
 * a space or a capital W. `'workspace'` (the nav-group key),
 * `'workspace-defaults'`, `'/api/v1/settings/workspace'` and
 * `adminium_workspaces` are code, and stay. A property NAME is code too
 * (`'POST /api/v1/workspaces': audited(...)`).
 *
 * Adding a string about the groups: put its key, its file or its exact text in
 * the matching list below, with a line saying why it means the group. Keep the
 * lists small: an entry that matches nothing fails, so they cannot rot.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const WORD = /\bworkspaces?\b/i;

// ─── The reviewed allow-lists: "workspace" here means the group ──────────────

/** en-US catalogue keys (`ns:dotted.key`) whose text is about the groups. */
const GROUP_KEYS: ReadonlyMap<string, string> = new Map<string, string>([
  // The sidebar, the switcher and the Workspaces dialog add theirs here.
  ['email:sendAs.byRecord', '"Send as": the sender of the workspace the record’s database is in'],
  ['email:sendAs.helper.byRecord', '"Send as": the sender of the workspace the record’s database is in'],
  ['email:sendAs.helper.noSender', '"Send as" a workspace with no sender of its own'],
  ['email:sendAs.helper.workspace', '"Send as" one workspace'],
  ['email:sendAs.workspaceFrom', '"Send as": a workspace and its From'],
  ['email:sendAs.workspaceNoSender', '"Send as": a workspace with no sender yet'],
  ['studio:workspaceSender.title', 'the sender sheet of one workspace'],
  ['studio:workspaceSender.subtitle', 'the sender sheet: mail about one workspace’s databases'],
  ['studio:workspaceSender.noMail.body', 'the sender sheet: a workspace cannot have its own sender yet'],
  ['studio:workspaceSender.postal.helper', 'the sender sheet: one workspace’s marketing mail'],
]);

/** Repo-relative path prefixes whose every "workspace" is the group. */
const GROUP_FILES: ReadonlyMap<string, string> = new Map([
  ['apps/server/src/routes/workspaces/', 'the routes that create, rename, order and delete workspaces'],
  ['apps/server/src/workspaces/', 'which workspaces a person sees, and the `workspaceId` list filter'],
  ['apps/docs/src/content/docs/reference/rest-api.md', 'documents the /workspaces routes'],
  ['apps/docs/src/content/docs/anatomy/', 'the pnpm sense: "twenty-one workspaces" are the packages of the monorepo'],
  ['apps/docs/src/content/docs/contributing/', 'the pnpm sense, as above'],
  ['apps/dashboard/src/studio/workspace-sender/', 'the sender sheet of one workspace'],
  ['apps/dashboard/src/email/editor/inspector/panels/SendAsField.tsx', '"Send as": a workspace’s sender, or the server’s'],
]);

/** Exact source strings that are about the groups. */
const GROUP_STRINGS: ReadonlyMap<string, string> = new Map([
  ['There is no such workspace.', 'a `workspaceId` the person cannot see (assistant host, last-chosen workspace)'],
  ['That database is not in this workspace. Call list_connections for the ones here.', 'Milo narrowed to the tab’s workspace'],
  ['Workspaces group databases: names and memberships, not rows.', 'row-coverage reason of the /workspaces routes'],
  ["The server's From and each workspace's name and From, no source row.", 'row-coverage reason of "Send as"’s choices'],
  ["Which sender a template goes as: the template rows and a workspace's name, no source row.", 'row-coverage reason of "Send as"'],
  ["A workspace's sender: a name and addresses on the workspace, no source row.", 'row-coverage reason of the workspace sender routes'],
]);

// ─── What counts as words ────────────────────────────────────────────────────

/** A source literal that is words, not code, and says "workspace". */
function isWorkspaceWords(text: string): boolean {
  if (!WORD.test(text)) return false;
  return /\s/.test(text) || /\bWorkspaces?\b/.test(text);
}

interface Hit {
  /** `path:line` or `ns:key`. */
  site: string;
  text: string;
  /** Repo-relative file. */
  file: string;
}

function* filesUnder(dir: string, match: RegExp): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
      yield* filesUnder(full, match);
    } else if (match.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      yield full;
    }
  }
}

/** Every string literal, template piece and JSX text in a source file that is words about "workspace". */
function sourceHits(file: string, text: string = readFileSync(file, 'utf8')): Hit[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = relative(repoRoot, file);
  const out: Hit[] = [];
  const push = (node: ts.Node, value: string): void => {
    if (!isWorkspaceWords(value)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    out.push({ site: `${rel}:${line + 1}`, text: value.trim(), file: rel });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const isName = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      const isModule = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent);
      if (!isName && !isModule) push(node, node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      push(node, node.text);
    } else if (ts.isJsxText(node)) {
      push(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Markdown prose: fenced blocks and inline code are code. */
function markdownHits(rel: string, text: string): Hit[] {
  const out: Hit[] = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const prose = line.replace(/`[^`]*`/g, '');
    if (WORD.test(prose)) out.push({ site: `${rel}:${index + 1}`, text: line.trim(), file: rel });
  });
  return out;
}

function htmlHits(rel: string, text: string): Hit[] {
  const stripped = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  return stripped
    .split('\n')
    .flatMap((line, index) => (WORD.test(line) ? [{ site: `${rel}:${index + 1}`, text: line.trim(), file: rel }] : []));
}

function catalogueHits(): { hits: Hit[]; files: number } {
  const dir = join(repoRoot, 'packages/i18n/locales/en-US');
  const out: Hit[] = [];
  const walk = (node: unknown, ns: string, path: string[]): void => {
    if (typeof node === 'string') {
      if (WORD.test(node)) out.push({ site: `${ns}:${path.join('.')}`, text: node, file: `packages/i18n/locales/en-US/${ns}.json` });
    } else if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) walk(child, ns, [...path, key]);
    }
  };
  const names = readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
  for (const name of names) walk(JSON.parse(readFileSync(join(dir, name), 'utf8')), name.slice(0, -'.json'.length), []);
  return { hits: out, files: names.length };
}

const SOURCE_ROOTS = ['apps/dashboard/src', 'apps/server/src', 'apps/desktop/src'] as const;
const PROSE_ROOTS = ['skills', 'apps/docs/src/content/docs'] as const;

function scan(): { hits: Hit[]; scanned: Record<string, number> } {
  const hits: Hit[] = [];
  const scanned: Record<string, number> = {};
  for (const root of SOURCE_ROOTS) {
    let n = 0;
    for (const file of filesUnder(join(repoRoot, root), /\.tsx?$/)) {
      n += 1;
      hits.push(...sourceHits(file));
    }
    for (const file of filesUnder(join(repoRoot, root), /\.html$/)) {
      n += 1;
      hits.push(...htmlHits(relative(repoRoot, file), readFileSync(file, 'utf8')));
    }
    scanned[root] = n;
  }
  for (const root of PROSE_ROOTS) {
    let n = 0;
    for (const file of filesUnder(join(repoRoot, root), /\.mdx?$/)) {
      n += 1;
      hits.push(...markdownHits(relative(repoRoot, file), readFileSync(file, 'utf8')));
    }
    scanned[root] = n;
  }
  const catalogue = catalogueHits();
  scanned['packages/i18n/locales/en-US'] = catalogue.files;
  return { hits: [...hits, ...catalogue.hits], scanned };
}

const allowedBy = (hit: Hit): string | null => {
  if (GROUP_KEYS.has(hit.site)) return `key ${hit.site}`;
  for (const prefix of GROUP_FILES.keys()) if (hit.file.startsWith(prefix)) return `file ${prefix}`;
  if (GROUP_STRINGS.has(hit.text)) return `string ${hit.text}`;
  return null;
};

describe('what counts as words', () => {
  it('a sentence or a capital W is words; a key, a slug, a path or a column is code', () => {
    expect(isWorkspaceWords('Ask a workspace admin')).toBe(true);
    expect(isWorkspaceWords('Workspace')).toBe(true);
    expect(isWorkspaceWords('Workspace-wide defaults')).toBe(true);
    expect(isWorkspaceWords('workspace')).toBe(false);
    expect(isWorkspaceWords('workspace-defaults')).toBe(false);
    expect(isWorkspaceWords('/api/v1/settings/workspace')).toBe(false);
    expect(isWorkspaceWords('adminium_workspaces')).toBe(false);
    expect(isWorkspaceWords('ui.workspaceView')).toBe(false);
  });

  it('reads fallbacks, templates and JSX text, and skips property names, imports and comments', () => {
    const file = join(repoRoot, 'apps/dashboard/src/planted.tsx');
    const code = [
      "import { x } from './workspace thing.js';",
      '// This workspace is a comment.',
      "const a = t('k', 'Ask a workspace admin');",
      'const b = `${n} files in this workspace`;',
      "const c = { 'POST /api/v1/workspaces': 1, workspace: 'Pages' };",
      'const d = <p>Your workspace is ready</p>;',
    ].join('\n');
    expect(sourceHits(file, code).map((hit) => hit.site)).toEqual([
      'apps/dashboard/src/planted.tsx:3',
      'apps/dashboard/src/planted.tsx:4',
      'apps/dashboard/src/planted.tsx:6',
    ]);
  });

  it('reads markdown prose, not its code', () => {
    const md = ['The `workspace` group.', '```json', '{ "group": "workspace" }', '```', 'Open Workspace settings.'].join('\n');
    expect(markdownHits('x.md', md).map((hit) => hit.site)).toEqual(['x.md:5']);
  });
});

describe('"workspace" means the group of databases, and nothing else', () => {
  const { hits, scanned } = scan();

  it('the scan reaches every tree', () => {
    for (const root of [...SOURCE_ROOTS, ...PROSE_ROOTS]) {
      expect(existsSync(join(repoRoot, root)), `${root} is not on disk`).toBe(true);
    }
    // Files read per tree (2026-11-06: 825, 1052, 49, 1037, 122, 22). A collapsed
    // count means the scan broke, not that the product got cleaner.
    expect(scanned['apps/dashboard/src']).toBeGreaterThan(700);
    expect(scanned['apps/server/src']).toBeGreaterThan(900);
    expect(scanned['apps/desktop/src']).toBeGreaterThan(30);
    expect(scanned['skills']).toBeGreaterThan(900);
    expect(scanned['apps/docs/src/content/docs']).toBeGreaterThan(100);
    expect(scanned['packages/i18n/locales/en-US']).toBeGreaterThan(20);
  });

  it('no product string uses "workspace" for the whole server', () => {
    const stray = hits.filter((hit) => allowedBy(hit) === null);
    expect(
      stray.map((hit) => `${hit.site}  ${hit.text.slice(0, 140)}`),
      'These say "workspace". The word now means a named group of databases. If one means the whole ' +
        'server, say "server". If it really is about the groups, add it to the allow-list in this file ' +
        'with the reason.',
    ).toEqual([]);
  });

  it('every allow-list entry still matches something', () => {
    const used = new Set(hits.map(allowedBy).filter((why): why is string => why !== null));
    const stale = [
      ...[...GROUP_KEYS.keys()].map((key) => `key ${key}`),
      ...[...GROUP_FILES.keys()].map((prefix) => `file ${prefix}`),
      ...[...GROUP_STRINGS.keys()].map((text) => `string ${text}`),
    ].filter((entry) => !used.has(entry));
    expect(stale, 'remove allow-list entries that no longer match anything').toEqual([]);
  });
});
