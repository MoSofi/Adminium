#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Produce each skill's `references/` folder from the documentation.
 *
 *   node scripts/skills/build-references.mjs            write
 *   node scripts/skills/build-references.mjs --check    compare, exit 1 on drift
 *   node scripts/skills/build-references.mjs --self-test
 *
 * WHY THE REFERENCES ARE PRODUCED AND NOT WRITTEN. A skill that copies facts
 * out of the docs by hand is right on the day it is written and wrong a few
 * releases later, and nothing says so. Here the docs are the one source: a
 * skill's hand-written files say what to do and in what order, and every
 * fact they lean on is a file under `references/` that this script wrote
 * from a docs page. `--check` in CI fails when a docs page changed and the
 * references did not.
 *
 * WHY THE FILES ARE SMALL. A reference is read by a model, one file at a
 * time, as it needs it. The manifest reference alone is over 200 KB, more
 * than a small model's whole window. So every page is split at its headings
 * into files of at most 8 KB, with an INDEX.md that names each one in a line.
 * The ceilings are enforced here, on the hand-written files too, because a
 * skill that grows past them stops being read whole.
 *
 * Deterministic: the same inputs give the same bytes. No clock, no network.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The most a produced reference may weigh, in bytes. */
export const MAX_REFERENCE_BYTES = 8192;
/** The most a hand-written SKILL.md may weigh. */
export const MAX_SKILL_BYTES = 6144;
export const MAX_INDEX_BYTES = 8192;
const DOCS_SITE = 'https://docs.adminium.dev';

const bytes = (text) => Buffer.byteLength(text, 'utf8');

/** `Numbers without gaps` → `numbers-without-gaps`. */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Frontmatter `title` and `description`, and the body after it. */
export function parsePage(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const meta = {};
  if (match !== null) {
    for (const line of match[1].split('\n')) {
      const field = /^(title|description):\s*(.*)$/.exec(line);
      if (field !== null) meta[field[1]] = field[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return { title: meta.title ?? '', description: meta.description ?? '', body: match === null ? text : text.slice(match[0].length) };
}

/**
 * Starlight markdown as plain markdown: an aside becomes a quote, and a link
 * into the site becomes a full address (a reference file is read far from it).
 */
export function plain(body, pageUrl) {
  const out = [];
  let fence = null;
  let aside = false;
  for (const line of body.split('\n')) {
    const fenced = /^(\s*)(```+|~~~+)/.exec(line);
    if (fenced !== null) {
      if (fence === null) fence = fenced[2];
      else if (line.trim().startsWith(fence)) fence = null;
      out.push(aside ? `> ${line}` : line);
      continue;
    }
    if (fence !== null) {
      out.push(aside ? `> ${line}` : line);
      continue;
    }
    const open = /^:::(note|tip|caution|danger)(?:\[(.*)\])?\s*$/.exec(line);
    if (open !== null) {
      aside = true;
      const kind = open[1].charAt(0).toUpperCase() + open[1].slice(1);
      out.push(`> **${open[2] === undefined ? kind : `${kind}: ${open[2]}`}**`);
      continue;
    }
    if (aside && line.trim() === ':::') {
      aside = false;
      continue;
    }
    const linked = line
      .replace(/\]\((\/[^)\s]*)\)/g, (_all, path) => `](${DOCS_SITE}${path})`)
      .replace(/\]\((#[^)\s]*)\)/g, (_all, anchor) => `](${pageUrl}${anchor})`);
    out.push(aside ? `> ${linked}`.trimEnd() : linked);
  }
  return out.join('\n');
}

/** Split markdown at headings of one level, outside code fences: [{ heading, text }], the first with heading null. */
export function splitAt(body, marks) {
  const parts = [{ heading: null, lines: [] }];
  let fence = null;
  for (const line of body.split('\n')) {
    const fenced = /^\s*(```+|~~~+)/.exec(line);
    if (fenced !== null) {
      if (fence === null) fence = fenced[1];
      else if (line.trim().startsWith(fence)) fence = null;
    }
    if (fence === null && line.startsWith(`${marks} `)) {
      parts.push({ heading: line.slice(marks.length + 1).trim(), lines: [] });
      continue;
    }
    parts[parts.length - 1].lines.push(line);
  }
  return parts.map((part) => ({ heading: part.heading, text: part.lines.join('\n').trim() })).filter((part) => part.heading !== null || part.text !== '');
}

/** Cut text that is still too big at blank lines outside code fences (and, failing that, at any line). */
export function splitByParagraphs(text, limit) {
  const blocks = [];
  let current = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const fenced = /^\s*(```+|~~~+)/.exec(line);
    if (fenced !== null) {
      if (fence === null) fence = fenced[1];
      else if (line.trim().startsWith(fence)) fence = null;
    }
    if (fence === null && line.trim() === '' && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n'));

  // A single block over the limit (a long table, a long code sample) is cut by lines.
  const pieces = blocks.flatMap((block) => {
    if (bytes(block) <= limit) return [block];
    const lines = block.split('\n');
    const fencedBlock = /^\s*(```+|~~~+)/.test(lines[0] ?? '');
    const open = fencedBlock ? lines[0] : null;
    const tableHead = !fencedBlock && /^\|/.test(lines[0] ?? '') && /^\|[\s:|-]+\|$/.test(lines[1] ?? '') ? lines.slice(0, 2) : null;
    const out = [];
    let chunk = [];
    for (const line of lines) {
      if (bytes([...chunk, line].join('\n')) > limit - 64 && chunk.length > 0) {
        out.push(open !== null ? [...chunk, '```'].join('\n') : chunk.join('\n'));
        chunk = open !== null ? [open] : tableHead !== null ? [...tableHead] : [];
      }
      chunk.push(line);
    }
    if (chunk.length > 0) out.push(chunk.join('\n'));
    return out;
  });

  const out = [];
  let held = '';
  for (const piece of pieces) {
    const joined = held === '' ? piece : `${held}\n\n${piece}`;
    if (bytes(joined) > limit && held !== '') {
      out.push(held);
      held = piece;
    } else held = joined;
  }
  if (held !== '') out.push(held);
  return out;
}

