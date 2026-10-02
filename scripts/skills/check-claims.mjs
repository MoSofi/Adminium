#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Hold the skills' hand-written files to the code.
 *
 *   node scripts/skills/check-claims.mjs
 *   node scripts/skills/check-claims.mjs --self-test
 *
 * A skill tells a coding agent what to run and what to write. When the code
 * moves and the skill does not, the agent is told to run a command that is
 * gone or to import a name that no longer exists, and nothing says so until a
 * person's build fails. This reads every hand-written file under `skills/`
 * (`SKILL.md`, `commands.md`, `README.md`) and checks three things:
 *
 *  1. NO HAND-KEPT LISTS. A skill that lists routes, error codes or settings
 *     by hand is the one that goes stale by omission: it is right about the
 *     seven it names and silent about the twenty-four added since. Lists
 *     belong in `references/`, produced from the docs. So a hand-written file
 *     may name at most a few of each.
 *  2. WHAT IT NAMES EXISTS: every route (in openapi.json), command and flag
 *     (in the CLI's own source), environment variable (in the server's
 *     source), error code (a string in the source), manifest part file,
 *     reference file, and every name imported from the side module or the
 *     public client in a code sample.
 *  3. COVERAGE. Every public API route and every top-level field of an app
 *     manifest appears in some skill's references — so a route or a field
 *     added with no docs behind a skill fails here.
 *
 * It cannot tell that a sentence has become untrue. That is what the trial
 * is for: the same prompts, run again before a release.
 *
 * Reads `packages/manifest/dist`, so it runs after the build.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** How many of one kind a hand-written file may name before it is keeping a list. */
export const MAX_NAMED = { routes: 3, codes: 5, variables: 3 };

const HAND_WRITTEN = ['SKILL.md', 'commands.md', 'README.md'];
/** Upper-case words in backticks that are not error codes. */
const NOT_CODES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'UTC', 'JSON', 'HTTP', 'HTTPS', 'AGPL', 'README', 'VERSION', 'INDEX', 'SKILL', 'UNLICENSED', 'TODO']);

const read = (file) => readFileSync(file, 'utf8');
const unique = (list) => [...new Set(list)];

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, keep, out);
    else if (keep(entry.name)) out.push(full);
  }
  return out;
}

