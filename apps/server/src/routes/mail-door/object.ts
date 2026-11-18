// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE OBJECT PAGE — where a person a source found says "don't keep my
 * details", from the link in the mail that told them (`leads/tell.ts`).
 * Beside the unsubscribe page in the mail door, and kept by its rules
 * (`index.ts`): always registered; open only while the outside can reach
 * this server; no script; nothing cached; no session read.
 *
 *   GET  /m/o/<token>   the address and one "Object" button: never acts on its own
 *   POST /m/o/<token>   the button (`act=object`): acts
 *
 * ─── What "Object" does (Art. 21) ──────────────────────────────────────────
 *  1. the address goes on the do-not-email list (reason `lead-finder`): it
 *     is never mailed again, and a source that finds it again is refused
 *     before anything is stored (`leads/people.ts`);
 *  2. the person is erased through the one erasure of a person's data
 *     (`privacy/erase.ts`): their rows emptied in place, their found
 *     person's rows, tell mails and fields' sources deleted, only the day
 *     they were told on kept in the audit entry;
 *  3. their people row itself is deleted when no other row links to it;
 *     when some do (a deal, a quote), it stays emptied, and the page says
 *     what stays: those records are the business's, with their details
 *     taken out.
 * Then: "Done. We have deleted your details and won't write to you again."
 *
 * The other answers: "You've already objected" (nothing left of them, the
 * address stopped); "This link doesn't work" (not this install's, changed
 * by one byte, or nothing is known of it any more); "This page isn't
 * available" (the door is shut, or the address keys cannot be read). Eight
 * languages: the mail's, else the one picked on the page, else the
 * browser's, else the install's.
 */
import { auditRepo, settingsRepo } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { resolveTableRef, tableRefIndex } from '../../apps/table-ref.js';
import { AddressKeysLockedError, looksLikeAddress, type ConsentService } from '../../consent/index.js';
import type { ConnectionManager } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { fetchByPk } from '../../crud/records.js';
import type { UnsubscribeClaim } from '../../email/unsubscribe-token.js';
import { foundById, type FoundRow } from '../../leads/found-store.js';
import { OBJECT_PATH, readObjectLink, type ObjectClaim } from '../../leads/object-token.js';
import { leadsInstall } from '../../leads/people.js';
import { privacyContact } from '../../leads/tell.js';
import { MAIL_DOOR_PREFIX } from '../../plugins/surfaces.js';
import { pkOfRowKey } from '../../payments/payables.js';
import { peopleTablesOf } from '../../people/tables-of.js';
import type { EraseResult } from '../../privacy/erase.js';
import { normaliseAddress } from '../../public-api/claim-code.js';
import { tagRoutes } from '../../security/route-audience.js';
import { createMailDoor, type MailDoorDeps } from './door.js';
import { escapeHtml, renderMailDoorPage, statusCard, type MailDoorBusiness, type MailDoorView, type Translate } from './page.js';

/** The largest form body taken: one short field. */
const FORM_BODY_LIMIT = 1024;
const tokenParams = z.object({ '*': z.string().max(4096) });
const tokenOf = (params: { '*': string }): string => (params['*'].includes('/') ? '' : params['*']);

export interface ObjectDoorDeps extends MailDoorDeps {
  manager: Pick<ConnectionManager, 'data'>;
  consent: ConsentService;
  /** The one erasure of a person's data, by address (`privacy/erase.ts`). */
  erase: (address: string) => Promise<EraseResult>;
}

/** Who a found person is now: their found person's row, their people row and the tables that link to it. */
interface Objector {
  found: FoundRow;
  view: SnapshotView;
  connectionId: string;
  person: { table: ResolvedTable; row: Row; address: string | null } | null;
}

/** What stays once they objected: the business's own records that named them, by their table's label. */
type Stays = { label: string; count: number }[];

