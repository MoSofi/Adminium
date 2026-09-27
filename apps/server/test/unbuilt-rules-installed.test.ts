// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An installed app whose manifest declares rules the server does not run yet:
 * the tables carrying one take no creates or changes (501 `RULE_NOT_BUILT`),
 * a table carrying none writes as ever, and a public entry using one — with
 * every entry read through it — is left out of the key's served scope, while
 * the key's sign-in stays.
 */
import { publicEndpointsRepo, publicScopesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RuleNotBuiltError } from '../src/crud/unbuilt-rules.js';
import { parseDefinition } from '../src/public-api/endpoint.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { lodgeManifest } from './tree-person-night-fixture.js';

describe.each(LEGS)('rules not built yet, on an installed app — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  beforeAll(async () => {
    if (available) h = await installInvoicing(dialect, lodgeManifest());
  }, 180_000);
  afterAll(async () => h?.close());

  it.runIf(available)('writes a table whose rules all run now: a price by the night, copies that follow, a joined text', async () => {
    const w = await writerFor(h!);
    const type = await w.create('room_types', { name: 'Garden', base_rate: 150 });
    const made = await w
      .create('stays', { email: 'mia@example.com', first_name: 'Mia', last_name: 'Okada', room_type_id: type['id'], arrive: '2026-08-01', depart: '2026-08-03' })
      .catch((error: unknown) => error);
    expect(made).not.toBeInstanceOf(RuleNotBuiltError);
    expect(Number((made as Record<string, unknown>)['room_total'])).toBe(300);
    await expect(w.writes.delete({ target: w.targetOf('stays'), pk: { id: 999_999 }, context: w.desk, announce: async () => {} })).resolves.toBe(0);
    const rule = await w.create('rate_rules', { name: 'August', amount: 20 }).catch((error: unknown) => error);
    expect(rule).not.toBeInstanceOf(RuleNotBuiltError);
  });

  it.runIf(available)('serves no entry that uses one, nor any read through it, and keeps the sign-in', async () => {
    const definitions = new Map<string, Record<string, unknown>>();
    for (const row of await publicEndpointsRepo(h!.meta).listByConnection(h!.connectionId)) {
      const parsed = parseDefinition(row.definition);
      if (parsed.ok) definitions.set(row.ref, parsed.definition as unknown as Record<string, unknown>);
    }
    const withTree = [...definitions].filter(([, d]) => d['children'] !== undefined || d['find_or_create'] !== undefined).map(([ref]) => ref);
    expect(withTree.length).toBeGreaterThan(0);
    const scopes = await publicScopesRepo(h!.meta).listByConnection(h!.connectionId);
    const served = scopes.flatMap((scope) => (JSON.parse(scope.document) as { resources: { ref: string; visibleWith?: { ref: string } }[] }).resources);
    for (const ref of withTree) expect(served.map((r) => r.ref)).not.toContain(ref);
    // Nothing served reads through an entry that is not served.
    const refs = new Set(served.map((r) => r.ref));
    for (const r of served) if (r.visibleWith !== undefined) expect(refs.has(r.visibleWith.ref)).toBe(true);
    // Each key that signs anybody in still can.
    const claimed = scopes.map((scope) => (JSON.parse(scope.document) as { claim?: unknown }).claim).filter((c) => c !== undefined);
    expect(claimed.length).toBeGreaterThan(0);
  });
});
