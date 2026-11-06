// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `automations`.
 *
 * The database's own rules (not an installed app's, not one a document
 * profile's trigger made, which the target makes again from the document),
 * each rewritten so it names nothing of this install: tables by their refs,
 * a notice's roles by their keys, a mail's template by the key the install
 * will give it, a document by its table and kind. The database, the zone and
 * what a rule has run are dropped.
 *
 * What goes out never travels. A webhook keeps its method, body and header
 * name, and loses its address and its header's value; a mail to typed
 * addresses keeps only that it goes to typed addresses. Both arrive empty and
 * switched off, and Check lists them for the owner to fill in. Whether a rule
 * also watches rows written around Adminium is always written: the stored
 * default (on) is not the file's (off).
 */
import { slugify } from '@adminium/engine';
import { manifestAutomationSchema } from '@adminium/manifest';
import {
  automationsRepo,
  documentProfilesRepo,
  type Automation,
  type AutomationCondition,
  type AutomationTrigger,
  type AutomationWriteValue,
  type EmailTemplate,
} from '@adminium/meta';

import { emailTarget, liveTemplates, whyTemplateStays } from './email.js';
import type { CheckItem } from './check.js';
import type { ConvertContext, ConvertPart, ManifestPart } from './types.js';

type Doc = Record<string, unknown>;
type StoredNode = Doc & { id: string; kind: string; title?: string; sub?: string | null };

/** The most rules one file carries (`MANIFEST_AUTOMATIONS_MAX`). */
const RULES_MAX = 32;
const RULE_KEY = /^[a-z][a-z0-9-]{0,79}$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,120}$/;

/** Why a rule does not travel; the Check item says it. */
class Stays extends Error {
  constructor(readonly item: Omit<CheckItem, 'kind' | 'item'> | null) {
    super(item?.code ?? 'answered');
  }
}

export const automationTarget = (id: string) => `automation:${id}`;

export const convertAutomations: ConvertPart = async (ctx) => {
  const { meta, connectionId } = ctx.source;
  const { check, choices } = ctx;
  const repo = automationsRepo(meta);
  const chosen = choices.automations === undefined ? null : new Set(choices.automations);
  const leaveOut = new Set(choices.leaveOut ?? []);

  // A rule no database owns is not this database's to save; the person is told.
  for (const rule of await repo.list({ connectionId: null })) {
    if (rule.managedBy !== null) continue;
    check.add({ group: 'info', code: 'RULE_NO_DATABASE', kind: 'automation', item: rule.name, message: 'This rule is not tied to a database, so it is not saved in an app.' });
  }

  // A rule a document profile's trigger made: the document carries the trigger, and the target makes the rule again.
  const madeByDocuments = new Set((await documentProfilesRepo(meta).list({ connectionId })).flatMap((profile) => (profile.trigger?.automationId ? [profile.trigger.automationId] : [])));
  const rules = (await repo.list({ connectionId }))
    .filter((rule) => rule.managedBy === null && !madeByDocuments.has(rule.id) && (chosen === null || chosen.has(rule.id)))
    // Oldest first: the order the person made them in.
    .reverse();
  const templates = await liveTemplates(ctx);

  const keys = new Set<string>();
  const keyFor = (rule: Automation): string => {
    const wanted = rule.templateKey !== null && RULE_KEY.test(rule.templateKey) ? rule.templateKey : slugify(rule.name).slice(0, 72) || 'rule';
    const base = RULE_KEY.test(wanted) ? wanted : `rule-${wanted}`.slice(0, 72);
    let key = base;
    for (let n = 2; keys.has(key); n += 1) key = `${base}-${String(n)}`;
    keys.add(key);
    return key;
  };

  const out: Doc[] = [];
  for (const rule of rules) {
    if (leaveOut.has(automationTarget(rule.id))) continue;
    const pending = new RuleWriter(ctx, rule, templates, leaveOut);
    let written: Doc;
    try {
      await pending.readDocuments();
      written = pending.rule();
    } catch (error) {
      if (!(error instanceof Stays)) throw error;
      if (error.item !== null) check.add({ ...error.item, kind: 'automation', item: rule.name });
      continue;
    }
    const parsed = manifestAutomationSchema.safeParse({ ...written, key: 'rule' });
    if (!parsed.success) {
      check.add({ group: 'info', code: 'RULE_UNFINISHED', kind: 'automation', item: rule.name, message: 'This rule is not finished, so it is left out.' });
      continue;
    }
    if (out.length >= RULES_MAX) {
      check.add({ group: 'info', code: 'RULES_TOO_MANY', kind: 'automation', item: rule.name, message: `An app carries at most ${String(RULES_MAX)} rules, so this one is left out.` });
      continue;
    }
    written['key'] = keyFor(rule);
    // Only now is a template used: a rule left out names none.
    pending.settle();
    out.push(written);
  }
  return (out.length === 0 ? {} : { automations: out }) as unknown as ManifestPart;
};

