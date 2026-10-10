// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RULES A MANIFEST SHIPS, INSTALLED.
 *
 * An app or an add-on may bring automation rules with it ("when a stock point
 * falls to its reorder level, write a request and tell the managers"). A
 * manifest writes them knowing nothing of the install they land on: tables by
 * their short names, a notice's roles by their keys, texts in several
 * languages, a daily time with no zone. Here each is bound to this install —
 * the real tables, the real roles, the instance's language, the database's
 * zone — checked whole exactly as a rule a person saves is, and stored as an
 * ordinary rule that also says what shipped it.
 *
 * WHOSE A SHIPPED RULE IS. The manifest's, until the owner changes it. An
 * update rewrites a rule nobody touched and leaves one somebody edited; a
 * rule the manifest no longer ships is taken away unless it was edited; an
 * uninstall does the same. "Edited" is read from a fingerprint of what was
 * written, as an app's email templates are. Whether a rule is switched on is
 * the owner's from the first install on: an update never moves the switch.
 *
 * Meta store only: no source transaction, no lock.
 */
import type { AddOnStep } from '@adminium/add-on-contracts';

import type { RuleSteps } from '../automations/validate.js';
import { createHash } from 'node:crypto';

import type { ManifestAutomation, ManifestCondition, ManifestNode, Manifest } from '@adminium/manifest';
import { auditRepo, automationsRepo, emailTemplatesRepo, rolesRepo, settingsRepo, type Automation, type AutomationGraph, type AutomationTrigger, type MetaDb } from '@adminium/meta';

import { nextTickFor } from '../automations/schedule.js';
import { firstIncompleteNode, resolveRule } from '../automations/validate.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { roleSlugFor } from './manifest-roles.js';
import { canonicalJson } from './sample-data.js';

export interface AutomationsResult {
  /** Rules written: made new, or rewritten because nobody had changed them. */
  written: string[];
  /** Rules of the same key the owner changed: left as they are. */
  kept: string[];
  /** Unedited rules the manifest no longer ships. */
  removed: string[];
}

type Words = string | Readonly<Record<string, string>>;

/** A trigger without the zone its schedule runs in: the zone is the install's, and changing it is no edit of the rule. */
function withoutZone(trigger: AutomationTrigger): unknown {
  if (trigger.kind !== 'schedule' || trigger.schedule.kind === 'interval') return trigger;
  const { timezone: _timezone, ...schedule } = trigger.schedule;
  return { ...trigger, schedule };
}

/** The fingerprint of a rule as the store keeps it, the same however its JSON was ordered. */
export function automationHashOf(rule: Pick<Automation, 'name' | 'description' | 'trigger' | 'graph'>): string {
  return createHash('sha256')
    .update(canonicalJson({ name: rule.name, description: rule.description, trigger: withoutZone(rule.trigger), graph: rule.graph }))
    .digest('hex');
}

interface Binding {
  connectionId: string;
  realId: (ref: string) => string;
  roleId: (key: string) => string;
  timezone: string;
  /** The instance's language as a manifest spells one (`de-DE`). */
  language: string;
}

const one = (words: Words, language: string): string => (typeof words === 'string' ? words : (words[language] ?? words['en-US'] ?? Object.values(words)[0] ?? ''));

function boundCondition(condition: ManifestCondition, b: Binding): unknown {
  if (!('count' in condition.left)) return condition;
  const count = condition.left.count;
  return { ...condition, left: { count: { ...count, table: b.realId(count.table) } } };
}

function boundNode(node: unknown, b: Binding): unknown {
  const anyNode = node as Record<string, unknown> & { kind: string; title: Words; sub?: Words };
  const base = { ...anyNode, title: one(anyNode.title, b.language), ...(anyNode.sub === undefined ? {} : { sub: one(anyNode.sub, b.language) }) };
  if (anyNode.kind === 'condition') return { ...base, condition: boundCondition(anyNode['condition'] as ManifestCondition, b) };
  if (anyNode.kind === 'branch') {
    const branches = anyNode['branches'] as { id: string; label: string; nodes: ManifestNode[] }[];
    return { ...base, condition: boundCondition(anyNode['condition'] as ManifestCondition, b), branches: branches.map((branch) => ({ ...branch, nodes: branch.nodes.map((child) => boundNode(child, b)) })) };
  }
  if (anyNode.kind !== 'action') return base;
  const action = anyNode['action'] as { kind: string } & Record<string, unknown>;
  if (action.kind === 'notification') {
    const to = action['to'] as { roles: string[] };
    return { ...base, action: { ...action, to: { roles: to.roles.map((key) => b.roleId(key)) }, title: one(action['title'] as Words, b.language), ...(action['body'] === undefined ? {} : { body: one(action['body'] as Words, b.language) }) } };
  }
  if (action.kind === 'record.create') return { ...base, action: { ...action, table: b.realId(action['table'] as string) } };
  return base;
}

/** A shipped rule as this install stores it: every table, role, text and zone its own. */
function bind(rule: ManifestAutomation, b: Binding): { name: string; description: string | null; trigger: AutomationTrigger; graph: AutomationGraph } {
  const trigger =
    rule.trigger.kind === 'record'
      ? {
          kind: 'record' as const,
          event: rule.trigger.event,
          connectionId: b.connectionId,
          table: b.realId(rule.trigger.table),
          // A shipped rule runs on what Adminium itself writes: it does not poll for rows written around it.
          watch: false,
          ...(rule.trigger.changedColumn === undefined ? {} : { changedColumn: rule.trigger.changedColumn }),
          ...(rule.trigger.when === undefined ? {} : { when: rule.trigger.when.map((condition) => boundCondition(condition, b)) }),
        }
      : {
          kind: 'schedule' as const,
          connectionId: b.connectionId,
          schedule: rule.trigger.schedule.kind === 'interval' ? rule.trigger.schedule : { ...rule.trigger.schedule, timezone: b.timezone },
          ...(rule.trigger.forEach === undefined
            ? {}
            : { forEach: { table: b.realId(rule.trigger.forEach.table), once: rule.trigger.forEach.once, where: rule.trigger.forEach.where.map((condition) => boundCondition(condition, b)) } }),
        };
  return {
    name: one(rule.name, b.language),
    description: rule.description === undefined ? null : one(rule.description, b.language),
    trigger: trigger as unknown as AutomationTrigger,
    graph: { version: 1, nodes: rule.graph.nodes.map((node) => boundNode(node, b)) } as unknown as AutomationGraph,
  };
}

export interface InstallAutomationsInput {
  meta: MetaDb;
  manifest: Manifest;
  connectionId: string;
  /** The connection's tables as they stand, with this install's own among them. */
  view: SnapshotView;
  /** A table's short name → its id here; a name that is not here is answered as it came, and the check below refuses it. */
  realId: (ref: string) => string;
  at?: number | undefined;
}

/**
 * Writes the manifest's rules for one database. Returns what it did, or
 * undefined when the manifest ships none and had shipped none. A rule that
 * cannot be bound or does not pass the save's own checks throws, naming the
 * rule: a shipped rule is whole, or the install is refused.
 */
export async function installAutomations(input: InstallAutomationsInput): Promise<AutomationsResult | undefined> {
  const { meta, manifest, connectionId, view } = input;
  const at = input.at ?? Date.now();
  const repo = automationsRepo(meta);
  const shipped = ((manifest as { automations?: ManifestAutomation[] }).automations ?? []) as ManifestAutomation[];
  const mine = await repo.listManagedBy(manifest.key, connectionId);
  if (shipped.length === 0 && mine.length === 0) return undefined;

  // The steps this manifest itself gives (an add-on's `addOn.steps`), as they will stand once it is installed:
  // a rule of its own that uses one is checked against them here, before the add-on is listed as installed.
  const declared = ((manifest as { addOn?: { steps?: AddOnStep[] } }).addOn?.steps ?? []) as AddOnStep[];
  const ownSteps: RuleSteps = (addOn, step) => {
    if (addOn !== manifest.key) return { state: 'no-add-on' };
    const found = declared.find((candidate) => candidate.key === step);
    if (found === undefined) return { state: 'no-step', addOnName: manifest.name };
    const inputTables = Object.fromEntries(found.inputs.filter((one) => one.table !== undefined).map((one) => [one.key, input.realId(one.table as string)]));
    return { state: 'ok', step: { addOn, addOnName: manifest.name, step: found, table: input.realId(found.writes.table), inputTables } };
  };

  const roles = rolesRepo(meta);
  const roleIds = new Map<string, string>();
  for (const role of (manifest as { roles?: { key: string }[] }).roles ?? []) {
    const found = await roles.findBySlug(roleSlugFor(manifest.key, role.key));
    if (found !== null) roleIds.set(role.key, found.id);
  }
  const connection = await meta.db.selectFrom('adminium_connections').select('timezone').where('id', '=', connectionId).executeTakeFirst();
  const stored = await settingsRepo(meta).get('locale.default');
  const templateKeys = new Set((await emailTemplatesRepo(meta).list({ kind: 'template', archived: false })).filter((row) => row.enabled).map((row) => row.key));
  const result: AutomationsResult = { written: [], kept: [], removed: [] };

  for (const rule of shipped) {
    const refusal = (why: string): Error => new Error(`The rule "${rule.key}" of "${manifest.key}" cannot be installed: ${why}`);
    const binding: Binding = {
      connectionId,
      realId: (ref) => {
        const id = input.realId(ref);
        if (!view.model.tables.some((table) => table.id === id)) throw refusal(`it names the table "${ref}", which is not here.`);
        return id;
      },
      roleId: (key) => {
        const id = roleIds.get(key);
        if (id === undefined) throw refusal(`it tells the role "${key}", which is not here.`);
        return id;
      },
      // The database's own zone; an install with none runs a daily rule on the server's clock.
      timezone: connection?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: typeof stored === 'string' ? stored.replace('_', '-') : 'en-US',
    };
    const bound = bind(rule, binding);
    // Checked whole, as a rule a person saves is: nothing half-written is ever stored for a manifest.
    try {
      resolveRule(bound.trigger, bound.graph, { view, templateKeys, blockLoopback: true, steps: ownSteps } as never);
    } catch (error) {
      throw refusal(error instanceof Error ? error.message : String(error));
    }
    // A step of the manifest's own is held to its inputs; another add-on's is that add-on's to answer for, on the day it runs.
    const unfinished = firstIncompleteNode(bound.graph, (addOn, step) => (addOn === manifest.key ? ownSteps(addOn, step) : { state: 'ok', step: { addOn, addOnName: addOn, step: { key: step, inputs: [] } as never, table: '', inputTables: {} } }));
    if (unfinished !== null) throw refusal(`its step "${unfinished.title}" is not finished.`);

    const existing = mine.find((candidate) => candidate.templateKey === rule.key);
    if (existing === undefined) {
      const schedule = bound.trigger.kind === 'schedule' ? bound.trigger.schedule : null;
      const made = await repo.create(
        { connectionId, ...bound, enabled: rule.enabled, nextRunAt: rule.enabled && schedule !== null ? nextTickFor(schedule, at) : null, createdBy: null, managedBy: manifest.key, templateKey: rule.key, contentHash: null },
        at,
      );
      // Hashed as the store keeps it, so reading it back is never an edit.
      await repo.setHash(made.id, automationHashOf((await repo.findById(made.id)) ?? made));
      result.written.push(rule.key);
      continue;
    }
    if (existing.contentHash === null || automationHashOf(existing) !== existing.contentHash) {
      result.kept.push(rule.key);
      continue;
    }
    // The zone it already runs in stays; so does the owner's switch.
    const zone = existing.trigger.kind === 'schedule' && existing.trigger.schedule.kind !== 'interval' ? existing.trigger.schedule.timezone : null;
    const trigger =
      zone !== null && bound.trigger.kind === 'schedule' && bound.trigger.schedule.kind !== 'interval' ? ({ ...bound.trigger, schedule: { ...bound.trigger.schedule, timezone: zone } } as AutomationTrigger) : bound.trigger;
    const schedule = trigger.kind === 'schedule' ? trigger.schedule : null;
    await repo.update(
      existing.id,
      { name: bound.name, description: bound.description, trigger, graph: bound.graph, ...(existing.enabled && schedule !== null ? { nextRunAt: nextTickFor(schedule, at) } : schedule === null ? { nextRunAt: null } : {}) },
      at,
    );
    await repo.setHash(existing.id, automationHashOf((await repo.findById(existing.id)) ?? existing));
    result.written.push(rule.key);
  }

  // What it shipped before and ships no longer: gone, unless the owner made it theirs.
  const keys = new Set(shipped.map((rule) => rule.key));
  for (const rule of mine) {
    if (rule.templateKey === null || keys.has(rule.templateKey)) continue;
    if (rule.contentHash === null || automationHashOf(rule) !== rule.contentHash) continue;
    await repo.remove(rule.id);
    result.removed.push(rule.templateKey);
  }
  return result;
}

/**
 * Takes a manifest's rules away with it. An unedited rule goes; one the owner
 * changed is theirs and stays — switched off when the tables it reads were
 * dropped, with a line in the audit trail saying why. Returns how many went.
 */
export async function removeAutomations(meta: MetaDb, key: string, connectionId: string | null, options: { tablesDropped: boolean }): Promise<number> {
  const repo = automationsRepo(meta);
  let removed = 0;
  for (const rule of await repo.listManagedBy(key, connectionId)) {
    if (rule.contentHash !== null && automationHashOf(rule) === rule.contentHash) {
      await repo.remove(rule.id);
      removed += 1;
      continue;
    }
    if (!options.tablesDropped || !rule.enabled) continue;
    await repo.update(rule.id, { enabled: false });
    await auditRepo(meta).append({
      actorKind: 'system',
      actorId: null,
      actorLabel: 'Adminium',
      category: 'automation',
      action: 'automation.disable',
      connectionId,
      changes: { after: { id: rule.id, name: rule.name, because: `"${key}" was uninstalled and its tables dropped` } },
    });
  }
  return removed;
}
