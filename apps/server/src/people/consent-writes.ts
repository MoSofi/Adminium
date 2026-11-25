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
 *    an API key as `system`. A create that leaves the column at no, or at
 *    its own default of yes, says nothing (nobody was asked). When the log already says what the column
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
 *    one signed in was refused before the write (`decide.ts`). A tick from a
 *    request that proved no mailbox (an anonymous entry finds its person by
 *    the address typed, which anybody can type) never overrules a "no"
 *    already standing for that person or address, in the log or on the
 *    do-not-email list: it writes nothing and changes no column. A public
 *    write that sets the consent column itself is held to the same rule.
 *  - A BOX THAT SAYS NO ("Don't send me a review request", `consent.means:
 *    no`) writes the person's no the same way. Anybody may give it, proved or
 *    not: a no can only stop mail, and the person switches it back on where
 *    they are signed in. A person who already said no is not logged again.
 *  - "DELETE MY DETAILS" that empties a declared consent column first
 *    appends a withdrawal from the person (`withdrawOnForget`).
 *
 * TEXTS keep their own log (`sms/consent`), and a box for texts its own
 * column (`publicAccess[].textConsent`):
 *  - A PUBLIC BOX ticked writes one row of the text log, in the declared
 *    words, for the number on the row. A stranger's yes never overrules a
 *    "no" standing for that number; a verified person's own yes replaces
 *    their own earlier no for that app, for the number their row holds,
 *    and never lifts the stop list (only their START does).
 *  - A row nobody linked (a first booking the desk links later, a stay for
 *    a guest with no account) keeps the answer on itself, on its create
 *    and on every later change of the box.
 *  - A STAFF CHANGE of a box's column (ticked or unticked on the record page,
 *    or an app's own staff screen) writes the staff member's yes or no in
 *    the box's declared words: the column and the log never disagree.
 *
 * The log lives in the meta store and the row in the app's database: two
 * connections, so there is no one transaction around both on any engine.
 * The row's statement commits first and the log row follows in the same
 * request, before it answers; a log that cannot be written fails the
 * request, as an audit entry that cannot be written does.
 */
import type { ConsentEvent, ConsentPerson, ConsentSource, MetaDb } from '@adminium/meta';

import { applyConsentToColumn } from '../consent/apply-column.js';
import { looksLikeAddress, type ConsentService, type ConsentTableSource, type StaffMember } from '../consent/index.js';
import type { EffectiveModel } from '../connections/effective-schema.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { literalDefault } from '../crud/column-rules.js';
import { fetchByPk } from '../crud/records.js';
import type { PeopleWrite, PublicConsentTick, PublicTextConsentTick, WriteContext } from '../crud/write-context.js';
import type { TableTextBox } from '../public-api/consent-tick.js';
import { ValidationFailedError } from '../errors.js';
import { parsePhone } from '../phone/index.js';
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
  /** The log of text answers (`sms/consent`). Without it a public box for texts records nothing, so nobody counts as agreeing. */
  textConsent?: TextConsentDoor | undefined;
  /** The business's country, to read a local number in; null when none is set. */
  textCountry?: (() => Promise<string | null>) | undefined;
  /** After a public box records a marketing yes to texts: where the country expects it, the mail that asks them to confirm (`sms/marketing/confirm.ts`). */
  textMarketingYes?: ((person: ConsentPerson) => Promise<unknown>) | undefined;
  /** Which app a row is of: a verified person's own yes replaces only a "no" given to that app, or to their number alone. */
  textAppOf?: TextAppOf | undefined;
  /** The boxes for texts the installed apps' entries draw on a table (`public-api/consent-tick.ts`): a staff change of one's column is recorded. */
  textBoxesOn?: ((target: { connectionId: string; view: SnapshotView; tableId: string }) => Promise<TableTextBox[]>) | undefined;
}

/** What the write path asks of the text consent log. */
export interface TextConsentDoor {
  standing(
    who: { phone: unknown; country: string | null; person: ConsentPerson },
    purpose: PublicTextConsentTick['purpose'],
  ): Promise<{ state: 'yes' | 'no' | 'not-asked'; event?: { person: ConsentPerson | null; source: string } | null | undefined }>;
  record(input: {
    phone: unknown;
    country: string | null;
    person: ConsentPerson;
    purpose: PublicTextConsentTick['purpose'];
    state: 'yes' | 'no';
    source: 'form' | 'staff';
    detail: string;
    staff?: StaffMember | null | undefined;
    wording: { text: string; version: string } | null;
    ip?: string | null | undefined;
    userAgent?: string | null | undefined;
  }): Promise<unknown>;
  /** Whether this number is on the stop list (a value that names no exact number answers true). */
  stop: { has(phone: unknown, country: string | null): Promise<boolean> };
}