/** One docs page as reference files: [{ name, heading, text }]. */
export function pageToFiles(source, opts) {
  const { title, body } = parsePage(source.text);
  const pageSlug = slug(source.page.replace(/\.mdx?$/, '').split('/').pop());
  const url = `${DOCS_SITE}/${source.page.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '')}/`.replace(/\/\/$/, '/');
  const stem = (heading) => (opts.flat === true ? heading : heading === '' ? pageSlug : `${pageSlug}--${heading}`);
  const header = (heading) => `<!-- produced from apps/docs/src/content/docs/${source.page}${heading === null ? '' : ` § ${heading}`}; do not edit -->\n`;
  const room = MAX_REFERENCE_BYTES - 512;
  const files = [];
  const push = (nameSlug, heading, text, level) => {
    const head = `${header(heading)}\n${'#'.repeat(1)} ${heading === null ? title : `${title}: ${heading}`}\n\n`;
    const pieces = bytes(text) <= room ? [text] : splitByParagraphs(text, room);
    pieces.forEach((piece, index) => {
      files.push({
        name: `${stem(nameSlug)}${index === 0 ? '' : `-${String(index + 1)}`}.md`,
        heading: heading === null ? title : heading,
        text: `${head}${piece.trim()}\n`,
        part: pieces.length > 1 ? index + 1 : 0,
        level,
      });
    });
  };

  for (const section of splitAt(plain(body, url), '##')) {
    const h2 = section.heading === null ? (opts.flat === true ? 'overview' : 'overview') : slug(section.heading);
    if (bytes(section.text) <= room) {
      if (section.text !== '') push(h2, section.heading, section.text, 2);
      continue;
    }
    for (const inner of splitAt(section.text, '###')) {
      if (inner.text === '') continue;
      if (inner.heading === null) push(h2, section.heading, inner.text, 2);
      else push(`${h2}--${slug(inner.heading)}`, `${section.heading ?? title} — ${inner.heading}`, `### ${inner.heading}\n\n${inner.text}`, 3);
    }
  }
  return files;
}

// ── generators: references that do not come from a docs page ──

