// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `computeTotals` against the ONE invoice money fixture
 * (34-invoices-add-on.md 34-T54, D20).
 *
 * ─── WHY THIS TREE IS IN THE FIXTURE'S SCOPE AT ALL ────────────────────────
 *
 * 34-T54 asks that every tree which computes an invoice total assert the same
 * table of cases, and names three: the add-on's renderer, the dashboard
 * canvas, and — "until O27 retires it" — the `block-*` widgets. The first two
 * were wired when the fixture was written; this is the third, and it was
 * missed. `scripts/check-invoice-money-fixture.mjs` found three byte-identical
 * COPIES and reported green, because a copy nobody reads is still a copy.
 *
 * So this file exists to make a fourth arithmetic answerable to the same law.
 *
 * ─── AND WHY IT DOES NOT ASSERT EQUALITY ───────────────────────────────────
 *
 * `computeTotals` is a DIFFERENT law, deliberately: it is the live-recomputing
 * canvas of a page-builder document bound to a table of floats, and it rounds
 * once at the end. The fixture's law rounds each LINE and works in integer
 * minor units. On the eight fixture cases the two agree exactly — every
 * quantity and rate there is whole — and the cases below say so, case by case.
 *
 * What they do NOT agree on is stated too, with a case of its own: give a line
 * a fractional quantity and the two part company, because rounding once at the
 * end is not rounding each line. That is a real difference between what the
 * builder draws and what the document renders for the same data, and it is
 * pinned here rather than left to be met on an invoice.
 *
 * O27 retires this flavor (deposited as 27-T75). Until it does, this file is
 * what stops the difference growing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeTotals } from './block-lib.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface FixtureCase {
  name: string;
  items: { qty: string; rate: string }[];
  discountRate: string;
  taxRate: string;
  expect: {
    lines: number[];
    subtotal: number;
    discount: number;
    taxBase: number;
    tax: number;
    total: number;
  };
}

const fixture = JSON.parse(
  readFileSync(join(HERE, '../../../../../apps/dashboard/src/invoices/model/money-fixture.json'), 'utf8'),
) as { cases: FixtureCase[]; law: string };

/** Minor units → the major-unit floats this tree speaks. */
const major = (minor: number): number => minor / 100;

/** The fixture writes every input as a string; this tree takes numbers. */
const numeric = (value: string): number => Number(value);

/** A case whose inputs cannot reach this tree at all — see the suite below. */
const reachesThisTree = (testCase: FixtureCase): boolean =>
  testCase.items.every((item) => Number.isFinite(numeric(item.qty)) && Number.isFinite(numeric(item.rate)));

function totalsFor(testCase: FixtureCase) {
  return computeTotals(
    testCase.items.map((item) => ({
      desc: '',
      // MAJOR units both sides: the fixture writes rates as decimal strings
      // ("2400", "0.005") and only its `expect` is in minor units.
      qty: numeric(item.qty),
      rate: numeric(item.rate),
    })) as never,
    {
      // `clamp01` bounds a rate to 0..1, so the fixture's whole-number
      // percentages have to arrive as fractions or `8` would read as 100%.
      discountRate: numeric(testCase.discountRate) / 100,
      taxRate: numeric(testCase.taxRate) / 100,
      currency: 'USD',
    } as never,
  );
}

/**
 * The cases where the two laws GIVE DIFFERENT ANSWERS, by name.
 *
 * A ratchet in both directions: a new disagreement fails this suite, and so
 * does fixing one of these without saying so. That is the point — the list is
 * the difference between the builder's canvas and the rendered document, and
 * it should only ever change deliberately.
 */
const KNOWN_DIVERGENCES = [
  "a credit note's negative lines",
  'a third decimal in the rate rounds half away from zero',
];

describe('the block-* canvas against the one money fixture (34-T54)', () => {
  it('reads a fixture with cases in it', () => {
    // An absence over an empty case list is indistinguishable from a pass —
    // the failure mode this whole fixture exists to close.
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(fixture.law).toContain('a line rounds once');
  });

  it('agrees with the wire law wherever the two laws can agree', () => {
    const disagreed: string[] = [];
    for (const testCase of fixture.cases) {
      if (!reachesThisTree(testCase)) continue;
      const totals = totalsFor(testCase);
      const same =
        Math.abs(totals.subtotal - major(testCase.expect.subtotal)) < 0.005 &&
        Math.abs(totals.discount - major(testCase.expect.discount)) < 0.005 &&
        Math.abs(totals.taxable - major(testCase.expect.taxBase)) < 0.005 &&
        Math.abs(totals.tax - major(testCase.expect.tax)) < 0.005 &&
        Math.abs(totals.total - major(testCase.expect.total)) < 0.005;
      if (!same) disagreed.push(testCase.name);
    }
    expect(
      disagreed.sort(),
      '\nThe builder canvas and the rendered document disagree on these cases. Two are known and ' +
        'listed; anything else here is a NEW divergence between what an operator is shown and ' +
        'what a customer receives:\n',
    ).toEqual([...KNOWN_DIVERGENCES].sort());
  });

  it('cannot be reached by the fixture’s text-parsing cases at all', () => {
    /*
     * `DocLineItem.qty` and `.rate` are `number`. A comma decimal mark or a
     * typographic minus is parsed — or not — long before this function, by
     * whatever put a value in the column. Asserting those cases here would be
     * testing this file's own `Number()` call and reporting it as coverage.
     */
    const unreachable = fixture.cases.filter((c) => !reachesThisTree(c)).map((c) => c.name);
    expect(unreachable.length, 'the fixture no longer carries a text case').toBeGreaterThan(0);
  });
});

describe('the two divergences, each stated', () => {
  it('a credit line computes as ZERO here and as a negative on the document', () => {
    /*
     * The larger of the two by far. `safeMoney` coerces anything not `> 0`, so
     * a three-line credit note the wire law totals at −189.00 shows as 0.00 on
     * the builder's canvas. Not a rounding difference — a whole document.
     */
    const credit = fixture.cases.find((c) => c.name === "a credit note's negative lines")!;
    expect(totalsFor(credit).subtotal).toBe(0);
    expect(credit.expect.subtotal).toBeLessThan(0);
  });

  it('rounds ONCE at the end, where the wire law rounds every line', () => {
    /*
     * Three lines of 1/3 of a unit at 10.00. Rounding each line gives
     * 3.33 × 3 = 9.99; rounding once at the end gives 10.00. One cent — and it
     * is the cent between what the builder shows an operator and what the
     * rendered document says.
     */
    const totals = computeTotals(
      [
        { desc: '', qty: 1 / 3, rate: 10 },
        { desc: '', qty: 1 / 3, rate: 10 },
        { desc: '', qty: 1 / 3, rate: 10 },
      ] as never,
      { discountRate: 0, taxRate: 0, currency: 'USD' } as never,
    );
    expect(totals.subtotal).toBe(10);
    // The wire law's answer for the same three lines: each to minor units
    // first, then summed.
    expect(Math.round((1 / 3) * 10 * 100) * 3).toBe(999);
  });
});
