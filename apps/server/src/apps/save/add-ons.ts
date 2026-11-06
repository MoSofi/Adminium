// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `addOns` (requires / suggests) and `apps.requires` for tables an install holds.
 *
 * ADD-ONS. The add-ons this database uses: those installed on it, those
 * attached to the dashboard, and those the saved parts name (a document's,
 * a way to pay, a public page's stock, a rule's add-on step, a role's
 * settings grant or a grant on an add-on's table). One that only an optional
 * part needs is suggested (ticked); one a rule's step, a role's grant on its
 * table or a public page needs is required.
 *
 * RANGES. The lowest version that works is not known from the database, so
 * the range is the installed version and up (`>=1.4.2`). An add-on that is
 * named but not installed here gets `>=0.0.0`, and Check says so.
 *
 * APPS. A table held by an installed catalog app makes that app required on
 * the same database (`apps.requires`, by publisher and key, from its
 * installed version up). The tables the file names of it are the ones the
 * save gives a ref, which must be the app's own ref (the install matches it).
 * An app installed from a file (publisher `local`) cannot be required: its
 * tables, pages and rules stay with it, and Check says so.
 *
 * NEVER. An add-on's credentials and its settings' values: after installing,
 * the owner gives them again (named in Check, never with a value).
 */
import type { AddOnNeeds, AppsBlock } from '@adminium/manifest';
import { automationsRepo, documentProfilesRepo, permissionsRepo, type InstalledManifest } from '@adminium/meta';

import { installsOf } from '../../installs/resolve.js';
import { paymentAddOnKeys } from '../../payments/ready.js';
import type { ConvertContext, ConvertPart } from './types.js';
import { addOnUsesOf, type AddOnUse } from './uses.js';

/** The host a plain dashboard's add-ons are attached to (`add-ons/install.ts`). */
const DASHBOARD_HOST = 'dashboard';
const THERE: ReadonlySet<string> = new Set(['installed', 'disabled']);
const NEEDS_MAX = 8;

const nameOf = (install: InstalledManifest): string => {
  const name = (install.document as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.trim() !== '' ? name : install.row.manifestKey;
};
const publisherOf = (install: InstalledManifest): string | null => {
  const id = (install.document as { publisher?: { id?: unknown } } | null)?.publisher?.id;
  return typeof id === 'string' ? id : null;
};

/** Every `add-on.step` an object holds, at any depth (a rule's graph). */
function stepAddOns(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) stepAddOns(item, out);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  if (record['kind'] === 'add-on.step' && typeof record['addOn'] === 'string' && record['addOn'] !== '') out.add(record['addOn']);
  for (const child of Object.values(record)) stepAddOns(child, out);
}

/** What the database's own rules and roles need of add-ons. */
async function usesHere(ctx: ConvertContext, heldByAddOn: ReadonlyMap<string, string>): Promise<AddOnUse[]> {
  const { meta, connectionId } = ctx.source;
  const out: AddOnUse[] = [];
  // Rules: a step an add-on gives. Not an install's rules, nor the rules a document's trigger makes.
  const profileRules = new Set((await documentProfilesRepo(meta).list({ connectionId })).map((p) => p.trigger?.automationId).filter((id): id is string => typeof id === 'string'));
  const chosen = ctx.choices.automations === undefined ? null : new Set(ctx.choices.automations);
  for (const rule of await automationsRepo(meta).list({ connectionId })) {
    if (rule.managedBy !== null || profileRules.has(rule.id) || (chosen !== null && !chosen.has(rule.id))) continue;
    const steps = new Set<string>();
    stepAddOns(rule.graph, steps);
    for (const key of steps) out.push({ key, optional: false, what: 'a rule runs one of its steps' });
  }
  // Roles: a settings grant, or a grant on one of an add-on's tables.
  const permissions = permissionsRepo(meta);
  for (const { role } of ctx.refs.roles()) {
    for (const grant of await permissions.listForRole(role.id)) {
      if (grant.resourceKind === 'app' && grant.resourceRef.startsWith('add-on/')) out.push({ key: grant.resourceRef.slice('add-on/'.length), optional: true, what: 'a role may change its settings' });
      if (grant.resourceKind === 'table' && grant.resourceRef.startsWith(`${connectionId}/`)) {
        const key = heldByAddOn.get(grant.resourceRef.slice(connectionId.length + 1));
        if (key !== undefined) out.push({ key, optional: false, what: 'a role works with its tables' });
      }
    }
  }
  return out;
}

export const convertAddOns: ConvertPart = async (ctx) => {
  const { meta, connectionId, model } = ctx.source;
  const installs = installsOf(meta);
  const everything = [...(await installs.list('add-on')), ...(await installs.list('app'))].filter((install) => THERE.has(install.row.status));
  const byId = new Map(everything.map((install) => [install.row.id, install]));

  // The tables installs hold here, by install.
  const heldByAddOn = new Map<string, string>();
  const heldByApp = new Map<string, { install: InstalledManifest; tables: { id: string; ref: string }[] }>();
  for (const table of model.tables) {
    const held = ctx.refs.heldBy(table.id);
    if (held === null || held.record.manifestId === null) continue;
    const install = byId.get(held.record.manifestId) ?? (await installs.findById(held.record.manifestId));
    if (install === null || install === undefined) continue;
    if (install.row.kind === 'add-on') {
      heldByAddOn.set(table.id, install.row.manifestKey);
      continue;
    }
    const entry = heldByApp.get(install.row.id) ?? { install, tables: [] };
    entry.tables.push({ id: table.id, ref: held.record.ref });
    heldByApp.set(install.row.id, entry);
  }

  // Apps: catalog apps are required; an app made from a file stays with its install.
  const requires: AppsBlock['requires'] = [];
  for (const { install, tables } of heldByApp.values()) {
    const publisher = publisherOf(install);
    if (publisher === null || publisher === 'local') {
      ctx.check.add({ group: 'info', code: 'APP_FROM_FILE', kind: 'app', item: nameOf(install), message: `${nameOf(install)} was installed from a file. Its tables, pages and rules stay with it; save it again where it was made.` });
      continue;
    }
    const named: string[] = [];
    for (const table of tables) {
      const ref = ctx.refs.table(table.id);
      if (ref === null) continue;
      if (ref === table.ref) named.push(ref);
      else ctx.check.add({ group: 'info', code: 'APP_TABLE_RENAMED', kind: 'table', item: table.ref, message: `It is ${nameOf(install)}'s table, saved under another name, so the install could not find it.` });
    }
    if (requires.length >= NEEDS_MAX) {
      ctx.check.add({ group: 'info', code: 'APPS_TOO_MANY', kind: 'app', item: nameOf(install), message: `A file names at most ${String(NEEDS_MAX)} apps it needs: install ${nameOf(install)} on the target first.` });
      continue;
    }
    requires.push({ publisher, key: install.row.manifestKey, range: `>=${install.row.version}`, ...(named.length === 0 ? {} : { tables: named.sort() }) });
    ctx.check.add({ group: 'info', code: 'APP_REQUIRED', kind: 'app', item: nameOf(install), message: `${nameOf(install)} ${install.row.version} or later must be installed on the target database first.` });
  }

  // Add-ons: installed here, attached to the dashboard, or named by what is saved.
  const uses: AddOnUse[] = [...addOnUsesOf(ctx), ...(await usesHere(ctx, heldByAddOn))];
  for (const install of everything) {
    if (install.row.kind !== 'add-on') continue;
    if (install.row.connectionId === connectionId) uses.push({ key: install.row.manifestKey, optional: true, what: 'it is installed on this database' });
    else if (install.row.connectionId === null && install.attachments.some((a) => a.attachedTo === DASHBOARD_HOST && a.disabledAt === null)) uses.push({ key: install.row.manifestKey, optional: true, what: 'it is attached to the dashboard' });
  }
  const need = new Map<string, { optional: boolean; what: string }>();
  for (const use of uses) {
    const before = need.get(use.key);
    // A part that needs it outweighs any number that would only like it.
    if (before === undefined || (before.optional && !use.optional)) need.set(use.key, { optional: use.optional, what: use.what });
  }

  const addOnInstall = (key: string): InstalledManifest | undefined =>
    everything.find((one) => one.row.kind === 'add-on' && one.row.manifestKey === key && one.row.connectionId === connectionId) ??
    everything.find((one) => one.row.kind === 'add-on' && one.row.manifestKey === key && one.row.connectionId === null);
  const payments = new Set(await paymentAddOnKeys({ manifests: installs }));
  const needs: { requires: NonNullable<AddOnNeeds['requires']>; suggests: NonNullable<AddOnNeeds['suggests']> } = { requires: [], suggests: [] };
  for (const [key, { optional, what }] of [...need].sort(([a], [b]) => a.localeCompare(b))) {
    if (key === ctx.choices.key || !/^[a-z][a-z0-9-]{1,79}$/.test(key)) continue;
    const install = addOnInstall(key);
    if (install === undefined) {
      ctx.check.add({ group: 'info', code: 'ADD_ON_NOT_HERE', kind: 'add-on', item: key, message: 'It is named by what is saved but is not installed here, so any version of it is asked for.' });
    }
    const list = optional ? needs.suggests : needs.requires;
    if (list.length >= NEEDS_MAX) {
      ctx.check.add({ group: 'info', code: 'ADD_ONS_TOO_MANY', kind: 'add-on', item: key, message: `A file names at most ${String(NEEDS_MAX)} add-ons in each list: install it on the target by hand.` });
      continue;
    }
    const reason = { 'en-US': `Used because ${what}.`.slice(0, 120) };
    const range = `>=${install?.row.version ?? '0.0.0'}`;
    if (optional) needs.suggests.push({ key, range, reason, checked: true });
    else needs.requires.push({ key, range, reason });

    if (install === undefined) continue;
    // What the owner gives the add-on again after installing: never a value, only what to fill in.
    const credentials = await meta.db.selectFrom('adminium_add_on_credentials').select('kind').where('manifestId', '=', install.row.id).execute();
    if (credentials.length > 0) {
      ctx.check.add({ group: 'after', code: 'ADD_ON_CREDENTIALS', kind: 'add-on', item: key, field: 'credentials', ...(payments.has(key) ? { afterKind: 'payment-key' } : {}), message: 'Its keys and passwords are not saved: give them again after installing.' });
    }
    const settings = await meta.db.selectFrom('adminium_add_on_settings').select('values').where('manifestId', '=', install.row.id).executeTakeFirst();
    const values = settings === undefined ? {} : (typeof settings.values === 'string' ? (JSON.parse(settings.values) as unknown) : settings.values);
    for (const [field, value] of Object.entries(typeof values === 'object' && values !== null ? (values as Record<string, unknown>) : {})) {
      if (value === null || value === undefined || value === '') continue;
      ctx.check.add({ group: 'after', code: 'ADD_ON_SETTING', kind: 'add-on', item: key, field, message: 'Its setting is not saved: set it again after installing if the app relies on it.' });
    }
  }

  return {
    ...(needs.requires.length === 0 && needs.suggests.length === 0
      ? {}
      : { addOns: { ...(needs.requires.length === 0 ? {} : { requires: needs.requires }), ...(needs.suggests.length === 0 ? {} : { suggests: needs.suggests }) } }),
    ...(requires.length === 0 ? {} : { apps: { requires } }),
  };
};
