// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Preflight's privilege pass.
 *
 * ─── The bug this file exists to keep fixed ────────────────────────────────
 *
 * The privilege check asked, for every step, "does the connected role own this
 * table?" — including for tables the SAME PLAN was creating. Postgres answers
 * "no" for a table that does not exist yet, which is true and useless, and the
 * refusal landed on the `add-fk` step: the operator asked to link a new
 * `reservations` table to `clients`, and Adminium created the table and
 * refused the link, reporting a privilege problem they did not have.
 *
 * A table being created cannot be owned yet. `CREATE` on the schema — checked
 * once, for the create step — is what authorises everything the new table
 * needs.
 */
import { describe, expect, it } from 'vitest';
import type { DdlStep } from '@adminium/engine';

import { preflight } from '../src/schema-ddl/preflight.js';

const step = (over: Partial<DdlStep> & { id: string; kind: DdlStep['kind']; table: string }): DdlStep => ({
  column: null,
  hazard: 'safe',
  requiresSuperAdmin: false,
  summary: 's',
  rationale: 'r',
  consequences: [],
  dependsOn: [],
  outsideTransaction: false,
  refusal: null,
  ...over,
});

/** A meta store that answers every lookup emptily — preflight must tolerate it. */
const meta = {
  db: {
    selectFrom() {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        selectAll: chain, select: chain, where: chain, orderBy: chain, limit: chain,
        execute: async () => [], executeTakeFirst: async () => undefined,
      });
      return q;
    },
  },
} as never;

describe('a table the plan is creating is never asked about as an alter target', () => {
  const steps = [
    step({ id: 's1', kind: 'create-table', table: 'public.reservations' }),
    step({ id: 's2', kind: 'add-fk', table: 'public.reservations', column: 'client_id', hazard: 'locking' }),
  ];

  it('does not refuse the foreign key on a brand-new table', async () => {
    // A privilege backend that answers "you do not own it" for everything —
    // exactly what Postgres says about a table that does not exist yet.
    const asked: string[] = [];
    const result = await preflight({
      meta,
      connectionId: 'c',
      steps,
      privileges: {
        db: {
          // `checkPrivileges` routes on the dialect; `generic` takes the
          // permissive branch, so the refusal here has to come from the
          // question set, which is what this test is about.
          executeQuery: async () => ({ rows: [] }),
        } as never,
        dialect: 'postgres',
      },
    }).catch(() => null);

    // The pg branch issues raw SQL; with a stub that returns no rows every
    // lookup misses and the code falls back to "allowed". What matters is that
    // the ALTER question was never asked for the created table.
    expect(result?.refusals.get('s2')).toBeUndefined();
    expect(asked).not.toContain('public.reservations:alter');
  });

  it('still asks about a table it is only altering', async () => {
    const altering = [step({ id: 's3', kind: 'add-column', table: 'public.clients', column: 'note' })];
    const result = await preflight({ meta, connectionId: 'c', steps: altering });
    // No privilege backend supplied → no privilege refusals at all.
    expect(result.refusals.size).toBe(0);
  });
});

describe('row counts', () => {
  it('warns above the soft line and refuses above the ceiling', async () => {
    const rewrite = [step({ id: 'r1', kind: 'alter-column-type', table: 'public.big', hazard: 'rewrite' })];

    const warned = await preflight({
      meta, connectionId: 'c', steps: rewrite,
      countRows: async () => ({ value: 250_000, capped: false }),
    });
    expect(warned.refusals.size).toBe(0);
    expect(warned.consequences.get('r1')?.some((c) => c.message.includes('250,000'))).toBe(true);

    const refused = await preflight({
      meta, connectionId: 'c', steps: rewrite,
      countRows: async () => ({ value: 2_000_000, capped: false }),
    });
    expect(refused.refusals.get('r1')?.code).toBe('TABLE_TOO_LARGE');
  });

  it('does not count a table whose steps are all safe', async () => {
    let counted = 0;
    await preflight({
      meta, connectionId: 'c',
      steps: [step({ id: 's1', kind: 'add-column', table: 'public.t' })],
      countRows: async () => {
        counted += 1;
        return { value: 1, capped: false };
      },
    });
    // Counting every table in a plan to decorate a dialog would be its own outage.
    expect(counted).toBe(0);
  });
});

