// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit for an app's own screens, as built: run as the last step of
 * `pnpm build`.
 *
 * What it holds to (vite.config.ts makes it, src/kit-host/ is its source):
 *
 *  - `dist/assets/kit/kit.json` names the door, and the door is a file there
 *    that exports `mount`;
 *  - the door is small: a screen that mounts one part pays for one, so no
 *    part, no React and no words may be in it;
 *  - every file the door reaches, by a static or a dynamic import, is in
 *    `dist/assets/`: a mapped staff host passes only that directory through;
 *  - the dashboard's own page loads none of the kit's files, and the kit
 *    reaches neither the dashboard's own entry nor its translator (i18next):
 *    a part that names a module of the first paint would have an app's
 *    screen fetch it;
 *  - `kit.json` lists every sheet of the kit, the one all parts stand on
 *    first, and the kit's JavaScript reaches each of them;
 *  - a sheet of the kit styles nothing outside its wrapper: every rule's
 *    selector starts at `.adm-kit`. Tailwind's registrations of its own
 *    `--tw-*` property names are the one thing let by; they paint nothing;
 *  - no rule reads a colour of the app's page with nothing to fall back on
 *    (src/kit-host/kit-theme.css turns each to a name kit.css fills). A name
 *    the sheet itself fills under the wrapper is its own, not the page's (the
 *    map's sheet gives the map engine the names it colours its pins by);
 *  - the words files are the catalogues' (`gen-kit-words.mjs --check`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
/** The door's ceiling, gzipped. It is about 0.8 KiB today. */
const DOOR_GZ_BYTES = 3 * 1024;

function fail(message) {
  console.error(`check-kit-build: FAIL: ${message}`);
  process.exit(1);
}

const manifestPath = join(dist, 'assets', 'kit', 'kit.json');
if (!existsSync(manifestPath)) fail('dist/assets/kit/kit.json is missing. Did the build run?');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.contract !== 1) fail(`kit.json says contract ${String(manifest.contract)}, expected 1.`);
if (typeof manifest.entry !== 'string' || !/^kit-[\w-]+\.js$/.test(manifest.entry)) fail(`kit.json names no door (${String(manifest.entry)}).`);
if (!Array.isArray(manifest.styles) || manifest.styles.length === 0) fail(`kit.json lists no sheet (${JSON.stringify(manifest.styles)}).`);
for (const sheet of manifest.styles) {
  if (typeof sheet !== 'string' || !/^[\w-]+\.css$/.test(sheet) || !existsSync(join(dist, 'assets', 'kit', sheet))) fail(`kit.json names a sheet that is not there (${String(sheet)}).`);
}

const door = `assets/kit/${manifest.entry}`;
if (!existsSync(join(dist, door))) fail(`${door} is missing.`);
const doorSource = readFileSync(join(dist, door), 'utf8');
if (!/export\{[^}]*\bas mount\b|export\{[^}]*\bmount\b/.test(doorSource)) fail(`${door} does not export mount.`);
const doorGz = gzipSync(doorSource).length;
if (doorGz > DOOR_GZ_BYTES) fail(`${door} is ${String(doorGz)} bytes gz, over ${String(DOOR_GZ_BYTES)}: a part or a library is in the door. Load it with a dynamic import.`);

// Everything the door reaches.
const seen = new Set();
const queue = [door];
while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!file.startsWith('assets/')) fail(`${file} is outside assets/: a mapped staff host would not serve it.`);
  if (!existsSync(join(dist, file))) fail(`${file} is imported by the kit and is not in the build.`);
  if (!file.endsWith('.js')) continue;
  const source = readFileSync(join(dist, file), 'utf8');
  for (const found of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) queue.push(posix.join(posix.dirname(file), found[1]));
  for (const found of source.matchAll(/["'](assets\/[^"']+\.(?:js|css))["']/g)) queue.push(found[1]);
}

// The sheets: all listed, all reached, the base first, nothing outside the wrapper.
const BASE_MARK = '--adm-kit-surface:';
const onDisk = readdirSync(join(dist, 'assets', 'kit')).filter((name) => name.endsWith('.css')).sort();
if (JSON.stringify([...manifest.styles].sort()) !== JSON.stringify(onDisk)) fail(`kit.json lists ${JSON.stringify(manifest.styles)} and assets/kit/ holds ${JSON.stringify(onDisk)}.`);
for (const sheet of manifest.styles) {
  if (!seen.has(`assets/kit/${sheet}`)) fail(`no file of the kit loads ${sheet}: a part would be drawn without it.`);
}

