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
 * WHAT SENDS OUT ARRIVES EMPTY AND SWITCHED OFF. A file never carries a
 * webhook's address or its header's value, nor the addresses a mail goes to
 * (`to: { kind: "fixed" }`): those steps are written empty, and their rule is
 * stored switched off whatever the file says. Filling them in, and switching
 * the rule on, is the owner's on the rules page, which needs the automations
 * permission and refuses to switch on a rule with an empty step. What the
 * owner fills in is no edit of the rule: it is kept out of the fingerprint,
 * and carried over when an update rewrites the rule.
 *
 * A step can also send out with no address field at all, so these count too
 * ({@link outboundSteps}): a step that writes words of its own into a column
 * a mail goes to (or an address anywhere), a mail to a column whose value the
 * file chose (a default, a copy, its seeded rows), an add-on's step given an
 * address of the file's own, a mail whose template or own values link to an
 * outside host with the record's values in the link (or a link nobody can
 * tell). Each
 * keeps its words, and its rule arrives switched off with an item on the
 * list for the owner to look at; an update that brings a new one switches an
 * unchanged rule off again. When unsure, a step counts as sending out.
 *
 * Meta store only: no source transaction, no lock.
 */
import { ADD_ON_STEP_PERSON, type AddOnStep } from '@adminium/add-on-contracts';

import type { RuleSteps } from '../automations/validate.js';
import { createHash } from 'node:crypto';

import { placeholdersIn, type ManifestAutomation, type ManifestCondition, type ManifestNode, type ManifestWriteValue, type Manifest } from '@adminium/manifest';
import { appAfterInstallRepo, auditRepo, automationsRepo, documentProfilesRepo, emailTemplatesRepo, rolesRepo, settingsRepo, type Automation, type AutomationGraph, type AutomationTrigger, type MetaDb } from '@adminium/meta';

import { forgetSpellsIfChosenAnew, nextTickFor } from '../automations/schedule.js';
import { firstIncompleteNode, resolveRule } from '../automations/validate.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { emailLinks } from '../email/link-hosts.js';
import { installTemplateKey, type InstallAddress } from '../installs/resolve.js';
import type { AfterInstallItem } from './after-install.js';
import { roleSlugFor } from './manifest-roles.js';
import { canonicalJson } from './sample-data.js';

export interface AutomationsResult {
  /** Rules written: made new, or rewritten because nobody had changed them. */
  written: string[];
  /** Rules of the same key the owner changed: left as they are. */
  kept: string[];
  /** Unedited rules the manifest no longer ships. */
  removed: string[];
  /** What the owner still fills in of the rules the manifest ships, as they stand after the write. */
  afterInstall: AfterInstallItem[];
}

type Words = string | Readonly<Record<string, string>>;

/** A trigger without the zone its schedule runs in: the zone is the install's, and changing it is no edit of the rule. */
function withoutZone(trigger: AutomationTrigger): unknown {
  if (trigger.kind !== 'schedule' || trigger.schedule.kind === 'interval') return trigger;
  const { timezone: _timezone, ...schedule } = trigger.schedule;
  return { ...trigger, schedule };
}

type StoredNode = { id: string; kind: string; action?: (Record<string, unknown> & { kind: string }) | undefined; branches?: { nodes: StoredNode[] }[] | undefined } & Record<string, unknown>;

/** Every step of a stored graph, a branch's own steps after it. */
function storedNodes(nodes: readonly StoredNode[]): StoredNode[] {
  return nodes.flatMap((node) => [node, ...(node.branches ?? []).flatMap((branch) => storedNodes(branch.nodes))]);
}

/** A step without what its owner fills in after an install: a webhook's address and header value, a mail's typed addresses, a document's profile. */
function withoutFilledIn(node: StoredNode): StoredNode {
  if (node.branches !== undefined) return { ...node, branches: node.branches.map((branch) => ({ ...branch, nodes: branch.nodes.map(withoutFilledIn) })) };
  const action = node.action;
  if (node.kind !== 'action' || action === undefined) return node;
  if (action.kind === 'webhook') {
    const { url: _url, headerValueEncrypted: _sealed, headerValue: _value, headerValueSet: _set, ...rest } = action;
    return { ...node, action: rest as StoredNode['action'] };
  }
  if (action.kind === 'email' && (action['to'] as { kind?: string } | null)?.kind === 'fixed') return { ...node, action: { ...action, to: { kind: 'fixed' } } };
  if (action.kind === 'document.render') {
    const { profileId: _profile, ...rest } = action;
    return { ...node, action: rest as StoredNode['action'] };
  }
  return node;
}

