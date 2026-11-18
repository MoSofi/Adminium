// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TELL MAIL — what a found person is sent as soon as they are kept:
 * where their details came from, why they are kept, for how long, their
 * rights, and how to object. The add-on's outbox kind `tell` (service mail,
 * no purpose), sent by the ordinary sender (`outbox/sender.ts`), which asks
 * this module for three things:
 *
 *  - {@link TellMail.prepare}: for a message of that kind, the template it
 *    goes with. The add-on's own text in each language the person is told
 *    in (editable in Email templates, and sent even while switched off:
 *    the mail is locked on while people are kept), followed by the engine's
 *    fixed sentences and, set apart, the Object block
 *    (`tell-words.ts`): the add-on's text can neither remove nor replace
 *    them. A wording a person typed over the template is never sent
 *    instead. `{{object_link}}` is filled here, sealed (`object-token.ts`),
 *    never a column's value of that name. A message whose person is no
 *    longer kept, or that cannot carry its link (no public address), does
 *    not go and says why;
 *  - {@link TellMail.told}: the message went: the found person's `told_at`
 *    is now, their state `told`;
 *  - {@link TellMail.notTold}: it failed, or was skipped, or was refused
 *    for good after it went (a bounce): `told_at` empty, state `failed`,
 *    and the keeping sweep erases them at their "tell by" day unless
 *    another one goes first.
 * Every other kind, and every other outbox, is none of this module's:
 * `prepare` answers null for it.
 */
import { emailTemplatesRepo, paymentSettingsRepo, settingsRepo, type EmailTemplate, type MetaDb } from '@adminium/meta';
import type { Outbox } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import { resolveTableRef, tableRefIndex } from '../apps/table-ref.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import type { WriteTarget } from '../crud/write-service.js';
import { translatorForLocale } from '../email/builtins.js';
import { storedPublicOrigin } from '../email/door-reach.js';
import { pkOfRowKey } from '../payments/payables.js';
import { peopleTablesOf } from '../people/tables-of.js';
import { businessName, privacyNoticeOf, senderPostalAddress } from '../privacy/business.js';
import { PAY_PAGE_SETTINGS_DOC } from '../privacy/business.js';
import { z } from 'zod';
import { foundById, markNotTold, markTold, type FoundRow } from './found-store.js';
import { LEADS_TELL_KIND, leadsAddOnsOn, readLeadsSettings, storedLeadsAddOns, type LeadsAddOnTables } from './installs.js';
import { OBJECT_LINK_VARIABLE, makeObjectToken, objectLinkKeys, objectUrl } from './object-token.js';
import { companyCountryColumn } from './pending-p3.js';
import { installLanguage } from './people.js';
import { sourceName, tellBlocks, tellLanguages, tellOpening, type TellLanguage, type TellTranslate } from './tell-words.js';

/** Why a tell mail did not go: its outbox row's sentence. */
export const TELL_SKIPS = {
  gone: 'Not sent: the person it tells is no longer kept',
  noLanguage: 'Not sent: why found people are kept is not written in a language this person can be told in',
  noOrigin: 'Not sent: this server has no public address for the Object link (set it in Settings)',
  noText: 'Not sent: the add-on has no text for this mail',
} as const;

/** The outbox a message is in, as the sender has it. */
export interface TellBox {
  appKey: string;
  connectionId: string;
  definition: Pick<Outbox, 'table' | 'columns'>;
}

export interface TellPrepareInput {
  box: TellBox;
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  row: Row;
  /** Where the message goes. */
  to: string;
  zone: string;
  now: number;
}

/** A tell mail made ready: its template (the add-on's text and the engine's), its language and the values it prints. */
export interface TellPrepared {
  template: EmailTemplate;
  /** As templates keep it (`fr_FR`). */
  locale: string;
  vars: Record<string, string>;
}

export interface TellMail {
  /** Null: not a tell mail. */
  prepare(input: TellPrepareInput): Promise<TellPrepared | { skip: string } | null>;
  /** The message went. */
  told(input: { box: TellBox; target: Pick<WriteTarget, 'db' | 'dialect'>; view: SnapshotView; row: Row }, at: number): Promise<void>;
  /** The message did not go, or failed for good after it went. */
  notTold(input: { box: TellBox; target: Pick<WriteTarget, 'db' | 'dialect'>; view: SnapshotView; row: Row }): Promise<void>;
}