/** One rule, written for the file; throws `Stays` when it cannot travel. */
class RuleWriter {
  readonly #templateUses: { action: Doc; key: string }[] = [];
  readonly #after: Omit<CheckItem, 'item'>[] = [];
  readonly #infos: Omit<CheckItem, 'item'>[] = [];

  constructor(
    readonly ctx: ConvertContext,
    readonly stored: Automation,
    readonly templates: readonly EmailTemplate[],
    readonly leaveOut: ReadonlySet<string>,
  ) {}

  rule(): Doc {
    const rule = this.stored;
    return {
      key: '',
      name: rule.name.slice(0, 120),
      ...(rule.description === null || rule.description.trim() === '' ? {} : { description: rule.description.slice(0, 500) }),
      enabled: rule.enabled,
      trigger: this.trigger(rule.trigger),
      graph: { version: 1, nodes: (rule.graph.nodes as unknown as StoredNode[]).map((node) => this.node(node)) },
    };
  }

  /** Marks the templates used and says what the owner fills in, once the rule is known to travel. */
  settle(): void {
    for (const use of this.#templateUses) {
      const name = this.ctx.refs.useTemplate(use.key);
      use.action['templateKey'] = name === null ? use.key : this.ctx.refs.installedTemplateKey(name);
    }
    for (const item of [...this.#after, ...this.#infos]) this.ctx.check.add({ ...item, item: this.stored.name });
  }

  stays(code: string, message: string, choice = false): never {
    if (choice) {
      throw new Stays({ group: 'choice', code, message, answer: { choices: ['leave-out'], target: automationTarget(this.stored.id) } });
    }
    throw new Stays({ group: 'info', code, message });
  }

  table(id: string | null | undefined): string {
    const ref = id === null || id === undefined || id === '' ? null : (this.ctx.refs.table(id) ?? this.ctx.refs.tableByName(id));
    if (ref === null) this.stays('RULE_TABLE_LEFT_OUT', 'This rule reads a table that is not in the app, so it is left out.');
    return ref;
  }

  role(ids: readonly string[], where: string): string[] {
    const keys = ids.flatMap((id) => {
      const key = this.ctx.refs.role(id);
      return key === null ? [] : [key];
    });
    if (keys.length < ids.length) {
      this.#infos.push({ group: 'info', code: 'RULE_ROLE_LEFT_OUT', kind: 'automation', field: where, message: 'A role this rule tells is not in the app (a built-in role, or one left out), so it is not told.' });
    }
    return keys;
  }

  trigger(trigger: AutomationTrigger): Doc {
    if (trigger.kind === 'record') {
      return {
        kind: 'record',
        event: trigger.event,
        table: this.table(trigger.table),
        ...(trigger.changedColumn === null || trigger.changedColumn === undefined || trigger.changedColumn === '' ? {} : { changedColumn: trigger.changedColumn }),
        ...(trigger.when === undefined || trigger.when.length === 0 ? {} : { when: trigger.when.map((condition) => this.condition(condition)) }),
        // Always written: a file that says nothing means "only what Adminium writes".
        watch: trigger.watch,
      };
    }
    const schedule = trigger.schedule;
    return {
      kind: 'schedule',
      schedule:
        schedule.kind === 'interval'
          ? { kind: 'interval', everyMinutes: schedule.everyMinutes }
          : {
              kind: schedule.kind,
              time: schedule.time,
              ...(schedule.dayOfWeek === null || schedule.dayOfWeek === undefined ? {} : { dayOfWeek: schedule.dayOfWeek }),
              ...(schedule.dayOfMonth === null || schedule.dayOfMonth === undefined ? {} : { dayOfMonth: schedule.dayOfMonth }),
            },
      ...(trigger.forEach === undefined
        ? {}
        : { forEach: { table: this.table(trigger.forEach.table), where: trigger.forEach.where.map((condition) => this.condition(condition)), once: trigger.forEach.once } }),
    };
  }

  operand(right: unknown): unknown {
    if (typeof right !== 'object' || right === null) return right;
    const relative = right as { amount: number; unit: string; setting?: { table: string; column: string } };
    return {
      amount: relative.amount,
      unit: relative.unit,
      ...(relative.setting === undefined ? {} : { setting: { table: this.table(relative.setting.table), column: relative.setting.column } }),
    };
  }

  condition(condition: AutomationCondition): Doc {
    const left = condition.left;
    const written: Doc = { op: condition.op, ...(condition.right === undefined ? {} : { right: this.operand(condition.right) }) };
    if ('count' in left) {
      const count = left.count;
      const where = count.where;
      written['left'] = {
        count: {
          table: this.table(count.table),
          matchColumn: count.matchColumn,
          equalsField: count.equalsField,
          ...(where === undefined ? {} : { where: { left: { field: where.left.field }, op: where.op, ...(where.right === undefined ? {} : { right: this.operand(where.right) }) } }),
        },
      };
    } else {
      written['left'] = { field: left.field };
    }
    return { left: written['left'], op: written['op'], ...(written['right'] === undefined ? {} : { right: written['right'] }) };
  }

  value(value: AutomationWriteValue): unknown {
    if (typeof value === 'string') return value;
    if ('now' in value) return { now: true };
    if ('setting' in value) {
      return { setting: { table: this.table(value.setting.table), column: value.setting.column }, ...(value.else === undefined ? {} : { else: { staff: value.else.staff } }) };
    }
    const after = value.daysAfter;
    return {
      daysAfter: {
        ...(after.column === undefined ? {} : { column: after.column }),
        ...(after.now === true ? { now: true } : {}),
        days: after.days,
        ...(after.setting === undefined ? {} : { setting: { table: this.table(after.setting.table), column: after.setting.column } }),
        ...(after.at === undefined ? {} : { at: after.at }),
      },
    };
  }

  values(values: Record<string, AutomationWriteValue>): Doc {
    return Object.fromEntries(Object.entries(values).map(([column, value]) => [column, this.value(value)]));
  }

  /** A template a step sends: checked now, named once the rule is known to travel. */
  template(action: Doc, key: string | null): void {
    if (key === null || key === '') this.stays('RULE_UNFINISHED', 'This rule is not finished, so it is left out.');
    const why = whyTemplateStays(key, this.templates);
    if (why === 'builtin') this.stays('RULE_BUILTIN_EMAIL', 'This rule sends a built-in mail, which is not saved in an app.', true);
    if (why === 'missing') this.stays('RULE_UNFINISHED', 'This rule sends a mail that is not there, so it is left out.');
    if (why === 'no-english') {
      if (this.leaveOut.has(emailTarget(key))) this.stays('RULE_EMAIL_LEFT_OUT', 'This rule sends a mail you left out, so it is left out too.');
      this.stays('EMAIL_NO_ENGLISH', 'This rule sends a mail with no US English text, which an app\'s mail needs.', true);
    }
    if (this.templates.some((row) => row.key === key && row.managedBy !== null)) this.stays('RULE_APP_EMAIL', 'This rule sends a mail of an installed app, so it is left out.', true);
    this.#templateUses.push({ action, key });
    // A stand-in that reads as a key, until the rule is known to travel.
    action['templateKey'] = 'pending-template';
  }

  /** A text in the instance's language, and in each language the step gives, as one text or a map with US English. */
  words(main: string, locales: Record<string, { title: string; body: string | null }> | undefined, pick: 'title' | 'body'): string | Record<string, string> | undefined {
    const byTag: Record<string, string> = {};
    for (const [tag, texts] of Object.entries(locales ?? {})) {
      const text = pick === 'title' ? texts.title : texts.body;
      if (text !== null && text !== '') byTag[tag] = text;
    }
    if (Object.keys(byTag).length === 0) return main === '' && pick === 'body' ? undefined : main;
    if (byTag['en-US'] === undefined) {
      if (main === '') return Object.values(byTag)[0];
      byTag['en-US'] = main;
    }
    return Object.keys(byTag).length === 1 ? byTag['en-US'] : byTag;
  }

  action(nodeId: string, action: Doc & { kind: string }): Doc {
    switch (action.kind) {
      case 'email': {
        const to = action['to'] as { kind: string; column?: string; table?: string } | null;
        if (to === null) this.stays('RULE_UNFINISHED', 'This rule is not finished, so it is left out.');
        const written: Doc = { kind: 'email', templateKey: '' };
        this.template(written, action['templateKey'] as string | null);
        if (to.kind === 'fixed') {
          // The addresses never travel: the owner types them after installing.
          written['to'] = { kind: 'fixed' };
          this.#after.push({ group: 'after', code: 'RULE_ADDRESSES', kind: 'automation', field: `${nodeId}.to.addresses`, afterKind: 'address', message: 'The addresses this mail goes to are typed in after installing.' });
        } else if (to.kind === 'listed') written['to'] = { kind: 'listed', table: this.table(to.table) };
        else written['to'] = { kind: to.kind, column: to.column };
        const replyTo = action['replyTo'] as { staff: string } | undefined;
        if (replyTo !== undefined) written['replyTo'] = { staff: replyTo.staff };
        // A mail to the record's own address that says no class is service mail, as the store reads it; a file says so.
        if (action['class'] !== undefined) written['class'] = action['class'];
        else if (to.kind === 'field') written['class'] = 'service';
        if (action['purpose'] !== undefined) written['purpose'] = action['purpose'];
        const vars = action['vars'] as Record<string, string> | undefined;
        if (vars !== undefined && Object.keys(vars).length > 0) written['vars'] = { ...vars };
        return written;
      }
      case 'notification': {
        const to = action['to'] as { roles: string[] } | { users: string[] } | { listed: string } | { column: string; lead?: true; else?: { roles: string[] } } | null;
        if (to === null) this.stays('RULE_UNFINISHED', 'This rule is not finished, so it is left out.');
        let written: Doc;
        if ('users' in to) this.stays('RULE_TELLS_PEOPLE', 'This rule tells people by name, and an app tells roles. Leave it out, or change it to tell a role first.', true);
        if ('roles' in to) {
          const roles = this.role(to.roles, `${nodeId}.to.roles`);
          if (roles.length === 0) this.stays('RULE_ROLE_LEFT_OUT', 'This rule tells only roles that are not in the app (a built-in role, or one left out).', true);
          written = { roles };
        } else if ('listed' in to) written = { listed: this.table(to.listed) };
        else {
          const others = to.else === undefined ? [] : this.role(to.else.roles, `${nodeId}.to.else.roles`);
          written = { column: to.column, ...(to.lead === true ? { lead: true } : {}), ...(others.length === 0 ? {} : { else: { roles: others } }) };
        }
        const locales = action['locales'] as Record<string, { title: string; body: string | null }> | undefined;
        const title = this.words(String(action['title'] ?? ''), locales, 'title');
        const body = this.words((action['body'] as string | null) ?? '', locales, 'body');
        return { kind: 'notification', to: written, title, ...(body === undefined ? {} : { body }), ...(action['urgent'] === true ? { urgent: true } : {}) };
      }
      case 'record.create': {
        const table = action['table'] as string | null;
        if (table === null) this.stays('RULE_UNFINISHED', 'This rule is not finished, so it is left out.');
        return { kind: 'record.create', table: this.table(table), values: this.values((action['values'] ?? {}) as Record<string, AutomationWriteValue>), ...(typeof action['name'] === 'string' ? { name: action['name'] } : {}) };
      }
      case 'record.update':
        return { kind: 'record.update', values: this.values((action['values'] ?? {}) as Record<string, AutomationWriteValue>) };
      case 'digest': {
        const to = action['to'] as { roles: string[] } | null;
        if (to === null) this.stays('RULE_UNFINISHED', 'This rule is not finished, so it is left out.');
        const roles = this.role(to.roles, `${nodeId}.to.roles`);
        if (roles.length === 0) this.stays('RULE_ROLE_LEFT_OUT', 'This rule sends its summary only to roles that are not in the app (a built-in role, or one left out).', true);
        const written: Doc = { kind: 'digest', templateKey: '' };
        this.template(written, action['templateKey'] as string | null);
        type Section = { key: string; table: string; owner: string; where: AutomationCondition[]; orderBy: { column: string; dir: string } | null; limit: number; reach?: string; sum?: string[]; by?: string; target?: Doc & { table: string }; within?: Doc };
        const sections = (action['sections'] as Section[]).map((section) => ({
          key: section.key,
          table: this.table(section.table),
          owner: section.owner,
          ...(section.where.length === 0 ? {} : { where: section.where.map((condition) => this.condition(condition)) }),
          ...(section.orderBy === null ? {} : { orderBy: { column: section.orderBy.column, dir: section.orderBy.dir } }),
          limit: section.limit,
          ...(section.reach === undefined ? {} : { reach: section.reach }),
          ...(section.sum === undefined || section.sum.length === 0 ? {} : { sum: [...section.sum] }),
          ...(section.by === undefined ? {} : { by: section.by }),
          ...(section.target === undefined ? {} : { target: { ...section.target, table: this.table(section.target.table) } }),
          ...(section.within === undefined ? {} : { within: { ...section.within } }),
        }));
        return { ...written, to: { roles }, sections, ...(action['sendEmpty'] === true ? { sendEmpty: true } : {}) };
      }
      case 'webhook': {
        // Never the address or the header's value: the owner fills them in after installing.
        const headerName = typeof action['headerName'] === 'string' && HEADER_NAME.test(action['headerName']) ? action['headerName'] : null;
        this.#after.push({ group: 'after', code: 'RULE_WEBHOOK', kind: 'automation', field: `${nodeId}.url`, afterKind: 'webhook', message: 'The web address this rule calls is filled in after installing.' });
        if (headerName !== null) this.#after.push({ group: 'after', code: 'RULE_WEBHOOK_HEADER', kind: 'automation', field: `${nodeId}.headerValue`, afterKind: 'webhook', message: 'The value of the header this rule sends is filled in after installing.' });
        return {
          kind: 'webhook',
          method: action['method'] ?? 'POST',
          bodyKind: action['bodyKind'] ?? 'json',
          ...(typeof action['body'] === 'string' && action['body'] !== '' ? { body: action['body'] } : {}),
          ...(headerName === null ? {} : { headerName }),
        };
      }
      case 'document.render':
        // Resolved before the graph is walked (it reads the profile).
        return { kind: 'document.render', document: this.#documents.get(nodeId) };
      case 'add-on.step':
        return { kind: 'add-on.step', addOn: action['addOn'], step: action['step'], inputs: { ...((action['inputs'] ?? {}) as Doc) } };
      default:
        this.stays('RULE_STEP_KIND', 'This rule has a step an app cannot carry, so it is left out.');
    }
  }

  /** The document each document step draws, by node id: read ahead, since reading a profile is async. */
  readonly #documents = new Map<string, Doc>();

  async readDocuments(): Promise<void> {
    const profiles = documentProfilesRepo(this.ctx.source.meta);
    const walk = async (nodes: readonly StoredNode[]): Promise<void> => {
      for (const node of nodes) {
        const action = node['action'] as (Doc & { kind: string }) | undefined;
        if (node.kind === 'action' && action?.kind === 'document.render') {
          const id = action['profileId'] as string | null;
          const profile = id === null ? null : await profiles.findById(id);
          if (profile !== null && profile.connectionId === this.ctx.source.connectionId) {
            const table = this.ctx.refs.table(profile.table) ?? this.ctx.refs.tableByName(profile.table);
            if (table !== null) this.#documents.set(node.id, { table, kind: profile.kind, addOn: profile.addOnKey });
          }
        }
        for (const branch of (node['branches'] as { nodes: StoredNode[] }[] | undefined) ?? []) await walk(branch.nodes);
      }
    };
    await walk(this.stored.graph.nodes as unknown as StoredNode[]);
  }

  node(node: StoredNode): Doc {
    const base: Doc = { id: node.id, kind: node.kind, title: (node.title ?? '').slice(0, 120), ...(typeof node.sub === 'string' && node.sub !== '' ? { sub: node.sub.slice(0, 200) } : {}) };
    switch (node.kind) {
      case 'trigger':
      case 'stop':
        return base;
      case 'wait':
        return { ...base, amount: node['amount'], unit: node['unit'] };
      case 'condition':
        return { ...base, ...(node['onError'] === true ? { onError: true } : {}), condition: this.condition(node['condition'] as AutomationCondition) };
      case 'branch': {
        const branches = node['branches'] as { id: string; label: string; nodes: StoredNode[] }[];
        return { ...base, condition: this.condition(node['condition'] as AutomationCondition), branches: branches.map((branch) => ({ id: branch.id, label: branch.label, nodes: branch.nodes.map((child) => this.node(child)) })) };
      }
      case 'action': {
        const action = node['action'] as Doc & { kind: string };
        if (action.kind === 'document.render' && !this.#documents.has(node.id)) {
          this.stays(action['profileId'] === null ? 'RULE_UNFINISHED' : 'RULE_DOCUMENT_LEFT_OUT', action['profileId'] === null ? 'This rule is not finished, so it is left out.' : 'This rule draws a document that is not in the app, so it is left out.');
        }
        return { ...base, ...(node['onError'] === true ? { onError: true } : {}), action: this.action(node.id, action) };
      }
      default:
        this.stays('RULE_STEP_KIND', 'This rule has a step an app cannot carry, so it is left out.');
    }
  }
}
