// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's source, made a person's own under a new key.
 *
 * "Make it yours" copies a published app's repository into `apps/<key>/` of a
 * project. The copy must install beside its original, so the key it was
 * written under has to become the new one wherever it is baked in. In the six
 * apps the key is also an ordinary word (`clients` and `events` are tables,
 * `pos` is a tone and a CSS prefix, `clinic` is the stem of `clinicians`), so
 * nothing here replaces a word: every change is made at a PLACE the key is
 * known to sit, and a place that was expected and not found is a problem said
 * out loud, never a silent pass.
 *
 * The manifest is changed as JSON, by field. The source is changed by file
 * and anchored pattern. Both are pure functions over text, so the six apps'
 * released sources are the test.
 */
import { LOCAL_PUBLISHER_ID, composeManifest, splitManifest, validateManifest } from '@adminium/manifest';

import { APP_BUILD_JSON, type AppBuildFile } from './own-build.js';

type Json = Record<string, unknown>;

export interface RenameResult {
  manifest: Json;
  /** Old page ref → new, for the source's own links. */
  pages: Map<string, string>;
  /** Strings that still carry the old key in a form that looks like a ref, for a person to look at. */
  leftovers: string[];
}

/** `my-shop` → `my_shop`: how the engine prefixes a table. */
export const tablePrefix = (key: string): string => key.split('-').join('_');

/** `old-x` → `new-x` when the value is the old key and a hyphen and more; null otherwise. */
function rekey(value: string, from: string, to: string): string | null {
  return value.startsWith(`${from}-`) ? `${to}-${value.slice(from.length + 1)}` : null;
}

/**
 * The manifest under a new key. `name` is what the person calls their copy.
 * Nothing but the listed fields and the strings that name them is changed.
 */
export function renameManifest(document: Json, to: string, name: string): RenameResult {
  const from = typeof document['key'] === 'string' ? document['key'] : '';
  if (from === '') throw new Error('The manifest has no key.');
  const pages = new Map<string, string>();
  for (const page of (document['pages'] as { ref?: unknown }[] | undefined) ?? []) {
    if (typeof page.ref !== 'string') continue;
    const next = rekey(page.ref, from, to);
    if (next !== null) pages.set(page.ref, next);
  }
  const templates = new Map<string, string>();
  for (const template of (document['emailTemplates'] as { key?: unknown }[] | undefined) ?? []) {
    if (typeof template.key !== 'string') continue;
    const next = rekey(template.key, from, to);
    if (next !== null) templates.set(template.key, next);
  }
  const seeds = `seeds/${from}.sample.json`;

  const text = (value: string): string => {
    const whole = pages.get(value) ?? templates.get(value);
    if (whole !== undefined) return whole;
    if (value === seeds) return `seeds/${to}.sample.json`;
    if (value.startsWith(`mft.${from}.`)) return `mft.${to}.${value.slice(from.length + 5)}`;
    if (value.startsWith(`/a/${from}/`)) return `/a/${to}/${value.slice(from.length + 4)}`;
    // A permission on one of the app's own pages: `page:@<ref>:<verb>`.
    const grant = /^page:@([a-z0-9-]+):(.+)$/.exec(value);
    if (grant !== null && pages.has(grant[1] as string)) return `page:@${pages.get(grant[1] as string) as string}:${grant[2] as string}`;
    // A link to one of the app's own pages: `/p/<ref>`, with whatever follows.
    const link = /^\/p\/([a-z0-9-]+)(.*)$/.exec(value);
    if (link !== null && pages.has(link[1] as string)) return `/p/${pages.get(link[1] as string) as string}${link[2] as string}`;
    return value;
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as Json).map(([key, inner]) => [key, walk(inner)]));
    return value;
  };

  const { updatesFrom: _updates, links: _links, ...kept } = document;
  const manifest = walk(kept) as Json;
  manifest['key'] = to;
  manifest['name'] = name;
  manifest['publisher'] = { id: LOCAL_PUBLISHER_ID, name: 'Local' };

  // What still looks like a ref of the old app: `<old>-…` as a whole value that is neither a table nor a column.
  const leftovers = new Set<string>();
  const look = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if ((value.startsWith(`${from}-`) || value.includes(`@${from}-`) || value.includes(`/${from}-`) || value.startsWith(`mft.${from}.`)) && !/\s/.test(value)) leftovers.add(`${path}: ${value}`);
    } else if (Array.isArray(value)) value.forEach((inner, index) => look(inner, `${path}.${String(index)}`));
    else if (value !== null && typeof value === 'object') for (const [key, inner] of Object.entries(value as Json)) look(inner, path === '' ? key : `${path}.${key}`);
  };
  look(manifest, '');
  return { manifest, pages, leftovers: [...leftovers] };
}