/** The fingerprint of a rule as the store keeps it, the same however its JSON was ordered, and whatever its owner filled in after the install. */
export function automationHashOf(rule: Pick<Automation, 'name' | 'description' | 'trigger' | 'graph'>): string {
  const graph = { ...rule.graph, nodes: (rule.graph.nodes as unknown as StoredNode[]).map(withoutFilledIn) };
  return createHash('sha256')
    .update(canonicalJson({ name: rule.name, description: rule.description, trigger: withoutZone(rule.trigger), graph }))
    .digest('hex');
}

/** Whether a step is one that sends out of Adminium: a webhook, or a mail to typed addresses. */
function sendsOut(node: StoredNode): boolean {
  return node.action?.kind === 'webhook' || (node.action?.kind === 'email' && (node.action['to'] as { kind?: string } | null)?.kind === 'fixed');
}

/** The link a rule's mail holds of this server's own: the record's page. */
const RULE_MAIL_OWN_LINKS = ['recordUrl'];

/** Words a file wrote itself, each placeholder taken out (its backup kept): what they say whatever the record holds. */
function literalOf(text: string): string {
  let out = '';
  let cursor = 0;
  for (const one of placeholdersIn(text)) {
    out += `${text.slice(cursor, one.at)} ${one.backup ?? ''} `;
    cursor = one.at + one.whole.length;
  }
  return (out + text.slice(cursor)).trim();
}

/** Whether words a file wrote reach somebody outside by themselves: an address, a host, a phone number (`phones`). */
function reachesOut(text: string, phones: boolean): boolean {
  // An add-on step's person (`@record`, `@link:contact_id`) is a row of the database, never an address.
  if (ADD_ON_STEP_PERSON.test(text.trim())) return false;
  const literal = literalOf(text);
  if (literal === '') return false;
  if (literal.includes('@')) return true;
  const links = emailLinks({ text });
  if (links.hosts.length > 0 || links.problems.length > 0) return true;
  return phones && /\d{6,}/.test(literal.replaceAll(/[\s().+/-]/g, ''));
}

type ManifestStep = { id: string; kind: string; action?: Record<string, unknown> & { kind: string }; branches?: { nodes: ManifestStep[] }[] };

type FileColumn = { ref: string; default?: unknown; references?: string; rules?: Record<string, unknown> };
type FileTable = { ref: string; columns?: FileColumn[] };

/** Rules of a column that work its value out from what the file wrote (a formula's words, a prefix, a lookup's table). */
const WORKED_OUT: readonly string[] = ['formula', 'format', 'lookup', 'band'];

/**
 * Whether the file itself can choose a column's value, an address a mail to
 * that column goes to: a default of its own, a default read from a setting,
 * a rule that works it out, a copy of such a column, or rows the file brings
 * (its seeds; its sample data, which it does not say the tables of).
 */
function fileChosenColumn(manifest: Manifest, tableRef: string | undefined, column: string): boolean {
  const tables = ((manifest as { requiredSchema?: { tables?: FileTable[] } }).requiredSchema?.tables ?? []) as FileTable[];
  const seeds = ((manifest as { seeds?: { table: string; rows?: Record<string, unknown>[]; file?: string }[] }).seeds ?? []);
  const sample = (manifest as { sampleData?: unknown }).sampleData !== undefined;
  const seen = new Set<string>();
  const chosen = (table: FileTable, ref: string): boolean => {
    const id = `${table.ref}.${ref}`;
    if (seen.has(id)) return false;
    seen.add(id);
    const col = (table.columns ?? []).find((one) => one.ref === ref);
    if (col === undefined) return false;
    if (typeof col.default === 'string' && col.default.trim() !== '') return true;
    const rules = col.rules ?? {};
    if (rules['default'] !== undefined || WORKED_OUT.some((rule) => rules[rule] !== undefined)) return true;
    if (sample || seeds.some((seed) => seed.table === table.ref && (seed.file !== undefined || (seed.rows ?? []).some((row) => row[ref] !== undefined && row[ref] !== null && row[ref] !== '')))) return true;
    // A copy from the linked row: chosen when the column it copies is.
    const copy = rules['copy'] as { via?: string; from?: string } | undefined;
    if (copy !== undefined) {
      const target = tables.find((one) => one.ref === (table.columns ?? []).find((c) => c.ref === copy.via)?.references);
      if (target === undefined || typeof copy.from !== 'string' || chosen(target, copy.from)) return true;
    }
    // A stamp: words of the file's own by origin, or another column of the row.
    const set = (rules['stamp'] as { set?: unknown } | undefined)?.set;
    if (set !== null && typeof set === 'object') {
      if ('byOrigin' in set) return true;
      const from = (set as { copy?: unknown }).copy;
      if (typeof from === 'string' && chosen(table, from)) return true;
    }
    return false;
  };
  const named = tables.filter((table) => table.ref === tableRef);
  return (named.length > 0 ? named : tables).some((table) => chosen(table, column));
}

