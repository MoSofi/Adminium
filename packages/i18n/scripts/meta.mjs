/**
 * Translation review-status tracking (10-i18n-theming.md §3.1/§3.3).
 *
 * Every non-English locale carries `locales/<tag>/.meta.json`:
 *
 *   { "<ns>.<dotted.key>": { "status": "mt" | "reviewed",
 *                            "srcHash": "<sha1 of the en-US text it was made from>" } }
 *
 * The point is that a bundle full of machine-drafted strings and a bundle a
 * native speaker has signed off look identical on disk. Without this file there
 * is no way to answer "can we ship these 8 locales?", and no way to notice that
 * an en-US edit has silently invalidated seven translations of it.
 *
 * `srcHash` pins the ENGLISH a translation was actually made from. Staleness is
 * DERIVED, never stored: an entry is `outdated` exactly while
 * `hash(currentEnglish) !== srcHash`. Storing it instead would be lossy — an
 * edit-then-revert of the source could never clear the flag, because the record
 * of what the translator had originally read would already be gone. The stored
 * `status` is therefore an intent (`mt` = drafted, `reviewed` = signed off) and
 * survives source churn; the translation keeps rendering either way, because
 * stale beats missing.
 *
 * Commands:
 *   node scripts/meta.mjs init      seed missing entries as `mt` (idempotent)
 *   node scripts/meta.mjs check     recompute hashes, flip drift to `outdated`,
 *                                   report coverage; exits non-zero on problems
 *   node scripts/meta.mjs review --locale de-DE [--ns ui] [--keys a,b | --all]
 *                                   mark entries `reviewed`
 *   node scripts/meta.mjs report    coverage table only, never writes
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

const SOURCE = 'en-US';
const TAGS = ['de-DE', 'fr-FR', 'cs-CZ', 'da-DK', 'zh-CN', 'zh-TW', 'ar-EG'];
const NAMESPACES = ['common', 'ui', 'studio', 'generated', 'errors'];

/** Namespaces that must be 100% `reviewed` before v1.0 (§3.3). */
const GATE_STRICT = ['common', 'ui', 'errors'];
/** …and these need ≥95%. */
const GATE_RELAXED = { studio: 0.95, generated: 0.95 };

const STATUSES = new Set(['mt', 'reviewed', 'outdated']);

const hash = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 12);

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix === '' ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

const bundle = (tag, ns) =>
  flatten(JSON.parse(fs.readFileSync(path.join(root, 'locales', tag, `${ns}.json`), 'utf8')));

/** `{ "<ns>.<key>": "<en text>" }` across every namespace. */
function sourceStrings() {
  const out = {};
  for (const ns of NAMESPACES) {
    for (const [k, v] of Object.entries(bundle(SOURCE, ns))) out[`${ns}.${k}`] = String(v);
  }
  return out;
}

const metaPath = (tag) => path.join(root, 'locales', tag, '.meta.json');

function readMeta(tag) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(tag), 'utf8'));
  } catch {
    return {};
  }
}