/** The app a row's table belongs to (`sms/app-of-row.ts`), or null. */
export type TextAppOf = (person: ConsentPerson) => Promise<string | null>;

export interface PeopleConsent {
  /** A row written, told to the log (see the header). */
  written(write: PeopleWrite): Promise<void>;
  /** A log event mirrored into the declared column of the person it names, or of every row holding its address. */
  mirrorEvent(event: ConsentEvent, address?: string | null): Promise<number>;
  /** Before "delete my details" empties a declared consent column: the person's withdrawal. */
  withdrawOnForget(input: { connectionId: string; view: SnapshotView; table: ResolvedTable; row: Row; columns: readonly string[] }): Promise<ConsentEvent | null>;
  /** The column of a table that holds its people's address, as its app declares it; null when none is declared. */
  addressColumnOf(connectionId: string, table: ResolvedTable): Promise<string | null>;
  /** Whether an installed app's entry draws a box for texts on this table: a staff change of its column is told to the text log. */
  hasTextBoxes(target: { connectionId: string; view?: SnapshotView | undefined; table: ResolvedTable }): Promise<boolean>;
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

  /**
   * The "no" a public yes may not overrule unless the request proved the
   * very mailbox it writes for: the person's (or the address's) newest event
   * for the purpose when it is a withdrawal, or the address on the
   * do-not-email list. A request that proved no mailbox is anybody who typed
   * an address, and one that proved another mailbox (a customer signed in as
   * themselves, signing a stranger up) has proved nothing about this one: so
   * their yes writes nothing and the person's column keeps saying no. A
   * customer signed in with this address proved still changes their mind.
   * Null when nothing stands.
   */
  async function standingNo(context: WriteContext, person: ConsentPerson, address: string | null, purpose: 'newsletter' | 'surveys'): Promise<{ event: ConsentEvent | null } | null> {
    if (context.origin !== 'public') return null;
    const proved = context.provedAddress;
    if (address !== null && proved !== null && proved !== undefined && normaliseAddress(proved) === address) return null;
    const standing = await consent.stateFor({ person, address }, purpose);
    if (standing.state === 'no') return { event: standing.event };
    if (address !== null && (await consent.stop.has(address))) return { event: null };
    return null;
  }

  /**
   * The "no" a column is put back to when only the do-not-email list stands
   * against a stranger's yes: never written to the log (nobody said it here;
   * the list is the record), only handed to the column door, as the system.
   */
  function stopListNo(person: ConsentPerson, purpose: 'newsletter' | 'surveys'): ConsentEvent {
    return {
      id: '',
      person,
      address: null,
      purpose,
      state: 'no',
      source: 'system',
      detail: 'do-not-email',
      how: null,
      note: null,
      staffId: null,
      staffLabel: null,
      wording: null,
      wordingVersion: null,
      ip: null,
      userAgent: null,
      at: Date.now(),
      confirmedAt: null,
    };
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
    const address = declared?.email == null ? null : addressIn(row[declared.email]);
    if (given.means === 'no') {
      // Already their answer: the log is not told twice.
      if ((await consent.stateFor({ person, address }, given.purpose)).state === 'no') return;
    } else if ((await standingNo(write.context, person, address, given.purpose)) !== null) {
      // A tick from anybody but this address's proved owner never overrules a "no": nothing is written, no column changes.
      return;
    }
    const event = await consent.record({
      person,
      address,
      purpose: given.purpose,
      state: given.means,
      source: 'form',
      detail: given.form,
      wording: { text: given.wording.text[language]!, version: `v${String(given.wording.version)} ${language}` },
      ip: given.ip === null ? null : given.ip.slice(0, IP_MAX),
      userAgent: given.userAgent === null ? null : given.userAgent.slice(0, USER_AGENT_MAX),
    });
    if (declared !== null) await applyTo(declared, key, event);
  }

  /** The language a box's wording is shown in, for the row written. */
  async function boxLanguage(target: PeopleWrite['target'], record: Row, given: { wording: { text: Readonly<Record<string, string>> }; person: { table: string; link: string | null } }, acceptLanguage: string | null): Promise<string> {
    const declared = await people.of(target.connectionId, target.view?.model, given.person.table);
    const own = given.person.link === null && declared?.language != null ? record[declared.language] : null;
    return wordingLanguage(given.wording.text, own, acceptLanguage);
  }

