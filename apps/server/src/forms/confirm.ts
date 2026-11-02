// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SIGN-UP CONFIRMED: what the confirm page (`/m/c/<token>`) reads and does.
 *
 * The sign-up waits on its answer row (`confirm = 'pending'`, with the
 * purpose, the wording and its version, the network address and the
 * browser). The page:
 *  - shows, on a GET, the address it confirms and one button; a GET changes
 *    nothing (link scanners open every link in a mail);
 *  - on the button's POST: the answer turns `confirmed` (once: two presses at
 *    the same moment confirm once), then the consent log gets its yes with
 *    `confirmed_at`, from the answer's own facts (`source: 'form'`), for the
 *    row the answer became when it is a person, else for the address; then
 *    the address comes off the do-not-email list (a confirmed sign-up is a
 *    fresh yes; the log keeps the old objection beside it). An erased
 *    person's entry stays: it has no address to lift;
 *  - says "too old" for a link past its 30 days, an answer no longer there
 *    (erased) or one the sweep let go (`expired`), and "already" for one
 *    confirmed before. The same pages whether or not the address is known
 *    anywhere else.
 * The sweep (`expirePending`) lets a sign-up go 30 days after its answer.
 *
 * Should the server stop between the answer turning `confirmed` and the log's
 * yes, the answer says confirmed and the log holds no yes: the address is
 * then mailed as one never asked. The answer row (staff's Answers page) shows
 * the confirmation, and a new sign-up writes the yes.
 */
import { formsOf } from '@adminium/manifest';
import { settingsRepo, type ConsentPerson, type MetaDb } from '@adminium/meta';
import type { Dialect } from '@adminium/engine';
import type { Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ConsentService } from '../consent/index.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { bindWriteValue } from '../crud/write-values.js';
import { peopleTablesOf } from '../people/tables-of.js';
import { CONFIRM_LINK_MS, confirmKey, confirmLinkLive, readConfirmToken, type ConfirmClaim } from './confirm-token.js';

export interface FormsConfirmDeps {
  meta: MetaDb;
  secret: string;
  consent: ConsentService;
  installs: () => Promise<AddOnInstalls>;
  data: (connectionId: string) => Promise<{ db: Kysely<SourceDatabase>; dialect: Dialect }>;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  now?: () => number;
}

/** What a confirm link stands for now. */
export type ConfirmState =
  | { state: 'dead' }
  | { state: 'too-old' }
  | { state: 'already' }
  | { state: 'waiting'; address: string; purpose: 'newsletter' | 'surveys'; language: string | null };

/** One answer row, as the page reads it. */
interface Waiting {
  connectionId: string;
  table: string;
  pk: string;
  row: Record<string, unknown>;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

export function createFormsConfirm(deps: FormsConfirmDeps) {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const key = confirmKey(deps.secret);

  async function install(): Promise<string> {
    const id = await settingsRepo(meta).get('system.instanceId');
    return typeof id === 'string' ? id : '';
  }

  /** What a token says; null for one this install did not make. */
  async function read(token: string): Promise<ConfirmClaim | null> {
    return readConfirmToken(key, await install(), token);
  }

  /** The answers tables of a forms add-on, on its database. */
  async function answersOf(addOn: string): Promise<{ connectionId: string; table: string; pk: string }[]> {
    const installs = await deps.installs();
    const rows = await meta.db.selectFrom('adminium_manifests').select(['connectionId']).where('manifestKey', '=', addOn).where('kind', '=', 'add-on').execute();
    const out: { connectionId: string; table: string; pk: string }[] = [];
    for (const row of rows) {
      if (row.connectionId === null) continue;
      const installed = installs.installed(row.connectionId, addOn);
      const block = installed === null ? null : formsOf(installed.manifest);
      if (installed === null || block === null) continue;
      const table = installs.tableOf(row.connectionId, addOn, block.answers);
      const pk = (installed.manifest.requiredSchema?.tables ?? []).find((one) => one.ref === block.answers)?.columns.find((column) => column.role === 'pk')?.ref;
      if (table !== null && pk !== undefined) out.push({ connectionId: row.connectionId, table, pk });
    }
    return out;
  }

  /** The answer a claim names, read where it is: null when it is not there (erased). */
  async function answerOf(claim: ConfirmClaim): Promise<Waiting | null> {
    for (const place of await answersOf(claim.addOn)) {
      try {
        const { db } = await deps.data(place.connectionId);
        const row = (await db
          .selectFrom(place.table as never)
          .selectAll()
          .where(db.dynamic.ref(place.pk), '=', claim.answer)
          .executeTakeFirst()) as Record<string, unknown> | undefined;
        if (row !== undefined && String(row['form_id']) === claim.form) return { ...place, row };
      } catch {
        // A database that cannot be read: as an answer not there.
      }
    }
    return null;
  }

  /** What the link stands for now (the page's GET: nothing changes). */
  async function stateOf(token: string): Promise<{ claim: ConfirmClaim | null; state: ConfirmState; waiting: Waiting | null }> {
    const claim = await read(token);
    if (claim === null) return { claim, state: { state: 'dead' }, waiting: null };
    if (!confirmLinkLive(claim.issuedAt, now())) return { claim, state: { state: 'too-old' }, waiting: null };
    const waiting = await answerOf(claim);
    const address = text(waiting?.row['email']);
    if (waiting === null || address === null) return { claim, state: { state: 'too-old' }, waiting: null };
    const confirm = waiting.row['confirm'];
    if (confirm === 'confirmed') return { claim, state: { state: 'already' }, waiting };
    if (confirm !== 'pending' || waiting.row['consent_purpose'] !== claim.purpose) return { claim, state: { state: 'too-old' }, waiting: null };
    return { claim, state: { state: 'waiting', address, purpose: claim.purpose, language: text(waiting.row['language']) }, waiting };
  }

  /** The person the answer became, when that row's table is declared people; null otherwise. */
  async function personOf(waiting: Waiting): Promise<ConsentPerson | null> {
    const stored = text(waiting.row['became_table']);
    const key = text(waiting.row['became_key']);
    if (stored === null || key === null) return null;
    const tableId = (await deps.installs()).tableOfRef(waiting.connectionId, stored);
    const view = await deps.viewFor(waiting.connectionId);
    if (tableId === null || view === null) return null;
    const declared = await peopleTablesOf(meta).of(waiting.connectionId, view.model, tableId);
    return declared?.kind === 'people' ? { connectionId: waiting.connectionId, table: tableId, key } : null;
  }

  /** The button's POST: see the header. Answers what the page shows next. */
  async function confirm(token: string): Promise<{ state: 'done'; purpose: 'newsletter' | 'surveys'; language: string | null } | { state: 'already' | 'too-old' | 'dead' }> {
    const found = await stateOf(token);
    if (found.state.state !== 'waiting') return { state: found.state.state };
    const waiting = found.waiting!;
    const at = now();
    // Once: the row turns confirmed only from pending, so a second press at the same moment does nothing.
    const { db } = await deps.data(waiting.connectionId);
    const moved = await db
      .updateTable(waiting.table as never)
      .set({ confirm: 'confirmed' } as never)
      .where(db.dynamic.ref(waiting.pk), '=', found.claim!.answer)
      .where(db.dynamic.ref('confirm'), '=', 'pending')
      .executeTakeFirst();
    if (Number(moved.numUpdatedRows) !== 1) return { state: 'already' };
    const address = found.state.address;
    const version = waiting.row['consent_version'];
    await deps.consent.record({
      state: 'yes',
      person: await personOf(waiting),
      address,
      purpose: found.state.purpose,
      source: 'form',
      detail: 'confirmed',
      wording: { text: text(waiting.row['consent_wording']) ?? '', version: version === null || version === undefined ? '' : String(version) },
      ip: text(waiting.row['ip']),
      userAgent: text(waiting.row['user_agent']),
      at,
      confirmedAt: at,
    });
    // A confirmed sign-up lifts the address's do-not-email entry; the log keeps the objection and this yes.
    const entry = await deps.consent.stop.entryFor(address);
    if (entry !== null) await deps.consent.stop.remove(entry.id);
    return { state: 'done', purpose: found.state.purpose, language: found.state.language };
  }

  /**
   * The sweep: every sign-up still waiting 30 days after its answer lets go
   * (`expired`), on every forms add-on's answers table. Answers how many.
   */
  async function expirePending(): Promise<number> {
    const before = new Date(now() - CONFIRM_LINK_MS).toISOString();
    const installs = await deps.installs();
    const rows = await meta.db.selectFrom('adminium_manifests').select(['manifestKey', 'connectionId']).where('kind', '=', 'add-on').where('status', '=', 'installed').execute();
    let expired = 0;
    for (const row of rows) {
      if (row.connectionId === null) continue;
      const installed = installs.installed(row.connectionId, row.manifestKey);
      const block = installed === null ? null : formsOf(installed.manifest);
      const table = block === null ? null : installs.tableOf(row.connectionId, row.manifestKey, block.answers);
      if (table === null) continue;
      try {
        const { db, dialect } = await deps.data(row.connectionId);
        const view = await deps.viewFor(row.connectionId);
        const column = view?.table(table).columns.get('submitted_at');
        if (column === undefined) continue;
        // A moment spelled as its column is written (an instant; on MySQL its UTC wall time).
        const cutoff = bindWriteValue(column, before, dialect);
        const result = await db
          .updateTable(table as never)
          .set({ confirm: 'expired' } as never)
          .where(db.dynamic.ref('confirm'), '=', 'pending')
          .where(db.dynamic.ref('submitted_at'), '<', cutoff)
          .executeTakeFirst();
        expired += Number(result.numUpdatedRows);
      } catch {
        // One database that cannot be reached does not stop the others.
      }
    }
    return expired;
  }

  return { stateOf, confirm, expirePending };
}

export type FormsConfirm = ReturnType<typeof createFormsConfirm>;

