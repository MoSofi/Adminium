// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `compileScope` (28-public-surface.md §3.2, 28-T03).
 *
 * The example tests below pin each individual refusal. The PROPERTY tests at
 * the bottom are the ones that matter: 28 §1.1 calls this "security-critical
 * new code [that] needs property tests, not unit tests", because an example
 * test only ever proves the case its author already thought of, and the failure
 * mode here is a scope that quietly reaches one column further than intended.
 */

import { describe, expect, it } from 'vitest';

import { compileScope, publicConfigOf, ScopeCompileError } from '../src/public-api/scope.js';

const COLUMNS: Record<string, Set<string>> = {
  'public.menu_items': new Set(['id', 'name', 'price', 'category', 'image_url', 'available', 'cost_price']),
  'public.orders': new Set(['id', 'customer_id', 'total', 'status', 'placed_at', 'internal_note']),
  'public.customers': new Set(['id', 'name', 'email', 'phone', 'dob']),
};
const columnsOf = (t: string): Set<string> | null => COLUMNS[t] ?? null;

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    side: 'customer',
    timezone: 'Europe/London',
    resources: [
      {
        ref: 'menu',
        table: 'public.menu_items',
        actions: ['read'],
        expose: ['id', 'name', 'price', 'category'],
        searchable: ['name'],
        orderable: ['name'],
        where: [{ column: 'available', op: 'eq', value: true }],
      },
    ],
    ...overrides,
  };
}

function issuesOf(input: unknown): string[] {
  try {
    compileScope(input, columnsOf);
    return [];
  } catch (e) {
    if (e instanceof ScopeCompileError) return e.issues.map((i) => i.code);
    throw e;
  }
}

describe('compileScope — shape', () => {
  it('compiles a minimal valid customer scope', () => {
    const scope = compileScope(doc(), columnsOf);
    expect(scope.byRef.get('menu')?.expose).toEqual(['id', 'name', 'price', 'category']);
    expect(scope.timezone).toBe('Europe/London');
  });

  it('defaults filterable to EMPTY, not to the exposed set', () => {
    // D5(c): the dangerous default is "whatever you can see, you can filter on",
    // because filtering is a read primitive with a much finer grain than reading.
    const scope = compileScope(doc(), columnsOf);
    expect([...(scope.byRef.get('menu')?.filterable ?? [])]).toEqual([]);
  });

  it('rejects an unknown top-level key rather than ignoring it', () => {
    expect(issuesOf({ ...doc(), publicApi: true })).toContain('SCOPE_SHAPE_INVALID');
  });
});

describe('compileScope — the timezone requirement (D20)', () => {
  it('refuses a missing timezone', () => {
    const d = doc();
    delete (d as Record<string, unknown>)['timezone'];
    expect(issuesOf(d)).toContain('SCOPE_SHAPE_INVALID');
  });

  it('refuses a plausible-but-wrong zone', () => {
    // The pilot's bug was a SILENT one-hour shift. "BST" and "GMT+1" both look
    // like answers and neither is an IANA zone.
    expect(issuesOf(doc({ timezone: 'BST' }))).toContain('SCOPE_TIMEZONE_INVALID');
    expect(issuesOf(doc({ timezone: 'GMT+1' }))).toContain('SCOPE_TIMEZONE_INVALID');
  });

  it('refuses ALIASES that Intl silently remaps — the six-hour trap', () => {
    // Found by this suite, 2026-08-20. `new Intl.DateTimeFormat({timeZone})`
    // does NOT throw for these; it remaps them, so a validator built on the
    // throw passes them and ships an offset that looks like data:
    //   BST  -> Asia/Dhaka       (British Summer Time meant; Bangladesh got)
    //   EST  -> America/Panama   (a zone that never observes DST)
    //   Zulu -> UTC,  GMT -> UTC
    // Membership in `Intl.supportedValuesOf('timeZone')` is the real test.
    for (const tz of ['BST', 'EST', 'Zulu', 'GMT', 'EST5EDT', 'PST8PDT']) {
      expect(issuesOf(doc({ timezone: tz }))).toContain('SCOPE_TIMEZONE_INVALID');
    }
  });

  it('normalizes a case-difference to the canonical spelling', () => {
    // A spelling slip is a typo worth fixing for the operator; an alias is a
    // MEANING difference only they can resolve. Hence normalize one, refuse the other.
    const scope = compileScope(doc({ timezone: 'europe/london' }), columnsOf);
    expect(scope.timezone).toBe('Europe/London');
  });

  it('accepts real IANA zones', () => {
    for (const tz of ['Europe/London', 'America/New_York', 'Australia/Eucla', 'UTC']) {
      expect(issuesOf(doc({ timezone: tz }))).toEqual([]);
    }
  });
});

