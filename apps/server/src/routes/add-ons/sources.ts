// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's Sources: the services a lead source add-on speaks for, each
 * with its own key, switch and caps (`lead-sources/`).
 *
 * ─── WHO MAY DO WHAT ───────────────────────────────────────────────────────
 *
 * Anybody who may open the add-on's pages reads its sources: which there
 * are, the hosts each reaches, the last four of a saved key, the last Check,
 * the switch, the caps and today's use. Never a key.
 *
 * Every change (a key saved, removed or checked; a switch or a cap) needs the
 * add-on's settings guard, the one its settings route uses (`manifests.manage`,
 * or the install's own settings grant), and a signed-in person: an API key
 * never sets where an owner's account is spent.
 *
 * ─── WHAT A SAVE DOES ──────────────────────────────────────────────────────
 *
 * One source's key at a time, so a register's key is saved while another
 * source stays "Key not set". The key goes into the add-on's encrypted
 * credential envelope and its last four into the readable document, under
 * the install's lock; then the source is asked at once whether it takes the
 * key, so the card shows accepted, refused or can't reach. Saving a key for
 * a source that had none switches it on. The audit row names the source,
 * never the key.
 *
 * Saving and checking are refused while the operator has switched add-on
 * network calls off, and while this server is set to call nothing outside.
 */
import type { InstalledManifest, ManifestsRepo, MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { pagesAreGated, addOnPagePermission } from '../../add-ons/page-gate.js';
import type { AddOnRuntimeState } from '../../add-ons/runtime.js';
import { audited } from '../../audit/coverage.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { installReachOf } from '../../installs/reach.js';
import { rememberInstall, rememberedInstall, resolveInstall, selectorOf } from '../../installs/resolve.js';
import { sourceGate, usedToday } from '../../lead-sources/caps.js';
import { installManifest, sourceEntryOf, withLeadSource, type LeadSourceRefusal } from '../../lead-sources/call.js';
import { SOURCE_KEY_MAX, lastFour, sourceKey, withSourceKey } from '../../lead-sources/keys.js';
import { LEAD_SOURCE_ANSWER_SCHEMAS, leadSourceErrorSchema, type KeyChecked, type LeadSourceEntry } from '../../lead-sources/pending-types.js';
import {
  MAX_DAILY_CAP,
  SOURCE_VERDICTS,
  mutateSourceState,
  needsKey,
  readSourcesState,
  sourceStateOf,
  sourcesOf,
  speaksForSources,
  withSourcesLock,
  writeSourceState,
  type SourceState,
  type SourceVerdict,
} from '../../lead-sources/state.js';
import { addOnSettingsGrantHeld } from '../../rbac/add-on-grant.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { getPrincipal } from '../../rbac/principal.js';
import type { TrialPolicy } from '../../trial/policy.js';
import { refuseUnlessAllowed } from '../../trial/refuse.js';
import { addOnKeyParams } from './schema.js';

export interface SourceRoutesDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  runtime: () => AddOnRuntimeState | null;
  /** The add-on's settings guard (`/add-ons/:key/settings`): it resolves the install and remembers it. */
  settingsGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  connectionNames: () => Promise<Map<string, string>>;
  policy: () => Pick<TrialPolicy, 'allows'>;
  /** Whether this server calls anything outside (`ADMINIUM_NETWORK_FEATURES`). */
  networkFeatures: () => boolean;
  /** Test seam: the fetch every source's client makes its requests with. */
  fetchImpl?: typeof globalThis.fetch | undefined;
}

const sourceParams = addOnKeyParams.extend({ source: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/) });
const keyParams = addOnKeyParams;

const sourceView = z.object({
  id: z.string(),
  /** The hosts this source's calls may reach; none for the website, which Adminium reads itself. */
  hosts: z.array(z.string()),
  gives: z.array(z.enum(['find', 'fill', 'people'])),
  website: z.boolean(),
  needsKey: z.boolean(),
  paid: z.boolean(),
  /** The last four characters of the saved key ('' for a key too short to show any), or null when none is saved. */
  lastFour: z.string().nullable(),
  savedAt: z.number().nullable(),
  verdict: z.enum(SOURCE_VERDICTS).nullable(),
  checkedAt: z.number().nullable(),
  on: z.boolean(),
  dailyCap: z.number().nullable(),
  personShare: z.number().nullable(),
  /** Calls made today, over everybody (UTC day). */
  usedToday: z.number(),
  /** Seconds the source is still paused for, after its service said "too many"; 0 when it is not. */
  pausedFor: z.number(),
});
type SourceView = z.infer<typeof sourceView>;

