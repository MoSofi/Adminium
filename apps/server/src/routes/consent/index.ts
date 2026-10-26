// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Consent and the do-not-email list, for staff (no screens yet; the comps'
 * do-not-email list and the record page's "E-mail consent" panel read these).
 *
 *   GET    /consent/stop-list          the list, newest first, searched by address, narrowed by why
 *   POST   /consent/stop-list          "Add addresses": put pasted addresses on it, by hand
 *   DELETE /consent/stop-list/:id      "Remove": they get marketing mail again only if they agree again
 *   POST   /consent/panel              one record: its standing per purpose, the list, its history
 *   POST   /consent/record-consent     "Record consent": a yes a staff member took (in person, by phone, …)
 *   POST   /consent/replied            "Replied": they answered a marketing e-mail; their sequences stop
 *   POST   /consent/said-no            "They said no": the record's address goes on the do-not-email list
 *
 * ─── Who may ───────────────────────────────────────────────────────────────
 * The install-wide list sits beside the e-mail screens and rides their grant,
 * `settings.manage` (e-mail documents add no key of their own). Taking an
 * address OFF it mails someone who objected, so it is the Super Admin's
 * alone, and a signed-in person's: never an API key.
 *
 * A record's own routes are judged as the record is. The panel is for
 * whoever reads it; recording consent, "Replied" and "They said no" for
 * whoever may change it (an app's rep, account manager or front desk, not
 * only an admin), as a change of that row: its table's update grant, and the
 * row inside their update reach (row limits, a listing the reach does not
 * count). A row out of reach answers as one that is not there. Every write is
 * a signed-in person's, whose name the event keeps.
 *
 * ─── What is never sent back ───────────────────────────────────────────────
 * A record's address (the page has it, masked or not, from the row), any
 * hash, and a sign-up's browser. A sign-up's network address only to a reader
 * who sees the table's personal columns. The audit entries carry no address:
 * counts, ids and reasons.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { MetaDb } from '@adminium/meta';

import { auditExempt, audited } from '../../audit/coverage.js';
import { consentTableSource, looksLikeAddress, type ConsentEvent, type ConsentPerson, type ConsentService, type ConsentTableSource, type StaffMember, type StopEntryView } from '../../consent/index.js';
import { CONSENT_PURPOSES } from '../../consent/types.js';
import type { ConnectionManager } from '../../connections/manager.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { fetchByPk } from '../../crud/records.js';
import { fetchVisible } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { pkOfRowKey, rowKeyOf } from '../../payments/payables.js';
import { normaliseAddress } from '../../public-api/claim-code.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import type { PermissionSet } from '../../rbac/resolver.js';
import {
  panelReply,
  saidNoReply,
  recordConsentBody,
  recordConsentReply,
  recordRef,
  stopAddBody,
  stopAddReply,
  stopIdParams,
  stopListQuery,
  stopListReply,
  stopRemoveReply,
  type EventView,
} from './schema.js';

export interface ConsentRoutesDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  service: ConsentService;
  tables?: ConsentTableSource | undefined;
  /**
   * The column of a table that holds its people's address, or null. Until
   * tables declare their people, the one column read as an e-mail address
   * (by its kind, or by the name `email`).
   */
  addressColumnOf?: ((connectionId: string, table: ResolvedTable) => Promise<string | null>) | undefined;
}

/** The one column of a table read as an e-mail address; `email` when there are several; null when none. */
export function emailColumnOf(table: ResolvedTable): string | null {
  const found = table.table.columns.filter((column) => column.semantics?.primary === 'email' || column.semantics?.flags.pii === 'email' || column.name.toLowerCase() === 'email');
  if (found.length === 1) return found[0]!.name;
  return found.find((column) => column.name.toLowerCase() === 'email')?.name ?? null;
}