function publicRoutes(repo) {
  const spec = JSON.parse(readFileSync(join(repo, 'apps/server/openapi.json'), 'utf8'));
  const rows = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!path.startsWith('/api/v1/public')) continue;
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const summary = String(operation.summary ?? operation.description ?? '').split('\n')[0].replace(/\|/g, '\\|').slice(0, 160);
      rows.push(`| \`${method.toUpperCase()}\` | \`${path}\` | ${summary} | ${Object.keys(operation.responses ?? {}).join(', ')} |`);
    }
  }
  const head = [
    '<!-- produced from apps/server/openapi.json (paths under /api/v1/public); do not edit -->',
    '',
    '# The public API: every route',
    '',
    'Every request carries the browser key: `Authorization: Bearer <publishable key>`. A customer screen',
    'does not call these by hand: `@adminiumjs/public-client` wraps them. This table is for checking',
    'that a route exists and what it answers.',
    '',
    '| Method | Path | What | Answers |',
    '|---|---|---|---|',
  ].join('\n');
  const files = [];
  let chunk = [];
  const flush = () => {
    if (chunk.length === 0) return;
    files.push({ name: `routes${files.length === 0 ? '' : `-${String(files.length + 1)}`}.md`, heading: 'The public API: every route', text: `${head}\n${chunk.join('\n')}\n`, part: files.length });
    chunk = [];
  };
  for (const row of rows) {
    if (bytes(`${head}\n${[...chunk, row].join('\n')}\n`) > MAX_REFERENCE_BYTES - 256) flush();
    chunk.push(row);
  }
  flush();
  return files;
}

function addOnCatalogue(repo) {
  const pins = JSON.parse(readFileSync(join(repo, 'scripts/release/add-ons-bundle.json'), 'utf8')).addOns ?? [];
  const text = [
    '<!-- produced from scripts/release/add-ons-bundle.json; do not edit -->',
    '',
    '# Add-ons: the first-party set',
    '',
    'The add-ons this version of Adminium bundles in its Docker image and desktop app, with the exact',
    'version of each. A newer one may exist: the live list is on the person\'s own Adminium, under',
    'Workspace settings → Add-ons.',
    '',
    '| Key | Version | Package | Fingerprint file |',
    '|---|---|---|---|',
    ...pins.map((pin) => `| \`${pin.key}\` | ${pin.version} | \`https://downloads.adminium.dev/add-ons/${pin.key}/${pin.key}-${pin.version}.tgz\` | \`${pin.key}-${pin.version}.tgz.integrity\` holding \`${pin.integrity}\` |`),
    '',
    'The key is what an app writes in `manifest/add-ons.json`. To give `adminium app try` an add-on,',
    'put its `.tgz` and a `.tgz.integrity` file holding the fingerprint above in one folder and pass',
    '`--add-ons <folder>`.',
    '',
  ].join('\n');
  return [{ name: 'add-ons.md', heading: 'Add-ons: the first-party set', text, part: 0 }];
}

const GENERATORS = { 'public-routes': publicRoutes, 'add-on-catalogue': addOnCatalogue };

/** Everything one skill's folder should hold besides its hand-written files: path → text. */
export function produceSkill(repo, skill, sources, entryCommands) {
  const out = new Map();
  const index = [];
  for (const source of sources) {
    const files =
      source.generator !== undefined
        ? GENERATORS[source.generator](repo)
        : pageToFiles({ page: source.page, text: readFileSync(join(repo, 'apps/docs/src/content/docs', source.page), 'utf8') }, source);
    for (const file of files) {
      const path = `references/${source.area}/${file.name}`;
      if (out.has(path)) throw new Error(`${skill}: two sources produce ${path}`);
      out.set(path, file.text);
      index.push({ area: source.area, path, what: file.part > 1 ? `${file.heading} (part ${String(file.part)})` : file.heading, size: bytes(file.text) });
    }
  }

  const areas = [...new Set(index.map((entry) => entry.area))];
  const table = (entries) => ['| File | What it covers | Bytes |', '|---|---|---|', ...entries.map((e) => `| \`${e.path}\` | ${e.what.replace(/\|/g, '\\|')} | ${String(e.size)} |`)].join('\n');
  const intro = [
    '<!-- produced by scripts/skills/build-references.mjs; do not edit -->',
    '',
    `# References for the \`${skill}\` skill`,
    '',
    'Produced from the Adminium documentation. Find the line for what you need, then open that one',
    'file. Every file is 8 KB or less.',
    '',
    '',
  ].join('\n');
  const whole = `${intro}${areas.map((area) => `## ${area}\n\n${table(index.filter((e) => e.area === area))}\n`).join('\n')}`;
  if (bytes(whole) <= MAX_INDEX_BYTES) out.set('references/INDEX.md', whole);
  else {
    // Too many files for one index: one line per area here, and an index in each area.
    out.set(
      'references/INDEX.md',
      `${intro}| Area | Files | Its index |\n|---|---|---|\n${areas.map((area) => `| ${area} | ${String(index.filter((e) => e.area === area).length)} | \`references/${area}/INDEX.md\` |`).join('\n')}\n`,
    );
    for (const area of areas) {
      const entries = index.filter((e) => e.area === area);
      const pages = [];
      let rows = [];
      const head = `<!-- produced by scripts/skills/build-references.mjs; do not edit -->\n\n# \`${skill}\` references: ${area}\n\n`;
      for (const entry of entries) {
        if (bytes(`${head}${table([...rows, entry])}\n`) > MAX_INDEX_BYTES - 128 && rows.length > 0) {
          pages.push(rows);
          rows = [];
        }
        rows.push(entry);
      }
      if (rows.length > 0) pages.push(rows);
      pages.forEach((page, i) => {
        const more = pages.length > 1 && i < pages.length - 1 ? `\nMore: \`references/${area}/INDEX-${String(i + 2)}.md\`\n` : '';
        out.set(`references/${area}/INDEX${i === 0 ? '' : `-${String(i + 1)}`}.md`, `${head}${table(page)}\n${more}`);
      });
    }
  }
  // Each skill is installed on its own, so each carries the verbs' commands.
  if (entryCommands !== null) out.set('commands.md', entryCommands);
  return out;
}

