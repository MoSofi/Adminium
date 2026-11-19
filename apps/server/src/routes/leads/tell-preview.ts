// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TELL MAIL AS IT WOULD GO: `GET /leads/:key/tell-preview?locale=`.
 *
 * The add-on's People card shows the mail a found person is sent the moment
 * they are kept. This route draws it as the sender would (`leads/tell.ts`):
 * the add-on's own opening from its template, then the engine's fixed
 * sentences and, set apart, the Object block; with this install's real
 * business name, postal address and privacy contact, its purpose and keeping
 * time, and a made-up person at a made-up company found today.
 *
 * It never sends anything, and never seals a token: the Object link it
 * carries points at the Object page with a word that opens nothing
 * ({@link PREVIEW_OBJECT_TOKEN}), so a preview copied into a mail could not
 * erase anybody.
 *
 * WHO: as the lead door (`index.ts`): a signed-in person who may open one
 * of the add-on's pages or keep its settings; never an API key.
 */
import type { MetaDb } from '@adminium/meta';
import { dirForLocale, isLocaleId } from '@adminium/i18n';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ConnectionManager } from '../../connections/manager.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { storedPublicOrigin } from '../../email/door-reach.js';
import { renderEmail } from '../../email/render.js';
import { prepareEmail } from '../../email/send.js';
import { NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { rememberedInstall } from '../../installs/resolve.js';
import { installManifest } from '../../lead-sources/call.js';
import { sourcesOf } from '../../lead-sources/state.js';
import { zoneOf } from '../../leads/found-store.js';
import { LEADS_TELL_KIND, readLeadsSettings } from '../../leads/installs.js';
import { objectUrl } from '../../leads/object-token.js';
import { leadsInstall } from '../../leads/people.js';
import { privacyContact, tellTemplate } from '../../leads/tell.js';
import { sourceName, tellLanguageOf, type TellLanguage } from '../../leads/tell-words.js';
import { businessName, privacyNoticeOf, senderPostalAddress } from '../../privacy/business.js';
import { linkOrigin } from '../../security/public-origin.js';

export interface TellPreviewDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  /** The database's schema as the install reads it. */
  viewOf: (connectionId: string) => Promise<SnapshotView>;
  /** The lead door's guard: it resolves and remembers the install. */
  guard: (request: FastifyRequest) => Promise<void>;
  now?: () => number;
}

/**
 * What the preview's Object link carries in place of a sealed token: the
 * Object page opens no token it did not seal, so this one is a dead link.
 */
export const PREVIEW_OBJECT_TOKEN = 'preview';

/** The made-up person and company the preview is about (never a real one). */
export const TELL_PREVIEW_SAMPLE = { name: 'Robin Hale', firstName: 'Robin', company: 'Kestrel Yard Architects' } as const;

const previewParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) });
const previewQuery = z
  .object({
    /** The language to show it in (BCP 47, `fr-FR`); absent, the reader's own. */
    locale: z.string().min(2).max(35).optional(),
  })
  .strict();