export function objectDoorRoutes(deps: ObjectDoorDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const door = createMailDoor(deps);
  const now = deps.now ?? Date.now;

  async function install(): Promise<string> {
    const id = await settingsRepo(meta).get('system.instanceId');
    return typeof id === 'string' ? id : '';
  }

  async function claimOf(request: FastifyRequest): Promise<ObjectClaim | null> {
    return readObjectLink(meta, deps.secret, await install(), tokenOf(request.params as { '*': string }));
  }

  /** The found person a link names, as they stand; null when nothing is known of them any more. */
  async function objectorOf(claim: ObjectClaim): Promise<Objector | null> {
    const found = await leadsInstall(deps, claim.installId);
    const people = found?.addOn.foundPeople ?? null;
    if (found === null || people === null) return null;
    const { addOn, view } = found;
    const { db } = await deps.manager.data(addOn.connectionId);
    const row = await foundById(db, people, claim.found);
    if (row === null) return null;
    const index = await tableRefIndex(meta, addOn.connectionId, view.model);
    const tableId = resolveTableRef(index, row.personTable)?.tableId ?? null;
    let person: Objector['person'] = null;
    if (tableId !== null) {
      const table = view.table(tableId);
      const pk = pkOfRowKey(table, row.personKey);
      const held = pk === null ? undefined : ((await fetchByPk(db, table, pk)) as Row | undefined);
      if (held !== undefined) {
        const declared = await peopleTablesOf(meta).of(addOn.connectionId, view.model, tableId);
        const value = declared?.email == null ? null : held[declared.email];
        person = { table, row: held, address: typeof value === 'string' && looksLikeAddress(value) ? normaliseAddress(value) : null };
      }
    }
    return { found: row, view, connectionId: addOn.connectionId, person };
  }

  /** The rows of other tables that link to their people row: they stay, emptied of them. */
  async function linksTo(objector: Objector): Promise<Stays> {
    const person = objector.person;
    if (person === null) return [];
    const { db } = await deps.manager.data(objector.connectionId);
    const out: Stays = [];
    for (const relation of objector.view.model.relations) {
      if (relation.through !== null || relation.to.tableId !== person.table.id || relation.from.columns.length !== 1 || relation.to.columns.length !== 1) continue;
      const value = person.row[relation.to.columns[0]!];
      if (value === null || value === undefined) continue;
      let table: ResolvedTable;
      try {
        table = objector.view.table(relation.from.tableId);
      } catch {
        continue;
      }
      const counted = (await db
        .selectFrom(table.id as never)
        .select(sql<number>`count(*)`.as('n') as never)
        .where(sql.ref(relation.from.columns[0]!), '=', value as never)
        .executeTakeFirst()) as { n?: unknown } | undefined;
      const count = Number(counted?.n ?? 0);
      if (count > 0) out.push({ label: table.table.label ?? table.name, count });
    }
    return out;
  }

  /** Deletes their people row once nothing links to it (it is already emptied). */
  async function removePerson(objector: Objector): Promise<void> {
    const person = objector.person;
    if (person === null || person.table.primaryKey.length === 0) return;
    const { db } = await deps.manager.data(objector.connectionId);
    let query = db.deleteFrom(person.table.id as never);
    for (const column of person.table.primaryKey) query = query.where(sql.ref(column), '=', person.row[column] as never);
    await query.execute();
  }

  /** The business, with whom a person writes to about their details: the DPO contact first. */
  async function businessOf(): Promise<MailDoorBusiness> {
    const business = await door.business();
    return { ...business, email: (await privacyContact(meta)) ?? business.email };
  }

  function actionOf(request: FastifyRequest): string {
    const lang = (request.query as { lang?: unknown } | undefined)?.lang;
    return `${MAIL_DOOR_PREFIX}/o/${tokenOf(request.params as { '*': string })}${typeof lang === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(lang) ? `?lang=${lang}` : ''}`;
  }

  /** The page's main column, in the reader's language. */
  function mainOf(t: Translate, business: MailDoorBusiness, view: ObjectView): string {
    const named = { business: business.name };
    switch (view.kind) {
      case 'ask': {
        const title = escapeHtml(t('mailDoor:object.title', 'Object to {business} keeping your details?', named));
        const line = escapeHtml(t('mailDoor:object.line', '{business} will delete your details and put this address on its do-not-email list.', named));
        return (
          `<section class="card"><h1 class="title">${title}</h1><bdi dir="ltr" class="mono addr">${escapeHtml(view.address)}</bdi><p class="note">${line}</p>` +
          `<form method="post" action="${escapeHtml(view.action)}"><div class="buttons"><button type="submit" name="act" value="object" class="primary">${escapeHtml(t('mailDoor:object.button', 'Object'))}</button></div></form></section>`
        );
      }
      case 'done': {
        const paras = view.stays.length === 0 ? [] : [escapeHtml(t('mailDoor:object.stays', '{business} keeps its own records that named you, with your details taken out: {records}.', { ...named, records: view.stays.map((one) => one.label).join(', ') }))];
        return statusCard('positive', 'circleCheck', t('mailDoor:object.done', 'Done. We have deleted your details and won’t write to you again.'), paras, null, null);
      }
      case 'already':
        return statusCard('neutral', 'circleCheck', t('mailDoor:object.already', 'You’ve already objected. {business} doesn’t keep your details.', named), [], null, null);
      case 'dead': {
        const title = business.email === null ? t('mailDoor:object.deadAsk', 'This link doesn’t work. Write to {business}.', named) : t('mailDoor:object.dead', 'This link doesn’t work. Write to {email}.', { email: business.email });
        return statusCard('neutral', 'link2Off', title, [], null, null);
      }
    }
  }

  type ObjectView = { kind: 'ask'; address: string; action: string } | { kind: 'done'; stays: Stays } | { kind: 'already' } | { kind: 'dead' };

  async function send(request: FastifyRequest, reply: FastifyReply, view: ObjectView | { kind: 'unavailable' }, status: number, claim: ObjectClaim | null): Promise<FastifyReply> {
    const locale = await door.language(request, claim?.language == null ? null : ({ language: claim.language.replace('-', '_') } as UnsubscribeClaim));
    const { t, lang } = await door.translator(locale);
    const business = await businessOf();
    const page: MailDoorView = view.kind === 'unavailable' ? { kind: 'unavailable' } : { kind: 'own', main: mainOf(t, business, view) };
    const path = request.url.split('?')[0] ?? request.url;
    const { html, policy } = renderMailDoorPage({ view: page, business, lang, accent: await door.accent(), path, t });
    return reply
      .code(status)
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', policy)
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex')
      .send(html);
  }

  async function guarded(request: FastifyRequest, reply: FastifyReply, work: () => Promise<FastifyReply>): Promise<FastifyReply> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AddressKeysLockedError) {
        request.log.error({ err: error }, 'object page: the address keys cannot be read with this server’s secret');
        return send(request, reply, { kind: 'unavailable' }, 503, null);
      }
      throw error;
    }
  }

  /** What a link shows now, without acting: the button, or why there is nothing to do. */
  async function standing(claim: ObjectClaim): Promise<{ objector: Objector } | { kind: 'already' | 'dead' }> {
    const objector = await objectorOf(claim);
    if (objector !== null) return { objector };
    return (await deps.consent.stop.has(claim.address)) ? { kind: 'already' } : { kind: 'dead' };
  }

  return async (app) => {
    tagRoutes(app, 'public');
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: FORM_BODY_LIMIT }, (_request, body, done) => {
      const fields: Record<string, string> = {};
      for (const [name, value] of new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8'))) if (!(name in fields)) fields[name] = value;
      done(null, fields);
    });

    // A GET never acts: a link scanner opening the mail objects for nobody.
    app.get(`${OBJECT_PATH}*`, { config: { rateLimitBucket: 'object-page' }, schema: { hide: true, params: tokenParams } }, async (request, reply) =>
      guarded(request, reply, async () => {
        if (!(await door.reachable())) return send(request, reply, { kind: 'unavailable' }, 404, null);
        const claim = await claimOf(request);
        if (claim === null) return send(request, reply, { kind: 'dead' }, 404, null);
        const state = await standing(claim);
        if ('kind' in state) return send(request, reply, state, state.kind === 'dead' ? 404 : 200, claim);
        return send(request, reply, { kind: 'ask', address: claim.address, action: actionOf(request) }, 200, claim);
      }),
    );

    app.post(
      `${OBJECT_PATH}*`,
      {
        config: { rateLimitBucket: 'object-page', csrf: 'exempt', audit: audited('worker') },
        schema: { hide: true, params: tokenParams },
      },
      async (request, reply) =>
        guarded(request, reply, async () => {
          if (!(await door.reachable())) return send(request, reply, { kind: 'unavailable' }, 404, null);
          const claim = await claimOf(request);
          if (claim === null) return send(request, reply, { kind: 'dead' }, 404, null);
          const body = request.body as Record<string, string> | undefined;
          const found = await standing(claim);
          if ('kind' in found) return send(request, reply, found, found.kind === 'dead' ? 404 : 200, claim);
          // Only the page's own button acts.
          if (body?.['act'] !== 'object') return send(request, reply, { kind: 'ask', address: claim.address, action: actionOf(request) }, 400, claim);
          const { objector } = found;
          const at = now();
          // 1. Never mailed again, first: an erasure cut short still leaves them stopped.
          await deps.consent.stop.add({ address: claim.address, reason: 'lead-finder', origin: null, at });
          // 2. What stays (the business's records that name them), read before their row is emptied.
          const stays = await linksTo(objector);
          // 3. Erased in place, by the address the mail went to and by the one their row holds now, when it moved.
          const results: EraseResult[] = [await deps.erase(claim.address)];
          if (objector.person?.address != null && objector.person.address !== claim.address) results.push(await deps.erase(objector.person.address));
          // 4. Their row goes too, once nothing links to it.
          if (stays.length === 0) await removePerson(objector);
          const told = [...new Set(results.flatMap((one) => one.told))].sort();
          await auditRepo(meta).append(
            {
              actorKind: 'system',
              actorId: null,
              actorLabel: 'A person, through the link in their mail',
              category: 'leads',
              action: 'leads.object',
              connectionId: objector.connectionId,
              changes: { after: { address: results[0]!.address, counts: results[0]!.counts, stays: stays.length, removed: stays.length === 0, ...(told.length === 0 ? {} : { told }) } },
              ip: request.ip ?? null,
            },
            at,
          );
          return send(request, reply, { kind: 'done', stays }, 200, claim);
        }),
    );
  };
}
