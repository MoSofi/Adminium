// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LEAD DOOR: what a lead source add-on's staff screens ask of the engine.
 *
 * A lead source add-on (`lead-source@1`) holds the code that speaks to each
 * of its sources, and its screens; the engine does every call, every read of
 * a website, every write and every match, so the owner's keys, the server's
 * network and the app's tables are only ever reached by the engine's rules:
 *
 *  - `POST /leads/:key/search`: companies by activity and place, from one
 *    source that finds them, a page at a time; each marked when it is
 *    already here, and when it may not be added (no sales contact, a sole
 *    trader);
 *  - `POST /leads/:key/lookup`: one record's details, from the registers
 *    chosen and the company's own website; several matches are the picker's
 *    list; the person's Stop ends it;
 *  - `POST /leads/:key/add`: found companies into the companies table, each
 *    with a retry key; a partial reply says what was refused;
 *  - `POST /leads/:key/fill`: the ticked fields of one record, refused for a
 *    field somebody changed since the sheet showed it;
 *  - `POST /leads/:key/people` and `…/people/keep`: the people at a company,
 *    only while the add-on keeps people, and keeping the ticked ones
 *    (`leads/people.ts`: checked, stored, told at once).
 *
 * WHO: a signed-in person (never an API key: a search spends the owner's
 * account) who may open one of the add-on's pages or keep its settings. What
 * they then add or fill is written AS THEM (`crud/as-person.ts`): their
 * grants, column limits, row limits, rules, audit and live updates. Whether a
 * company is already here is decided as the install (`leads/match.ts`); what
 * they are shown of it, as them.
 *
 * WHAT IS WRITTEN: only what a source said, never what the page sends back.
 * Every answer is parsed with the contract's schemas, every string made one
 * plain line, and kept a while for the person's next click
 * (`leads/memory.ts`); "Add", "Fill in" and "Keep" name what was found, and
 * the door writes what it kept.
 */
import {
  LEAD_SOURCE_PAGE_MAX,
  SOURCE_READS_WEBSITE,
  parseLeadSourceAnswer,
  type CompaniesFound,
  type CompanyFacts,
  type FillQuery,
  type FoundCompany,
  type FoundPerson,
  type LeadSource,
  type LeadSourceError,
} from '@adminium/add-on-contracts';
import type { InstalledManifest, ManifestsRepo, MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';

import { pagesAreGated, addOnPagePermission } from '../../add-ons/page-gate.js';
import type { AddOnRuntimeState } from '../../add-ons/runtime.js';
import { looksLikeAddress } from '../../consent/index.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { createRowAsPerson, readAsPerson, updateAsPerson } from '../../crud/as-person.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import type { RecordWriteService } from '../../crud/write-service.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { plainWords } from '../../designer/untrusted.js';
import { audited, auditExempt } from '../../audit/coverage.js';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { installReachOf } from '../../installs/reach.js';
import { rememberInstall, rememberedInstall, resolveInstall, selectorOf } from '../../installs/resolve.js';
import { installManifest, sourceEntryOf, withLeadSource, type LeadSourceDeps, type LeadSourceRefusal } from '../../lead-sources/call.js';
import { readSourcesState, sourceStateOf, sourcesOf, speaksForSources, type LeadSourceEntry } from '../../lead-sources/state.js';
import { companiesTableFor, type CompaniesTable } from '../../leads/companies.js';
import { addRefusal, ADD_REFUSALS, withOfficersFor, type AddRefusal } from '../../leads/flags.js';
import { readLeadsSettings, type LeadsAddOnTables } from '../../leads/installs.js';
import { alreadyHere, domainKey, type Matched } from '../../leads/match.js';
import { FoundMemory, type AddedAnswer } from '../../leads/memory.js';
import { genericAddress, leadsInstall, type KeepFoundPeopleInput, type KeptPeople } from '../../leads/people.js';
import { isRegister } from '../../leads/registers.js';
import { pageFacts, websiteWords } from '../../leads/website-facts.js';
import { LEAD_FIELDS, leadColumns, noteFieldSources, ownerColumn, shownText, writesFor, type LeadField } from '../../leads/write.js';
import { readCompanyWebsite, type WebsiteReaderDeps } from '../../net/website-reader.js';
import { normaliseAddress } from '../../public-api/claim-code.js';
import { addOnSettingsGrantHeld } from '../../rbac/add-on-grant.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { getPrincipal } from '../../rbac/principal.js';
import type { TrialPolicy } from '../../trial/policy.js';
import { refuseUnlessAllowed } from '../../trial/refuse.js';
import { rowKeyOf } from '../../payments/payables.js';
import { peopleTablesOf } from '../../people/tables-of.js';
import { tableRefIndex, storedTableRef } from '../../apps/table-ref.js';

export interface LeadDoorDeps {
  meta: MetaDb;
  manifests: ManifestsRepo;
  manager: Pick<ConnectionManager, 'data'>;
  runtime: () => AddOnRuntimeState | null;
  policy: () => Pick<TrialPolicy, 'allows'>;
  /** Whether this server calls anything outside (`ADMINIUM_NETWORK_FEATURES`). */
  networkFeatures: () => boolean;
  /** The write service: the fields' sources rows are checked by it, as Adminium writes them. */
  writes: Pick<RecordWriteService, 'check'>;
  /** Keeps the people a source found at a company (`leads/people.ts`). */
  keep: (input: KeepFoundPeopleInput) => Promise<KeptPeople>;
  /** Whether an address is on the do-not-email list. */
  stopped: (address: string) => Promise<boolean>;
  /** The engine's website reader: its state, its log and the operator's switch. */
  reader: WebsiteReaderDeps;
  connectionNames: () => Promise<Map<string, string>>;
  /** A database's schema as the install reads it; the snapshot as others read it when absent. */
  viewFor?: ((connectionId: string) => Promise<SnapshotView | null>) | undefined;
  memory?: FoundMemory | undefined;
  /** Test seams: the fetch each source's client makes its requests with, and the engine's deadline for a call. */
  fetchImpl?: typeof globalThis.fetch | undefined;
  deadlineMs?: number | undefined;
  now?: () => number;
}

// ── shapes ───────────────────────────────────────────────────────────────────

const keyParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) });
const sourceId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
/** A companies table, by its id or its stored name `<app>:<ref>`. */
const tableName = z.string().min(1).max(200).optional();
const recordKey = z.string().min(1).max(200);
/** A key a page mints for one found company: sent again, the add answers what it did the first time. */
const retryKey = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);