/** Hand-written and produced files that weigh more than they may: [message]. */
export function ceilings(skillsDir, skill, produced) {
  const problems = [];
  const skillFile = join(skillsDir, skill, 'SKILL.md');
  if (!existsSync(skillFile)) problems.push(`skills/${skill}/SKILL.md is missing`);
  else if (statSync(skillFile).size > MAX_SKILL_BYTES) {
    problems.push(`skills/${skill}/SKILL.md is ${String(statSync(skillFile).size)} bytes; the most is ${String(MAX_SKILL_BYTES)}. Move detail into the docs, where a reference is produced from it.`);
  }
  for (const [path, text] of produced) {
    const limit = /INDEX(-\d+)?\.md$/.test(path) ? MAX_INDEX_BYTES : MAX_REFERENCE_BYTES;
    if (bytes(text) > limit) problems.push(`skills/${skill}/${path} would be ${String(bytes(text))} bytes; the most is ${String(limit)}`);
  }
  return problems;
}

/** Files on disk under a skill's produced folders: relative path → text. */
function onDisk(dir) {
  const out = new Map();
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(relative(dir, full).split(sep).join('/'), readFileSync(full, 'utf8'));
    }
  };
  if (existsSync(join(dir, 'references'))) walk(join(dir, 'references'));
  return out;
}

export async function run({ repo, check }) {
  const skillsDir = join(repo, 'skills');
  const config = (await import(pathToFileURL(join(skillsDir, 'references.config.mjs')).href)).default;
  const entry = Object.keys(config)[0];
  const entryCommandsFile = join(skillsDir, entry, 'commands.md');
  const entryCommands = existsSync(entryCommandsFile) ? readFileSync(entryCommandsFile, 'utf8') : null;
  const problems = [];
  let written = 0;

  for (const [skill, sources] of Object.entries(config)) {
    const produced = produceSkill(repo, skill, sources, skill === entry ? null : entryCommands);
    problems.push(...ceilings(skillsDir, skill, produced));
    const dir = join(skillsDir, skill);
    const existing = onDisk(dir);
    if (produced.has('commands.md') && existsSync(join(dir, 'commands.md'))) existing.set('commands.md', readFileSync(join(dir, 'commands.md'), 'utf8'));

    if (check) {
      for (const [path, text] of produced) {
        if (!existing.has(path)) problems.push(`skills/${skill}/${path} is missing`);
        else if (existing.get(path) !== text) problems.push(`skills/${skill}/${path} is stale`);
      }
      for (const path of existing.keys()) {
        if (!produced.has(path)) problems.push(`skills/${skill}/${path} is produced by nothing: remove it`);
      }
      continue;
    }
    rmSync(join(dir, 'references'), { recursive: true, force: true });
    for (const [path, text] of produced) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
      written += 1;
    }
  }
  return { problems, written, skills: Object.keys(config).length };
}

// ── self-test: the script proves it can fail ──