/** The selectors of every style rule in a sheet, with the at-rules they sit in; `@property` and `@keyframes` are skipped whole. */
function selectorsOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const walk = (from, to, inside) => {
    let at = from;
    while (at < to) {
      const open = text.indexOf('{', at);
      if (open === -1 || open >= to) return;
      let depth = 1;
      let close = open + 1;
      while (close < to && depth > 0) {
        if (text[close] === '{') depth += 1;
        else if (text[close] === '}') depth -= 1;
        close += 1;
      }
      // What stands before the brace, after the last declaration or rule.
      const head = text.slice(at, open).split(/[;}]/).pop().trim();
      if (head.startsWith('@')) {
        if (/^@(media|supports|layer|container|starting-style)\b/.test(head)) walk(open + 1, close - 1, [...inside, head]);
        else if (!/^@(property|keyframes|font-face)\b/.test(head)) fail(`a sheet of the kit holds an at-rule this check does not know: ${head}`);
      } else {
        // A rule nested in this one is styled under it, so the outer selector answers for both.
        found.push({ selector: head, inside });
      }
      at = close;
    }
  };
  walk(0, text.length, []);
  return found;
}

let rules = 0;
manifest.styles.forEach((sheet, index) => {
  const css = readFileSync(join(dist, 'assets', 'kit', sheet), 'utf8');
  if (css.includes(BASE_MARK) !== (index === 0)) fail(`${sheet} is ${index === 0 ? 'first in kit.json and is not' : 'not first in kit.json and is'} the sheet that defines ${BASE_MARK}`);
  for (const { selector, inside } of selectorsOf(css)) {
    rules += 1;
    // Tailwind's own stand-in for `@property` on a browser without it: `--tw-*` values only.
    if (inside.some((rule) => /^@layer properties\b/.test(rule))) continue;
    // An escaped character (the `\,` inside an arbitrary-value class) is part of a name, not of the list.
    for (const one of selector.replace(/\\./g, '_').split(/,(?![^(]*\))/)) {
      // Tailwind writes "every child but the last" (`space-y-*`) as `:where(.adm-kit .x > :not(:last-child))`: still under the wrapper.
      if (!one.trim().replace(/^:where\(/, '').startsWith('.adm-kit')) fail(`${sheet} styles "${one.trim()}" outside the kit's wrapper${inside.length > 0 ? ` (in ${inside.join(' ')})` : ''}.`);
    }
  }
  for (const found of css.matchAll(/@property\s+(--[\w-]+)/g)) {
    if (!found[1].startsWith('--tw-')) fail(`${sheet} registers ${found[1]} on the app's page.`);
  }
  // What the sheet fills itself. Every rule is under the wrapper (checked above), so these never reach the page.
  const own = new Set([...css.matchAll(/[{;]\s*(--[\w-]+)\s*:/g)].map((found) => found[1]));
  const bare = [...css.matchAll(/var\(\s*(--(?!adm-|tw-)[\w-]+)\s*\)/g)].map((found) => found[1]).filter((name) => !own.has(name));
  if (bare.length > 0) fail(`${sheet} reads ${[...new Set(bare)].join(', ')} from the app's page with nothing to fall back on. Turn it to an --adm-kit-* name in src/kit-host/kit-theme.css and fill that in kit.css.`);
});

const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (html.includes('/assets/kit/')) fail('dist/index.html loads a file of the kit: the dashboard must not pay for it.');
// And the other way round. The dashboard's entry is the script its page names; its translator is told by its own log prefix.
const dashboardEntry = /<script[^>]+src="\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
if (dashboardEntry !== undefined && seen.has(dashboardEntry)) fail(`the kit reaches ${dashboardEntry}, the dashboard's own entry: an app's screen would load the whole dashboard.`);
for (const file of seen) {
  if (file.endsWith('.js') && readFileSync(join(dist, file), 'utf8').includes('i18next:')) fail(`the kit reaches ${file}, which holds i18next: a part imports from "@adminium/i18n" (the whole translator). Import "@adminium/i18n/react", or keep the importer out of the part.`);
}

const words = spawnSync(process.execPath, [join(root, 'scripts', 'gen-kit-words.mjs'), '--check'], { encoding: 'utf8' });
if (words.status !== 0) fail(`the kit's words are out of date. Run \`node scripts/gen-kit-words.mjs\`.\n${words.stderr}`);

const kitFiles = [...seen].filter((file) => file.startsWith('assets/kit/')).length;
console.log(`check-kit-build: OK: door ${(doorGz / 1024).toFixed(1)} KiB gz, ${String(seen.size)} files reached (${String(kitFiles)} the kit's own), ${String(manifest.styles.length)} sheets (${String(rules)} rules, all under .adm-kit), words in step`);