const addressView = z.object({ lines: z.string().optional(), town: z.string().optional(), region: z.string().optional(), postalCode: z.string().optional(), country: z.string().optional() });
const foundView = z.object({
  ref: z.string(),
  name: z.string(),
  number: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  address: addressView.optional(),
  activity: z.object({ code: z.string().optional(), label: z.string().optional() }).optional(),
  about: z.string().optional(),
  natural: z.boolean(),
  noMarketing: z.boolean(),
  officers: z.array(z.object({ name: z.string(), role: z.string().optional() })).optional(),
  sourceUrl: z.string().optional(),
  /** The row it already is: its key only when the reader may open it ("kept by a colleague" otherwise), never its values. */
  here: z.object({ key: z.string().nullable(), keptByColleague: z.boolean(), by: z.enum(['number', 'domain', 'name']) }).nullable(),
  /** Why it may not be ticked, with what to say; null when it may. */
  blocked: z.object({ reason: z.enum(['no-marketing', 'sole-trader', 'needs-address']), message: z.string() }).nullable(),
});
type FoundView = z.infer<typeof foundView>;

const searchBody = z
  .object({
    source: sourceId,
    table: tableName,
    /** An activity code in the source's own scheme. */
    activity: z.string().trim().min(1).max(40),
    place: z
      .object({
        text: z.string().trim().max(200),
        country: z.string().regex(/^[A-Z]{2}$/),
        /** Place codes the page resolved (France's INSEE codes, Norway's municipalities); handed on as they are. */
        codes: z.array(z.string().regex(/^[A-Za-z0-9-]{1,20}$/)).max(200).optional(),
      })
      .strict(),
    cursor: z.string().min(1).max(1024).nullable().optional(),
    size: z.number().int().min(1).max(LEAD_SOURCE_PAGE_MAX).optional(),
  })
  .strict();
const searchReply = z.object({ source: z.string(), table: z.string().nullable(), peopleOn: z.boolean(), companies: z.array(foundView), next: z.string().nullable(), total: z.number().nullable() });