/** The table a rule's record is a row of: the record's, or the rows a schedule walks. */
function recordTableOf(rule: ManifestAutomation): string | undefined {
  const trigger = rule.trigger as { table?: unknown; forEach?: { table?: unknown } };
  if (typeof trigger.table === 'string') return trigger.table;
  return typeof trigger.forEach?.table === 'string' ? trigger.forEach.table : undefined;
}

function manifestSteps(nodes: readonly ManifestStep[]): ManifestStep[] {
  return nodes.flatMap((node) => [node, ...(node.branches ?? []).flatMap((branch) => manifestSteps(branch.nodes))]);
}

/**
 * The steps of a manifest's rules that send out though they name no
 * address a person fills in, by rule key: each the id of a step. Read from
 * the file alone, every rule at once, since one rule may write the address
 * another mails:
 *
 *  - a step that writes words of its own (or a value of a setting, a date)
 *    into a column a mail step sends to, and that mail step; one that writes
 *    an address anywhere, or a link to an outside host with the record's
 *    values in it;
 *  - a mail to a column whose value the file chose: a default, a copy of one,
 *    a rule that works it out, rows the file brings;
 *  - an add-on's step with an address, a host or a phone number of the
 *    file's own in an input;
 *  - a mail or summary whose template links to an outside host with a value
 *    of the record in the link (a form sent there, a `<base>` too), or holds
 *    a link nobody can tell; a mail whose own values (`vars`) name an outside
 *    host or an address.
 */
export function outboundSteps(manifest: Manifest): Map<string, string[]> {
  const rules = ((manifest as { automations?: ManifestAutomation[] }).automations ?? []) as ManifestAutomation[];
  const templates = new Map((((manifest as { emailTemplates?: { key: string }[] }).emailTemplates ?? []) as { key: string }[]).map((template) => [template.key, template]));
  const leaks = new Map<string, boolean>();
  const templateLeaks = (key: unknown): boolean => {
    if (typeof key !== 'string') return false;
    const template = templates.get(key);
    if (template === undefined) return false;
    if (!leaks.has(key)) {
      const links = emailLinks(template, RULE_MAIL_OWN_LINKS);
      leaks.set(key, links.problems.length > 0 || links.carried.length > 0);
    }
    return leaks.get(key) === true;
  };
  const stepsOf = (rule: ManifestAutomation): ManifestStep[] => manifestSteps(rule.graph.nodes as unknown as ManifestStep[]);
  const fieldOf = (action: Record<string, unknown>): string | null => {
    const to = action['to'] as { kind?: string; column?: unknown } | undefined;
    return action['kind'] === 'email' && to?.kind === 'field' && typeof to.column === 'string' ? to.column : null;
  };

  // The columns a mail goes to, and those a step writes words of its own into (or any value that is not words: a setting's, a date).
  const mailed = new Set<string>();
  const written = new Set<string>();
  const ownWords = (value: unknown): boolean => (typeof value === 'string' ? literalOf(value) !== '' : value !== null && value !== undefined);
  for (const rule of rules) {
    for (const step of stepsOf(rule)) {
      const action = step.action;
      if (action === undefined) continue;
      const field = fieldOf(action);
      if (field !== null) mailed.add(field);
      if (action.kind === 'record.create' || action.kind === 'record.update') {
        for (const [column, value] of Object.entries((action['values'] ?? {}) as Record<string, unknown>)) if (ownWords(value)) written.add(column);
      }
    }
  }

  const out = new Map<string, string[]>();
  for (const rule of rules) {
    const ids: string[] = [];
    for (const step of stepsOf(rule)) {
      const action = step.action;
      if (step.kind !== 'action' || action === undefined) continue;
      let sends = false;
      if (action.kind === 'record.create' || action.kind === 'record.update') {
        for (const [column, value] of Object.entries((action['values'] ?? {}) as Record<string, unknown>)) {
          if (!ownWords(value)) continue;
          if (mailed.has(column)) sends = true;
          if (typeof value !== 'string') continue;
          const carries = placeholdersIn(value).length > 0;
          const hosts = emailLinks({ text: value });
          if (mailed.has(column) || literalOf(value).includes('@') || (carries && (hosts.hosts.length > 0 || hosts.problems.length > 0))) sends = true;
        }
      }
      if (action.kind === 'email') {
        const field = fieldOf(action);
        if (field !== null && (written.has(field) || fileChosenColumn(manifest, recordTableOf(rule), field))) sends = true;
        if (templateLeaks(action['templateKey'])) sends = true;
        for (const value of Object.values((action['vars'] ?? {}) as Record<string, unknown>)) if (typeof value === 'string' && reachesOut(value, false)) sends = true;
      }
      if (action.kind === 'digest' && templateLeaks(action['templateKey'])) sends = true;
      if (action.kind === 'add-on.step') {
        for (const value of Object.values((action['inputs'] ?? {}) as Record<string, unknown>)) if (typeof value === 'string' && reachesOut(value, true)) sends = true;
      }
      if (sends) ids.push(step.id);
    }
    if (ids.length > 0) out.set(rule.key, ids);
  }
  return out;
}