function writeMeta(tag, meta) {
  // Sorted so the file diffs cleanly when keys are added anywhere in the tree.
  const sorted = Object.fromEntries(Object.keys(meta).sort().map((k) => [k, meta[k]]));
  fs.writeFileSync(metaPath(tag), `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * Reconcile one locale's meta against the current en-US source.
 * Returns the updated meta plus what changed, without writing.
 */
function reconcile(tag, src) {
  const meta = readMeta(tag);
  const added = [];
  const invalidated = [];
  const removed = [];

  for (const [key, en] of Object.entries(src)) {
    const entry = meta[key];
    if (entry === undefined) {
      // In en-US but untracked here: an untranslated or freshly-drafted string.
      meta[key] = { status: 'mt', srcHash: hash(en) };
      added.push(key);
    } else if (entry.status === 'outdated') {
      // Migrate the older three-state shape: `outdated` was a derived fact
      // stored as if it were intent, which made it unrecoverable.
      meta[key] = { status: 'mt', srcHash: entry.srcHash };
    } else if (entry.srcHash !== hash(en) && entry.status === 'reviewed') {
      invalidated.push(key);
    }
  }
  for (const key of Object.keys(meta)) {
    if (!(key in src)) {
      delete meta[key];
      removed.push(key);
    }
  }
  return { meta, added, outdated: invalidated, removed };
}

/** Staleness is derived: the English no longer matches what was translated. */
function isStale(entry, en) {
  return entry.srcHash !== hash(en);
}

function coverage(meta, src) {
  const per = {};
  for (const [key, entry] of Object.entries(meta)) {
    const ns = key.slice(0, key.indexOf('.'));
    per[ns] ??= { reviewed: 0, mt: 0, outdated: 0, total: 0 };
    const stale = src[key] !== undefined && isStale(entry, src[key]);
    // A stale entry counts as neither reviewed nor freshly drafted: it is work
    // to redo, and the §3.3 gate must not treat it as done.
    per[ns][stale ? 'outdated' : entry.status] += 1;
    per[ns].total += 1;
  }
  return per;
}

function pct(n, d) {
  return d === 0 ? 1 : n / d;
}

function reportTable(src) {
  const rows = [];
  let worst = 0;
  for (const tag of TAGS) {
    const meta = readMeta(tag);
    const per = coverage(meta, src);
    const total = Object.values(per).reduce((a, b) => a + b.total, 0);
    const reviewed = Object.values(per).reduce((a, b) => a + b.reviewed, 0);
    const outdated = Object.values(per).reduce((a, b) => a + b.outdated, 0);
    rows.push({ tag, total, reviewed, outdated, per });
    worst = Math.max(worst, outdated);
  }
  const w = (s, n) => String(s).padEnd(n);
  console.log(`\n${w('locale', 9)}${w('tracked', 9)}${w('reviewed', 10)}${w('mt', 8)}${w('outdated', 9)}gate`);
  console.log('-'.repeat(60));
  for (const r of rows) {
    const mt = r.total - r.reviewed - r.outdated;
    const strictOk = GATE_STRICT.every((ns) => (r.per[ns]?.total ?? 0) === (r.per[ns]?.reviewed ?? 0));
    const relaxedOk = Object.entries(GATE_RELAXED).every(
      ([ns, need]) => pct(r.per[ns]?.reviewed ?? 0, r.per[ns]?.total ?? 0) >= need,
    );
    const gate = strictOk && relaxedOk ? 'v1.0 ready' : 'community draft';
    console.log(
      `${w(r.tag, 9)}${w(r.total, 9)}${w(`${r.reviewed} (${Math.round(pct(r.reviewed, r.total) * 100)}%)`, 10)}${w(mt, 8)}${w(r.outdated, 9)}${gate}`,
    );
  }
  console.log(
    `\nGate (§3.3): ${GATE_STRICT.join('/')} must be 100% reviewed; ` +
      `${Object.keys(GATE_RELAXED).join('/')} ≥95%. Locales below that are labelled ` +
      `"(community draft)" in the picker.`,
  );
  return rows;
}

/**
 * Rewrite `src/review-status.ts` from the tracked data. Without this the runtime
 * view is a hand-maintained copy, which is exactly how a "reviewed" badge ends
 * up lying about a bundle nobody read.
 */
function genReviewStatus(src) {
  const lines = [];
  for (const tag of TAGS) {
    const meta = readMeta(tag);
    const per = coverage(meta, src);
    const total = Object.values(per).reduce((a, b) => a + b.total, 0);
    const reviewed = Object.values(per).reduce((a, b) => a + b.reviewed, 0);
    const outdated = Object.values(per).reduce((a, b) => a + b.outdated, 0);
    const strictOk = GATE_STRICT.every((ns) => (per[ns]?.total ?? 0) === (per[ns]?.reviewed ?? 0));
    const relaxedOk = Object.entries(GATE_RELAXED).every(
      ([ns, need]) => pct(per[ns]?.reviewed ?? 0, per[ns]?.total ?? 0) >= need,
    );
    lines.push(
      `  ${tag.replace('-', '_')}: { tracked: ${total}, reviewed: ${reviewed}, ` +
        `mt: ${total - reviewed - outdated}, outdated: ${outdated}, ` +
        `shipReady: ${strictOk && relaxedOk} },`,
    );
  }
  const file = path.join(root, 'src/review-status.ts');
  const current = fs.readFileSync(file, 'utf8');
  const next = current.replace(
    /(export const REVIEW_STATUS[^=]*= \{\n)[\s\S]*?(\n\};)/,
    (_m, head, tail) => `${head}${lines.join('\n')}${tail}`,
  );
  fs.writeFileSync(file, next);
  console.log('regenerated src/review-status.ts');
}

const args = process.argv.slice(2);
const cmd = args[0] ?? 'report';
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const src = sourceStrings();

if (cmd === 'init') {
  let total = 0;
  for (const tag of TAGS) {
    const { meta, added, removed } = reconcile(tag, src);
    writeMeta(tag, meta);
    total += added.length;
    console.log(`${tag}: ${Object.keys(meta).length} tracked (+${added.length} new, -${removed.length} stale)`);
  }
  console.log(`\nSeeded ${total} entries at status "mt".`);
  genReviewStatus(src);
  reportTable(src);
} else if (cmd === 'check') {
  let problems = 0;
  for (const tag of TAGS) {
    const { meta, added, outdated, removed } = reconcile(tag, src);
    writeMeta(tag, meta);
    if (added.length > 0) {
      console.log(`${tag}: ${added.length} untracked key(s) seeded as "mt" — e.g. ${added.slice(0, 3).join(', ')}`);
      problems += added.length;
    }
    if (outdated.length > 0) {
      console.log(
        `${tag}: ${outdated.length} REVIEWED translation(s) invalidated by an en-US edit — ` +
          `e.g. ${outdated.slice(0, 3).join(', ')}`,
      );
      problems += outdated.length;
    }
    if (removed.length > 0) console.log(`${tag}: dropped ${removed.length} entry(ies) for deleted keys`);
  }
  genReviewStatus(src);
  reportTable(src);
  if (problems > 0) {
    console.log(`\n${problems} entry(ies) need attention. Re-review them, then \`meta.mjs review\`.`);
    process.exit(1);
  }
  console.log('\nNo drift.');
} else if (cmd === 'review') {
  const tag = flag('locale');
  if (tag === undefined || !TAGS.includes(tag)) {
    console.error(`--locale must be one of: ${TAGS.join(', ')}`);
    process.exit(2);
  }
  const ns = flag('ns');
  const keys = flag('keys');
  const all = args.includes('--all');
  if (!all && keys === undefined) {
    console.error('pass --all, or --keys a,b,c');
    process.exit(2);
  }
  const { meta } = reconcile(tag, src);
  const wanted = all
    ? Object.keys(meta).filter((k) => ns === undefined || k.startsWith(`${ns}.`))
    : keys.split(',').map((s) => s.trim());
  let n = 0;
  for (const k of wanted) {
    if (meta[k] === undefined) {
      console.error(`unknown key: ${k}`);
      process.exit(2);
    }
    if (meta[k].status !== 'reviewed') {
      // Pin the exact English this sign-off refers to.
      meta[k] = { status: 'reviewed', srcHash: hash(src[k]) };
      n += 1;
    }
  }
  writeMeta(tag, meta);
  console.log(`${tag}: marked ${n} entry(ies) reviewed${ns === undefined ? '' : ` in ${ns}`}.`);
} else if (cmd === 'gen') {
  genReviewStatus(src);
} else if (cmd === 'report') {
  for (const tag of TAGS) {
    if (!fs.existsSync(metaPath(tag))) {
      console.error(`${tag} has no .meta.json — run \`node scripts/meta.mjs init\` first.`);
      process.exit(2);
    }
  }
  reportTable(src);
} else {
  console.error(`unknown command: ${cmd}\nusage: meta.mjs init|check|review|report|gen`);
  process.exit(2);
}