/** `/api/v1/data/:connectionId/{table}` → `/api/v1/data/{}/{}`. */
export const routeShape = (path) =>
  path
    .replace(/[?#].*$/, '')
    .replace(/\/(:[A-Za-z]+|\{[^}]*\}|<[^>]*>)/g, '/{}')
    .replace(/\/$/, '');

/** What one hand-written file names. Pure: text in, claims out. */
export function claimsOf(text) {
  const lines = text.split('\n');
  const at = (index) => index + 1;
  const claims = { routes: [], commands: [], variables: [], codes: [], parts: [], references: [], imports: [] };
  lines.forEach((line, i) => {
    for (const match of line.matchAll(/\/api\/v1\/[A-Za-z0-9_\-/:{}<>.]*[A-Za-z0-9_}>]/g)) claims.routes.push({ line: at(i), value: match[0] });
    for (const match of line.matchAll(/\bADMINIUM_[A-Z0-9_]+\b/g)) claims.variables.push({ line: at(i), value: match[0] });
    for (const match of line.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{4,})`/g)) {
      if (!NOT_CODES.has(match[1]) && !match[1].startsWith('ADMINIUM_')) claims.codes.push({ line: at(i), value: match[1] });
    }
    for (const match of line.matchAll(/\bmanifest\/([a-z-]+(?:\/[*<a-z>-]+)?\.json)/g)) claims.parts.push({ line: at(i), value: match[1] });
    for (const match of line.matchAll(/references\/[A-Za-z0-9_\-/*.]+\.md/g)) claims.references.push({ line: at(i), value: match[0] });
    // `npx @adminiumjs/adminium app check <key> --json`, inside a code span or a table cell.
    for (const match of line.matchAll(/@adminiumjs\/adminium((?:\s+(?:--?[a-z][a-z-]*|[a-z][a-z-]*|<[^>]+>|\[[^\]]+\]|"[^"]*"))+)/g)) {
      const words = match[1].trim().split(/\s+/);
      const flags = [...match[1].matchAll(/--([a-z][a-z-]*)/g)].map((flag) => flag[1]);
      const names = words.filter((word) => /^[a-z][a-z-]*$/.test(word));
      if (names.length > 0 || flags.length > 0) claims.commands.push({ line: at(i), names, flags, value: match[0].trim() });
    }
  });
  // Names imported in a code sample: `import { a, type B } from '<module>'`.
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(@adminiumjs\/(?:adminium\/side|adminium\/ui|public-client))'/g)) {
    const line = text.slice(0, match.index).split('\n').length;
    for (const name of match[1].split(',').map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter((part) => part !== '')) {
      claims.imports.push({ line, module: match[2], value: name });
    }
  }
  return claims;
}

/** A glob with `*` (any run of characters but `/`) as a test. */
const globTest = (glob) => new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

/**
 * The problems in one hand-written file, given what exists.
 * `facts`: { routes:Set, commands:Map<name,{flags:Set, sub:Map}>, variables:Set, hasCode:(c)=>bool, parts:Set, exports:Map<module,Set> }
 */
export function problemsOf(file, text, facts, referenceFiles) {
  const claims = claimsOf(text);
  const out = [];
  const say = (line, message) => out.push(`${file}:${String(line)}: ${message}`);

  for (const [kind, limit] of Object.entries(MAX_NAMED)) {
    const named = unique(claims[kind].map((claim) => claim.value));
    if (named.length > limit) {
      say(claims[kind][0].line, `names ${String(named.length)} ${kind} (${named.slice(0, 4).join(', ')}, …). A list belongs in references/, produced from the docs; a hand-written file names at most ${String(limit)}.`);
    }
  }
  for (const claim of claims.routes) {
    if (!facts.routes.has(routeShape(claim.value))) say(claim.line, `the route ${claim.value} is not in apps/server/openapi.json`);
  }
  for (const claim of claims.variables) {
    if (!facts.variables.has(claim.value)) say(claim.line, `${claim.value} is not a variable the server reads`);
  }
  for (const claim of claims.codes) {
    if (!facts.hasCode(claim.value)) say(claim.line, `the code ${claim.value} is not in the source`);
  }
  for (const claim of claims.parts) {
    const part = claim.value.replace(/\/[<>a-z0-9*-]+\.json$/, '/<ref>.json');
    if (!facts.parts.has(part)) say(claim.line, `manifest/${claim.value} is not a manifest part`);
  }
  for (const claim of claims.references) {
    const test = globTest(claim.value);
    if (!referenceFiles.some((path) => test.test(path))) say(claim.line, `${claim.value} matches no produced reference`);
  }
  for (const claim of claims.commands) {
    const [first, second] = claim.names;
    if (first === undefined) continue; // `@adminiumjs/adminium --version`
    const command = facts.commands.get(first);
    if (command === undefined) {
      say(claim.line, `\`adminium ${first}\` is not a command`);
      continue;
    }
    let flags = command.flags;
    if (command.sub.size > 0 && second !== undefined) {
      const sub = command.sub.get(second);
      if (sub === undefined) {
        say(claim.line, `\`adminium ${first} ${second}\` is not a command`);
        continue;
      }
      flags = sub;
    }
    for (const flag of claim.flags) {
      if (!flags.has(flag) && !['help', 'version'].includes(flag)) say(claim.line, `\`${claim.value}\`: there is no --${flag}`);
    }
  }
  for (const claim of claims.imports) {
    if (facts.exports.get(claim.module)?.has(claim.value) !== true) say(claim.line, `${claim.module} exports no "${claim.value}"`);
  }
  return out;
}

// ── reading what exists ──