  /**
   * Whose answer a box on the row written is: the person its link names, or
   * the row itself. A row nobody links (a first booking, whose patient the
   * desk links later; a stay for a guest with no account) keeps the answer
   * on itself, on its create and on every later change of the box: the
   * number is what a text is sent by, and the row's app is its scope. The
   * link is read from the row as written, so a person unlinked by this
   * change or an earlier one is never named.
   */
  function answerOf(write: PeopleWrite, given: { person: { table: string; link: string | null } }): ConsentPerson | null {
    const { target, record } = write;
    if (given.person.link === null) return { connectionId: target.connectionId, table: given.person.table, key: rowKeyOf(target.table, record) };
    const theirs = record[given.person.link];
    if (theirs !== null && theirs !== undefined && theirs !== '') return { connectionId: target.connectionId, table: given.person.table, key: String(theirs) };
    // No person linked: the row answers for itself, on a later change as on its create.
    return target.table.primaryKey.length > 0 ? { connectionId: target.connectionId, table: target.table.id, key: rowKeyOf(target.table, record) } : null;
  }

  /**
   * Whether a verified person's own fresh yes may replace the "no" standing
   * for this number: never while the number is on the stop list (only their
   * START lifts that); and only a no that is theirs to change for this app,
   * one on their own row, on a row of the same app, or about their number
   * alone (a STOP their START lifted). The number must be the one their own
   * row holds: a proved mailbox proves nothing about another person's phone.
   */
  async function ownNoReplaced(given: PublicTextConsentTick, person: ConsentPerson, phone: string, country: string | null, standing: Awaited<ReturnType<TextConsentDoor['standing']>>): Promise<boolean> {
    const door = deps.textConsent!;
    if (given.verified !== true || given.means !== 'yes') return false;
    if (await door.stop.has(phone, country)) return false;
    // Their own row's number, as the business holds it.
    const held = await deps.tables.table(person.connectionId, person.table);
    const declared = held === null ? null : await people.of(person.connectionId, held.view.model, held.table.id);
    const pk = held === null ? null : pkOfRowKey(held.table, person.key);
    const row = held === null || pk === null ? undefined : await fetchByPk(held.db, held.table, pk);
    const theirs = declared?.phone == null || row === undefined ? null : parsePhone(row[declared.phone], country);
    const typed = parsePhone(phone, country);
    if (theirs === null || !theirs.ok || !typed.ok || theirs.e164 !== typed.e164) return false;
    const no = standing.event ?? null;
    if (no === null || no.person === null) return true;
    if (no.person.connectionId === person.connectionId && no.person.table === person.table && no.person.key === person.key) return true;
    if (deps.textAppOf === undefined) return false;
    const [mine, theirsApp] = await Promise.all([deps.textAppOf(person), deps.textAppOf(no.person)]);
    return mine !== null && mine === theirsApp;
  }

  /**
   * A public box for texts on the row written: one row of the text log, for
   * the number on that row. Nobody has proved they hold a number they typed,
   * so a yes never overrules a "no" already standing for it, save a verified
   * person's own (see {@link ownNoReplaced}). The box is never a condition
   * of the booking or the sale, so a log that cannot be written costs the
   * yes and not the write: no text goes without it.
   */
  async function textTick(write: PeopleWrite, given: PublicTextConsentTick): Promise<void> {
    const door = deps.textConsent;
    if (door === undefined) return;
    const { target, record, before } = write;
    if (booleanOf(record[given.column]) !== true || (before !== null && booleanOf(before[given.column]) === true)) return;
    const phone = record[given.phone];
    if (typeof phone !== 'string' || phone.trim() === '') return;
    const person = answerOf(write, given);
    if (person === null) return;
    try {
      const language = await boxLanguage(target, record, given, given.acceptLanguage);
      const country = (await deps.textCountry?.()) ?? null;
      const standing = await door.standing({ phone, country, person }, given.purpose);
      if (standing.state === 'no' && !(await ownNoReplaced(given, person, phone, country, standing))) return;
      await door.record({
        phone,
        country,
        person,
        purpose: given.purpose,
        state: given.means,
        source: 'form',
        detail: given.form,
        wording: { text: given.wording.text[language]!, version: `v${String(given.wording.version)} ${language}` },
        ip: given.ip === null ? null : given.ip.slice(0, IP_MAX),
        userAgent: given.userAgent === null ? null : given.userAgent.slice(0, USER_AGENT_MAX),
      });
      if (given.purpose === 'text-marketing' && given.means === 'yes') await deps.textMarketingYes?.(person);
    } catch (error) {
      // Its name alone: a message here can quote the number.
      deps.log?.warn({ table: given.table, error: error instanceof Error ? error.name : 'unknown' }, 'A public text consent box was not recorded');
    }
  }