export interface TellMailDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`: the Object link's keys are kept under it. */
  secret: string;
}

const contactSchema = z.object({ contactEmail: z.string().nullable().optional() }).passthrough();

/** Whom a person writes to about their details: the DPO contact, else the pay page's contact address. */
export async function privacyContact(meta: MetaDb): Promise<string | null> {
  const dpo = await settingsRepo(meta).get('privacy.dpoContact');
  if (typeof dpo === 'string' && dpo.trim() !== '') return dpo.trim();
  const page = await paymentSettingsRepo(meta).get(PAY_PAGE_SETTINGS_DOC, contactSchema).catch(() => null);
  const email = page?.contactEmail;
  return typeof email === 'string' && email.trim() !== '' ? email.trim() : null;
}

/** The first word of a name, as a greeting reads it. */
function firstNameOf(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const first = name.trim().split(/\s+/u)[0] ?? '';
  return first === '' ? null : first;
}

export function createTellMail(deps: TellMailDeps): TellMail {
  const { meta } = deps;

  /** The add-on and its tell outbox, when the box is one; null for any other outbox. */
  async function leadsBoxOf(box: TellBox, view: SnapshotView): Promise<LeadsAddOnTables | null> {
    const stored = (await storedLeadsAddOns(meta)).filter((one) => one.key === box.appKey && one.connectionId === box.connectionId);
    if (stored.length === 0) return null;
    const addOn = (await leadsAddOnsOn(meta, box.connectionId, view, stored))[0];
    if (addOn === undefined || addOn.tell === null || addOn.foundPeople === null || addOn.tell.table.id !== view.table(box.definition.table).id) return null;
    return addOn;
  }

  /** The found person a message tells, and the add-on's tables. */
  async function aboutOf(box: TellBox, view: SnapshotView, db: Kysely<SourceDatabase>, row: Row): Promise<{ addOn: LeadsAddOnTables; found: FoundRow | null; foundId: string | null } | null> {
    if (row[box.definition.columns.kind] !== LEADS_TELL_KIND) return null;
    const addOn = await leadsBoxOf(box, view);
    if (addOn === null) return null;
    const value = row[addOn.tell!.link];
    const foundId = value === null || value === undefined ? null : String(value);
    return { addOn, foundId, found: foundId === null ? null : await foundById(db, addOn.foundPeople!, foundId) };
  }

  /** A row of a table a found person's row names (by its stored name), read as the install. */
  async function rowNamed(db: Kysely<SourceDatabase>, view: SnapshotView, connectionId: string, stored: string | null, key: string | null): Promise<{ table: ResolvedTable; row: Row } | null> {
    if (stored === null || key === null) return null;
    const index = await tableRefIndex(meta, connectionId, view.model);
    const tableId = resolveTableRef(index, stored)?.tableId ?? null;
    if (tableId === null) return null;
    const table = view.table(tableId);
    const pk = pkOfRowKey(table, key);
    const row = pk === null ? undefined : ((await fetchByPk(db, table, pk)) as Row | undefined);
    return row === undefined ? null : { table, row };
  }

  async function prepare(input: TellPrepareInput): Promise<TellPrepared | { skip: string } | null> {
    const { box, db, view } = input;
    const about = await aboutOf(box, view, db, input.row);
    if (about === null) return null;
    const { addOn, found } = about;
    if (found === null) return { skip: TELL_SKIPS.gone };
    const declared = await peopleTablesOf(meta).all(box.connectionId, view.model);

    // Who they are, and where they were found.
    const person = await rowNamed(db, view, box.connectionId, found.personTable, found.personKey);
    if (person === null) return { skip: TELL_SKIPS.gone };
    const personEntry = declared.find((one) => one.table === person.table.id);
    const firstName = firstNameOf(personEntry?.name === null || personEntry === undefined ? null : person.row[personEntry.name]);
    const company = await rowNamed(db, view, box.connectionId, found.companyTable, found.companyKey);
    const companyEntry = company === null ? undefined : declared.find((one) => one.table === company.table.id && one.kind === 'companies');
    const countryColumn = company === null || companyEntry === undefined ? null : await companyCountryColumn(meta, companyEntry, company.table);
    const country = countryColumn === null || company === null ? null : company.row[countryColumn];
    const companyName = company === null || companyEntry?.name === null || companyEntry === undefined ? null : company.row[companyEntry.name];

    // In which languages, why, and for how long.
    const settings = await readLeadsSettings(db, addOn);
    const purpose = { ...settings.purpose };
    let languages: TellLanguage[] = tellLanguages(typeof country === 'string' ? country : null, await installLanguage(meta), purpose);
    if (languages.length === 0) return { skip: TELL_SKIPS.noLanguage };

    // The Object link: sealed, for this person's row and this address.
    const origin = await storedPublicOrigin(meta);
    if (origin === null) return { skip: TELL_SKIPS.noOrigin };
    const install = await settingsRepo(meta).get('system.instanceId');
    const key = await objectLinkKeys(meta, deps.secret).write();
    const link = objectUrl(origin, makeObjectToken(key, typeof install === 'string' ? install : '', { address: input.to, installId: addOn.installId, found: found.id, language: languages[0]! }));

    const facts = {
      business: (await businessName(meta, { origin })) || new URL(origin).hostname,
      postal: await senderPostalAddress(meta),
      contact: await privacyContact(meta),
      source: sourceName(found.source, (addOn.manifest.addOn as { sources?: { id: string; hosts?: string[] }[] }).sources?.find((one) => one.id === found.source)?.hosts ?? []),
      foundAt: found.foundAt,
      zone: input.zone,
      keepYears: settings.keepYears,
      noticeUrl: (await privacyNoticeOf(meta)).noticeUrl,
      firstName,
    };

    // The add-on's text in each language, each followed by the engine's sentences and the Object block.
    const templateKey = (box.definition as Outbox).kinds?.[LEADS_TELL_KIND];
    const rows = templateKey === undefined ? [] : (await emailTemplatesRepo(meta).siblings(templateKey)).filter((one) => one.archivedAt === null);
    const base = rows.find((one) => one.locale === languages[0]!.replace('-', '_')) ?? rows.find((one) => one.locale === 'en_US') ?? rows[0];
    if (base === undefined) return { skip: TELL_SKIPS.noText };
    const blocks: Record<string, unknown>[] = [];
    const vars: Record<string, string> = {};
    const subjects: string[] = [];
    languages = languages.slice(0, 2);
    for (const [n, language] of languages.entries()) {
      const locale = language.replace('-', '_');
      const i18n = await translatorForLocale(meta, locale);
      const t: TellTranslate = (k, options) => i18n.t(k, options);
      const own = rows.find((one) => one.locale === locale);
      if (n > 0) blocks.push({ block: 'email.divider', id: `tell_${String(n)}_between`, data: { height: 16 } });
      if (own !== undefined) {
        // The add-on's text as written, its own blocks given ids of their own so the two languages never share one.
        blocks.push(...own.blocks.map((block, b) => ({ ...block, id: `tell_${String(n)}_own_${String(b)}` })));
        subjects.push(own.subject);
      } else {
        const opening = tellOpening(t, n, firstName);
        blocks.push(...opening.blocks);
        Object.assign(vars, opening.vars);
        subjects.push(t('email:leadsTell.subject', { defaultValue: 'Why we have your details' }));
      }
      const engine = tellBlocks(t, language, n, { ...facts, purpose: purpose[language] ?? found.purpose });
      blocks.push(...engine.blocks);
      Object.assign(vars, engine.vars);
    }
    // What the add-on's text may print about the person, filled here.
    vars['name'] = typeof person.row[personEntry?.name ?? ''] === 'string' ? String(person.row[personEntry!.name!]) : '';
    vars['first_name'] = firstName ?? '';
    vars['company'] = typeof companyName === 'string' ? companyName : '';
    vars['source'] = facts.source;
    vars['business'] = facts.business;
    vars[OBJECT_LINK_VARIABLE] = link;
    const subject = [...new Set(subjects.filter((one) => one.trim() !== ''))].join(' / ');
    return {
      template: { ...base, locale: languages[0]!.replace('-', '_'), subject: subject === '' ? base.subject : subject, blocks, preheader: '', enabled: true },
      locale: languages[0]!.replace('-', '_'),
      vars,
    };
  }

  async function told(input: { box: TellBox; target: Pick<WriteTarget, 'db' | 'dialect'>; view: SnapshotView; row: Row }, at: number): Promise<void> {
    const about = await aboutOf(input.box, input.view, input.target.db, input.row);
    if (about === null || about.foundId === null) return;
    await markTold({ ...input.target, table: about.addOn.foundPeople! }, about.foundId, at);
  }

  async function notTold(input: { box: TellBox; target: Pick<WriteTarget, 'db' | 'dialect'>; view: SnapshotView; row: Row }): Promise<void> {
    const about = await aboutOf(input.box, input.view, input.target.db, input.row);
    if (about === null || about.foundId === null) return;
    await markNotTold({ ...input.target, table: about.addOn.foundPeople! }, about.foundId);
  }

  return { prepare, told, notTold };
}
