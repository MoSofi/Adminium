// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CONSENT ON THE WRITE SIDE: the consent log and the yes/no column an app
 * declares for one purpose (`people[].consent`, the CRM's `may_email`) kept
 * saying the same thing, whichever side a change starts on.
 *
 * The log is the record and the column mirrors it. So:
 *
 *  - A ROW WRITTEN that changes a declared consent column is told to the log
 *    in the same write (`written`, called by the write service after the
 *    statement and before the after hooks): a signed-in staff member's save,
 *    a bulk edit or an undo as theirs (`staff`); a file brought in as
 *    `import`; a person's own page as `person`; a rule, the owner's code or
 *    an API key as `system`. A create that leaves the column at no says
 *    nothing (nobody was asked). When the log already says what the column
 *    now says (an unsubscribe or a forget wrote the log first) nothing more
 *    is written: no change is ever logged twice, and nothing loops.
 *  - A LOG EVENT from anywhere else (an unsubscribe, the first-send review,
 *    a staff member's "Record consent", a public tick) reaches the column
 *    through the consent door (`ConsentService.applyToColumn`, one direct
 *    UPDATE of the column and its stamps), never through a save: that is
 *    `mirrorEvent`, the one function the mail door, the consent routes and
 *    the send review call. It finds the person by their row when the event
 *    names one, else by their address on every declared table. The opt-out
 *    mark is never stamped by it.
 *  - A PUBLIC TICK ("Email me about new shows", `publicAccess[].consent`)
 *    given on a create or a change through its entry writes one log row from
 *    the form: the declared sentence in the person's language and its
 *    version, the network address and the browser, keyed to the person the
 *    entry links (not the order), then sets that person's declared column
 *    through the door. A box left unticked writes nothing (it is no
 *    withdrawal of an earlier yes), and a tick for another person than the
 *    one signed in was refused before the write (`decide.ts`).
 *  - "DELETE MY DETAILS" that empties a declared consent column first
 *    appends a withdrawal from the person (`withdrawOnForget`).
 *
 * The log lives in the meta store and the row in the app's database: two
 * connections, so there is no one transaction around both on any engine.
 * The row's statement commits first and the log row follows in the same
 * request, before it answers; a log that cannot be written fails the
 * request, as an audit entry that cannot be written does.
 */
import type { ConsentEvent, ConsentPerson, ConsentSource, MetaDb } from '@adminium/meta';

import { looksLikeAddress, type ConsentService, type ConsentTableSource, type StaffMember } from '../consent/index.js';
import type { EffectiveModel } from '../connections/effective-schema.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import type { PeopleWrite, PublicConsentTick, WriteContext } from '../crud/write-context.js';
import { booleanOf } from '../crud/write-values.js';
import { pkOfRowKey, rowKeyOf } from '../payments/payables.js';
import { normaliseAddress } from '../public-api/claim-code.js';
import { declaredPeople, type DeclaredPeopleTable } from './declared.js';
import { peopleTablesOf, type PeopleTables } from './tables-of.js';

/** The most rows one address is looked for in, per table, when a log event names no row. */
const ROWS_PER_ADDRESS = 20;
/** What the log keeps of a browser. */
const USER_AGENT_MAX = 512;
const IP_MAX = 64;

export interface PeopleConsentDeps {
  meta: MetaDb;
  consent: ConsentService;
  /** The source tables, read on the database's own pool. */
  tables: ConsentTableSource;
  /** A database's current schema, for a log event that names only an address. */
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  people?: PeopleTables | undefined;
  log?: { warn(fields: object, message: string): void } | undefined;
}

export interface PeopleConsent {
  /** A row written, told to the log (see the header). */
  written(write: PeopleWrite): Promise<void>;
  /** A log event mirrored into the declared column of the person it names, or of every row holding its address. */
  mirrorEvent(event: ConsentEvent, address?: string | null): Promise<number>;
  /** Before "delete my details" empties a declared consent column: the person's withdrawal. */
  withdrawOnForget(input: { connectionId: string; view: SnapshotView; table: ResolvedTable; row: Row; columns: readonly string[] }): Promise<ConsentEvent | null>;
  /** The column of a table that holds its people's address, as its app declares it; null when none is declared. */
  addressColumnOf(connectionId: string, table: ResolvedTable): Promise<string | null>;
}

/** Where a change of the column came from, as the log keeps it. */
export function consentSourceOf(context: WriteContext): { source: ConsentSource; staff: StaffMember | null; detail: string } {
  const actor = context.actor;
  if (context.origin === 'public') return { source: 'person', staff: null, detail: 'own-page' };
  if (context.origin === 'import') return { source: 'import', staff: null, detail: 'file' };
  if ((context.origin === 'dashboard' || context.origin === 'bulk' || context.origin === 'undo') && actor?.kind === 'user' && actor.id !== null) {
    return { source: 'staff', staff: { id: actor.id, label: actor.label }, detail: context.origin === 'dashboard' ? 'saved' : context.origin };
  }
  if (actor?.kind === 'api-key') return { source: 'system', staff: null, detail: 'api-key' };
  return { source: 'system', staff: null, detail: context.origin === 'automation' ? 'rule' : context.origin };
}

/** An address worth keeping, or null. */
function addressIn(value: unknown): string | null {
  return typeof value === 'string' && looksLikeAddress(value) ? normaliseAddress(value) : null;
}

/** The language of the wording a person is shown: theirs (their row's), else the request's, else English. */
export function wordingLanguage(text: Readonly<Record<string, string>>, own: unknown, acceptLanguage: string | null): string {
  const tags = Object.keys(text);
  const norm = (tag: string) => tag.trim().replace('_', '-').toLowerCase();
  const pick = (wanted: string) => tags.find((tag) => norm(tag) === norm(wanted)) ?? tags.find((tag) => norm(tag).split('-')[0] === norm(wanted).split('-')[0]);
  if (typeof own === 'string' && own.trim() !== '') {
    const hit = pick(own);
    if (hit !== undefined) return hit;
  }
  const asked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q.slice(2)) };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of asked) {
    const hit = pick(tag);
    if (hit !== undefined) return hit;
  }
  return text['en-US'] !== undefined ? 'en-US' : tags[0]!;
}

