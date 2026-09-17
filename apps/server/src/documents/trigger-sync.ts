// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A document mapping's trigger IS an automation (last line, as ruled by D55).
 * This keeps the two in step.
 *
 * ─── WHY THERE IS NO TRIGGER TABLE FOR THIS TO WRITE ──────────────────────
 *
 * `adminium_record_triggers` was designed for this. The owner ruled reuse on
 * 2026-09-10 (D55) because plan 42 had already built the matcher, the 60 s
 * undo window, the per-row dedupe key and the delay-by-origin rule that
 * section specified — and because O4's only objection, that
 * `automations.manage` was reserved, had gone away when 42 un-reserved it.
 *
 * So "when a new order is created, draw an invoice" is a RULE with one step,
 * and this module is what turns the operator's choice on the mapping into
 * that rule.
 *
 * ─── IT IS IDEMPOTENT, AND THAT IS THE ANSWER TO THE COST D55 ACCEPTED ────
 *
 * The rule is visible in the Automations UI, where somebody can edit or delete
 * it — the trade D55 took, on the grounds that a rule somebody can see and is
 * told not to edit beats a render that fires from nowhere. The mitigation is
 * that this function is a full reconcile rather than a create: every write to
 * the mapping re-asserts the rule, and a rule that was deleted is recreated on
 * the next save. A mapping and its rule cannot drift for long, and they cannot
 * drift silently at all — the rule's own name and description say what owns
 * it.
 *
 * ─── `watch: false`, AND THE UI PROMISES IT ───────────────────────────────
 *
 * 42's record trigger can ALSO poll, so that rows written straight into the
 * database are noticed. A document mapping must not: the step-5 note tells
 * the operator, in eight languages, that "rows added by an import or written
 * straight into the database do not draw anything — only writes through
 * Adminium do" (D10). Leaving the poller on would make that sentence false and
 * would mint invoices for a bulk import nobody meant to invoice.
 */

import {
  automationsRepo,
  documentProfilesRepo,
  type Automation,
  type AutomationGraph,
  type AutomationTrigger,
  type DocumentProfile,
  type MetaDb,
} from '@adminium/meta';

/**
 * How the rule's description opens, so a reader knows what owns it.
 *
 * Exported for the test that pins it — this string is the only thing standing
 * between an operator and editing a rule that gets overwritten on the next
 * save of its mapping, so it is worth one assertion of its own.
 */
export const MANAGED_PREFIX = 'Managed by a document mapping';

function describeFor(profile: DocumentProfile): string {
  return (
    `${MANAGED_PREFIX} — "${profile.name}". ` +
    'Editing it here does not change the mapping, and the next save of the mapping ' +
    'will put this rule back as it was. Change it in Studio → Document mappings.'
  );
}

function triggerFor(profile: DocumentProfile): AutomationTrigger | null {
  const chosen = profile.trigger;
  if (chosen === null || chosen === undefined) return null;
  if (chosen.event === 'record.deleted') {
    /*
     * A DELETED row cannot be drawn from. The subject is read at render time,
     * with the requester's grants, and the row is gone by then — the pipeline
     * would skip every one of them with `row-gone`. Refusing here is the
     * honest place: an operator who chose it gets no rule rather than a rule
     * that never produces anything.
     */
    return null;
  }
  return {
    kind: 'record',
    event: chosen.event === 'record.created' ? 'created' : 'updated',
    connectionId: profile.connectionId,
    table: profile.table,
    // See the header. The UI promises this in eight languages.
    watch: false,
    ...(chosen.when == null ? {} : { changedColumn: chosen.when.column }),
  } as AutomationTrigger;
}

function graphFor(profile: DocumentProfile): AutomationGraph {
  return {
    version: 1,
    nodes: [
      {
        id: 'trigger',
        kind: 'trigger',
        title: profile.name,
        sub: profile.table,
      },
      {
        id: 'draw',
        kind: 'action',
        title: profile.name,
        sub: profile.kind,
        onError: false,
        action: { kind: 'document.render', profileId: profile.id },
      },
    ],
  } as AutomationGraph;
}

export interface SyncResult {
  /** The rule that now backs this mapping, or null when it has no trigger. */
  automationId: string | null;
  action: 'created' | 'updated' | 'removed' | 'none';
}

/**
 * Make the rule match the mapping.
 *
 * Called after every profile create, patch and delete. Returns what it did so
 * a route can put the id back on the profile — the link lives in the
 * profile's own `trigger` json rather than in a new column, because the
 * trigger IS what the rule is, and a column would be a second place to keep
 * them in step.
 */
export async function syncProfileTrigger(
  meta: MetaDb,
  profile: DocumentProfile | null,
  opts: { previous?: DocumentProfile | null; userId?: string | null } = {},
): Promise<SyncResult> {
  const rules = automationsRepo(meta);
  const existingId =
    (profile?.trigger as { automationId?: string } | null)?.automationId ??
    (opts.previous?.trigger as { automationId?: string } | null)?.automationId ??
    null;

  const existing: Automation | null =
    existingId === null ? null : await rules.findById(existingId);

  // The mapping is gone, or no longer fires: the rule goes with it.
  const wanted = profile === null ? null : triggerFor(profile);
  if (wanted === null) {
    if (existing !== null) await rules.remove(existing.id);
    return { automationId: null, action: existing === null ? 'none' : 'removed' };
  }

  if (existing === null) {
    const created = await rules.create({
      connectionId: profile!.connectionId,
      name: profile!.name,
      description: describeFor(profile!),
      // The rule follows the mapping's own switch: turning a mapping off must
      // stop it drawing, and that is one flag rather than two that can
      // disagree.
      enabled: profile!.enabled,
      trigger: wanted,
      graph: graphFor(profile!),
      createdBy: opts.userId ?? null,
    });
    return { automationId: created.id, action: 'created' };
  }

  await rules.update(existing.id, {
    name: profile!.name,
    description: describeFor(profile!),
    enabled: profile!.enabled,
    trigger: wanted,
    graph: graphFor(profile!),
  });
  return { automationId: existing.id, action: 'updated' };
}

/**
 * Re-assert every rule an add-on's mappings own.
 *
 * Uninstall disables the mappings; this carries that through to the rules, so
 * a write cannot enqueue a render for a provider that is gone. It is separate
 * from `syncProfileTrigger` because it runs over a SET and must not need each
 * profile's previous state.
 */
export async function syncTriggersForAddOn(
  meta: MetaDb,
  addOnKey: string,
  enabled: boolean,
): Promise<number> {
  const profiles = await documentProfilesRepo(meta).list({ addOnKey });
  const rules = automationsRepo(meta);
  let touched = 0;
  for (const profile of profiles) {
    /*
     * `?? null` because the stored key is `string | null | undefined`: a
     * mapping whose trigger the pipeline refuses to make a rule for has it
     * WRITTEN as null rather than left absent. Both mean "owns no rule", and
     * the narrower cast this used to carry said so of only one of them.
     */
    const id = (profile.trigger as { automationId?: string | null } | null)?.automationId ?? null;
    if (id === null) continue;
    const rule = await rules.findById(id);
    if (rule === null) continue;
    await rules.update(id, { enabled });
    touched += 1;
  }
  return touched;
}