/** The items of {@link outboundSteps} for one rule: one per step, for its owner to look at before switching it on. */
function outboundItems(key: string, outbound: ReadonlyMap<string, readonly string[]>): AfterInstallItem[] {
  return (outbound.get(key) ?? []).map((id) => ({ kind: 'outbound', item: key, field: id }));
}

/** What the owner still has to fill in of a stored rule: one item per empty value. */
export function afterInstallItemsOfRule(key: string, graph: AutomationGraph): AfterInstallItem[] {
  const out: AfterInstallItem[] = [];
  for (const node of storedNodes(graph.nodes as unknown as StoredNode[])) {
    const action = node.action;
    if (node.kind !== 'action' || action === undefined) continue;
    if (action.kind === 'webhook') {
      if (action['url'] === null || action['url'] === undefined || action['url'] === '') out.push({ kind: 'webhook', item: key, field: `${node.id}.url` });
      if (typeof action['headerName'] === 'string' && action['headerName'] !== '' && (action['headerValueEncrypted'] ?? null) === null) out.push({ kind: 'webhook', item: key, field: `${node.id}.headerValue` });
    }
    const to = action['to'] as { kind?: string; addresses?: unknown[] } | null | undefined;
    if (action.kind === 'email' && to?.kind === 'fixed' && (to.addresses ?? []).length === 0) out.push({ kind: 'address', item: key, field: `${node.id}.to.addresses` });
    if (action.kind === 'document.render' && (action['profileId'] ?? null) === null) out.push({ kind: 'document', item: key, field: `${node.id}.profileId` });
  }
  return out;
}

/**
 * What the owner filled in of a rule an update rewrites: carried onto the
 * new version's step of the same id and kind, so the update takes nothing of
 * theirs away.
 */
function carryFilledIn(before: AutomationGraph, after: AutomationGraph): AutomationGraph {
  const filled = new Map(storedNodes(before.nodes as unknown as StoredNode[]).map((node) => [node.id, node]));
  const carry = (node: StoredNode): StoredNode => {
    if (node.branches !== undefined) return { ...node, branches: node.branches.map((branch) => ({ ...branch, nodes: branch.nodes.map(carry) })) };
    const was = filled.get(node.id)?.action;
    const action = node.action;
    if (node.kind !== 'action' || action === undefined || was === undefined || was.kind !== action.kind) return node;
    if (action.kind === 'webhook') {
      const sameHeader = (was['headerName'] ?? null) === (action['headerName'] ?? null);
      return { ...node, action: { ...action, url: was['url'] ?? null, headerValueEncrypted: sameHeader ? (was['headerValueEncrypted'] ?? null) : null } };
    }
    const to = action['to'] as { kind?: string } | null;
    const wasTo = was['to'] as { kind?: string; addresses?: unknown } | null;
    if (action.kind === 'email' && to?.kind === 'fixed' && wasTo?.kind === 'fixed') return { ...node, action: { ...action, to: { kind: 'fixed', addresses: wasTo.addresses ?? [] } } };
    if (action.kind === 'document.render' && (action['profileId'] ?? null) === null) return { ...node, action: { ...action, profileId: was['profileId'] ?? null } };
    return node;
  };
  return { ...after, nodes: (after.nodes as unknown as StoredNode[]).map(carry) } as unknown as AutomationGraph;
}

