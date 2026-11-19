// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a landing pages add-on's own screens ask the engine, for staff: Milo's
 * draft and the staff reads (the pages' pictures and status are `index.ts`).
 *
 *   POST /landing/:addOn/draft                "Draft it with Milo": a page's draft
 *                                             document (`landing/draft.ts`)
 *   GET  /landing/:addOn/forms                the live forms a Form block may name
 *   GET  /landing/:addOn/funnels/:key/rule    a funnel's rule: its name and its
 *                                             steps as chips ("What happens after")
 *   GET  /landing/live-pages                  the live pages of every landing pages
 *                                             add-on, for the forms builder's
 *                                             "Go to a landing page" ending
 *
 * `:addOn` is the pages add-on's key; the install is the one the request names
 * (`landing/install-of.ts`: the `X-Adminium-Install` header the add-on's page
 * client sends, else `?connectionId=`), else the key's only one, as the
 * add-on's kit finds it.
 *
 * - **The draft** is for someone who may use Milo (`system:assistant:use`) AND
 *   change the add-on's pages; it spends their own allowance, sends no row and
 *   no tool, and answers a draft document with every block marked. It never
 *   publishes: the add-on writes it into the page's `draft`, and the publish
 *   seal refuses a marked page (`landing/seal.ts`). Audited `landing.draft`
 *   (`llm`): the outcome, the model and the tokens, never the description.
 * - **The live forms** are read across every forms add-on (the add-on's kit
 *   names only its own tables), by someone who may read the add-on's pages:
 *   only forms they may read themselves, only live ones, with their languages
 *   and their ending (a `landing` ending says whether its page is live).
 * - **The live pages** are read across every landing pages add-on, by someone
 *   who may read that add-on's pages (an add-on whose pages they may not read
 *   is left out): each live page by its add-on, key, name, address and
 *   language, never its content.
 * - **A funnel's rule** is read by the funnel's readers, who may hold no
 *   system permission: the rule's name and chips only (`landing/rule.ts`),
 *   and `canOpen` for a person who may manage rules. A rule that is gone says
 *   `removed`; a funnel with none says `none`.
 */
import { FORM_LANGUAGES, type FormEnding } from '@adminium/add-on-contracts/forms';
import { automationsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited, auditExempt } from '../../audit/coverage.js';
import type { AddOnInstalls } from '../../apps/table-ref.js';
import type { ChatAnswererDeps } from '../../chat/answerer.js';
import type { DataHandle } from '../../connections/manager.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../errors.js';
import type { FormsCatalog } from '../../forms/catalog.js';
import { strangerBusiness } from '../../forms/view.js';
import { requestReadsWhole } from '../../crud/row-reach-request.js';
import { draftLandingPage, LANDING_DESCRIPTION_MAX, type DraftForm } from '../../landing/draft.js';
import { livePageSlug, type LandingEndings } from '../../landing/ending.js';
import { landingInstallOf } from '../../landing/install-of.js';
import { landingAddOnOn, landingAddOns, type LandingAddOn } from '../../landing/installed.js';
import { ruleChips } from '../../landing/rule.js';
import { PERMISSIONS } from '../../rbac/permissions.js';

export interface LandingDraftAndReadsDeps {
  meta: MetaDb;
  installs: () => Promise<AddOnInstalls>;
  data: (connectionId: string) => Promise<Pick<DataHandle, 'db'>>;
  catalog: Pick<FormsCatalog, 'liveForms'>;
  endings: Pick<LandingEndings, 'target'>;
  /** The AI service a draft is written with, and where this server switches it off. */
  ai: Pick<ChatAnswererDeps, 'connections' | 'offHere'>;
  now?: () => number;
}

const tags = ['landing'];
const params = z.object({ addOn: z.string().min(1).max(80) });
/** A row's key, as a funnel or a page is named: letters, digits, `_` and `-`. */
const rowKey = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const funnelParams = params.extend({ key: rowKey });
const query = z.object({ connectionId: z.string().max(64).optional() });