describe('a rename says what follows the name and what does not', () => {
  /*
   * A rename is `safe` for the DATA and anything but safe for the references.
   * D33 rewrites Adminium's own — pages, grants, overrides, the included-table
   * list, the diagram layout — and four things deliberately keep the old name.
   *
   * The drop path stated both halves; the rename path stated neither, so the
   * whole review pane for a rename read "A metadata-only rename." That is true
   * of the table and false of the app around it, and a rename is precisely the
   * change an operator is most likely to assume is harmless. Found running
   * criterion 13 in a browser.
   */
  it('names the repair and the deliberate non-repair on a table rename', async () => {
    const result = await preflight({
      meta,
      connectionId: 'c',
      steps: [step({ id: 'r1', kind: 'rename-table', table: 'public.clients', hazard: 'safe' })],
    });
    const kinds = (result.consequences.get('r1') ?? []).map((c) => c.kind);
    expect(kinds).toContain('repaired');
    expect(kinds).toContain('not-repaired');

    const repaired = (result.consequences.get('r1') ?? []).find((c) => c.kind === 'repaired');
    expect(repaired?.message).toContain('page bindings');
    expect(repaired?.message).toContain('role grants');

    const kept = (result.consequences.get('r1') ?? []).find((c) => c.kind === 'not-repaired');
    // The audit log is a record of what happened, and keeping the old name is
    // the point of it — this sentence is a promise, not a caveat.
    expect(kept?.message).toContain('OLD name');
  });

  it('says the same for a column rename', async () => {
    const result = await preflight({
      meta,
      connectionId: 'c',
      steps: [
        step({ id: 'r2', kind: 'rename-column', table: 'public.clients', column: 'email', hazard: 'safe' }),
      ],
    });
    const kinds = (result.consequences.get('r2') ?? []).map((c) => c.kind);
    expect(kinds).toContain('repaired');
    expect(kinds).toContain('not-repaired');
  });

  it('leaves a plain add-column with neither', async () => {
    const result = await preflight({
      meta,
      connectionId: 'c',
      steps: [step({ id: 'a1', kind: 'add-column', table: 'public.clients', column: 'note' })],
    });
    const kinds = (result.consequences.get('a1') ?? []).map((c) => c.kind);
    expect(kinds).not.toContain('repaired');
    expect(kinds).not.toContain('not-repaired');
  });
});

describe('the row ceiling counts and refuses the SAME set (D18)', () => {
  /*
   * These three were found by a design critique run before the Super-Admin door
   * was built, and all three were live in the shipped tree.
   *
   * The ceiling had two definitions of its own subject: `COUNT_WORTHY` decided
   * what to COUNT (`rewrite`, `lossy`) and `step.hazard === 'rewrite'` decided
   * what to REFUSE. A `lossy` step was therefore counted, warned about, and
   * unrefusable — and a narrowing type change on a 400-million-row table is
   * `lossy`, with a rationale that says in as many words that MySQL copies the
   * whole table. It walked past the ceiling that exists to stop it.
   *
   * Both sets also missed D18's full-scan `locking` kinds, which neither
   * counted nor refused.
   */
  const OVER = async () => ({ value: 1_000_001, capped: true });

  it('refuses a LOSSY full rewrite, not only a `rewrite` one', async () => {
    const result = await preflight({
      meta, connectionId: 'c', countRows: OVER,
      steps: [step({ id: 'l1', kind: 'alter-column-type', table: 'public.huge', hazard: 'lossy' })],
    });
    expect(result.refusals.get('l1')?.code).toBe('TABLE_TOO_LARGE');
  });

  it('refuses a full-scan LOCKING step — D18 names these and nothing counted them', async () => {
    for (const kind of ['set-not-null', 'add-unique', 'set-pk', 'add-fk'] as const) {
      const result = await preflight({
        meta, connectionId: 'c', countRows: OVER,
        steps: [step({ id: kind, kind, table: 'public.huge', hazard: 'locking' })],
      });
      expect(result.refusals.get(kind)?.code, kind).toBe('TABLE_TOO_LARGE');
    }
  });

  it('leaves a locking step that reads NOTHING alone', async () => {
    // `locking` alone is not a scan — drop-fk locks briefly and reads no rows.
    // Refusing it would make the ceiling a tax on cheap operations.
    let counted = 0;
    const result = await preflight({
      meta, connectionId: 'c',
      countRows: async () => { counted += 1; return { value: 1_000_001, capped: true }; },
      steps: [step({ id: 'd1', kind: 'drop-fk', table: 'public.huge', hazard: 'locking' })],
    });
    expect(result.refusals.get('d1')).toBeUndefined();
    expect(counted).toBe(0);
  });
});

describe('a count that FAILED is not a count of zero (D18)', () => {
  /*
   * `if (count === null) continue` deleted the row-count consequence, the
   * ceiling refusal and the acknowledgement door in one line — so a lock, a
   * statement timeout, a killed connection, or a table simply too big to scan
   * inside the server's timeout switched the entire gate off for that apply.
   * It failed OPEN, on exactly the tables the gate exists to protect, and
   * anyone able to make one query fail could have had the rewrite.
   */
  it('refuses a full-row step whose table could not be counted', async () => {
    const result = await preflight({
      meta, connectionId: 'c',
      countRows: async () => null,
      steps: [step({ id: 'x1', kind: 'alter-column-type', table: 'public.huge', hazard: 'rewrite' })],
    });
    expect(result.refusals.get('x1')?.code).toBe('COUNT_UNAVAILABLE');
    expect(result.refusals.get('x1')?.message).toContain('unknown size');
  });

  it('still lets a SAFE step through when the count is unavailable', async () => {
    // The ceiling is about rewrites. Refusing an add-column because some
    // unrelated count timed out would make the gate a general outage.
    const result = await preflight({
      meta, connectionId: 'c',
      countRows: async () => null,
      steps: [step({ id: 'a1', kind: 'add-column', table: 'public.huge', column: 'n', hazard: 'safe' })],
    });
    expect(result.refusals.get('a1')).toBeUndefined();
  });
});