/** The signed-in person a write is recorded as: never an API key. */
function personOf(request: FastifyRequest): StaffMember {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('Consent is recorded by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const user = (request as unknown as { user?: { id?: string; name?: string | null; email?: string | null } }).user;
  if (user?.id === undefined) throw new UnauthorizedError();
  return { id: user.id, label: user.name?.trim() || user.email || 'someone' };
}

export function consentRoutes(deps: ConsentRoutesDeps): FastifyPluginAsyncZod {
  const { meta, service } = deps;
  const tables = deps.tables ?? consentTableSource({ meta, manager: deps.manager });
  const addressColumnOf = deps.addressColumnOf ?? (async (_connectionId: string, table: ResolvedTable) => emailColumnOf(table));

  /**
   * The record as this person reaches it: refuses a table they may not read
   * (or change), and answers a row their row limits hide as one not there.
   */
  async function reach(request: FastifyRequest, input: { connectionId: string; table: string; recordId: string }, action: 'read' | 'update') {
    const found = await tables.table(input.connectionId, input.table);
    if (found === null) throw new NotFoundError('No such table.');
    const { table, db } = found;
    const grant = (what: string) => request.can(`table:${input.connectionId}:${table.id}:${what}`);
    if (!(await grant('read'))) throw new ForbiddenError('You may not read this record.', 'TABLE_FORBIDDEN');
    if (action === 'update' && !(await grant('update'))) throw new ForbiddenError('You may not change this record.', 'TABLE_FORBIDDEN');
    const pk = pkOfRowKey(table, input.recordId);
    if (pk === null) throw new NotFoundError('No such record.');
    // When the row limits cannot be worked out, nothing is shown: never a row read past them.
    const set = (request as unknown as { rbacResolution?: PermissionSet }).rbacResolution;
    if (set === undefined || set === null) throw new ForbiddenError('You may not read this record.', 'TABLE_FORBIDDEN');
    const context = await rowLimitContextOf(meta, set, input.connectionId, found.view.model);
    const row = context === null ? await fetchByPk(db, table, pk) : await fetchVisible(context, db, table, pk, action);
    if (row === undefined) throw new NotFoundError('No such record.');
    const person: ConsentPerson = { connectionId: input.connectionId, table: table.id, key: rowKeyOf(table, row as Row) };
    // The row's address, read here and never sent back: what an unsubscribe that knew only the address is found by.
    const column = await addressColumnOf(input.connectionId, table);
    const raw = column === null ? null : (row as Row)[column];
    const address = typeof raw === 'string' && looksLikeAddress(raw) ? normaliseAddress(raw) : null;
    return { table, person, address, grant };
  }

  function eventView(event: ConsentEvent, seesPersonal: boolean): EventView {
    return {
      id: event.id,
      purpose: event.purpose,
      state: event.state,
      source: event.source,
      detail: event.detail,
      how: event.how,
      note: event.note,
      staff: event.staffId === null ? null : { id: event.staffId, label: event.staffLabel ?? '' },
      wordingVersion: event.wordingVersion,
      ip: seesPersonal ? event.ip : null,
      at: event.at,
      confirmedAt: event.confirmedAt,
    };
  }

  async function requireListGrant(request: FastifyRequest): Promise<void> {
    const user = (request as unknown as { user?: { id?: string } }).user;
    if (user?.id === undefined && request.apiKeyPrincipal == null) throw new UnauthorizedError();
    if (!(await request.can(PERMISSIONS.settingsManage))) throw new ForbiddenError('You may not see the do-not-email list.');
  }

  return async (app) => {
    const superAdmin = async (request: FastifyRequest) => (await app.rbac.resolve(request)).superAdmin && request.apiKeyPrincipal == null;
    const withRemove = (entry: StopEntryView, may: boolean) => ({ ...entry, mayRemove: may && entry.erasedAt === null });

    app.get(
      '/consent/stop-list',
      { config: { audit: auditExempt('reading the do-not-email list changes nothing') }, schema: { querystring: stopListQuery, response: { 200: stopListReply } } },
      async (request) => {
        await requireListGrant(request);
        const query = request.query;
        const page = await service.stop.list({ q: query.q, reason: query.reason, limit: query.limit, cursor: query.cursor ?? null });
        const may = await superAdmin(request);
        return { data: { entries: page.entries.map((entry) => withRemove(entry, may)), next: page.next, total: await service.stop.count(query.reason) } };
      },
    );

    app.post(
      '/consent/stop-list',
      { config: { audit: audited('rbac') }, schema: { body: stopAddBody, response: { 200: stopAddReply } } },
      async (request) => {
        await requireListGrant(request);
        const staff = personOf(request);
        const invalid: string[] = [];
        const wanted = new Set<string>();
        for (const line of request.body.addresses) {
          const typed = line.trim();
          if (typed === '') continue;
          if (looksLikeAddress(typed)) wanted.add(normaliseAddress(typed));
          else invalid.push(typed.slice(0, 320));
        }
        let added = 0;
        let already = 0;
        for (const address of wanted) {
          const result = await service.stop.add({ address, reason: 'hand', staff });
          if (result.added) added += 1;
          else already += 1;
        }
        if (added > 0) await app.rbac.audit(request, { category: 'settings', action: 'consent.stop-list.add', changes: { after: { added, already, reason: 'hand' } } });
        return { data: { added, already, invalid } };
      },
    );

    app.delete(
      '/consent/stop-list/:id',
      { config: { audit: audited('rbac') }, schema: { params: stopIdParams, response: { 200: stopRemoveReply } } },
      async (request) => {
        await requireListGrant(request);
        personOf(request);
        if (!(await superAdmin(request))) throw new ForbiddenError('Only a Super Admin may take an address off the do-not-email list.');
        const entry = await service.stop.get(request.params.id);
        const result = await service.stop.remove(request.params.id);
        if (result === 'missing' || entry === null) throw new NotFoundError('That address is not on the list.');
        if (result === 'erased') throw new ValidationFailedError("An erased person's entry stays, so they are never e-mailed again.", { reason: 'ERASED' });
        await app.rbac.audit(request, { category: 'settings', action: 'consent.stop-list.remove', changes: { before: { id: entry.id, reason: entry.reason, addedAt: entry.addedAt } } });
        return { data: { removed: true as const } };
      },
    );

    app.post(
      '/consent/panel',
      { config: { audit: auditExempt('reading how a record stands changes nothing') }, schema: { body: recordRef, response: { 200: panelReply } } },
      async (request) => {
        const { person, address, grant } = await reach(request, request.body, 'read');
        const seesPersonal = await grant('read_pii');
        const who = { person, address };
        const purposes = [];
        for (const purpose of CONSENT_PURPOSES) {
          const standing = await service.stateFor(who, purpose);
          purposes.push({ purpose, state: standing.state, event: standing.event === null ? null : eventView(standing.event, seesPersonal) });
        }
        const entry = address === null ? null : await service.stop.entryFor(address);
        return {
          data: {
            addressKnown: address !== null,
            purposes,
            stopped: entry === null ? null : { since: entry.addedAt, reason: entry.reason, origin: entry.origin },
            lastReplied: await service.lastReplied(who),
            history: (await service.history(who, { limit: 100 })).map((event) => eventView(event, seesPersonal)),
            // As a change of this row is judged: the table's update grant, and the row inside the update reach.
            mayChange: (await grant('update')) && (await reach(request, request.body, 'update').then(() => true, () => false)),
          },
        };
      },
    );

    app.post(
      '/consent/record-consent',
      { config: { audit: audited('rbac') }, schema: { body: recordConsentBody, response: { 200: recordConsentReply } } },
      async (request) => {
        const staff = personOf(request);
        const body = request.body;
        const { table, person, address, grant } = await reach(request, body, 'update');
        const event = await service.record({ person, address, purpose: body.purpose, state: 'yes', source: 'staff', how: body.how, note: body.note, staff });
        await app.rbac.audit(request, {
          category: 'data',
          action: 'consent.record',
          connectionId: body.connectionId,
          entity: { connectionId: body.connectionId, table: table.id, pk: pkOfRowKey(table, person.key) ?? {}, label: person.key },
          changes: { after: { event: event.id, purpose: body.purpose, state: 'yes', how: body.how } },
        });
        return { data: { event: eventView(event, await grant('read_pii')) } };
      },
    );

    app.post(
      '/consent/said-no',
      { config: { audit: audited('rbac') }, schema: { body: recordRef, response: { 200: saidNoReply } } },
      async (request) => {
        const staff = personOf(request);
        const body = request.body;
        const { table, person, address } = await reach(request, body, 'update');
        if (address === null) throw new ValidationFailedError('This record has no e-mail address to put on the do-not-email list.', { reason: 'NO_ADDRESS' });
        const { entry, added } = await service.stop.add({ address, reason: 'hand', staff });
        if (added) {
          await app.rbac.audit(request, {
            category: 'settings',
            action: 'consent.stop-list.add',
            connectionId: body.connectionId,
            entity: { connectionId: body.connectionId, table: table.id, pk: pkOfRowKey(table, person.key) ?? {}, label: person.key },
            changes: { after: { added: 1, already: 0, reason: 'hand' } },
          });
        }
        return { data: { added, stopped: { since: entry.addedAt, reason: entry.reason, origin: entry.origin } } };
      },
    );

    app.post(
      '/consent/replied',
      { config: { audit: audited('rbac') }, schema: { body: recordRef, response: { 200: recordConsentReply } } },
      async (request) => {
        const staff = personOf(request);
        const body = request.body;
        const { table, person, address, grant } = await reach(request, body, 'update');
        const event = await service.markReplied({ person, address, staff });
        await app.rbac.audit(request, {
          category: 'data',
          action: 'consent.replied',
          connectionId: body.connectionId,
          entity: { connectionId: body.connectionId, table: table.id, pk: pkOfRowKey(table, person.key) ?? {}, label: person.key },
          changes: { after: { event: event.id, state: 'replied' } },
        });
        return { data: { event: eventView(event, await grant('read_pii')) } };
      },
    );
  };
}