const checkView = z.object({
  verdict: z.enum(SOURCE_VERDICTS),
  /** Why, when not accepted: the source's or the engine's refusal code. */
  code: z.string().nullable(),
  message: z.string().nullable(),
  /** The account the key belongs to, as the source names it. */
  account: z.string().nullable(),
});

const listReply = z.object({ key: z.string(), canManage: z.boolean(), sources: z.array(sourceView) });
const oneReply = z.object({ source: sourceView, check: checkView.nullable() });
const saveKeyBody = z.object({ value: z.string().min(1).max(SOURCE_KEY_MAX) }).strict();
const switchBody = z
  .object({
    on: z.boolean().optional(),
    dailyCap: z.number().int().min(1).max(MAX_DAILY_CAP).nullable().optional(),
    personShare: z.number().int().min(1).max(100).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Say what changes: on, dailyCap or personShare.');

/** The signed-in person making the change. An API key is refused by name. */
function requirePerson(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) {
    throw new ForbiddenError("A source's key and caps are set by a signed-in person, never with an API key.", 'FORBIDDEN', { reason: 'api-key' });
  }
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

/** What a Check found, as the card shows it. */
function verdictOf(answer: KeyChecked | LeadSourceRefusal): { verdict: SourceVerdict; code: string | null; message: string | null; account: string | null } {
  if (answer.ok) return { verdict: 'accepted', code: null, message: null, account: answer.account ?? null };
  return { verdict: answer.code === 'KEY_REFUSED' ? 'refused' : 'unreachable', code: answer.code, message: answer.message.slice(0, 500), account: null };
}

export function registerSourceRoutes(app: FastifyInstance, deps: SourceRoutesDeps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { meta, manifests } = deps;

  async function mayKeep(request: FastifyRequest, install: InstalledManifest): Promise<boolean> {
    if (await request.can(PERMISSIONS.manifestsManage)) return true;
    const principal = getPrincipal(request);
    return principal !== null && (await addOnSettingsGrantHeld(meta, principal, install));
  }

  /** Whether the reader may open any of the add-on's pages (each its own permission once its pages are gated). */
  async function mayOpenPages(request: FastifyRequest, install: InstalledManifest): Promise<boolean> {
    const manifest = installManifest(install);
    const pages = manifest?.addOn.pages ?? [];
    if (manifest === null || pages.length === 0) return false;
    if (!pagesAreGated(manifest)) return true;
    for (const page of pages) if (await request.can(addOnPagePermission(page.ref))) return true;
    return false;
  }

  /** The read guard: whoever keeps the add-on's settings, or may open one of its pages. */
  async function readGuard(request: FastifyRequest): Promise<void> {
    const { key } = request.params as { key: string };
    const reach = installReachOf(meta, request);
    const install = await resolveInstall(manifests, key, selectorOf(request), {
      kind: 'add-on',
      connectionNames: deps.connectionNames,
      reaches: async (one) => (await reach(one)) && ((await mayKeep(request, one)) || (await mayOpenPages(request, one))),
    });
    if (install === null) throw new NotFoundError(`${key} is not installed.`);
    if (!(await mayKeep(request, install)) && !(await mayOpenPages(request, install))) {
      throw new ForbiddenError(`Seeing the sources of ${key} needs its settings, or one of its pages.`);
    }
    rememberInstall(request, install);
  }

  /** The install the guard resolved, its manifest, and the one source named; or a 404. */
  function sourceOf(request: FastifyRequest, source: string): { install: InstalledManifest; entry: LeadSourceEntry } {
    const install = rememberedInstall(request);
    if (install === undefined) throw new NotFoundError('That add-on is not installed.');
    const found = sourceEntryOf(install, source);
    if (!('entry' in found)) throw new NotFoundError(found.message);
    return { install, entry: found.entry };
  }

  function speaks(install: InstalledManifest): LeadSourceEntry[] {
    const manifest = installManifest(install);
    if (manifest === null || !speaksForSources(manifest)) throw new NotFoundError(`"${install.row.manifestKey}" has no sources.`);
    return sourcesOf(manifest);
  }

  function viewOf(install: InstalledManifest, entry: LeadSourceEntry, state: SourceState, used: number): SourceView {
    return {
      id: entry.id,
      hosts: entry.reads === 'website' ? [] : [...(entry.hosts ?? [])],
      gives: [...entry.gives],
      website: entry.reads === 'website',
      needsKey: needsKey(entry),
      paid: entry.paid === true,
      lastFour: state.lastFour,
      savedAt: state.savedAt,
      verdict: state.verdict,
      checkedAt: state.checkedAt,
      on: state.on,
      dailyCap: state.dailyCap,
      personShare: state.personShare,
      usedToday: used,
      pausedFor: sourceGate.pausedFor(install.row.id, entry.id),
    };
  }

  async function viewNow(install: InstalledManifest, entry: LeadSourceEntry, state?: SourceState): Promise<SourceView> {
    const now = state ?? sourceStateOf(await readSourcesState(meta, install.row.id), entry);
    return viewOf(install, entry, now, await usedToday(meta, install.row.id, entry.id, app.rbac.now()));
  }

  /** Refused before anything goes out: the operator's switch, then this server's own. */
  function refuseOffline(): void {
    refuseUnlessAllowed(deps.policy(), 'addOnHttp', 'The operator has switched add-on network calls off for this installation, so no source can be asked.');
    if (!deps.networkFeatures()) {
      throw new ValidationFailedError('Network features are off on this server, so no source can be asked.', { reason: 'network-off' });
    }
  }

  function keyedSource(entry: LeadSourceEntry): void {
    if (entry.reads === 'website') throw new ValidationFailedError('Adminium reads the website itself: it takes no key.', { reason: 'website' });
    if (!needsKey(entry)) throw new ValidationFailedError(`${entry.id} needs no key.`, { reason: 'no-key' });
  }

  /** Asks the source whether it takes its key, and records what it said on the latest document. */
  async function check(request: FastifyRequest, install: InstalledManifest, entry: LeadSourceEntry, spender: string): Promise<{ state: SourceState; found: ReturnType<typeof verdictOf> }> {
    // A Check is short and asks nothing costly: the engine's own deadline for a call bounds it.
    const controller = new AbortController();
    const answer = await withLeadSource(
      { meta, manifests, runtime: deps.runtime, policy: deps.policy(), fetchImpl: deps.fetchImpl, log: (message, fields) => request.log.warn(fields, message) },
      { install, source: entry.id, spender, signal: controller.signal, purpose: 'check' },
      async (source) => {
        const said: unknown = await source.checkKey();
        // Parsed before it is believed: an answer outside the contract is the source being unavailable.
        const ok = LEAD_SOURCE_ANSWER_SCHEMAS.checkKey.safeParse(said);
        if (ok.success) return ok.data;
        const refused = leadSourceErrorSchema.safeParse(said);
        if (refused.success) return refused.data;
        request.log.warn({ addOn: install.row.manifestKey, source: entry.id }, 'a source answered its Check outside the contract');
        return { ok: false as const, code: 'UNAVAILABLE' as const, message: `${entry.id} answered in a way Adminium does not understand.` };
      },
    );
    let found = verdictOf(answer);
    // The source's own words are kept only after the saved key is taken out of them.
    const key = sourceKey(await manifests.getCredential(install.row.id), entry.id);
    if (found.message !== null && key !== null && key.length >= 6) found = { ...found, message: found.message.split(key).join('[the saved key]') };
    const at = app.rbac.now();
    const state = await mutateSourceState(meta, install.row.id, entry, (current) => ({ ...current, verdict: found.verdict, checkedAt: at }), at);
    await app.rbac.audit(request, {
      category: 'leads',
      action: 'leads.source.key.checked',
      // The source and what it said, never the key.
      changes: { after: { key: install.row.manifestKey, source: entry.id, verdict: found.verdict, code: found.code } },
    });
    return { state, found };
  }

  api.get(
    '/add-ons/:key/sources',
    { preHandler: [app.requireAuth, readGuard], config: { audience: 'staff' }, schema: { params: keyParams, response: { 200: listReply } } },
    async (request) => {
      const install = rememberedInstall(request)!;
      const entries = speaks(install);
      const document = await readSourcesState(meta, install.row.id);
      const sources: SourceView[] = [];
      for (const entry of entries) sources.push(viewOf(install, entry, sourceStateOf(document, entry), await usedToday(meta, install.row.id, entry.id, app.rbac.now())));
      return { key: install.row.manifestKey, canManage: await mayKeep(request, install), sources };
    },
  );

  api.put(
    '/add-ons/:key/sources/:source/key',
    { preHandler: [app.requireAuth, deps.settingsGuard], config: { audience: 'staff', audit: audited('rbac') }, schema: { params: sourceParams, body: saveKeyBody, response: { 200: oneReply } } },
    async (request) => {
      const by = requirePerson(request);
      refuseOffline();
      const { install, entry } = sourceOf(request, request.params.source);
      keyedSource(entry);
      const value = request.body.value.trim();
      if (value === '') throw new ValidationFailedError('Paste the key.', { reason: 'empty' });
      // The key and its last four change together, one writer at a time: two saves at once never lose a key.
      const replaced = await withSourcesLock(install.row.id, async () => {
        const envelope = await manifests.getCredential(install.row.id);
        const before = sourceKey(envelope, entry.id);
        await manifests.setCredential(install.row.id, { kind: 'api-key', secret: withSourceKey(envelope, entry.id, value) });
        const at = app.rbac.now();
        // A source with no key before is switched on by its first one; a replaced key leaves the switch as it was.
        await writeSourceState(meta, install.row.id, entry, (current) => ({ ...current, lastFour: lastFour(value), savedAt: at, verdict: null, checkedAt: null, on: before === null ? true : current.on }), at);
        return before !== null;
      });
      await app.rbac.audit(request, {
        category: 'leads',
        // The source's id, never the key.
        action: 'leads.source.key.saved',
        changes: { after: { key: install.row.manifestKey, source: entry.id, replaced } },
      });
      const { state, found } = await check(request, install, entry, by);
      return { source: await viewNow(install, entry, state), check: found };
    },
  );

  api.delete(
    '/add-ons/:key/sources/:source/key',
    { preHandler: [app.requireAuth, deps.settingsGuard], config: { audience: 'staff', audit: audited('rbac') }, schema: { params: sourceParams, response: { 200: oneReply } } },
    async (request) => {
      requirePerson(request);
      const { install, entry } = sourceOf(request, request.params.source);
      keyedSource(entry);
      const state = await withSourcesLock(install.row.id, async () => {
        const envelope = await manifests.getCredential(install.row.id);
        if (envelope !== null) await manifests.setCredential(install.row.id, { kind: 'api-key', secret: withSourceKey(envelope, entry.id, null) });
        const at = app.rbac.now();
        return writeSourceState(meta, install.row.id, entry, (current) => ({ ...current, lastFour: null, savedAt: null, verdict: null, checkedAt: null }), at);
      });
      await app.rbac.audit(request, { category: 'leads', action: 'leads.source.key.removed', changes: { before: { key: install.row.manifestKey, source: entry.id } } });
      return { source: await viewNow(install, entry, state), check: null };
    },
  );

  api.post(
    '/add-ons/:key/sources/:source/check',
    { preHandler: [app.requireAuth, deps.settingsGuard], config: { audience: 'staff', audit: audited('rbac') }, schema: { params: sourceParams, response: { 200: oneReply } } },
    async (request) => {
      const by = requirePerson(request);
      refuseOffline();
      const { install, entry } = sourceOf(request, request.params.source);
      if (entry.reads === 'website') throw new ValidationFailedError('Adminium reads the website itself: there is no key to check.', { reason: 'website' });
      if (needsKey(entry) && sourceKey(await manifests.getCredential(install.row.id), entry.id) === null) {
        throw new ValidationFailedError(`${entry.id}: key not set. Save one first.`, { reason: 'key-not-set' });
      }
      const { state, found } = await check(request, install, entry, by);
      return { source: await viewNow(install, entry, state), check: found };
    },
  );

  api.put(
    '/add-ons/:key/sources/:source',
    { preHandler: [app.requireAuth, deps.settingsGuard], config: { audience: 'staff', audit: audited('rbac') }, schema: { params: sourceParams, body: switchBody, response: { 200: oneReply } } },
    async (request) => {
      requirePerson(request);
      const { install, entry } = sourceOf(request, request.params.source);
      const body = request.body;
      // A paid source always has a cap: what keeps a click from spending the owner's account.
      if (entry.paid === true && body.dailyCap === null) throw new ValidationFailedError(`${entry.id} is paid: it keeps a daily cap.`, { reason: 'paid-cap' });
      const state = await mutateSourceState(
        meta,
        install.row.id,
        entry,
        (current) => ({
          ...current,
          ...(body.on === undefined ? {} : { on: body.on }),
          ...(body.dailyCap === undefined ? {} : { dailyCap: body.dailyCap }),
          ...(body.personShare === undefined ? {} : { personShare: body.personShare }),
        }),
        app.rbac.now(),
      );
      await app.rbac.audit(request, {
        category: 'leads',
        action: 'leads.source.changed',
        changes: { after: { key: install.row.manifestKey, source: entry.id, on: state.on, dailyCap: state.dailyCap, personShare: state.personShare } },
      });
      return { source: await viewNow(install, entry, state), check: null };
    },
  );
}