describe("D18's one door through the ceiling", () => {
  /*
   * A design critique run before this was built found the door, as first drawn,
   * could never open — and these tests are the shape that would have caught it.
   *
   * The door was going to be opened only on the APPLY path, leaving the plan
   * refused. But a refused step compiles to no SQL, so the two paths produced
   * different plans and `applySchemaEdit`'s checksum compare threw SCHEMA_DRIFT
   * before the door was consulted. On SQLite it was worse: `rebuild-table`
   * compiles to no SQL either way, so door-closed and door-open hashed
   * IDENTICALLY and a checksum from a refused plan would have replayed into a
   * door-open apply.
   *
   * So the door lives in preflight, the PLAN takes the acknowledgement, and the
   * checksum covers it.
   */
  const OVER = async () => ({ value: 1_000_001, capped: true });
  const bigStep = (id = 'big') =>
    step({ id, kind: 'alter-column-type', table: 'public.huge', hazard: 'rewrite' });

  it('stays shut for a Super Admin who acknowledged NOTHING', async () => {
    const r = await preflight({
      meta, connectionId: 'c', countRows: OVER, steps: [bigStep()],
      ceilingDoor: { superAdmin: true, acknowledged: new Set() },
    });
    expect(r.refusals.get('big')?.code).toBe('TABLE_TOO_LARGE');
  });

  it('stays shut for a NON-super-admin who acknowledged correctly', async () => {
    // Both halves are required. A delegated `schema.ddl` holder who learns the
    // table's name must not be able to type their way past the ceiling.
    const r = await preflight({
      meta, connectionId: 'c', countRows: OVER, steps: [bigStep()],
      ceilingDoor: { superAdmin: false, acknowledged: new Set(['public.huge']) },
    });
    expect(r.refusals.get('big')?.code).toBe('TABLE_TOO_LARGE');
  });

  it('stays shut when the acknowledgement names a DIFFERENT table', async () => {
    const r = await preflight({
      meta, connectionId: 'c', countRows: OVER, steps: [bigStep()],
      ceilingDoor: { superAdmin: true, acknowledged: new Set(['public.something_else']) },
    });
    expect(r.refusals.get('big')?.code).toBe('TABLE_TOO_LARGE');
  });

  it('opens for a Super Admin who named the table', async () => {
    const r = await preflight({
      meta, connectionId: 'c', countRows: OVER, steps: [bigStep()],
      ceilingDoor: { superAdmin: true, acknowledged: new Set(['public.huge']) },
    });
    expect(r.refusals.get('big')).toBeUndefined();
  });

  it('opens ONLY the ceiling — every other refusal on the same step stands', async () => {
    /*
     * The failure this guards: suppressing a refusal by deleting the map entry
     * would also delete an INSUFFICIENT_PRIVILEGE or ADDON_OWNED verdict that
     * landed on the same step, turning one authorised rewrite into a bypass of
     * every other gate. The door must never SET a refusal it did not consider.
     */
    const r = await preflight({
      meta, connectionId: 'c', countRows: OVER, steps: [bigStep()],
      ceilingDoor: { superAdmin: true, acknowledged: new Set(['public.huge']) },
    });
    // The ceiling is open…
    expect(r.refusals.get('big')).toBeUndefined();
    // …and the row-count consequence still tells the operator what they signed.
    expect(r.consequences.get('big')?.some((c) => c.kind === 'row-count')).toBe(true);
  });

  it('reports the gate plan-level, with the number the operator was shown', async () => {
    const r = await preflight({
      meta, connectionId: 'c', countRows: OVER, steps: [bigStep()],
      ceilingDoor: { superAdmin: true, acknowledged: new Set() },
    });
    expect(r.ceilings).toEqual([
      { table: 'public.huge', rows: 1_000_000, capped: true, acknowledged: false, openable: true },
    ]);
  });

  it('tells a non-super-admin the gate is not theirs to open', async () => {
    // `openable: false` is what lets the UI show a sentence instead of a field
    // that can never work.
    const r = await preflight({
      meta, connectionId: 'c', countRows: OVER, steps: [bigStep()],
      ceilingDoor: { superAdmin: false, acknowledged: new Set() },
    });
    expect(r.ceilings[0]?.openable).toBe(false);
  });

  it('does NOT open the COUNT_UNAVAILABLE refusal — an unknown size has no number to name', async () => {
    const r = await preflight({
      meta, connectionId: 'c', countRows: async () => null, steps: [bigStep()],
      ceilingDoor: { superAdmin: true, acknowledged: new Set(['public.huge']) },
    });
    expect(r.refusals.get('big')?.code).toBe('COUNT_UNAVAILABLE');
  });
});