export const landingDraftBody = z
  .object({
    /** What the page is for, in the person's words: data the model reads, never kept. */
    description: z.string().trim().min(1).max(LANDING_DESCRIPTION_MAX),
    /** The page's one language (a BCP 47 tag). */
    language: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/).max(10),
    /** The page being drafted, when it is saved already: never linked to from itself. */
    pageKey: rowKey.optional(),
  })
  .strict();

const leftOut = z.discriminatedUnion('what', [
  z.object({ what: z.literal('quote'), block: z.string() }),
  z.object({ what: z.literal('picture'), block: z.string() }),
  z.object({ what: z.literal('link'), block: z.string(), label: z.string() }),
  z.object({ what: z.literal('form'), block: z.string() }),
  z.object({ what: z.literal('page-link'), block: z.string(), label: z.string() }),
]);

export const landingDraftReply = z.object({
  data: z.object({
    /** The page's draft document: every block carries `milo: true`. Never a state or a published copy. */
    page: z.record(z.string(), z.unknown()),
    /** What Milo wrote that was left out, for the person to put back by hand. */
    left: z.array(leftOut),
    tokens: z.number(),
  }),
});

/** A form's ending as a staff screen shows it. */
const staffEnding = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('words'), words: z.record(z.string(), z.string()) }),
  z.object({ kind: z.literal('page'), url: z.string() }),
  /** One of the business's landing pages; `broken` while it is not live (strangers then see the default thanks). */
  z.object({ kind: z.literal('landing'), addOn: z.string(), page: z.string(), broken: z.boolean() }),
]);

export const landingFormsReply = z.object({
  data: z.object({
    forms: z.array(
      z.object({
        /** The forms add-on that holds it, and its row key: what a Form block names. */
        addOn: z.string(),
        /** The forms add-on's install (`adminium_manifests.id`): what the views read takes. */
        installId: z.string(),
        key: z.string(),
        name: z.string(),
        slug: z.string(),
        /** The languages it is written in, in the product's order. */
        languages: z.array(z.string()),
        ending: staffEnding,
      }),
    ),
  }),
});

export const landingLivePagesReply = z.object({
  data: z.object({
    pages: z.array(
      z.object({
        /** The landing pages add-on that holds it, its install, and the page's row key: what a form's `landing` ending names. */
        addOn: z.string(),
        installId: z.string(),
        key: z.string(),
        /** Staff's own name for the page. */
        name: z.string(),
        slug: z.string(),
        language: z.string(),
      }),
    ),
  }),
});

const ruleChip = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trigger'), title: z.string(), on: z.enum(['record', 'schedule']), event: z.enum(['created', 'updated', 'deleted']).optional() }),
  z.object({ kind: z.literal('action'), title: z.string(), action: z.string() }),
  z.object({ kind: z.literal('condition'), title: z.string() }),
  z.object({ kind: z.literal('wait'), title: z.string(), amount: z.number(), unit: z.string() }),
  z.object({ kind: z.literal('branch'), title: z.string() }),
  z.object({ kind: z.literal('stop'), title: z.string() }),
]);

export const landingRuleReply = z.object({
  data: z.discriminatedUnion('state', [
    /** The funnel names no rule. */
    z.object({ state: z.literal('none') }),
    /** The rule it names is gone. */
    z.object({ state: z.literal('removed') }),
    z.object({
      state: z.literal('linked'),
      name: z.string(),
      enabled: z.boolean(),
      chips: z.array(ruleChip),
      /** Whether this person may open the rule itself (they manage rules). */
      canOpen: z.boolean(),
      /** The rule's id, to open it by: only for someone who may. */
      ruleId: z.string().optional(),
    }),
  ]),
});

