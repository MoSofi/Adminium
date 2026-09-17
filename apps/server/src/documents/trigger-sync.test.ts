// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A mapping's trigger, as a rule.
 *
 * The lifecycle is the whole of it, because every state change has a wrong
 * version that looks fine until somebody imports ten thousand rows:
 *
 *  - `watch: false`, always — the editor promises in eight languages that a
 *    direct database write draws nothing;
 *  - the rule follows the mapping's own switch, so turning a mapping off stops
 *    it drawing;
 *  - removing a trigger removes the rule, rather than leaving one that fires
 *    on every write and skips every time;
 *  - the reconcile is IDEMPOTENT, which is what makes a hand-deleted rule
 *    recoverable — the cost D55 knowingly accepted.
 */
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  automationsRepo,
  connectionsRepo,
  createSqliteMetaDb,
  documentProfilesRepo,
  initMetaDb,
  type DocumentProfile,
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';

import { MANAGED_PREFIX, syncProfileTrigger, syncTriggersForAddOn } from './trigger-sync.js';

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace('enc:', ''),
};

describe('a mapping’s trigger becomes a rule', () => {
  let meta: MetaDb;
  let profiles: ReturnType<typeof documentProfilesRepo>;
  let rules: ReturnType<typeof automationsRepo>;
  let connectionId: string;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await applyMigrations(meta.db, { dialect: meta.dialect });
    profiles = documentProfilesRepo(meta);
    rules = automationsRepo(meta);
    connectionId = (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;
  });

  const makeProfile = async (over: Partial<DocumentProfile> = {}) =>
    await profiles.create({
      addOnKey: 'invoices',
      kind: 'invoice',
      name: 'Invoice',
      connectionId,
      table: 'public.orders',
      mapping: {},
      ...(over.trigger === undefined ? {} : { trigger: over.trigger }),
      ...(over.enabled === undefined ? {} : { enabled: over.enabled }),
    });

  /** The reconcile, then the profile updated with the id — as the route does. */
  async function reconcile(profile: DocumentProfile, previous: DocumentProfile | null = null) {
    const result = await syncProfileTrigger(meta, profile, { previous });
    if (profile.trigger !== null) {
      await profiles.patch(profile.id, {
        trigger: { ...profile.trigger, automationId: result.automationId },
      });
    }
    return { result, profile: (await profiles.findById(profile.id))! };
  }

  it('writes NO rule for a mapping that only draws on request', async () => {
    const profile = await makeProfile();
    const { result } = await reconcile(profile);
    expect(result).toEqual({ automationId: null, action: 'none' });
    expect(await rules.list()).toHaveLength(0);
  });

  it('writes a one-step rule whose step names the mapping', async () => {
    const profile = await makeProfile({ trigger: { event: 'record.created' } });
    const { result, profile: after } = await reconcile(profile);

    expect(result.action).toBe('created');
    const rule = (await rules.findById(result.automationId!))!;
    expect(rule.trigger.kind).toBe('record');
    expect(rule.graph.nodes).toHaveLength(2);

    const step = rule.graph.nodes[1] as { kind: string; action: { kind: string; profileId: string } };
    expect(step.kind).toBe('action');
    expect(step.action.kind).toBe('document.render');
    // The step carries ONE field: everything about how the document is made
    // stays on the mapping, so the rule cannot hold a stale copy of it.
    expect(step.action.profileId).toBe(profile.id);

    // And the mapping remembers which rule fires it.
    expect((after.trigger as { automationId?: string }).automationId).toBe(result.automationId);
  });

  it('NEVER polls, because the editor promises it does not', async () => {
    /*
     * 42's record trigger can also poll, so rows written straight into the
     * database are noticed. A document mapping must not: the step-5 note
     * tells the operator, in eight languages, that an import draws nothing
     * (D10). Leaving the poller on would make that sentence false and mint
     * invoices for a bulk import nobody meant to invoice.
     */
    const profile = await makeProfile({ trigger: { event: 'record.created' } });
    const { result } = await reconcile(profile);
    const rule = (await rules.findById(result.automationId!))!;
    expect(rule.trigger).toMatchObject({ kind: 'record', watch: false });
  });

  it('says what owns it, so a reader in Workflow Logs is not guessing', async () => {
    // The cost D55 accepted: the rule is visible where somebody could edit it.
    // Naming its owner is the mitigation that costs nothing.
    const profile = await makeProfile({ trigger: { event: 'record.created' } });
    const { result } = await reconcile(profile);
    const rule = (await rules.findById(result.automationId!))!;
    expect(rule.description).toContain(MANAGED_PREFIX);
    expect(rule.description).toContain('Invoice');
  });

  it('follows the mapping’s own switch rather than carrying a second one', async () => {
    const profile = await makeProfile({ trigger: { event: 'record.created' }, enabled: false });
    const { result } = await reconcile(profile);
    expect((await rules.findById(result.automationId!))?.enabled).toBe(false);
  });

  it('UPDATES the rule in place when the mapping changes', async () => {
    const profile = await makeProfile({ trigger: { event: 'record.created' } });
    const { profile: withRule } = await reconcile(profile);
    const first = (withRule.trigger as { automationId: string }).automationId;

    const renamed = (await profiles.patch(profile.id, { name: 'Proforma' }))!;
    const { result } = await reconcile(renamed, withRule);
    // The same rule, not a second one: two rules on one table would draw two
    // documents for every row.
    expect(result.action).toBe('updated');
    expect(result.automationId).toBe(first);
    expect(await rules.list()).toHaveLength(1);
    expect((await rules.findById(first))?.name).toBe('Proforma');
  });

  it('REMOVES the rule when the trigger is taken away', async () => {
    const profile = await makeProfile({ trigger: { event: 'record.created' } });
    const { profile: withRule } = await reconcile(profile);
    const id = (withRule.trigger as { automationId: string }).automationId;

    const manual = (await profiles.patch(profile.id, { trigger: null }))!;
    const { result } = await syncProfileTrigger(meta, manual, { previous: withRule }).then(
      (r) => ({ result: r }),
    );
    expect(result.action).toBe('removed');
    // A rule left behind would fire on every write and skip every time — a run
    // row per write, in Workflow Logs, for a mapping that no longer asks.
    expect(await rules.findById(id)).toBeNull();
  });

  it('REMOVES the rule when the mapping is deleted', async () => {
    const profile = await makeProfile({ trigger: { event: 'record.created' } });
    const { profile: withRule } = await reconcile(profile);
    await profiles.remove(profile.id);
    await syncProfileTrigger(meta, null, { previous: withRule });
    expect(await rules.list()).toHaveLength(0);
  });

  it('RECREATES a rule somebody deleted by hand', async () => {
    /*
     * The mitigation for the cost D55 took. The rule is visible in the
     * Automations UI and a person can delete it; the reconcile is a full
     * re-assert rather than a create, so the next save of the mapping puts it
     * back. A mapping and its rule cannot drift for long.
     */
    const profile = await makeProfile({ trigger: { event: 'record.created' } });
    const { profile: withRule } = await reconcile(profile);
    const id = (withRule.trigger as { automationId: string }).automationId;

    await rules.remove(id);
    expect(await rules.list()).toHaveLength(0);

    const { result } = await reconcile(withRule, withRule);
    expect(result.action).toBe('created');
    expect(await rules.list()).toHaveLength(1);
  });

  it('refuses to make a rule for a DELETED-row trigger', async () => {
    /*
     * A deleted row cannot be drawn from: the subject is read at render time,
     * with the requester's grants, and the row is gone by then. The pipeline
     * would skip every one with `row-gone`. Refusing here means an operator
     * who chose it gets no rule, rather than a rule that never produces
     * anything and looks like it should.
     */
    const profile = await makeProfile({ trigger: { event: 'record.deleted' } });
    const { result } = await reconcile(profile);
    expect(result.automationId).toBeNull();
    expect(await rules.list()).toHaveLength(0);
  });
});