export interface Binding {
  connectionId: string;
  realId: (ref: string) => string;
  roleId: (key: string) => string;
  timezone: string;
  /** The instance's language as a manifest spells one (`de-DE`). */
  language: string;
  /** The app's document profile a step draws, by the document's table, kind and add-on; null when none is here. */
  profileId?: (document: { table: string; kind: string; addOn?: string | undefined }) => string | null;
}

const one = (words: Words, language: string): string => (typeof words === 'string' ? words : (words[language] ?? words['en-US'] ?? Object.values(words)[0] ?? ''));

/**
 * A notice's words in every language the manifest gives them, kept beside the
 * instance's own (`title`, `body`): each reader is told in theirs when the
 * notice is written. Nothing when the step gives one text for everybody.
 */
function noticeLocales(title: Words, body: Words | undefined): Record<string, { title: string; body: string | null }> | undefined {
  const tags = [...new Set([...(typeof title === 'string' ? [] : Object.keys(title)), ...(body === undefined || typeof body === 'string' ? [] : Object.keys(body))])].sort();
  if (tags.length === 0) return undefined;
  return Object.fromEntries(tags.map((tag) => [tag, { title: one(title, tag), body: body === undefined ? null : one(body, tag) }]));
}

function boundCondition(condition: ManifestCondition, b: Binding): unknown {
  // An amount read from a setting: from the settings table as it is named here.
  const right = condition.right;
  if (typeof right === 'object' && right !== null && right.setting !== undefined) return { ...condition, right: { ...right, setting: { ...right.setting, table: b.realId(right.setting.table) } } };
  if (!('count' in condition.left)) return condition;
  const count = condition.left.count;
  return { ...condition, left: { count: { ...count, table: b.realId(count.table) } } };
}

function boundValue(value: ManifestWriteValue, b: Binding): unknown {
  if (typeof value !== 'object') return value;
  if ('setting' in value) return { ...value, setting: { ...value.setting, table: b.realId(value.setting.table) } };
  if ('daysAfter' in value && value.daysAfter.setting !== undefined) return { daysAfter: { ...value.daysAfter, setting: { ...value.daysAfter.setting, table: b.realId(value.daysAfter.setting.table) } } };
  return value;
}