export function createPeopleConsent(deps: PeopleConsentDeps): PeopleConsent {
  const { meta, consent } = deps;
  const people = deps.people ?? peopleTablesOf(meta);

  /** A declared table and its source handle, on the database's own pool. */
  async function declaredOf(connectionId: string, tableId: string): Promise<{ declared: DeclaredPeopleTable; found: NonNullable<Awaited<ReturnType<ConsentTableSource['table']>>> } | null> {
    const found = await deps.tables.table(connectionId, tableId);
    if (found === null) return null;
    const declared = await people.of(connectionId, found.view.model, found.table.id);
    return declared === null ? null : { declared, found };
  }

  /** The column door, for one row; a failure is said and passed over (the log is the record). */
  async function applyTo(declared: DeclaredPeopleTable, key: string, event: ConsentEvent): Promise<boolean> {
    if (declared.consent === null || declared.consent.purpose !== event.purpose) return false;
    try {
      const done = await consent.applyToColumn({ connectionId: declared.connectionId, table: declared.table, key, column: declared.consent.column, keep: declared.optOutMark === null ? [] : [declared.optOutMark] }, event);
      return done === 'written';
    } catch (error) {
      deps.log?.warn({ err: error, table: declared.table }, 'a consent event could not be written into its column');
      return false;
    }
  }

  async function mirrorEvent(event: ConsentEvent, address?: string | null): Promise<number> {
    if ((event.state !== 'yes' && event.state !== 'no') || event.purpose === null) return 0;
    if (event.person !== null) {
      const held = await declaredOf(event.person.connectionId, event.person.table);
      return held !== null && (await applyTo(held.declared, event.person.key, event)) ? 1 : 0;
    }
    const wanted = addressIn(address);
    if (wanted === null) return 0;
    // Known only by address: every row of a declared table that keeps it, as sign-in finds one (trimmed, lower case).
    const tables = await declaredPeople(meta, async (connectionId) => (await deps.viewFor(connectionId))?.model ?? null);
    let written = 0;
    for (const declared of tables) {
      if (declared.consent?.purpose !== event.purpose || declared.email === null) continue;
      const found = await deps.tables.table(declared.connectionId, declared.table);
      if (found === null || found.table.primaryKey.length === 0) continue;
      const email = declared.email;
      const rows = (await found.db
        .selectFrom(found.table.id)
        .select(found.table.primaryKey as never)
        .where((eb) => eb(eb.fn('lower', [eb.fn('trim', [eb.ref(email as never)])]), '=', wanted as never))
        .limit(ROWS_PER_ADDRESS)
        .execute()) as Row[];
      for (const row of rows) if (await applyTo(declared, rowKeyOf(found.table, row), event)) written += 1;
    }
    return written;
  }

  /** A public tick on the row written: one log row from the form, then the person's column. */
  async function tick(write: PeopleWrite, given: PublicConsentTick): Promise<void> {
    const { target, record, before } = write;
    if (booleanOf(record[given.column]) !== true || (before !== null && booleanOf(before[given.column]) === true)) return;
    const theirs = given.person.link === null ? rowKeyOf(target.table, record) : record[given.person.link];
    if (theirs === null || theirs === undefined || theirs === '') return;
    const key = String(theirs);
    const held = await deps.tables.table(target.connectionId, given.person.table);
    if (held === null) return;
    const pk = pkOfRowKey(held.table, key);
    const row = pk === null ? undefined : await fetchByPk(held.db, held.table, pk);
    if (row === undefined) return;
    const declared = await people.of(target.connectionId, held.view.model, held.table.id);
    const language = wordingLanguage(given.wording.text, declared?.language == null ? null : row[declared.language], given.acceptLanguage);
    const person: ConsentPerson = { connectionId: target.connectionId, table: held.table.id, key };
    const event = await consent.record({
      person,
      address: declared?.email == null ? null : addressIn(row[declared.email]),
      purpose: given.purpose,
      state: 'yes',
      source: 'form',
      detail: given.form,
      wording: { text: given.wording.text[language]!, version: `v${String(given.wording.version)} ${language}` },
      ip: given.ip === null ? null : given.ip.slice(0, IP_MAX),
      userAgent: given.userAgent === null ? null : given.userAgent.slice(0, USER_AGENT_MAX),
    });
    if (declared !== null) await applyTo(declared, key, event);
  }

  /** A row's declared consent column changed by the write: told to the log as its writer. */
  async function mirrorColumn(write: PeopleWrite, model: EffectiveModel | undefined): Promise<void> {
    const { action, target, context, record, before } = write;
    const declared = await people.of(target.connectionId, model, target.table.id);
    if (declared?.consent == null) return;
    const column = declared.consent.column;
    if (action === 'update' && before === null) return;
    const now = booleanOf(record[column]) === true;
    const was = before === null ? false : booleanOf(before[column]) === true;
    if (now === was) return;
    const person: ConsentPerson = { connectionId: target.connectionId, table: target.table.id, key: rowKeyOf(target.table, record) };
    const address = declared.email === null ? null : addressIn(record[declared.email]);
    const state = now ? 'yes' : 'no';
    // Already so in the log (an unsubscribe, a forget, a tick wrote it first): nothing more.
    if ((await consent.stateFor({ person, address }, declared.consent.purpose)).state === state) return;
    const { source, staff, detail } = consentSourceOf(context);
    await consent.record({ person, address, purpose: declared.consent.purpose, state, source, detail, staff });
  }

  return {
    async written(write) {
      const given = write.context.consentTick;
      if (write.context.origin === 'public' && given !== undefined && given.table === write.target.table.id) await tick(write, given);
      await mirrorColumn(write, write.target.view?.model);
    },

    mirrorEvent,

    async withdrawOnForget(input) {
      const declared = await people.of(input.connectionId, input.view.model, input.table.id);
      if (declared?.consent == null || !input.columns.includes(declared.consent.column)) return null;
      const person: ConsentPerson = { connectionId: input.connectionId, table: input.table.id, key: rowKeyOf(input.table, input.row) };
      const address = declared.email === null ? null : addressIn(input.row[declared.email]);
      const standing = await consent.stateFor({ person, address }, declared.consent.purpose);
      // Only a yes is withdrawn: the column's, or the log's.
      if (booleanOf(input.row[declared.consent.column]) !== true && standing.state !== 'yes') return null;
      return consent.withdraw({ person, address, purpose: declared.consent.purpose, source: 'person', detail: 'forget' });
    },

    async addressColumnOf(connectionId, table) {
      const view = await deps.viewFor(connectionId);
      return (await people.of(connectionId, view?.model, table.id))?.email ?? null;
    },
  };
}