export function landingDraftAndReadsRoutes(deps: LandingDraftAndReadsDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const now = deps.now ?? Date.now;

  /** The pages add-on the request names, installed and with its tables; 404 for anything else. */
  async function landingOf(request: FastifyRequest, key: string): Promise<LandingAddOn & { pages: string; pagesKey: string }> {
    const found = await landingInstallOf(meta, request, key);
    const connectionId = found?.row.connectionId ?? null;
    const landing = found === null || connectionId === null ? null : landingAddOnOn(await deps.installs(), connectionId, key);
    if (landing === null || landing.pages === null || landing.pagesKey === null) throw new NotFoundError('This add-on has no landing pages here.', { addOn: key });
    return { ...landing, pages: landing.pages, pagesKey: landing.pagesKey };
  }

  const grant = (request: FastifyRequest, connectionId: string, tableId: string, action: 'read' | 'update') => request.can(`table:${connectionId}:${tableId}:${action}`);
  /**
   * Whether the person may read every row of a table: these reads list a
   * table's rows (or say whether one is there) as the system, so a person
   * held to some rows of it is told of none (`rbac/row-coverage-table.ts`).
   */
  const readsAll = async (request: FastifyRequest, connectionId: string, tableId: string): Promise<boolean> =>
    (await grant(request, connectionId, tableId, 'read')) && (await requestReadsWhole(meta, request, connectionId, tableId));

  /** The live forms this person may read, with their endings as a staff screen shows them. */
  async function formsFor(request: FastifyRequest): Promise<z.infer<typeof landingFormsReply>['data']['forms']> {
    const out: z.infer<typeof landingFormsReply>['data']['forms'] = [];
    for (const live of await deps.catalog.liveForms()) {
      if (!(await readsAll(request, live.connectionId, live.formsTable))) continue;
      const { definition } = live.form;
      const listed = new Set<string>(definition.languages);
      out.push({ addOn: live.addOn, installId: live.installId, key: live.id, name: live.name, slug: live.slug, languages: FORM_LANGUAGES.filter((one) => listed.has(one)), ending: await endingOf(definition.ending, live.connectionId) });
    }
    return out;
  }

  async function endingOf(ending: FormEnding, near: string): Promise<z.infer<typeof staffEnding>> {
    if (ending.kind !== 'landing') return ending.kind === 'words' ? { kind: 'words', words: { ...ending.words } as Record<string, string> } : ending;
    return { ...ending, broken: (await deps.endings.target(ending, near)).state !== 'live' };
  }

  return async (app) => {
    app.post(
      '/landing/:addOn/draft',
      {
        preHandler: [app.requireAuth],
        config: { audit: audited('rbac') },
        schema: {
          tags,
          summary: 'Draft a landing page with Milo',
          description:
            'One call to the AI service (and one more when the first answer is not a page), on the person\'s own daily Milo allowance, with the description, the page\'s language, the business\'s name and contact address and the live forms the person may read: no rows, no tools. It answers a draft document with every block marked, quotes, pictures and links to other websites left out; it never publishes. For someone who may use Milo and change the add-on\'s pages.',
          params,
          querystring: query,
          body: landingDraftBody,
          response: { 200: landingDraftReply },
        },
      },
      async (request) => {
        // A person, on their own allowance: never an API key.
        const user = request.user;
        if (user === null || user === undefined || !(await request.can(PERMISSIONS.assistantUse))) throw new ForbiddenError('Only someone who may use Milo drafts with it.', 'FORBIDDEN', { reason: 'assistant-use' });
        const landing = await landingOf(request, request.params.addOn);
        if (!(await grant(request, landing.connectionId, landing.pages, 'update'))) {
          throw new ForbiddenError('Only someone who may change these pages drafts one.', 'TABLE_FORBIDDEN', { reason: 'landing-pages-update' });
        }
        const { business } = await strangerBusiness(meta);
        const forms: DraftForm[] = (await formsFor(request)).map((form) => ({ addOn: form.addOn, key: form.key, name: form.name, languages: form.languages }));
        const { db } = await deps.data(landing.connectionId);
        const drafted = await draftLandingPage({
          meta,
          ai: deps.ai,
          userId: user.id,
          description: request.body.description,
          language: request.body.language,
          business: { name: business.name, email: business.email },
          forms,
          self: request.body.pageKey ?? null,
          // Which pages a link names the add-on holds: the keys alone are read, never a page's content.
          pagesHeld: async (keys) => {
            if (keys.length === 0 || !(await readsAll(request, landing.connectionId, landing.pages))) return new Set();
            try {
              const rows = (await db.selectFrom(landing.pages).select(db.dynamic.ref(landing.pagesKey) as never).where(db.dynamic.ref(landing.pagesKey), 'in', [...keys]).execute()) as Record<string, unknown>[];
              const held = new Set(rows.map((row) => String(row[landing.pagesKey])));
              return new Set(keys.filter((key) => held.has(key)));
            } catch {
              return new Set();
            }
          },
          at: now(),
          warn: (fields, message) => request.log.warn(fields, message),
        });
        const audit = (outcome: string) =>
          app.rbac.audit(request, { category: 'llm', action: 'landing.draft', connectionId: landing.connectionId, changes: { after: { addOn: landing.key, outcome, model: drafted.model, tokens: drafted.tokens } } });
        if (!drafted.ok) {
          // A refusal before any call costs nothing and is not a model's outcome: only a call made is audited.
          if (drafted.tokens > 0 || drafted.refused === 'failed' || drafted.refused === 'draft-failed') await audit(drafted.refused);
          if (drafted.refused === 'allowance') throw new AppError(429, 'RATE_LIMITED', 'Your Milo allowance for today is used.', { reason: 'allowance', resetsAt: new Date(drafted.resetsAt).toISOString() });
          if (drafted.refused === 'draft-failed') throw new AppError(502, 'LANDING_DRAFT_FAILED', 'Milo could not write a page from that. Try again, or describe the page in other words.', { reason: 'draft-failed' });
          if (drafted.refused === 'failed') throw new AppError(502, 'LANDING_DRAFT_FAILED', 'Milo could not write a draft. Try again.', { reason: 'failed' });
          throw new ConflictError('No AI service can be used here.', 'CONFLICT', { reason: drafted.refused });
        }
        await audit('drafted');
        return { data: { page: drafted.page as unknown as Record<string, unknown>, left: drafted.left, tokens: drafted.tokens } };
      },
    );

    app.get(
      '/landing/:addOn/forms',
      {
        preHandler: [app.requireAuth],
        config: { audit: auditExempt('read-only list of live forms') },
        schema: {
          tags,
          summary: 'The live forms a landing page may show',
          description:
            'Every live form of every forms add-on that the person may read, with its languages and its ending (a landing page ending says whether its page is live). For someone who may read the add-on\'s pages.',
          params,
          querystring: query,
          response: { 200: landingFormsReply },
        },
      },
      async (request) => {
        const landing = await landingOf(request, request.params.addOn);
        if (!(await grant(request, landing.connectionId, landing.pages, 'read'))) {
          throw new ForbiddenError('Only someone who may read these pages reads this.', 'TABLE_FORBIDDEN', { reason: 'landing-pages-read' });
        }
        return { data: { forms: await formsFor(request) } };
      },
    );

    app.get(
      '/landing/live-pages',
      {
        preHandler: [app.requireAuth],
        config: { audit: auditExempt('read-only list of live landing pages') },
        schema: {
          tags,
          summary: 'The live landing pages a form may end on',
          description:
            'Every live page of every landing pages add-on whose pages the person may read: its add-on, install, key, name, address and language, never its content. For the forms builder\'s "Go to a landing page" ending.',
          response: { 200: landingLivePagesReply },
        },
      },
      async (request) => {
        const out: z.infer<typeof landingLivePagesReply>['data']['pages'] = [];
        for (const landing of await landingAddOns(meta, await deps.installs())) {
          const { pages, pagesKey } = landing;
          if (!landing.on || pages === null || pagesKey === null || !(await readsAll(request, landing.connectionId, pages))) continue;
          let rows: Record<string, unknown>[];
          try {
            const { db } = await deps.data(landing.connectionId);
            rows = (await db
              .selectFrom(pages)
              .select([db.dynamic.ref(pagesKey), db.dynamic.ref('name'), db.dynamic.ref('slug'), db.dynamic.ref('state'), db.dynamic.ref('language'), db.dynamic.ref('published')] as never)
              .where(db.dynamic.ref('state'), '=', 'live')
              .execute()) as Record<string, unknown>[];
          } catch {
            continue;
          }
          for (const row of rows) {
            const slug = livePageSlug(row);
            if (slug === null) continue;
            out.push({ addOn: landing.key, installId: landing.installId, key: String(row[pagesKey]), name: typeof row['name'] === 'string' ? row['name'] : slug, slug, language: typeof row['language'] === 'string' ? row['language'] : '' });
          }
        }
        out.sort((a, b) => a.addOn.localeCompare(b.addOn) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
        return { data: { pages: out } };
      },
    );

    app.get(
      '/landing/:addOn/funnels/:key/rule',
      {
        preHandler: [app.requireAuth],
        config: { audit: auditExempt('read-only: a rule\'s name and steps') },
        schema: {
          tags,
          summary: 'What happens after a funnel',
          description:
            'The rule a funnel names: its name, whether it is on, and its steps as chips (the trigger and each step by its kind and title), never the rule itself; whether the person may open it. For someone who may read the add-on\'s funnels.',
          params: funnelParams,
          querystring: query,
          response: { 200: landingRuleReply },
        },
      },
      async (request) => {
        const landing = await landingOf(request, request.params.addOn);
        if (landing.funnels === null || landing.funnelsKey === null) throw new NotFoundError('This add-on has no funnels here.', { addOn: landing.key });
        const funnels = landing.funnels;
        const funnelsKey = landing.funnelsKey;
        if (!(await grant(request, landing.connectionId, funnels, 'read'))) {
          throw new ForbiddenError('Only someone who may read these funnels reads this.', 'TABLE_FORBIDDEN', { reason: 'landing-funnels-read' });
        }
        // The funnel's row is read as the system: a person held to some funnels reads no funnel's rule here.
        if (!(await requestReadsWhole(meta, request, landing.connectionId, funnels))) {
          throw new ForbiddenError('Only someone who may read every funnel reads this.', 'TABLE_FORBIDDEN', { reason: 'landing-funnels-rows' });
        }
        const { db } = await deps.data(landing.connectionId);
        let row: Record<string, unknown> | undefined;
        try {
          row = (await db.selectFrom(funnels).select([db.dynamic.ref(funnelsKey), db.dynamic.ref('rule_id')] as never).where(db.dynamic.ref(funnelsKey), '=', request.params.key).executeTakeFirst()) as Record<string, unknown> | undefined;
        } catch {
          row = undefined;
        }
        // The row the key names, and no other: a database that reads `12abc` as 12 is not taken at its word.
        if (row === undefined || String(row[funnelsKey]) !== request.params.key) throw new NotFoundError('No such funnel.', { addOn: landing.key });
        const ruleId = typeof row['rule_id'] === 'string' ? row['rule_id'].trim() : '';
        if (ruleId === '') return { data: { state: 'none' as const } };
        const rule = await automationsRepo(meta)
          .findById(ruleId)
          .catch(() => null);
        if (rule === null) return { data: { state: 'removed' as const } };
        const canOpen = await request.can(PERMISSIONS.automationsManage);
        return { data: { state: 'linked' as const, name: rule.name, enabled: rule.enabled, chips: ruleChips(rule), canOpen, ...(canOpen ? { ruleId: rule.id } : {}) } };
      },
    );
  };
}