describe('currency (28-T34)', () => {
  it('is optional — a scope serving no money needs none', () => {
    expect(issuesOf(doc())).toEqual([]);
    expect(compileScope(doc(), columnsOf).currency).toBeNull();
  });

  it('accepts an ISO-4217 code and carries it through', () => {
    expect(compileScope(doc({ currency: 'GBP' }), columnsOf).currency).toBe('GBP');
  });

  it.each(['gbp', 'POUNDS', '£', 'GB'])('refuses %s', (bad) => {
    // A `money` column arrives as a bare decimal string, so a wrong currency
    // formats silently and wrongly — the same class of failure as a wrong zone.
    expect(issuesOf(doc({ currency: bad }))).toContain('SCOPE_SHAPE_INVALID');
  });
});

describe('compileScope — column reach (D5)', () => {
  it('refuses a filterable column that is not exposed', () => {
    expect(
      issuesOf(
        doc({
          resources: [
            {
              ref: 'menu',
              table: 'public.menu_items',
              actions: ['read'],
              expose: ['id', 'name'],
              filterable: ['cost_price'],
            },
          ],
        }),
      ),
    ).toContain('SCOPE_FILTERABLE_NOT_EXPOSED');
  });

  it('refuses a searchable column that is not exposed', () => {
    expect(
      issuesOf(
        doc({
          resources: [
            { ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id'], searchable: ['name'] },
          ],
        }),
      ),
    ).toContain('SCOPE_SEARCHABLE_NOT_EXPOSED');
  });

  it('refuses an orderable column that is not exposed', () => {
    expect(
      issuesOf(
        doc({
          resources: [
            { ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id'], orderable: ['cost_price'] },
          ],
        }),
      ),
    ).toContain('SCOPE_ORDERABLE_NOT_EXPOSED');
  });

  it('refuses a TABLE the snapshot does not have', () => {
    // Found by a live probe: a table created after the last introspection let
    // the scope compile and then failed at request time as an "unavailable
    // resource" — to an anonymous caller who can do nothing about it. The
    // operator authoring the scope is the only person who can, so it refuses
    // where they can see it.
    expect(
      issuesOf(
        doc({
          resources: [
            { ref: 'ghost', table: 'public.not_introspected', actions: ['read'], expose: ['id'] },
          ],
        }),
      ),
    ).toContain('SCOPE_TABLE_UNKNOWN');
  });

  it('does NOT refuse an unknown table when no schema was supplied', () => {
    // Studio authoring before a connection is reachable, and every unit test
    // that passes no lookup: there "unknown" means "not checked", not "absent".
    expect(() =>
      compileScope(
        doc({
          resources: [
            { ref: 'ghost', table: 'public.not_introspected', actions: ['read'], expose: ['id'] },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('refuses a column that does not exist on the table', () => {
    expect(
      issuesOf(
        doc({
          resources: [
            { ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id', 'margin'] },
          ],
        }),
      ),
    ).toContain('SCOPE_EXPOSE_UNKNOWN_COLUMN');
  });
});

describe('compileScope — writing yourself out of scope', () => {
  it('refuses a writable column that the mandatory predicate constrains', () => {
    expect(
      issuesOf(
        doc({
          resources: [
            {
              ref: 'orders',
              table: 'public.orders',
              actions: ['read', 'update'],
              expose: ['id', 'status', 'total'],
              writable: ['status'],
              where: [{ column: 'status', op: 'neq', value: 'cancelled' }],
            },
          ],
        }),
      ),
    ).toContain('SCOPE_WHERE_COLUMN_WRITABLE');
  });

  it('refuses a writable claim column', () => {
    expect(
      issuesOf(
        doc({
          resources: [
            {
              ref: 'orders',
              table: 'public.orders',
              actions: ['read', 'update'],
              expose: ['id', 'customer_id', 'status'],
              writable: ['customer_id'],
              claim: { column: 'customer_id' },
            },
          ],
        }),
      ),
    ).toContain('SCOPE_CLAIM_COLUMN_WRITABLE');
  });
});

describe('compileScope — the meta namespace is never publishable', () => {
  it.each(['adminium_users', 'public.adminium_settings', 'meta.adminium_api_keys'])('refuses %s', (table) => {
    expect(
      issuesOf(doc({ resources: [{ ref: 'x', table, actions: ['read'], expose: ['id'] }] })),
    ).toContain('SCOPE_REF_META_NAMESPACE');
  });
});

describe('compileScope — claim tiers (D11/D17)', () => {
  const sensitiveDoc = (strategy: string): Record<string, unknown> =>
    doc({
      claim: { strategy, ref: 'patients', match: ['phone', 'dob'] },
      resources: [
        {
          ref: 'patients',
          table: 'public.customers',
          actions: ['read'],
          expose: ['id', 'name'],
          sensitive: true,
          claim: { column: 'id' },
        },
      ],
    });

  it('refuses reference-lookup on a sensitive resource', () => {
    // This is the pilot app's shipped model — mobile + DOB against sequential
    // refs — and D17 rules it out for exactly this data.
    expect(issuesOf(sensitiveDoc('lookup'))).toContain('SCOPE_CLAIM_TIER_TOO_WEAK');
  });

  it('allows email-code and external on a sensitive resource', () => {
    expect(issuesOf(sensitiveDoc('email-code'))).toEqual([]);
    expect(issuesOf(sensitiveDoc('external'))).toEqual([]);
  });

  it('allows reference-lookup on a NON-sensitive resource', () => {
    expect(
      issuesOf(
        doc({
          claim: { strategy: 'lookup', ref: 'orders', match: ['id'] },
          resources: [
            {
              ref: 'orders',
              table: 'public.orders',
              actions: ['read'],
              expose: ['id', 'status'],
              claim: { column: 'id' },
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a sensitive customer resource with neither predicate nor claim', () => {
    expect(
      issuesOf(
        doc({
          resources: [
            { ref: 'patients', table: 'public.customers', actions: ['read'], expose: ['id', 'name'], sensitive: true },
          ],
        }),
      ),
    ).toContain('SCOPE_SENSITIVE_UNSCOPED');
  });

  it('refuses two-hop claim scoping', () => {
    expect(
      issuesOf(
        doc({
          resources: [
            {
              ref: 'orders',
              table: 'public.orders',
              actions: ['read'],
              expose: ['id'],
              claim: { column: 'customer_id', via: { ref: 'menu', localColumn: 'id', foreignColumn: 'id' } },
            },
          ],
        }),
      ),
    ).toContain('SCOPE_CLAIM_AMBIGUOUS');
  });
});

describe('publicConfigOf — what reaches the browser', () => {
  it('never carries the physical table, the predicate, or the sensitive flag', () => {
    const scope = compileScope(
      doc({
        resources: [
          {
            ref: 'orders',
            table: 'public.orders',
            actions: ['read'],
            expose: ['id', 'status'],
            where: [{ column: 'status', op: 'neq', value: 'draft' }],
            sensitive: true,
            claim: { column: 'customer_id' },
          },
        ],
        claim: { strategy: 'email-code', ref: 'orders', match: ['id'] },
      }),
      columnsOf,
    );
    const wire = JSON.stringify(publicConfigOf(scope));

    // The predicate is an authorization rule: publishing it tells an attacker
    // exactly which rows they are being kept away from.
    expect(wire).not.toContain('public.orders');
    expect(wire).not.toContain('draft');
    expect(wire).not.toContain('sensitive');
    expect(wire).not.toContain('customer_id');
    // …while still telling the client what it may ask for.
    expect(wire).toContain('Europe/London');
    expect(wire).toContain('status');
  });
});

/* ------------------------------------------------------------- properties */

/**
 * These generate scopes rather than asserting on hand-picked ones. The seed is
 * fixed so a failure is reproducible; `Math.random` is deliberately unused.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

describe('compileScope — properties', () => {
  const ALL = ['id', 'name', 'price', 'category', 'image_url', 'available', 'cost_price'];

  it('a compiled scope never exposes a column the document did not list (500 cases)', () => {
    const rnd = lcg(20260820);
    let compiled = 0;
    for (let i = 0; i < 500; i++) {
      const pick = (): string[] => ALL.filter(() => rnd() < 0.5);
      const expose = pick();
      if (expose.length === 0) continue;
      const exposed = new Set(expose);
      const candidate = doc({
        resources: [
          {
            ref: 'menu',
            table: 'public.menu_items',
            actions: ['read'],
            expose,
            // Draw from the exposed set so most cases compile; the refusal path
            // has its own tests above.
            filterable: pick().filter((c) => exposed.has(c)),
            searchable: pick().filter((c) => exposed.has(c)),
            orderable: pick().filter((c) => exposed.has(c)),
          },
        ],
      });
      let scope;
      try {
        scope = compileScope(candidate, columnsOf);
      } catch {
        continue;
      }
      compiled++;
      const r = scope.byRef.get('menu');
      expect(r).toBeDefined();
      const set = new Set(r?.expose ?? []);
      // The invariant: everything reachable is a subset of what was exposed.
      for (const c of r?.filterable ?? []) expect(set.has(c)).toBe(true);
      for (const c of r?.searchable ?? []) expect(set.has(c)).toBe(true);
      for (const c of r?.orderable ?? []) expect(set.has(c)).toBe(true);
      for (const c of set) expect(expose).toContain(c);
    }
    // Guard against the property passing because nothing compiled.
    expect(compiled).toBeGreaterThan(100);
  });

  it('the mandatory predicate survives compilation for every condition count (1..16)', () => {
    for (let n = 1; n <= 16; n++) {
      const where = Array.from({ length: n }, (_, k) => ({
        column: 'available',
        op: 'eq' as const,
        value: k % 2 === 0,
      }));
      const scope = compileScope(
        doc({
          resources: [
            { ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id', 'available'], where },
          ],
        }),
        columnsOf,
      );
      const m = scope.byRef.get('menu')?.mandatory;
      expect(m).not.toBeNull();
      const count = m && 'and' in m ? m.and.length : 1;
      expect(count).toBe(n);
    }
  });

  it('no resource ever compiles with an action it did not declare', () => {
    const rnd = lcg(7);
    const ACTIONS = ['read', 'create', 'update'] as const;
    for (let i = 0; i < 200; i++) {
      const declared = ACTIONS.filter(() => rnd() < 0.5);
      if (declared.length === 0) continue;
      const needsWritable = declared.some((a) => a !== 'read');
      let scope;
      try {
        scope = compileScope(
          doc({
            resources: [
              {
                ref: 'menu',
                table: 'public.menu_items',
                actions: declared,
                expose: ['id', 'name'],
                writable: needsWritable ? ['name'] : [],
              },
            ],
          }),
          columnsOf,
        );
      } catch {
        continue;
      }
      const got = [...(scope.byRef.get('menu')?.actions ?? [])].sort();
      expect(got).toEqual([...declared].sort());
    }
  });
});