/** One node of a shipped rule, bound to the install: its tables, roles and language (exported for its tests). */
export function boundNode(node: unknown, b: Binding): unknown {
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
    // To the people of a role, by the role's id here; or to the person a staff column names (or their lead), as written, with its roles for nobody by id.
    // To the people a listing names: the listing's table as it is named here.
    const to = action['to'] as { roles: string[] } | { listed: string } | { column: string; lead?: true; else?: { roles: string[] } };
    const bound = 'roles' in to ? { roles: to.roles.map((key) => b.roleId(key)) } : 'listed' in to ? { listed: b.realId(to.listed) } : to.else === undefined ? to : { ...to, else: { roles: to.else.roles.map((key) => b.roleId(key)) } };
    const title = action['title'] as Words;
    const body = action['body'] as Words | undefined;
    const locales = noticeLocales(title, body);
    return { ...base, action: { ...action, to: bound, title: one(title, b.language), ...(body === undefined ? {} : { body: one(body, b.language) }), ...(locales === undefined ? {} : { locales }) } };
  }
  if (action.kind === 'digest') {
    const to = action['to'] as { roles: string[] };
    const sections = action['sections'] as {
      key: string;
      table: string;
      owner: string;
      where?: ManifestCondition[];
      orderBy?: { column: string; dir?: 'asc' | 'desc' };
      limit?: number;
      reach?: 'own' | 'team';
      sum?: string[];
      by?: 'owner';
      target?: { table: string; owner: string; column: string; year?: string; of: string };
      within?: { column: string; this: 'year'; orEmpty?: true } | { column: string; lastDays: number; orEmpty?: true };
    }[];
    return {
      ...base,
      action: {
        kind: 'digest',
        templateKey: action['templateKey'],
        to: { roles: to.roles.map((key) => b.roleId(key)) },
        sections: sections.map((section) => ({
          key: section.key,
          table: b.realId(section.table),
          owner: section.owner,
          where: (section.where ?? []).map((condition) => boundCondition(condition, b)),
          orderBy: section.orderBy === undefined ? null : { column: section.orderBy.column, dir: section.orderBy.dir ?? 'asc' },
          limit: section.limit ?? 20,
          ...(section.reach === undefined ? {} : { reach: section.reach }),
          ...(section.sum === undefined ? {} : { sum: section.sum }),
          ...(section.by === undefined ? {} : { by: section.by }),
          ...(section.target === undefined ? {} : { target: { ...section.target, table: b.realId(section.target.table) } }),
          ...(section.within === undefined ? {} : { within: section.within }),
        })),
        sendEmpty: action['sendEmpty'] === true,
      },
    };
  }
  // A value read from the settings row, or days kept there: from the settings table as it is named here.
  if (action.kind === 'record.create' || action.kind === 'record.update') {
    const values = Object.fromEntries(Object.entries(action['values'] as Record<string, ManifestWriteValue>).map(([ref, value]) => [ref, boundValue(value, b)]));
    return { ...base, action: { ...action, values, ...(action.kind === 'record.create' ? { table: b.realId(action['table'] as string) } : {}) } };
  }
  // A call out, and a mail to typed addresses: written empty, for the owner to fill in.
  if (action.kind === 'webhook') {
    return {
      ...base,
      action: {
        kind: 'webhook',
        url: null,
        method: action['method'] ?? 'POST',
        bodyKind: action['bodyKind'] ?? 'json',
        body: action['body'] ?? null,
        headerName: action['headerName'] ?? null,
        headerValueEncrypted: null,
      },
    };
  }
  if (action.kind === 'email' && (action['to'] as { kind?: string } | undefined)?.kind === 'fixed') {
    return { ...base, action: { ...action, to: { kind: 'fixed', addresses: [] } } };
  }
  // A document: the app's own profile for it here, or none yet.
  if (action.kind === 'document.render') {
    const document = action['document'] as { table: string; kind: string; addOn?: string };
    return { ...base, action: { kind: 'document.render', profileId: b.profileId?.(document) ?? null } };
  }
  // A mail to the people a listing names: the listing's table as it is named here.
  if (action.kind === 'email' && (action['to'] as { kind?: string } | undefined)?.kind === 'listed') {
    const to = action['to'] as { kind: 'listed'; table: string };
    return { ...base, action: { ...action, to: { kind: 'listed', table: b.realId(to.table) } } };
  }
  return base;
}

/** A graph as if its owner had filled in what they fill in after the install: for the check that every other step is whole. */
function asFilledIn(graph: AutomationGraph): AutomationGraph {
  const fill = (node: StoredNode): StoredNode => {
    if (node.branches !== undefined) return { ...node, branches: node.branches.map((branch) => ({ ...branch, nodes: branch.nodes.map(fill) })) };
    const action = node.action;
    if (node.kind !== 'action' || action === undefined) return node;
    if (action.kind === 'webhook' && (action['url'] ?? null) === null) return { ...node, action: { ...action, url: 'https://filled-in.invalid/' } };
    const to = action['to'] as { kind?: string; addresses?: unknown[] } | null;
    if (action.kind === 'email' && to?.kind === 'fixed' && (to.addresses ?? []).length === 0) return { ...node, action: { ...action, to: { kind: 'fixed', addresses: ['filled-in@example.invalid'] } } };
    if (action.kind === 'document.render' && (action['profileId'] ?? null) === null) return { ...node, action: { ...action, profileId: 'filled-in' } };
    return node;
  };
  return { ...graph, nodes: (graph.nodes as unknown as StoredNode[]).map(fill) } as unknown as AutomationGraph;
}