/** The flags a command file declares: every `name: { type: 'string' | 'boolean'` in it. */
function flagsIn(source) {
  return new Set([...source.matchAll(/(?:'([a-z][a-z-]*)'|\b([a-z][A-Za-z]*))\s*:\s*\{\s*(?:\n\s*)?type:\s*'(?:string|boolean)'/g)].map((m) => m[1] ?? m[2]));
}

/** The commands a registry array lists, by reading each one's own file: name → source. */
function commandsOf(registryFile, arrayName) {
  const source = read(registryFile);
  const list = new RegExp(`export const ${arrayName}: readonly Command\\[\\] = \\[([^\\]]*)\\]`).exec(source)?.[1] ?? '';
  const out = new Map();
  for (const [, identifier] of list.matchAll(/([A-Za-z]+Command)/g)) {
    const from = new RegExp(`import \\{ ${identifier} \\} from '([^']+)'`).exec(source)?.[1];
    if (from === undefined) continue;
    const file = join(dirname(registryFile), from.replace(/\.js$/, '.ts'));
    const text = read(file);
    const name = /^  name: '([a-z-]+)',$/m.exec(text)?.[1];
    const aliases = [...(/aliases: \[([^\]]*)\]/.exec(text)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    if (name !== undefined) for (const each of [name, ...aliases]) out.set(each, { file, text });
  }
  return out;
}

export async function gather(repo) {
  const server = join(repo, 'apps/server/src');
  const spec = JSON.parse(read(join(repo, 'apps/server/openapi.json')));
  const routes = new Set(Object.keys(spec.paths ?? {}).map(routeShape));

  const commands = new Map();
  for (const [name, { text }] of commandsOf(join(server, 'cli/run.ts'), 'COMMANDS')) commands.set(name, { flags: flagsIn(text), sub: new Map() });
  for (const [name, { text }] of commandsOf(join(server, 'cli/commands/app.ts'), 'APP_COMMANDS')) commands.get('app')?.sub.set(name, flagsIn(text));

  const sources = [...walk(server, (name) => name.endsWith('.ts')), ...walk(join(repo, 'packages'), (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))];
  const haystack = sources.map(read).join('\n');
  const variables = new Set([...haystack.matchAll(/\bADMINIUM_[A-Z0-9_]+\b/g)].map((m) => m[0]));
  const literals = new Set([...haystack.matchAll(/['"`]([A-Z][A-Z0-9_]{3,})['"`]/g)].map((m) => m[1]));

  const manifest = await import(pathToFileURL(join(repo, 'packages/manifest/dist/index.js')).href);
  const exportsOf = (file) => new Set([...read(file).matchAll(/^export (?:declare )?(?:async )?(?:const|function|class|interface|type|enum) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]));
  const exports = new Map([
    ['@adminiumjs/adminium/side', exportsOf(join(server, 'side/index.ts'))],
    ['@adminiumjs/adminium/ui', exportsOf(join(server, 'ui/index.ts'))],
    ['@adminiumjs/public-client', exportsOf(join(repo, 'packages/public-client/src/index.ts'))],
  ]);
  return {
    routes,
    commands,
    variables,
    hasCode: (code) => literals.has(code),
    parts: new Set(manifest.MANIFEST_PARTS),
    exports,
    publicRoutes: Object.keys(spec.paths ?? {}).filter((path) => path.startsWith('/api/v1/public')),
    manifestFields: Object.keys(manifest.appManifestSchema.shape ?? manifest.appManifestSchema._def?.shape ?? {}),
  };
}

export async function run(repo) {
  const skillsDir = join(repo, 'skills');
  const facts = await gather(repo);
  const problems = [];
  const skills = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const allReferences = [];

  for (const skill of skills) {
    const dir = join(skillsDir, skill);
    const referenceFiles = walk(join(dir, 'references'), (name) => name.endsWith('.md')).map((file) => relative(dir, file).split(sep).join('/'));
    allReferences.push(...referenceFiles.map((path) => join(dir, path)));
    for (const name of HAND_WRITTEN) {
      const file = join(dir, name);
      if (existsSync(file)) problems.push(...problemsOf(`skills/${skill}/${name}`, read(file), facts, referenceFiles));
    }
  }
  if (existsSync(join(skillsDir, 'README.md'))) problems.push(...problemsOf('skills/README.md', read(join(skillsDir, 'README.md')), facts, []));

  // Coverage: nothing public, and no top-level manifest field, is missing from every skill's references.
  const referenced = allReferences.map(read).join('\n');
  if (facts.manifestFields.length < 10) problems.push('could not read the app manifest fields from packages/manifest/dist (is it built?)');
  for (const path of facts.publicRoutes) {
    if (!referenced.includes(path)) problems.push(`no skill's references mention the public route ${path}`);
  }
  for (const field of facts.manifestFields) {
    if (!new RegExp(`[\`"]${field}[\`"]`).test(referenced)) problems.push(`no skill's references mention the manifest field "${field}"`);
  }
  return { problems, skills: skills.length, references: allReferences.length };
}

function selfTest() {
  const fail = (message) => {
    console.error(`self-test FAILED: ${message}`);
    process.exit(1);
  };
  const facts = {
    routes: new Set(['/api/v1/public/records/{}']),
    commands: new Map([['app', { flags: new Set(), sub: new Map([['check', new Set(['json'])]]) }], ['new', { flags: new Set(['yes']), sub: new Map() }]]),
    variables: new Set(['ADMINIUM_SECRET']),
    hasCode: (code) => code === 'NO_SURFACE',
    parts: new Set(['app.json', 'tables/<ref>.json']),
    exports: new Map([['@adminiumjs/adminium/side', new Set(['useStaff'])]]),
  };
  const good = [
    'Run `npx @adminiumjs/adminium app check <key> --json` and `npx @adminiumjs/adminium new <name> --yes`.',
    'It calls /api/v1/public/records/:ref and reads `ADMINIUM_SECRET`; a refusal is `NO_SURFACE`.',
    'Edit manifest/app.json and manifest/tables/jobs.json. See references/guides/page--*.md.',
    "```tsx\nimport { useStaff } from '@adminiumjs/adminium/side';\n```",
  ].join('\n');
  const clean = problemsOf('x.md', good, facts, ['references/guides/page--first.md']);
  if (clean.length > 0) fail(`a correct file was refused: ${clean.join('; ')}`);

  const cases = [
    ['a route that is gone', 'Call /api/v1/public/things/:id.', 'is not in apps/server/openapi.json'],
    ['a command that is gone', 'Run `npx @adminiumjs/adminium app publish`.', 'is not a command'],
    ['a flag that is gone', 'Run `npx @adminiumjs/adminium app check --fast`.', 'there is no --fast'],
    ['a variable nothing reads', 'Set ADMINIUM_NOPE.', 'is not a variable the server reads'],
    ['a code that is gone', 'It answers `OLD_CODE`.', 'is not in the source'],
    ['a part that is not one', 'Edit manifest/acess.json.', 'is not a manifest part'],
    ['a reference that is not produced', 'See references/guides/gone--*.md.', 'matches no produced reference'],
    ['an import that is gone', "import { useEverything } from '@adminiumjs/adminium/side';", 'exports no "useEverything"'],
    ['a hand-kept list', ['/api/v1/a', '/api/v1/b', '/api/v1/c', '/api/v1/d'].join(' '), 'A list belongs in references/'],
  ];
  for (const [what, text, expected] of cases) {
    const found = problemsOf('x.md', text, facts, []);
    if (!found.some((problem) => problem.includes(expected))) fail(`${what} was not caught (${found.join('; ') || 'no problem reported'})`);
  }
  console.log(`self-test ok — ${String(cases.length)} kinds of stale claim each fail the check`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--self-test')) {
    console.error(`unknown option(s): ${args.join(' ')} (usage: check-claims.mjs [--self-test])`);
    process.exit(1);
  }
  if (args.includes('--self-test')) selfTest();
  else {
    if (!statSync(join(REPO, 'packages/manifest/dist/index.js'), { throwIfNoEntry: false })) {
      console.error('packages/manifest/dist is missing: build first (pnpm build).');
      process.exit(1);
    }
    const result = await run(REPO);
    if (result.problems.length > 0) {
      for (const problem of result.problems) console.error(`✗ ${problem}`);
      console.error(`\n${String(result.problems.length)} claim(s) in the skills do not hold. Fix the skill, or the docs its references are produced from.`);
      process.exit(1);
    }
    console.log(`ok — ${String(result.skills)} skills name nothing that is not there, and ${String(result.references)} references cover the public API and the manifest`);
  }
}