async function selfTest() {
  const fail = (message) => {
    console.error(`self-test FAILED: ${message}`);
    process.exit(1);
  };
  const dir = mkdtempSync(join(tmpdir(), 'skills-references-'));
  try {
    const docs = join(dir, 'apps/docs/src/content/docs/guides');
    mkdirSync(docs, { recursive: true });
    mkdirSync(join(dir, 'skills/one'), { recursive: true });
    mkdirSync(join(dir, 'skills/two'), { recursive: true });
    const long = Array.from({ length: 400 }, (_, i) => `Line ${String(i)} of a long section, long enough to matter.`).join('\n\n');
    writeFileSync(
      join(docs, 'page.md'),
      `---\ntitle: A page\ndescription: About a page.\n---\n\nIntro with [a link](/guides/other/).\n\n## First\n\nShort.\n\n:::caution[Careful]\nMind this.\n:::\n\n\`\`\`md\n## not a heading\n\`\`\`\n\n## Long one\n\n### Part A\n\n${long}\n\n### Part B\n\nEnd.\n`,
    );
    writeFileSync(join(dir, 'skills/references.config.mjs'), "export default { one: [{ area: 'guides', page: 'guides/page.md' }], two: [{ area: 'guides', page: 'guides/page.md' }] };\n");
    writeFileSync(join(dir, 'skills/one/SKILL.md'), '# one\n');
    writeFileSync(join(dir, 'skills/one/commands.md'), '# verbs\n');
    writeFileSync(join(dir, 'skills/two/SKILL.md'), '# two\n');

    const first = await run({ repo: dir, check: false });
    if (first.problems.length > 0) fail(`a clean write reported ${first.problems.join('; ')}`);
    const files = [...onDisk(join(dir, 'skills/one')).entries()];
    if (!files.some(([path]) => path === 'references/guides/page--first.md')) fail('no file for the "First" section');
    if (!files.some(([path]) => path === 'references/guides/page--long-one--part-a-2.md')) fail('a long section was not cut into parts');
    for (const [path, text] of files) if (bytes(text) > MAX_REFERENCE_BYTES) fail(`${path} is over the ceiling`);
    const firstFile = readFileSync(join(dir, 'skills/one/references/guides/page--first.md'), 'utf8');
    if (!firstFile.includes('> **Caution: Careful**') || !firstFile.includes('## not a heading')) fail('an aside or a fenced heading was mishandled');
    if (!readFileSync(join(dir, 'skills/one/references/guides/page--overview.md'), 'utf8').includes(`${DOCS_SITE}/guides/other/`)) fail('a site link was not made absolute');
    if (readFileSync(join(dir, 'skills/two/commands.md'), 'utf8') !== '# verbs\n') fail('the verbs were not copied to the second skill');
    if ((await run({ repo: dir, check: true })).problems.length > 0) fail('--check reported drift right after a write');

    writeFileSync(join(docs, 'page.md'), readFileSync(join(docs, 'page.md'), 'utf8').replace('Short.', 'Changed.'));
    if (!(await run({ repo: dir, check: true })).problems.some((p) => p.includes('page--first.md is stale'))) fail('--check missed a changed docs page');
    await run({ repo: dir, check: false });
    writeFileSync(join(dir, 'skills/one/references/guides/orphan.md'), 'x');
    if (!(await run({ repo: dir, check: true })).problems.some((p) => p.includes('orphan.md is produced by nothing'))) fail('--check missed an orphan');
    rmSync(join(dir, 'skills/one/references/guides/orphan.md'));
    writeFileSync(join(dir, 'skills/one/SKILL.md'), 'x'.repeat(MAX_SKILL_BYTES + 1));
    if (!(await run({ repo: dir, check: true })).problems.some((p) => p.includes('SKILL.md is'))) fail('--check missed an oversized SKILL.md');
    console.log('self-test ok — a stale reference, an orphan and an oversized skill each fail the check');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !['--check', '--self-test'].includes(arg));
  if (unknown.length > 0) {
    console.error(`unknown option(s): ${unknown.join(' ')} (usage: build-references.mjs [--check] [--self-test])`);
    process.exit(1);
  }
  if (args.includes('--self-test')) await selfTest();
  else {
    const check = args.includes('--check');
    const result = await run({ repo: REPO, check });
    if (result.problems.length > 0) {
      for (const problem of result.problems) console.error(`✗ ${problem}`);
      console.error(check ? `\n${String(result.problems.length)} problem(s). Run  pnpm run skills-references  and commit the result.` : `\n${String(result.problems.length)} problem(s).`);
      process.exit(1);
    }
    console.log(check ? `ok — the references of ${String(result.skills)} skills match the docs` : `wrote ${String(result.written)} file(s) for ${String(result.skills)} skills`);
  }
}