/**
 * What the owner will fill in after an install of these rules, read from the
 * file alone, for the review before anything is made: each rule bound with
 * stand-ins for what only the install knows (its tables, roles and zone) — a
 * document a rule draws counts as there when the app declares it.
 */
export function plannedAfterInstallOfRules(manifest: Manifest): AfterInstallItem[] {
  if (manifest.kind !== 'app') return [];
  const documents = manifest.documents ?? [];
  const binding: Binding = {
    connectionId: 'planned',
    realId: (ref) => ref,
    roleId: (key) => key,
    timezone: 'UTC',
    language: 'en-US',
    profileId: (document) => (documents.some((entry) => entry.table === document.table && entry.kind === document.kind) ? 'planned' : null),
  };
  const rules = ((manifest as { automations?: ManifestAutomation[] }).automations ?? []) as ManifestAutomation[];
  const outbound = outboundSteps(manifest);
  return rules.flatMap((rule) => [...afterInstallItemsOfRule(rule.key, bind(rule, binding).graph), ...outboundItems(rule.key, outbound)]);
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
          // A shipped rule runs on what Adminium itself writes, unless it says it also polls for rows written around it.
          watch: rule.trigger.watch ?? false,
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

/**
 * A rule's email and digest steps name the templates its manifest ships; a
 * later install keeps those under keys of its own, so its rules send its own.
 */
function withInstallTemplates<T extends { graph: AutomationGraph }>(bound: T, manifest: Manifest, install: InstallAddress): T {
  if (install.slug === '') return bound;
  const shipped = new Set(((manifest as { emailTemplates?: { key: string }[] }).emailTemplates ?? []).map((template) => template.key));
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;
    const out = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    if (typeof out['templateKey'] === 'string' && shipped.has(out['templateKey'])) out['templateKey'] = installTemplateKey(out['templateKey'], install);
    return out;
  };
  return { ...bound, graph: walk(bound.graph) as AutomationGraph };
}