const addBody = z
  .object({
    source: sourceId,
    table: tableName,
    companies: z
      .array(
        z
          .object({
            ref: z.string().min(1).max(100),
            retryKey,
            /** A sole trader's own address, with people on: they are kept as a person and told. */
            email: z.string().trim().max(320).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(LEAD_SOURCE_PAGE_MAX),
  })
  .strict();
const addReason = z.enum(['already-here', 'no-marketing', 'sole-trader', 'needs-address', 'not-found', 'refused', 'not-kept']);
const addResult = z.object({ ref: z.string(), outcome: z.enum(['added', 'refused']), key: z.string().nullable(), reason: addReason.nullable(), message: z.string().nullable() });
const addReply = z.object({ table: z.string(), added: z.number(), refused: z.number(), message: z.string(), results: z.array(addResult) });

const lookupBody = z
  .object({
    table: tableName,
    record: recordKey,
    /** The registers to ask (sources that fill in a company). */
    sources: z.array(sourceId).max(8).default([]),
    /** Read the company's own website (the record's). */
    website: z.boolean().default(false),
    /** A host the person agreed to after "This website sends visitors to …". */
    confirmedHost: z.string().trim().min(1).max(253).optional(),
    /** In place of the record's own: a number (the picker's "Use this one"), or a name and town. */
    number: z.string().trim().min(1).max(40).optional(),
    name: z.string().trim().min(1).max(300).optional(),
    town: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
const lookupSource = z.object({
  source: z.string(),
  outcome: z.enum(['found', 'several', 'none', 'refused']),
  code: z.string().nullable(),
  message: z.string().nullable(),
  matches: z.array(foundView),
});
const lookupReply = z.object({
  table: z.string(),
  record: z.string(),
  sources: z.array(lookupSource),
  website: z.object({ outcome: z.enum(['read', 'asks', 'refused-by-site', 'not-a-page', 'unreachable', 'no-website', 'off']), host: z.string().nullable(), message: z.string().nullable() }).nullable(),
  fields: z.array(
    z.object({
      field: z.enum(LEAD_FIELDS),
      column: z.string(),
      /** The value the record holds now, as the sheet shows it. */
      now: z.string().nullable(),
      found: z.array(z.object({ source: z.string(), value: z.string() })),
    }),
  ),
});

const fillBody = z
  .object({
    table: tableName,
    record: recordKey,
    fields: z
      .array(z.object({ field: z.enum(LEAD_FIELDS), source: sourceId, now: z.string().max(10_000).nullable() }).strict())
      .min(1)
      .max(LEAD_FIELDS.length),
  })
  .strict();
const fillReply = z.object({ table: z.string(), record: z.string(), filled: z.array(z.object({ field: z.enum(LEAD_FIELDS), column: z.string(), source: z.string() })) });

const peopleBody = z.object({ table: tableName, record: recordKey, source: sourceId }).strict();
const peopleReply = z.object({
  record: z.string(),
  domain: z.string(),
  people: z.array(z.object({ name: z.string(), role: z.string().nullable(), email: z.string(), sources: z.array(z.string()), note: z.enum(['generic', 'already-here']).nullable() })),
  /** How many it found are on the do-not-email list: not listed, never kept. */
  stopped: z.number(),
});
const keepBody = z.object({ table: tableName, record: recordKey, source: sourceId, emails: z.array(z.string().trim().min(3).max(320)).min(1).max(LEAD_SOURCE_PAGE_MAX) }).strict();
const keepReply = z.object({
  kept: z.array(z.object({ email: z.string(), personTable: z.string(), personKey: z.string() })),
  refused: z.array(z.object({ email: z.string(), reason: z.string() })),
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** The HTTP status each refusal answers with. */
const REFUSAL_STATUS: Readonly<Record<string, number>> = {
  SOURCE_OFF: 409,
  KEY_NOT_SET: 409,
  NOT_VOUCHED: 409,
  KEY_REFUSED: 409,
  DAILY_CAP: 429,
  PERSON_SHARE: 429,
  PAUSED: 429,
  BUSY: 429,
  RATE_LIMITED: 429,
  QUOTA_SPENT: 429,
  NOT_FOUND: 404,
  INVALID_REQUEST: 422,
  UNAVAILABLE: 502,
};

/** The add-on's own display name: the engine's words never name an add-on of their own. */
function displayName(install: InstalledManifest): string {
  const name = (install.document as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : install.row.manifestKey;
}

/** What a refusal says, in the door's words where the engine's own would name a package. */
function refusalWords(refusal: LeadSourceRefusal, install: InstalledManifest): string {
  if (refusal.code === 'NOT_VOUCHED') return `${displayName(install)} did not load: its package is not one Adminium can vouch for.`;
  return refusal.message;
}

function refusalError(refusal: LeadSourceRefusal, install: InstalledManifest, source: string): AppError {
  const retry = 'retryAfterSeconds' in refusal ? refusal.retryAfterSeconds : undefined;
  return new AppError(REFUSAL_STATUS[refusal.code] ?? 502, refusal.code, refusalWords(refusal, install), { source, ...(retry === undefined ? {} : { retryAfterSeconds: retry }) });
}

/** A found company, every string one plain line within the contract's bounds. */
function plainCompany(company: FoundCompany): FoundCompany {
  const line = (value: string | undefined, max: number) => (value === undefined ? undefined : plainWords(value, max) || undefined);
  const address = company.address === undefined ? undefined : Object.fromEntries(Object.entries(company.address).map(([key, value]) => [key, line(value, key === 'lines' ? 500 : 120)]).filter(([, value]) => value !== undefined));
  const out: FoundCompany = {
    ref: plainWords(company.ref, 100),
    name: plainWords(company.name, 300),
    natural: company.natural,
    noMarketing: company.noMarketing,
  };
  const put = <K extends keyof FoundCompany>(key: K, value: FoundCompany[K] | undefined) => {
    if (value !== undefined) out[key] = value;
  };
  put('number', line(company.number, 40));
  put('website', company.website);
  put('phone', line(company.phone, 40));
  if (address !== undefined && Object.keys(address).length > 0) out.address = address as FoundCompany['address'];
  if (company.activity !== undefined) out.activity = { ...(company.activity.code === undefined ? {} : { code: plainWords(company.activity.code, 20) }), ...(company.activity.label === undefined ? {} : { label: plainWords(company.activity.label, 300) }) };
  put('about', line(company.about, 2000));
  if (company.officers !== undefined) out.officers = company.officers.map((officer) => ({ name: plainWords(officer.name, 200), ...(officer.role === undefined ? {} : { role: plainWords(officer.role, 100) }) }));
  put('sourceUrl', company.sourceUrl);
  return out;
}

/** A found person, plain, with their address as every door writes it. */
function plainPerson(person: FoundPerson): FoundPerson {
  return {
    name: plainWords(person.name, 200),
    ...(person.role === undefined ? {} : { role: plainWords(person.role, 100) }),
    email: normaliseAddress(person.email.trim()),
    sources: person.sources,
  };
}

/** A FoundCompany's facts (what a fill may write). */
function factsOf(company: FoundCompany): CompanyFacts {
  const { ref: _ref, natural: _natural, noMarketing: _noMarketing, officers: _officers, ...facts } = company;
  return facts;
}

const sameShown = (a: string | null, b: string | null): boolean => (a ?? '') === (b ?? '');

// ── the routes ───────────────────────────────────────────────────────────────

export function leadDoorRoutes(deps: LeadDoorDeps): FastifyPluginAsync {
  const memory = deps.memory ?? new FoundMemory(deps.now);
  const now = deps.now ?? Date.now;

  return async (app: FastifyInstance) => {
    const api = app.withTypeProvider<ZodTypeProvider>();
    const { meta, manifests } = deps;

    async function mayKeep(request: FastifyRequest, install: InstalledManifest): Promise<boolean> {
      if (await request.can(PERMISSIONS.manifestsManage)) return true;
      const principal = getPrincipal(request);
      return principal !== null && (await addOnSettingsGrantHeld(meta, principal, install));
    }

    async function mayOpenPages(request: FastifyRequest, install: InstalledManifest): Promise<boolean> {
      const manifest = installManifest(install);
      const pages = manifest?.addOn.pages ?? [];
      if (manifest === null || pages.length === 0) return false;
      if (!pagesAreGated(manifest)) return true;
      for (const page of pages) if (await request.can(addOnPagePermission(page.ref))) return true;
      return false;
    }

    /** The door's guard: a signed-in person who may open the add-on's pages or keep its settings, on an add-on that speaks for sources. */
    async function doorGuard(request: FastifyRequest): Promise<void> {
      if (request.apiKeyPrincipal != null) {
        throw new ForbiddenError('Finding companies is done by a signed-in person, never with an API key: it spends the owner’s accounts.', 'FORBIDDEN', { reason: 'api-key' });
      }
      const { key } = request.params as { key: string };
      const reach = installReachOf(meta, request);
      const may = async (one: InstalledManifest) => (await mayKeep(request, one)) || (await mayOpenPages(request, one));
      const install = await resolveInstall(manifests, key, selectorOf(request), { kind: 'add-on', connectionNames: deps.connectionNames, reaches: async (one) => (await reach(one)) && (await may(one)) });
      if (install === null) throw new NotFoundError(`${key} is not installed.`);
      const manifest = installManifest(install);
      if (manifest === null || !speaksForSources(manifest)) throw new NotFoundError(`"${key}" finds no companies.`);
      if (!(await may(install))) throw new ForbiddenError(`Finding companies with ${displayName(install)} needs one of its pages.`);
      rememberInstall(request, install);
    }

    /** Everything one call works with: the install, the person, the database and its companies table. */
    interface Door {
      install: InstalledManifest;
      name: string;
      staffId: string;
      staffLabel: string;
      owner: string;
      connectionId: string;
      view: SnapshotView;
      companies: CompaniesTable;
      leads: LeadsAddOnTables | null;
      peopleOn: boolean;
    }

    async function viewOf(connectionId: string): Promise<SnapshotView> {
      const view = deps.viewFor === undefined ? await loadSnapshotView(meta, connectionId, { forOthers: true }) : await deps.viewFor(connectionId);
      if (view === null) throw new ValidationFailedError('The database this add-on is on cannot be read now.', { reason: 'database' });
      return view;
    }

    async function doorOf(request: FastifyRequest, table: string | undefined): Promise<Door> {
      const install = rememberedInstall(request);
      if (install === undefined) throw new NotFoundError('That add-on is not installed.');
      const user = (request as unknown as { user?: { id?: string; email?: string; name?: string } }).user;
      if (user?.id === undefined) throw new UnauthorizedError();
      const connectionId = install.row.connectionId;
      if (connectionId === null) throw new ValidationFailedError(`${displayName(install)} is not attached to an app's database.`, { reason: 'no-database' });
      const view = await viewOf(connectionId);
      const companies = await companiesTableFor(meta, connectionId, view, table);
      if (companies === null) {
        throw new ValidationFailedError(table === undefined ? 'No app on this database keeps companies.' : `"${table}" is not a table of companies here.`, { reason: 'no-companies-table' });
      }
      const found = await leadsInstall({ meta, manager: deps.manager, viewFor: async () => view }, install.row.id);
      const leads = found?.addOn ?? null;
      let peopleOn = false;
      if (leads !== null) {
        const { db } = await deps.manager.data(connectionId);
        peopleOn = (await readLeadsSettings(db, leads)).peopleOn && leads.foundPeople !== null;
      }
      return { install, name: displayName(install), staffId: user.id, staffLabel: user.email ?? user.name ?? user.id, owner: FoundMemory.owner(install.row.id, user.id), connectionId, view, companies, leads, peopleOn };
    }

    /** Refused before anything goes out: the operator's switch, then this server's own. */
    function refuseOffline(): void {
      refuseUnlessAllowed(deps.policy(), 'addOnHttp', 'The operator has switched add-on network calls off for this installation, so no source can be asked.');
      if (!deps.networkFeatures()) throw new ValidationFailedError('Network features are off on this server, so no source can be asked.', { reason: 'network-off' });
    }

    /** One source of the install, giving `give`; the website reader is never one of these. */
    function sourceGiving(door: Door, source: string, give: 'find' | 'fill' | 'people'): LeadSourceEntry {
      const found = sourceEntryOf(door.install, source);
      if (!('entry' in found)) throw new NotFoundError(found.message);
      const { entry } = found;
      if (entry.reads === SOURCE_READS_WEBSITE || !entry.gives.includes(give)) {
        const what = give === 'find' ? 'find companies' : give === 'fill' ? 'fill in a company' : 'find people';
        throw new ValidationFailedError(`${source} does not ${what}.`, { reason: 'gives', source });
      }
      return entry;
    }

    function callDeps(request: FastifyRequest): LeadSourceDeps {
      return {
        meta,
        manifests,
        runtime: deps.runtime,
        policy: deps.policy(),
        fetchImpl: deps.fetchImpl,
        deadlineMs: deps.deadlineMs,
        log: (message, fields) => request.log.warn(fields, message),
      };
    }

    /** Asks one source, as the person, with their Stop; the answer parsed (an answer outside the contract is the source being unavailable). */
    async function ask<C extends 'findCompanies' | 'fillCompany' | 'findPeople'>(
      request: FastifyRequest,
      door: Door,
      source: string,
      call: C,
      signal: AbortSignal,
      run: (made: LeadSource) => Promise<unknown> | undefined,
    ): Promise<(C extends 'findPeople' ? { ok: true; people: FoundPerson[] } : CompaniesFound) | LeadSourceRefusal> {
      const locale = (await recipientLocale(meta, door.staffId)).replace('_', '-');
      const answer = await withLeadSource(callDeps(request), { install: door.install, source, spender: door.staffId, signal, locale }, async (made) => {
        const work = run(made);
        if (work === undefined) return { ok: false, code: 'INVALID_REQUEST', message: `${source} does not answer this question.` } satisfies LeadSourceError;
        const parsed = parseLeadSourceAnswer(call, await work);
        if (parsed.issues.length > 0) request.log.warn({ addOn: door.install.row.manifestKey, source, call, issues: parsed.issues.slice(0, 10) }, 'a source answered outside the contract');
        return parsed.answer as never;
      });
      return answer as never;
    }

    /** "Already here" for each found company, decided as the install; what the reader is shown of each row, as them. */
    async function hereOf(request: FastifyRequest, door: Door, companies: readonly FoundCompany[]): Promise<FoundView['here'][]> {
      const { db } = await deps.manager.data(door.connectionId);
      const matched: (Matched | null)[] = await alreadyHere(
        db,
        door.companies,
        companies.map((one) => ({ name: one.name, number: one.number, website: one.website, town: one.address?.town })),
      );
      const seen = new Map<string, boolean>();
      const out: FoundView['here'][] = [];
      for (const match of matched) {
        if (match === null) {
          out.push(null);
          continue;
        }
        let opens = seen.get(match.key);
        if (opens === undefined) {
          opens = (await readAsPerson(app, request, door.connectionId, door.companies.table.id, match.key)) !== null;
          seen.set(match.key, opens);
        }
        out.push({ key: opens ? match.key : null, keptByColleague: !opens, by: match.by });
      }
      return out;
    }

    function viewOfFound(company: FoundCompany, here: FoundView['here'], peopleOn: boolean): FoundView {
      const refusal = here === null ? addRefusal(company, peopleOn, null) : null;
      return {
        ...withOfficersFor(company, peopleOn),
        here,
        blocked: refusal === null ? null : { reason: refusal, message: ADD_REFUSALS[refusal] },
      };
    }

    /**
     * The person's Stop: the page went away (or its Stop dropped the call)
     * before the answer was sent. The reply closing before it ended says so;
     * so does the request stream ending in an error.
     */
    function stopOf(request: FastifyRequest, reply: FastifyReply): AbortController {
      const stop = new AbortController();
      const stopped = () => stop.abort(new DOMException('Stopped.', 'AbortError'));
      reply.raw.once('close', () => {
        if (!reply.raw.writableEnded) stopped();
      });
      request.raw.once('close', () => {
        if (request.raw.errored !== null && request.raw.errored !== undefined && !reply.raw.writableEnded) stopped();
      });
      // The connection itself going away (the browser's Stop, a closed tab); let go of once answered, as a kept-alive connection serves more.
      const socket = request.raw.socket as NodeJS.EventEmitter | null | undefined;
      const gone = () => {
        if (!reply.raw.writableEnded) stopped();
      };
      socket?.once('close', gone);
      reply.raw.once('finish', () => socket?.off('close', gone));
      return stop;
    }

    /** One record of the companies table as the person reads it; a 404 when they cannot open it. */
    async function recordOf(request: FastifyRequest, door: Door, key: string): Promise<Row> {
      const row = await readAsPerson(app, request, door.connectionId, door.companies.table.id, key);
      if (row === null) throw new NotFoundError('That company is not here, or not one you can open.');
      return row;
    }

    // Every door writes an audit row as the person (`leads.*`), but a look-up, which only reads and asks.
    const routeConfig = { audience: 'staff' as const, rateLimitBucket: 'lead-door' as const, audit: audited('rbac') };
    const readConfig = { audience: 'staff' as const, rateLimitBucket: 'lead-door' as const, audit: auditExempt('A look-up reads one record and asks the chosen sources and the website; it writes nothing, and the fill that follows is audited.') };

    // ── search ────────────────────────────────────────────────────────────────
    api.post(
      '/leads/:key/search',
      { preHandler: [app.requireAuth, doorGuard], config: routeConfig, schema: { params: keyParams, body: searchBody, response: { 200: searchReply } } },
      async (request, reply) => {
        const body = request.body;
        const door = await doorOf(request, body.table);
        sourceGiving(door, body.source, 'find');
        refuseOffline();
        const stop = stopOf(request, reply);
        const answer = await ask(request, door, body.source, 'findCompanies', stop.signal, (made) =>
          made.findCompanies?.({
            activity: body.activity,
            place: { text: body.place.text, country: body.place.country, ...(body.place.codes === undefined ? {} : { codes: body.place.codes }) },
            page: { cursor: body.cursor ?? null, size: body.size ?? 20 },
          }),
        );
        if (!answer.ok) throw refusalError(answer, door.install, body.source);
        const companies = answer.companies.map(plainCompany);
        memory.rememberCompanies(door.owner, body.source, companies);
        const here = await hereOf(request, door, companies);
        await app.rbac.audit(request, {
          category: 'leads',
          action: 'leads.search',
          // The source and what was asked (the place's words cut to 200), and how many were found: never what was found.
          changes: { after: { key: door.install.row.manifestKey, source: body.source, activity: body.activity, place: body.place.text.slice(0, 200), country: body.place.country, found: companies.length, here: here.filter((one) => one !== null).length } },
        });
        return {
          source: body.source,
          table: door.companies.ref,
          peopleOn: door.peopleOn,
          companies: companies.map((company, at) => viewOfFound(company, here[at] ?? null, door.peopleOn)),
          next: answer.next,
          total: answer.total ?? null,
        };
      },
    );

    // ── add ───────────────────────────────────────────────────────────────────
    api.post(
      '/leads/:key/add',
      { preHandler: [app.requireAuth, doorGuard], config: routeConfig, schema: { params: keyParams, body: addBody, response: { 200: addReply } } },
      async (request) => {
        const body = request.body;
        const door = await doorOf(request, body.table);
        sourceGiving(door, body.source, 'find');
        const { db } = await deps.manager.data(door.connectionId);
        const index = await tableRefIndex(meta, door.connectionId, door.view.model);
        const tableRef = storedTableRef(index, door.companies.table.id);
        const owner = ownerColumn(door.companies);
        const keepsRetryKey = door.companies.table.table.columns.some((column) => column.retryKey === true);
        const results: AddedAnswer[] = [];
        const noted: { key: string; columns: { column: string; source: string }[]; stored: Row }[] = [];

        for (const one of body.companies) {
          const earlier = memory.added(door.owner, one.retryKey);
          if (earlier !== null) {
            results.push(earlier);
            continue;
          }
          const answer = (outcome: AddedAnswer): AddedAnswer => {
            // A refusal that may change (a colleague's add, a person's address) is not kept: only what was done.
            if (outcome.outcome === 'added') memory.rememberAdded(door.owner, one.retryKey, outcome);
            results.push(outcome);
            return outcome;
          };
          const company = memory.company(door.owner, body.source, one.ref);
          if (company === null) {
            answer({ ref: one.ref, outcome: 'refused', reason: 'not-found', message: 'This company is no longer in your search: search again.' });
            continue;
          }
          const address = one.email === undefined || one.email === '' ? null : one.email;
          const refusal: AddRefusal | null = addRefusal(company, door.peopleOn, address);
          if (refusal !== null) {
            answer({ ref: one.ref, outcome: 'refused', reason: refusal, message: ADD_REFUSALS[refusal] });
            continue;
          }
          if (company.natural && address !== null && (!looksLikeAddress(address) || genericAddress(normaliseAddress(address)) || (await deps.stopped(normaliseAddress(address))))) {
            answer({ ref: one.ref, outcome: 'refused', reason: 'needs-address', message: 'That address cannot be kept: give the person’s own address.' });
            continue;
          }
          // Already here, as the install sees the table: never twice, whoever keeps it.
          const [match] = await alreadyHere(db, door.companies, [{ name: company.name, number: company.number, website: company.website, town: company.address?.town }]);
          if (match !== null && match !== undefined) {
            answer({ ref: one.ref, outcome: 'refused', reason: 'already-here', message: 'Already here.' });
            continue;
          }
          const writes = writesFor(door.companies, factsOf(company));
          const values: Record<string, unknown> = Object.fromEntries(writes.map((write) => [write.column, write.value]));
          if (owner !== null) values[owner] = door.staffId;
          let stored: Row;
          try {
            stored = (
              await createRowAsPerson(app, request, door.connectionId, door.companies.table.id, values, { code: 'COMPANY_REFUSED', message: 'The company was refused.' }, keepsRetryKey ? { clientKey: one.retryKey } : {})
            ).row;
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
            answer({ ref: one.ref, outcome: 'refused', reason: 'refused', message: error.message });
            continue;
          }
          const key = rowKeyOf(door.companies.table, stored);
          // A sole trader is a person: kept and told at once, or the company row goes again.
          if (company.natural && address !== null) {
            const kept = await deps.keep({
              installId: door.install.row.id,
              addOnKey: door.install.row.manifestKey,
              staff: { id: door.staffId, label: door.staffLabel, request },
              company: { table: tableRef, key },
              source: body.source,
              people: [{ name: company.officers?.[0]?.name ?? company.name, email: address, sources: company.sourceUrl === undefined ? [] : [company.sourceUrl] }],
            });
            if (kept.kept.length === 0) {
              await app.inject({ method: 'DELETE', url: `/api/v1/data/${encodeURIComponent(door.connectionId)}/${encodeURIComponent(door.companies.table.id)}/${encodeURIComponent(key)}`, headers: { ...(request.headers.cookie === undefined ? {} : { cookie: request.headers.cookie }), ...(request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization }) }, remoteAddress: request.ip });
              answer({ ref: one.ref, outcome: 'refused', reason: 'not-kept', message: `The person was not kept (${kept.refused[0]?.reason ?? 'refused'}).` });
              continue;
            }
          }
          answer({ ref: one.ref, outcome: 'added', key });
          noted.push({ key, columns: writes.map((write) => ({ column: write.column, source: body.source })), stored });
        }

        if (door.leads !== null) {
          for (const one of noted) await noteFieldSources({ manager: deps.manager, writes: deps.writes }, { addOn: door.leads, view: door.view, tableRef, rowKey: one.key, columns: one.columns, stored: one.stored, at: now() });
        }
        const added = results.filter((one) => one.outcome === 'added').length;
        const refused = results.length - added;
        const reasons: Record<string, number> = {};
        for (const one of results) if (one.outcome === 'refused') reasons[one.reason ?? 'refused'] = (reasons[one.reason ?? 'refused'] ?? 0) + 1;
        await app.rbac.audit(request, {
          category: 'leads',
          action: 'leads.added',
          changes: { after: { key: door.install.row.manifestKey, source: body.source, table: tableRef, added, refused: reasons, rows: results.filter((one) => one.outcome === 'added').map((one) => one.key) } },
        });
        return {
          table: tableRef,
          added,
          refused,
          message: refused === 0 ? `${String(added)} added` : `${String(added)} added, ${String(refused)} refused`,
          results: results.map((one) => ({ ref: one.ref, outcome: one.outcome, key: one.key ?? null, reason: (one.reason ?? null) as z.infer<typeof addReason> | null, message: one.message ?? null })),
        };
      },
    );

    // ── look up ───────────────────────────────────────────────────────────────
    api.post(
      '/leads/:key/lookup',
      { preHandler: [app.requireAuth, doorGuard], config: readConfig, schema: { params: keyParams, body: lookupBody, response: { 200: lookupReply } } },
      async (request, reply) => {
        const body = request.body;
        const door = await doorOf(request, body.table);
        const entries = [...new Set(body.sources)].map((source) => sourceGiving(door, source, 'fill'));
        if (entries.length > 0) refuseOffline();
        const record = await recordOf(request, door, body.record);
        const columns = leadColumns(door.companies);
        const text = (field: LeadField): string | undefined => {
          const column = columns[field];
          const value = column === undefined ? null : shownText(record[column]);
          return value === null || value === '' ? undefined : value;
        };
        const recordRef = `${door.companies.table.id}\u0000${body.record}`;
        const stop = stopOf(request, reply);
        const sources: z.infer<typeof lookupSource>[] = [];
        const found = new Map<string, CompanyFacts>();

        const number = body.number ?? text('number');
        const country = text('country');
        const town = body.town ?? text('town');
        const query: FillQuery = {
          ...(number === undefined ? { name: body.name ?? text('name') ?? '', ...(town === undefined ? {} : { town }) } : { number }),
          ...(country === undefined || !/^[A-Z]{2}$/.test(country) ? {} : { country }),
        };
        for (const entry of entries) {
          if (stop.signal.aborted) break;
          if (query.number === undefined && (query.name === undefined || query.name === '')) {
            sources.push({ source: entry.id, outcome: 'none', code: 'INVALID_REQUEST', message: 'This company has no number and no name to look up by.', matches: [] });
            continue;
          }
          const answer = await ask(request, door, entry.id, 'fillCompany', stop.signal, (made) => made.fillCompany?.(query));
          if (!answer.ok) {
            sources.push({ source: entry.id, outcome: answer.code === 'NOT_FOUND' ? 'none' : 'refused', code: answer.code, message: refusalWords(answer, door.install), matches: [] });
            continue;
          }
          const matches = answer.companies.map(plainCompany);
          if (matches.length === 1) {
            const facts = factsOf(matches[0]!);
            memory.rememberFacts(door.owner, recordRef, entry.id, facts);
            found.set(entry.id, facts);
          }
          sources.push({
            source: entry.id,
            outcome: matches.length === 0 ? 'none' : matches.length === 1 ? 'found' : 'several',
            code: null,
            message: null,
            // The picker's list: each as it may be shown, never with its officers while people are off.
            matches: matches.length > 1 ? matches.map((one) => viewOfFound(one, null, door.peopleOn)) : [],
          });
        }

        let website: z.infer<typeof lookupReply>['website'] = null;
        if (body.website && !stop.signal.aborted) {
          const reader = sourcesOf(installManifest(door.install)!).find((entry) => entry.reads === SOURCE_READS_WEBSITE);
          const on = reader !== undefined && sourceStateOf(await readSourcesState(meta, door.install.row.id), reader).on;
          const site = text('website');
          if (!on || reader === undefined) website = { outcome: 'off', host: null, message: `${displayName(door.install)} does not read websites here.` };
          else if (site === undefined) website = { outcome: 'no-website', host: null, message: 'This company has no website to read.' };
          else {
            let read;
            try {
              read = await readCompanyWebsite({ website: site, install: door.install.row.id, signal: stop.signal, confirmedHost: body.confirmedHost, country }, deps.reader);
            } catch (error) {
              // The person's Stop: nothing was read, nothing is written.
              if (stop.signal.aborted) read = null;
              else throw error;
            }
            if (read === null) website = null;
            else if (read.outcome === 'read') {
              const facts = pageFacts(read.page);
              memory.rememberFacts(door.owner, recordRef, reader.id, facts);
              found.set(reader.id, facts);
              website = { outcome: 'read', host: null, message: null };
            } else website = { outcome: read.outcome, host: read.outcome === 'asks' ? read.host : null, message: websiteWords(read) };
          }
        }

        const fields: z.infer<typeof lookupReply>['fields'] = [];
        for (const field of LEAD_FIELDS) {
          const column = columns[field];
          if (column === undefined) continue;
          const offered: { source: string; value: string }[] = [];
          for (const [source, facts] of found) {
            const write = writesFor(door.companies, facts, [field])[0];
            if (write !== undefined) offered.push({ source, value: write.value });
          }
          fields.push({ field, column, now: shownText(record[column]), found: offered });
        }
        return { table: door.companies.ref, record: body.record, sources, website, fields };
      },
    );

    // ── fill ──────────────────────────────────────────────────────────────────
    api.post(
      '/leads/:key/fill',
      { preHandler: [app.requireAuth, doorGuard], config: routeConfig, schema: { params: keyParams, body: fillBody, response: { 200: fillReply } } },
      async (request) => {
        const body = request.body;
        const door = await doorOf(request, body.table);
        const record = await recordOf(request, door, body.record);
        const recordRef = `${door.companies.table.id}\u0000${body.record}`;
        const columns = leadColumns(door.companies);
        const values: Record<string, unknown> = {};
        const seen: Record<string, string | null> = {};
        const filled: { field: LeadField; column: string; source: string }[] = [];
        for (const one of body.fields) {
          const column = columns[one.field];
          if (column === undefined) throw new ValidationFailedError(`This table keeps no ${one.field}.`, { reason: 'field', field: one.field });
          const facts = memory.facts(door.owner, recordRef, one.source);
          const write = facts === null ? undefined : writesFor(door.companies, facts, [one.field])[0];
          if (write === undefined) throw new ValidationFailedError(`Nothing from ${one.source} to fill ${column} with: look up again.`, { reason: 'look-up-again', field: one.field });
          // Changed since the sheet showed it: nobody's edit is written over.
          const now = shownText(record[column]);
          if (!sameShown(now, one.now === null ? null : one.now.trim())) {
            throw new AppError(409, 'FIELD_CHANGED', `${column} was changed after you looked. Look up again.`, { field: one.field, column });
          }
          values[column] = write.value;
          if (Object.keys(seen).length < 8) seen[column] = typeof record[column] === 'string' ? (record[column] as string) : (shownText(record[column]) ?? null);
          filled.push({ field: one.field, column, source: one.source });
        }
        let stored: Row;
        try {
          stored = await updateAsPerson(app, request, door.connectionId, door.companies.table.id, body.record, { values, seen }, { code: 'FILL_REFUSED', message: 'The fill was refused.' });
        } catch (error) {
          if (error instanceof AppError && error.code === 'ROW_CHANGED') throw new AppError(409, 'FIELD_CHANGED', 'A field was changed after you looked. Look up again.', error.details);
          throw error;
        }
        if (door.leads !== null) {
          const index = await tableRefIndex(meta, door.connectionId, door.view.model);
          await noteFieldSources(
            { manager: deps.manager, writes: deps.writes },
            { addOn: door.leads, view: door.view, tableRef: storedTableRef(index, door.companies.table.id), rowKey: body.record, columns: filled.map((one) => ({ column: one.column, source: one.source })), stored, at: now() },
          );
        }
        await app.rbac.audit(request, {
          category: 'leads',
          action: 'leads.filled',
          changes: { after: { key: door.install.row.manifestKey, table: door.companies.ref, record: body.record, fields: filled.map((one) => ({ column: one.column, source: one.source })) } },
        });
        return { table: door.companies.ref, record: body.record, filled };
      },
    );

    // ── people ────────────────────────────────────────────────────────────────

    /** Whether an address is on a declared people row of the database already (as the install reads them). */
    async function addressHere(door: Door, addresses: readonly string[]): Promise<Set<string>> {
      const out = new Set<string>();
      if (addresses.length === 0) return out;
      const { db } = await deps.manager.data(door.connectionId);
      for (const entry of await peopleTablesOf(meta).all(door.connectionId, door.view.model)) {
        if (entry.kind !== 'people' || entry.email === null) continue;
        let table;
        try {
          table = door.view.table(entry.table);
        } catch {
          continue;
        }
        if (!table.columns.has(entry.email)) continue;
        const rows = (await db
          .selectFrom(table.id as never)
          .select(sql<string>`lower(trim(${sql.ref(entry.email)}))`.as('address') as never)
          .where(sql`lower(trim(${sql.ref(entry.email)}))`, 'in', addresses as never)
          .execute()) as { address: string }[];
        for (const row of rows) out.add(row.address);
      }
      return out;
    }

    function peopleOnOrRefuse(door: Door): void {
      if (!door.peopleOn) throw new AppError(409, 'PEOPLE_OFF', `Keeping people is off, so ${door.name} fills in company details only.`, { reason: 'people-off' });
    }

    api.post(
      '/leads/:key/people',
      { preHandler: [app.requireAuth, doorGuard], config: routeConfig, schema: { params: keyParams, body: peopleBody, response: { 200: peopleReply } } },
      async (request, reply) => {
        const body = request.body;
        const door = await doorOf(request, body.table);
        peopleOnOrRefuse(door);
        sourceGiving(door, body.source, 'people');
        refuseOffline();
        const record = await recordOf(request, door, body.record);
        const columns = leadColumns(door.companies);
        const domain = domainKey(columns.website === undefined ? null : shownText(record[columns.website]));
        if (domain === '') throw new ValidationFailedError('This company has no website, so nobody can be looked for at it.', { reason: 'no-website' });
        const company = (columns.name === undefined ? null : shownText(record[columns.name])) ?? '';
        const stop = stopOf(request, reply);
        const answer = await ask(request, door, body.source, 'findPeople', stop.signal, (made) => made.findPeople?.({ domain, company }));
        if (!answer.ok) throw refusalError(answer, door.install, body.source);
        const people = answer.people.map(plainPerson);
        const recordRef = `${door.companies.table.id}\u0000${body.record}`;
        memory.rememberPeople(door.owner, recordRef, body.source, people);
        const here = await addressHere(door, people.map((one) => one.email));
        const listed: z.infer<typeof peopleReply>['people'] = [];
        let stopped = 0;
        for (const person of people) {
          if (await deps.stopped(person.email)) {
            stopped += 1;
            continue;
          }
          listed.push({ name: person.name, role: person.role ?? null, email: person.email, sources: person.sources, note: genericAddress(person.email) ? 'generic' : here.has(person.email) ? 'already-here' : null });
        }
        await app.rbac.audit(request, {
          category: 'leads',
          action: 'leads.search',
          changes: { after: { key: door.install.row.manifestKey, source: body.source, people: true, table: door.companies.ref, record: body.record, found: people.length } },
        });
        return { record: body.record, domain, people: listed, stopped };
      },
    );

    api.post(
      '/leads/:key/people/keep',
      { preHandler: [app.requireAuth, doorGuard], config: routeConfig, schema: { params: keyParams, body: keepBody, response: { 200: keepReply } } },
      async (request) => {
        const body = request.body;
        const door = await doorOf(request, body.table);
        peopleOnOrRefuse(door);
        sourceGiving(door, body.source, 'people');
        const record = await recordOf(request, door, body.record);
        const recordRef = `${door.companies.table.id}\u0000${body.record}`;
        const people: FoundPerson[] = [];
        const refused: { email: string; reason: string }[] = [];
        for (const email of body.emails) {
          const person = memory.person(door.owner, recordRef, body.source, email);
          if (person === null) refused.push({ email, reason: 'not-found' });
          else people.push(person);
        }
        const index = await tableRefIndex(meta, door.connectionId, door.view.model);
        const tableRef = storedTableRef(index, door.companies.table.id);
        if (people.length > 0) await recheckNoMarketing(request, door, record, tableRef, body.record);
        const kept = people.length === 0 ? { kept: [], refused: [] } : await deps.keep({ installId: door.install.row.id, addOnKey: door.install.row.manifestKey, staff: { id: door.staffId, label: door.staffLabel, request }, company: { table: tableRef, key: body.record }, source: body.source, people });
        return { kept: kept.kept, refused: [...refused, ...kept.refused] };
      },
    );

    /**
     * Before the first people are kept at a company a register added (the
     * first mail anyone there is sent: their tell mail), that register is
     * asked again whether the company objected to sales contact. A company
     * that did since, or a register that cannot answer now, keeps nobody.
     */
    async function recheckNoMarketing(request: FastifyRequest, door: Door, record: Row, tableRef: string, key: string): Promise<void> {
      const leads = door.leads;
      if (leads === null || leads.fieldSources === null || leads.foundPeople === null) return;
      const { db } = await deps.manager.data(door.connectionId);
      // Not the first: somebody here was kept before, after the same question.
      const before = (await db.selectFrom(leads.foundPeople.id as never).select(sql<number>`1`.as('one') as never).where(sql.ref('company_table'), '=', tableRef as never).where(sql.ref('company_key'), '=', key as never).limit(1).execute()) as unknown[];
      if (before.length > 0) return;
      const columns = leadColumns(door.companies);
      const numberColumn = columns.number;
      const number = numberColumn === undefined ? null : shownText(record[numberColumn]);
      if (numberColumn === undefined || number === null || number === '') return;
      const noted = (await db
        .selectFrom(leads.fieldSources.id as never)
        .select(sql<string>`${sql.ref('source')}`.as('source') as never)
        .where(sql.ref('table_ref'), '=', tableRef as never)
        .where(sql.ref('row_key'), '=', key as never)
        .where(sql.ref('column_name'), '=', numberColumn as never)
        .execute()) as { source: string }[];
      const manifest = installManifest(door.install);
      const register = noted.map((one) => sourcesOf(manifest!).find((entry) => entry.id === one.source)).find((entry): entry is LeadSourceEntry => entry !== undefined && isRegister(entry) && entry.gives.includes('fill'));
      if (register === undefined) return;
      refuseOffline();
      const country = columns.country === undefined ? null : shownText(record[columns.country]);
      const answer = await ask(request, door, register.id, 'fillCompany', new AbortController().signal, (made) => made.fillCompany?.({ number, ...(country === null || !/^[A-Z]{2}$/.test(country) ? {} : { country }) }));
      if (!answer.ok) {
        if (answer.code === 'NOT_FOUND') return;
        throw new AppError(409, 'RECHECK_FAILED', `${register.id} could not be asked again whether this business takes sales contact: try again.`, { source: register.id, code: answer.code });
      }
      if (answer.companies.some((one) => one.noMarketing)) throw new AppError(409, 'NO_SALES_CONTACT', ADD_REFUSALS['no-marketing'], { source: register.id });
    }

  };
}
