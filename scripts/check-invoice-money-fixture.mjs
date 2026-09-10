#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Invoice money-fixture gate — every copy of the arithmetic law's table must
 * be byte-identical (34-invoices-add-on.md D20 as amended by O25; 34-T54).
 *
 * `money-fixture.json` is the table three trees assert against their own
 * copy of `money.ts`:
 *
 *   - `apps/dashboard/src/invoices/model/money-fixture.json`  the editor's
 *     ladder (`money.test.ts` beside it)
 *   - `apps/server/src/invoices/money-fixture.json`           the summary the
 *     server writes on every save (`test/invoice-money.test.ts`)
 *   - `add-ons/packages/invoices/src/money-fixture.json`      the add-on's
 *     renderer (34e) — a sibling checkout, optional until it exists
 *
 * None of the three may import another (01 2.3; the add-on is another
 * repository), so the law is a COPY in each, and a copy is only as good as
 * the table that holds it equal. Each tree's test proves its copy of the law
 * against its copy of the table — which is exactly why the tables themselves
 * must not drift: a tree whose fixture was edited alone would go green on a
 * law the other trees no longer share. This gate compares the files as bytes
 * rather than parsing them so a reformatting, a reordering or a trailing
 * newline is a difference too — the fixture is copied, never re-derived.
 *
 * WHAT IT REFUSES TO DO: pass by silence. The add-on's copy is optional only
 * because the package has not been created yet (34e); when it is absent the
 * gate says so on stdout, and the day it ships, drop the `optional` flag on
 * its row — the same rule `check-invoice-block-vocab.mjs` follows for the
 * block vocabulary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TRUTH = { label: 'dashboard', file: path.join(root, 'apps/dashboard/src/invoices/model/money-fixture.json') };
const COPIES = [
  { label: 'server', file: path.join(root, 'apps/server/src/invoices/money-fixture.json'), optional: false },
  /*
   * The add-on renderer (34e), which shipped on 2026-09-10 — so this row is no
   * longer optional, and the header's instruction to drop the flag "the day it
   * ships" is done.
   *
   * It is a SIBLING CHECKOUT, not a workspace: `add-ons` is its own repository
   * and CI for this repo may not have it on disk. That is the one thing the
   * flag was also buying, and it is bought back below instead — an absent
   * sibling is a NOTE, a present-but-different one is a PROBLEM. Silence about
   * a copy that exists and disagrees is the failure this gate was written for.
   */
  {
    label: 'add-on renderer',
    file: path.resolve(root, '..', 'add-ons', 'packages', 'invoices', 'src', 'money-fixture.json'),
    optional: false,
    sibling: true,
  },
];

const problems = [];
const notes = [];

if (!fs.existsSync(TRUTH.file)) {
  problems.push(`${TRUTH.label}: no fixture at ${path.relative(root, TRUTH.file)}`);
}
const truth = problems.length === 0 ? fs.readFileSync(TRUTH.file) : null;

// The fixture must at least parse as the table the tests read, or every tree
// would go red on a syntax error rather than on a number — say which it is.
if (truth !== null) {
  try {
    const parsed = JSON.parse(truth.toString('utf8'));
    for (const key of ['cases', 'breakdown', 'fx', 'format']) {
      if (!(key in parsed)) problems.push(`${TRUTH.label}: the fixture has no "${key}" table`);
    }
  } catch (error) {
    problems.push(`${TRUTH.label}: the fixture is not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

let present = 1;
for (const copy of COPIES) {
  const rel = path.relative(root, copy.file);
  if (!fs.existsSync(copy.file)) {
    const missingSibling = copy.sibling === true;
    (copy.optional || missingSibling ? notes : problems).push(
      `${copy.label}: no copy at ${rel}` +
        (missingSibling ? ' (sibling repository not checked out — not a failure)' : '') +
        (copy.optional ? ' (not created yet — 34e)' : ''),
    );
    continue;
  }
  present += 1;
  if (truth === null) continue;
  const theirs = fs.readFileSync(copy.file);
  if (!theirs.equals(truth)) {
    // Name the first differing byte so the fix is a copy, not a hunt.
    const limit = Math.min(theirs.length, truth.length);
    let offset = 0;
    while (offset < limit && theirs[offset] === truth[offset]) offset += 1;
    problems.push(
      `${copy.label}: ${rel} differs from ${path.relative(root, TRUTH.file)} ` +
        `(first difference at byte ${String(offset)}; ${String(truth.length)} vs ${String(theirs.length)} bytes)`,
    );
  }
}

if (problems.length > 0) {
  console.error('Invoice money-fixture gate FAILED:\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  console.error(`Every copy is the same table. Copy ${path.relative(root, TRUTH.file)} over the others — never edit one alone.`);
  process.exit(1);
}

console.log(`Invoice money fixture OK - ${String(truth.length)} bytes; ${String(present)} of ${String(1 + COPIES.length)} copies present and byte-identical.`);
for (const note of notes) console.log(`  note: ${note}`);