export interface InstallAutomationsInput {
  meta: MetaDb;
  manifest: Manifest;
  /** The install the rules belong to: their roles and templates are its own. */
  install: InstallAddress;
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
    // Only checked here, never run: a table's stored name is the run's to read.
    return { state: 'ok', step: { addOn, addOnName: manifest.name, step: found, table: input.realId(found.writes.table), inputTables, refOf: (tableId: string) => tableId } };
  };

  const roles = rolesRepo(meta);
  const roleIds = new Map<string, string>();
  for (const role of (manifest as { roles?: { key: string }[] }).roles ?? []) {
    const found = await roles.findBySlug(roleSlugFor(manifest.key, role.key, input.install.slug));
    if (found !== null) roleIds.set(role.key, found.id);
  }
  const connection = await meta.db.selectFrom('adminium_connections').select('timezone').where('id', '=', connectionId).executeTakeFirst();
  const stored = await settingsRepo(meta).get('locale.default');
  const templateKeys = new Set((await emailTemplatesRepo(meta).list({ kind: 'template', archived: false })).filter((row) => row.enabled).map((row) => row.key));
  const result: AutomationsResult = { written: [], kept: [], removed: [], afterInstall: [] };
  // The app's own document profiles here, made before its rules: what a document step draws.
  const profiles = await documentProfilesRepo(meta).listOwnedBy(connectionId, manifest.key);
  // Steps that send out with no address to fill in; and those the owner was already shown, by an earlier version.
  const outbound = outboundSteps(manifest);
  const shown = new Set((await appAfterInstallRepo(meta).list(input.install.id)).filter((row) => row.kind === 'outbound').map((row) => `${row.item}\u0000${row.field}`));

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
      profileId: (document) => {
        const table = input.realId(document.table);
        return profiles.find((profile) => profile.table === table && profile.kind === document.kind && (document.addOn === undefined || profile.addOnKey === document.addOn))?.id ?? null;
      },
    };
    const bound = withInstallTemplates(bind(rule, binding), manifest, input.install);
    // Checked whole, as a rule a person saves is: nothing half-written is ever stored for a manifest.
    try {
      resolveRule(bound.trigger, bound.graph, { view, templateKeys, blockLoopback: true, steps: ownSteps } as never);
    } catch (error) {
      throw refusal(error instanceof Error ? error.message : String(error));
    }
    // A step of the manifest's own is held to its inputs; another add-on's is that add-on's to answer for, on the day it runs.
    // What the owner fills in after the install is the one thing a shipped step may lack.
    const waiting = afterInstallItemsOfRule(rule.key, bound.graph);
    const unfinished = firstIncompleteNode(asFilledIn(bound.graph), (addOn, step) => (addOn === manifest.key ? ownSteps(addOn, step) : { state: 'ok', step: { addOn, addOnName: addOn, step: { key: step, inputs: [] } as never, table: '', inputTables: {}, refOf: (tableId: string) => tableId } }));
    if (unfinished !== null) throw refusal(`its step "${unfinished.title}" is not finished.`);
    // A rule that sends out, or waits for its owner, arrives switched off.
    const flagged = outboundItems(rule.key, outbound);
    const switchedOn = rule.enabled && waiting.length === 0 && flagged.length === 0 && !storedNodes(bound.graph.nodes as unknown as StoredNode[]).some(sendsOut);

    const existing = mine.find((candidate) => candidate.templateKey === rule.key);
    // The part it belongs to is the app's to say, also of a rule its owner has since changed.
    if (existing !== undefined && existing.module !== (rule.module ?? null)) await repo.setModule(existing.id, rule.module ?? null);
    if (existing === undefined) {
      const schedule = bound.trigger.kind === 'schedule' ? bound.trigger.schedule : null;
      const made = await repo.create(
        { connectionId, ...bound, enabled: switchedOn, nextRunAt: switchedOn && schedule !== null ? nextTickFor(schedule, at) : null, createdBy: null, managedBy: manifest.key, installId: input.install.id, templateKey: rule.key, contentHash: null, module: rule.module ?? null },
        at,
      );
      // Hashed as the store keeps it, so reading it back is never an edit.
      const written = (await repo.findById(made.id)) ?? made;
      await repo.setHash(made.id, automationHashOf(written));
      result.afterInstall.push(...afterInstallItemsOfRule(rule.key, written.graph), ...flagged);
      result.written.push(rule.key);
      continue;
    }
    if (existing.contentHash === null || automationHashOf(existing) !== existing.contentHash) {
      result.afterInstall.push(...afterInstallItemsOfRule(rule.key, existing.graph), ...flagged);
      result.kept.push(rule.key);
      continue;
    }
    // What the owner filled in stays with the step it was filled into.
    bound.graph = carryFilledIn(existing.graph, bound.graph);
    // The zone it already runs in stays; so does the owner's switch.
    const zone = existing.trigger.kind === 'schedule' && existing.trigger.schedule.kind !== 'interval' ? existing.trigger.schedule.timezone : null;
    const trigger =
      zone !== null && bound.trigger.kind === 'schedule' && bound.trigger.schedule.kind !== 'interval' ? ({ ...bound.trigger, schedule: { ...bound.trigger.schedule, timezone: zone } } as AutomationTrigger) : bound.trigger;
    const schedule = trigger.kind === 'schedule' ? trigger.schedule : null;
    // A step that now sends out, which no earlier version showed its owner, switches the rule off until they look.
    const offAgain = existing.enabled && flagged.some((item) => !shown.has(`${item.item}\u0000${item.field}`));
    const enabled = existing.enabled && !offAgain;
    await repo.update(
      existing.id,
      {
        name: bound.name,
        description: bound.description,
        trigger,
        graph: bound.graph,
        ...(offAgain ? { enabled: false, nextRunAt: null } : enabled && schedule !== null ? { nextRunAt: nextTickFor(schedule, at) } : schedule === null ? { nextRunAt: null } : {}),
      },
      at,
    );
    if (offAgain) {
      await auditRepo(meta).append({
        actorKind: 'system',
        actorId: null,
        actorLabel: 'Adminium',
        category: 'automation',
        action: 'automation.disable',
        connectionId,
        changes: { after: { id: existing.id, name: bound.name, because: `the update of "${manifest.key}" made a step of it send out of Adminium` } },
      });
    }
    await forgetSpellsIfChosenAnew(meta, existing.id, existing.trigger, trigger);
    const rewritten = (await repo.findById(existing.id)) ?? existing;
    await repo.setHash(existing.id, automationHashOf(rewritten));
    result.afterInstall.push(...afterInstallItemsOfRule(rule.key, rewritten.graph), ...flagged);
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