const previewReply = z.object({
  /** The language it is shown in: the one asked when the purpose is written in it, else English when it is. */
  locale: z.string(),
  /** Whether why people are kept is written in that language; false: the sentence shows "…" in its place. */
  purposeWritten: z.boolean(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  /** The Object link it carries: one that opens nothing. */
  objectLink: z.string(),
  /** The made-up person it is shown for. */
  sample: z.object({ name: z.string(), company: z.string() }),
});
export type TellPreviewReply = z.infer<typeof previewReply>;

/** Registers the preview route on the lead door's plugin (`/api/v1/leads/:key/tell-preview`). */
export function tellPreviewRoute(app: FastifyInstance, deps: TellPreviewDeps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { meta } = deps;
  const now = deps.now ?? Date.now;

  api.get(
    '/leads/:key/tell-preview',
    {
      preHandler: [app.requireAuth, deps.guard],
      // A draw of a mail that is never sent: it writes nothing, reads no person.
      config: { audience: 'staff' as const, rateLimitBucket: 'lead-door' as const },
      schema: { params: previewParams, querystring: previewQuery, response: { 200: previewReply } },
    },
    async (request) => {
      const install = rememberedInstall(request);
      if (install === undefined) throw new NotFoundError('That add-on is not installed.');
      const user = (request as unknown as { user?: { id?: string } }).user;
      if (user?.id === undefined) throw new UnauthorizedError();
      const connectionId = install.row.connectionId;
      if (connectionId === null) throw new ValidationFailedError('This add-on is not attached to an app’s database.', { reason: 'no-database' });
      const view = await deps.viewOf(connectionId);
      const found = await leadsInstall({ meta, manager: deps.manager, viewFor: async () => view }, install.row.id);
      if (found === null || found.addOn.foundPeople === null || found.addOn.settings === null) throw new ValidationFailedError('The add-on’s tables for the people it finds are not here.', { reason: 'tables' });
      const { addOn } = found;
      if (addOn.tell === null) throw new ValidationFailedError('The add-on has no mail that tells a person where their details came from.', { reason: 'tell-outbox' });

      const { db } = await deps.manager.data(connectionId);
      const settings = await readLeadsSettings(db, addOn);
      const asked: TellLanguage = tellLanguageOf(request.query.locale ?? (await recipientLocale(meta, user.id))) ?? 'en-US';
      const written = (language: TellLanguage) => (settings.purpose[language] ?? '').trim() !== '';
      // As the People card shows it: in the language asked when the purpose is written in it, else in English.
      const language: TellLanguage = written(asked) || !written('en-US') ? asked : 'en-US';

      // The link a preview carries: the Object page, with a word that opens nothing. Never a sealed token.
      const origin = (await storedPublicOrigin(meta)) ?? (await linkOrigin(meta, request));
      const link = objectUrl(origin, PREVIEW_OBJECT_TOKEN);
      // The source that finds people, as the mail names it; else the first source.
      const manifest = installManifest(install);
      const sources = manifest === null ? [] : sourcesOf(manifest);
      const source = sources.find((one) => one.gives.includes('people')) ?? sources[0];
      const facts = {
        business: (await businessName(meta, { origin })) || new URL(origin).hostname,
        postal: await senderPostalAddress(meta),
        contact: await privacyContact(meta),
        source: source === undefined ? '' : sourceName(source.id, source.hosts ?? []),
        foundAt: now(),
        addressByStaff: false,
        zone: await zoneOf(meta, connectionId),
        keepYears: settings.keepYears,
        noticeUrl: (await privacyNoticeOf(meta)).noticeUrl,
        firstName: TELL_PREVIEW_SAMPLE.firstName,
      };
      const made = await tellTemplate(meta, {
        templateKey: addOn.tell.definition.kinds[LEADS_TELL_KIND],
        languages: [language],
        facts,
        purpose: settings.purpose,
        fallbackPurpose: '…',
        name: TELL_PREVIEW_SAMPLE.name,
        company: TELL_PREVIEW_SAMPLE.company,
        link,
      });
      if ('skip' in made) throw new ValidationFailedError('The add-on has no text for this mail.', { reason: 'no-text' });

      // Drawn as the sender draws it: the business's banner, its sender, the mail's language.
      const prepared = await prepareEmail(meta, made.template, { brandName: facts.business, about: { connectionId, templateKey: made.template.key } });
      const rendered = renderEmail({
        ...prepared.render,
        locale: made.locale,
        vars: { appName: facts.business, ...made.vars },
        dir: isLocaleId(made.locale) ? dirForLocale(made.locale) : 'ltr',
      });
      return {
        locale: language,
        purposeWritten: written(language),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        objectLink: link,
        sample: { name: TELL_PREVIEW_SAMPLE.name, company: TELL_PREVIEW_SAMPLE.company },
      };
    },
  );
}