/** One change to a source file: what was looked for, and how many times it was found. */
export interface SourceChange {
  file: string;
  what: string;
  count: number;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Files that are copies shared by every app, with other apps' keys in them as examples: never changed. */
const SHARED = /(^|\/)(urlSync|publicConfig|surface-types|demo-types|demoTypes|demoEmit|surfaceEmit|surface-emit|demo-emit|embed)(\.test)?\.tsx?$/;

/** Whether a path is source the rename reads: not a test, not vendored, not the contract harness. */
export function isRenamedSource(path: string): boolean {
  if (!/^src\/.*\.(ts|tsx)$/.test(path)) return false;
  if (/\.test\.tsx?$/.test(path) || path.startsWith('src/testing/') || path.startsWith('src/contract/')) return false;
  return !SHARED.test(path);
}

/**
 * One source file under the new key. Returns the new text and what changed;
 * a file with nothing of the key in a known place comes back as it was.
 */
export function renameSource(path: string, text: string, from: string, to: string, pages: ReadonlyMap<string, string>): { text: string; changes: SourceChange[] } {
  const changes: SourceChange[] = [];
  let out = text;
  const swap = (what: string, pattern: RegExp, replace: (...groups: string[]) => string): void => {
    let count = 0;
    out = out.replace(pattern, (...found) => {
      count += 1;
      return replace(...(found.slice(0, -2) as string[]));
    });
    if (count > 0) changes.push({ file: path, what, count });
  };
  const K = escape(from);
  const quote = `(['"\`])`;

  if (path === 'package.json') {
    swap('the screens’ address', new RegExp(`/apps/${K}/`, 'g'), () => `/apps/${to}/`);
    swap('the build’s folder', new RegExp(`dist-surface/${K}/`, 'g'), () => `dist-surface/${to}/`);
    return { text: out, changes };
  }
  if (/^seeds\/.*\.sample\.json$/.test(path)) {
    swap('the sample’s app', new RegExp(`("app"\\s*:\\s*)"${K}"`), (_all, lead) => `${lead as string}"${to}"`);
    return { text: out, changes };
  }
  if (!isRenamedSource(path)) return { text: out, changes };

  // The key, named as a constant or a field: `APP_KEY = 'pos'`, `appKey: "ordering"`, `app: "clinic"`.
  swap('the key constant', new RegExp(`\\b((?:DEMO_)?APP_KEY\\s*(?::\\s*string\\s*)?=\\s*)${quote}${K}\\2`, 'g'), (_all, lead, q) => `${lead as string}${q as string}${to}${q as string}`);
  swap('the key field', new RegExp(`\\b((?:appKey|app)\\s*:\\s*)${quote}${K}\\2`, 'g'), (_all, lead, q) => `${lead as string}${q as string}${to}${q as string}`);
  // The table prefix, as a literal: `"clients_"`, `` `pos_${short}` ``.
  swap('the table prefix', new RegExp(`${quote}${K}_(\\2|\\$\\{)`, 'g'), (_all, q, tail) => `${q as string}${tablePrefix(to)}_${tail as string}`);
  // The role prefix, as a literal: `` `clinic-${role}` ``.
  swap('the role prefix', new RegExp(`\`${K}-(\\$\\{)`, 'g'), (_all, tail) => `\`${to}-${tail as string}`);
  // Links to the app's own dashboard pages, and its page refs named whole.
  for (const [before, after] of pages) {
    const ref = escape(before);
    swap(`the page ${before}`, new RegExp(`/p/${ref}(?![a-z0-9-])`, 'g'), () => `/p/${after}`);
    swap(`the page ${before}`, new RegExp(`${quote}${ref}\\1`, 'g'), (_all, q) => `${q as string}${after}${q as string}`);
  }
  // The modules the original's manifest was written from. Screens import them (an email's kinds, a public key's
  // name), so they stay, and say the new key wherever they spell a ref: nothing else in that folder starts `<key>-`.
  if (path.startsWith('src/manifest/')) {
    swap('a ref in the manifest’s modules', new RegExp(`(['"\`])${K}-`, 'g'), (_all, q) => `${q as string}${to}-`);
    swap('the manifest’s own key', new RegExp(`\\b(key\\s*:\\s*)${quote}${K}\\2`, 'g'), (_all, lead, q) => `${lead as string}${q as string}${to}${q as string}`);
  }
  swap('a text key', new RegExp(`${quote}mft\\.${K}\\.`, 'g'), (_all, q) => `${q as string}mft.${to}.`);
  // The sample file, imported by its name.
  swap('the sample file', new RegExp(`seeds/${K}\\.sample\\.json`, 'g'), () => `seeds/${to}.sample.json`);
  swap('the app’s own address', new RegExp(`/apps/${K}/`, 'g'), () => `/apps/${to}/`);
  swap('the app’s dashboard address', new RegExp(`/a/${K}/`, 'g'), () => `/a/${to}/`);
  return { text: out, changes };
}

/** What a copy leaves behind: the original's repository chores, its demo, and the generator the part files replace. */
export function isDropped(path: string): boolean {
  const top = path.split('/')[0] ?? '';
  if (['.github', '.do', 'db', 'e2e', 'node_modules', 'dist', 'dist-surface', 'dist-demo', '.git', 'test-results', 'playwright-report'].includes(top)) return true;
  if (['Dockerfile', 'Caddyfile', 'docker-compose.yml', 'playwright.config.ts', 'RELEASES.json', '.dockerignore'].includes(path)) return true;
  if (path.startsWith('src/contract/') || path.startsWith('src/testing/')) return true;
  // The original's tests are about the original: they read its manifest.json, and are not the copy's gate.
  if (/\.test\.(ts|tsx|mjs)$/.test(path)) return true;
  return ['scripts/write-manifest.ts', 'scripts/publish-app.mjs', 'scripts/r2.mjs', 'scripts/write-sample.ts'].includes(path);
}

export interface CopyPlan {
  /** Every file of the copy, by its path inside `apps/<key>/`. */
  files: Map<string, Buffer>;
  build: AppBuildFile;
  changes: SourceChange[];
  /** Why the copy cannot be trusted as it stands; empty when it can. */
  problems: string[];
}

/**
 * The build a copy is given: the app's own Vite, for each side, at the copy's address. The screens alone: the
 * original's type check also reads tests the copy leaves behind. Known before anything is fetched, so a person can
 * read it and approve it first.
 */
export function copyBuildFor(key: string): AppBuildFile {
  const side = (name: string): string => `VITE_ADMINIUM_SURFACE_SIDE=${name} node_modules/.bin/vite build --base=/apps/${key}/${name}/ --outDir dist-surface/${key}/${name}`;
  return { install: 'npm ci --ignore-scripts', command: `${side('staff')} && ${side('customer')}`, output: `dist-surface/${key}` };
}

/**
 * The whole copy, from the files of the app's repository at its release.
 * Nothing is written: the caller does that, once there are no problems.
 */
export function planCopy(source: ReadonlyMap<string, Buffer>, opts: { to: string; name: string }): CopyPlan {
  const problems: string[] = [];
  const files = new Map<string, Buffer>();
  const changes: SourceChange[] = [];
  const build = copyBuildFor(opts.to);

  const raw = source.get('manifest.json');
  if (raw === undefined) return { files, build, changes, problems: ['The app’s source has no manifest.json.'] };
  let document: Json;
  try {
    document = JSON.parse(raw.toString('utf8')) as Json;
  } catch {
    return { files, build, changes, problems: ['The app’s manifest.json does not read.'] };
  }
  const from = typeof document['key'] === 'string' ? document['key'] : '';
  if (from === '') return { files, build, changes, problems: ['The app’s manifest has no key.'] };
  const renamed = renameManifest(document, opts.to, opts.name);
  const checked = validateManifest(renamed.manifest, { allowLocalPublisher: true });
  if (!checked.ok) problems.push(...checked.issues.slice(0, 6).map((issue) => `The renamed manifest is not valid: ${issue.path}: ${issue.message}`));
  for (const left of renamed.leftovers.slice(0, 6)) problems.push(`The old key is still named in the manifest: ${left}`);

  // The manifest as part files: a model edits a table's file, not 900 KB of JSON.
  const parts = splitManifest(renamed.manifest);
  if (!composeManifest(parts).ok) problems.push('The renamed manifest cannot be written as part files.');
  for (const part of parts) files.set(`manifest/${part.path}`, Buffer.from(part.text, 'utf8'));

  for (const [path, bytes] of source) {
    if (path === 'manifest.json' || isDropped(path)) continue;
    const target = path === `seeds/${from}.sample.json` ? `seeds/${opts.to}.sample.json` : path;
    const isText = path === 'package.json' || /^seeds\/.*\.sample\.json$/.test(path) || isRenamedSource(path);
    if (!isText) {
      files.set(target, bytes);
      continue;
    }
    const done = renameSource(path, bytes.toString('utf8'), from, opts.to, renamed.pages);
    changes.push(...done.changes);
    files.set(target, Buffer.from(done.text, 'utf8'));
  }
  files.set(APP_BUILD_JSON, Buffer.from(`${JSON.stringify(build, null, 2)}\n`, 'utf8'));

  // The places every one of these apps has. One that is missing means this is not the app the rules were written for.
  const count = (what: string): number => changes.filter((change) => change.what === what).reduce((sum, change) => sum + change.count, 0);
  if (count('the screens’ address') < 2 || count('the build’s folder') < 2) problems.push('The app’s package.json does not build its screens the way these rules expect (build:surface with /apps/<key>/<side>/).');
  if (count('the key constant') < 1) problems.push('The app’s source does not name its key where these rules expect (APP_KEY).');
  return { files, build, changes, problems };
}