describe('uninstalling an add-on stops its rules', () => {
  it('disables every rule its mappings own', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await applyMigrations(meta.db, { dialect: meta.dialect });
    const profiles = documentProfilesRepo(meta);
    const rules = automationsRepo(meta);
    const connectionId = (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;

    const mine = await profiles.create({
      addOnKey: 'invoices',
      kind: 'invoice',
      name: 'Invoice',
      connectionId,
      table: 'public.orders',
      mapping: {},
      trigger: { event: 'record.created' },
    });
    const result = await syncProfileTrigger(meta, mine);
    await profiles.patch(mine.id, {
      trigger: { event: 'record.created', automationId: result.automationId },
    });

    expect(await syncTriggersForAddOn(meta, 'invoices', false)).toBe(1);
    expect((await rules.findById(result.automationId!))?.enabled).toBe(false);
    // Disabling the mapping alone would leave a rule that fires on every write
    // and skips every time, for an add-on that is gone.
    expect(await syncTriggersForAddOn(meta, 'barcode-labels', false)).toBe(0);
  });

  it('leaves a mapping that owns no rule alone, and does not count it', async () => {
    /*
     * A deleted-row trigger gets no rule (above), and the route writes that
     * refusal back as `automationId: null`. Uninstall must walk past such a
     * mapping — not make it a rule on the way out, and not report it as one of
     * the rules it stopped, which is what the count is read for.
     */
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await applyMigrations(meta.db, { dialect: meta.dialect });
    const profiles = documentProfilesRepo(meta);
    const connectionId = (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;

    const refused = await profiles.create({
      addOnKey: 'invoices',
      kind: 'invoice',
      name: 'On delete',
      connectionId,
      table: 'public.orders',
      mapping: {},
      trigger: { event: 'record.deleted' },
    });
    const result = await syncProfileTrigger(meta, refused);
    expect(result.automationId).toBeNull();
    await profiles.patch(refused.id, { trigger: { event: 'record.deleted', automationId: null } });

    expect(await syncTriggersForAddOn(meta, 'invoices', false)).toBe(0);
  });
});