  /**
   * A staff member's change of a box's column (the record page, a bulk
   * change, an undo, an app's own staff screen saving through the data
   * routes): told to the text log as theirs, in the box's declared words.
   * Ticked, their yes; unticked, a no. A box that means "no" is a no when
   * ticked and nothing when unticked. A change that leaves the column as it
   * was writes nothing. A yes needs a number a text can reach: a row without
   * one records nothing.
   */
  async function staffTextColumns(write: PeopleWrite): Promise<void> {
    const door = deps.textConsent;
    const { action, target, context, record, before } = write;
    if (door === undefined || deps.textBoxesOn === undefined || target.view === undefined) return;
    if (action === 'update' && before === null) return;
    const { source, staff, detail } = consentSourceOf(context);
    if (source !== 'staff' || staff === null) return;
    const boxes = await deps.textBoxesOn({ connectionId: target.connectionId, view: target.view, tableId: target.table.id });
    for (const box of boxes) {
      const now = booleanOf(record[box.column]) === true;
      const was = before === null ? false : booleanOf(before[box.column]) === true;
      if (now === was) continue;
      const state: 'yes' | 'no' | null = box.means === 'yes' ? (now ? 'yes' : 'no') : now ? 'no' : null;
      if (state === null) continue;
      const person = answerOf(write, box);
      if (person === null) continue;
      const phone = record[box.phone];
      const hasPhone = typeof phone === 'string' && phone.trim() !== '';
      if (state === 'yes' && !hasPhone) continue;
      const header = context.request?.headers['accept-language'];
      const language = await boxLanguage(target, record, box, typeof header === 'string' ? header : null);
      try {
        await door.record({
          phone: hasPhone ? phone : null,
          country: (await deps.textCountry?.()) ?? null,
          person,
          purpose: box.purpose,
          state,
          source: 'staff',
          detail,
          staff,
          wording: state === 'yes' ? { text: box.wording.text[language]!, version: `v${String(box.wording.version)} ${language}` } : null,
        });
      } catch (error) {
        // A number no text can reach takes no yes: the row is saved and nobody is texted.
        if (!(error instanceof ValidationFailedError)) throw error;
      }
    }
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
    // A new row holding the column's own default of yes: nobody was asked, so the log hears no yes nobody gave. A "no"
    // this person already gave stands, whoever made the row, and the column says so.
    if (action === 'create' && now) {
      const model = target.table.table?.columns.find((one) => one.name === column);
      if (model !== undefined && booleanOf(literalDefault(model.default, model.logicalType)) === true) {
        const standing = await consent.stateFor({ person, address }, declared.consent.purpose);
        const no = standing.state === 'no' ? (standing.event ?? stopListNo(person, declared.consent.purpose)) : address !== null && (await consent.stop.has(address)) ? stopListNo(person, declared.consent.purpose) : null;
        // On the write's own handle: a row made inside a larger save (a guest's first booking) is not yet there for any other.
        if (no !== null) {
          const own = { table: () => Promise.resolve({ view: target.view, table: target.table, db: target.db, dialect: target.dialect }) };
          await applyConsentToColumn(meta, own, { connectionId: declared.connectionId, table: declared.table, key: person.key, column, keep: declared.optOutMark === null ? [] : [declared.optOutMark] }, no);
        }
        return;
      }
    }
    const state = now ? 'yes' : 'no';
    // Already so in the log (an unsubscribe, a forget, a tick wrote it first): nothing more.
    if ((await consent.stateFor({ person, address }, declared.consent.purpose)).state === state) return;
    if (state === 'yes') {
      // A stranger's public write setting the column (this mailbox not proved) over a standing "no": the log
      // hears nothing, and the column is put back to no: to the log's withdrawal when there is one (the log is
      // the record), else, the address being on the do-not-email list alone, to a plain no, so that taking it
      // off the list later never turns the stranger's yes into one.
      const no = await standingNo(context, person, address, declared.consent.purpose);
      if (no !== null) {
        await applyTo(declared, person.key, no.event ?? stopListNo(person, declared.consent.purpose));
        return;
      }
    }
    const { source, staff, detail } = consentSourceOf(context);
    await consent.record({ person, address, purpose: declared.consent.purpose, state, source, detail, staff });
  }

  return {
    async written(write) {
      const given = write.context.consentTick;
      if (write.context.origin === 'public' && given !== undefined && given.table === write.target.table.id) await tick(write, given);
      if (write.context.origin === 'public') {
        for (const text of write.context.textConsentTicks ?? []) if (text.table === write.target.table.id) await textTick(write, text);
      } else {
        await staffTextColumns(write);
      }
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

    async hasTextBoxes(target) {
      if (deps.textBoxesOn === undefined || target.view === undefined) return false;
      return (await deps.textBoxesOn({ connectionId: target.connectionId, view: target.view, tableId: target.table.id })).length > 0;
    },
  };
}
