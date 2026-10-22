// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RULES ADMINIUM READS BUT DOES NOT RUN YET.
 *
 * A manifest may declare a rule before the server that keeps it is built: the
 * words land first, so an app can be written, validated and installed against
 * them, and the rule's behaviour follows. Until it does, a table that carries
 * one refuses every create and change — 501 `RULE_NOT_BUILT {table, rule}` —
 * rather than write rows the rule would have refused: a limit that counts
 * nothing sells what is not there, and a condition that is never checked lets
 * any move through. A delete is let through (it can break no limit), so sample
 * rows and an uninstall still clear up.
 *
 * A public entry that declares such a rule refuses its requests the same way,
 * before anything is read: an entry whose filter is not built yet would
 * otherwise answer as a plain list of the whole table.
 *
 * A WORD OF THE MANIFEST ITSELF may be ahead of the server too: a block an
 * add-on declares, a key of a public entry. A manifest that uses one is
 * refused before anything is made of it — install, update, a folder apply and
 * the folder check all ask `unbuiltInManifest` — with the release that runs
 * the word, so the answer is "needs Adminium <release>", never half an app.
 *
 * Each detector is removed in the change that builds its rule. A release
 * ships with no word it claims to run itself (a test says so).
 */
import { installFloorWords, type ManifestWordName } from '@adminium/manifest';

import { AppError, ValidationFailedError } from '../errors.js';
import type { EffectiveModel, EffectiveTable } from '../connections/effective-schema.js';

export interface UnbuiltTableRule {
  /** The rule's name as the refusal gives it (`capacity`, `states.timed`, …). */
  rule: string;
  /**
   * Whether a write to this table meets the rule: its own stored rules, or
   * (with the model) another table's rule that this table's rows feed.
   */
  on: (table: EffectiveTable, model?: Pick<EffectiveModel, 'tables' | 'relations'>) => boolean;
}

export interface UnbuiltEntryRule {
  rule: string;
  /** Whether this stored public entry (its parsed definition) uses it. */
  on: (entry: Readonly<Record<string, unknown>>) => boolean;
}

export const UNBUILT_TABLE_RULES: readonly UnbuiltTableRule[] = [];

/** The public entry keys whose behaviour is not built yet. */
export const UNBUILT_ENTRY_RULES: readonly UnbuiltEntryRule[] = [];

/**
 * The words of a manifest this server reads and does not run yet, each with
 * the release that runs it. The change that builds a word moves it from here
 * to {@link MANIFEST_WORDS_RUN}: every word the manifest package can name is
 * in one of the two, and a test says so.
 */
export const UNBUILT_MANIFEST_WORDS: Readonly<Partial<Record<ManifestWordName, string>>> = {};

/** The newer words of a manifest this server runs: nothing is refused for using one. */
export const MANIFEST_WORDS_RUN: readonly ManifestWordName[] = [
  // A step an add-on gives to Automations (a named write of one row of its own), and a rule that uses one.
  'addOn.steps',
  'automations.addOnStep',
  // What an add-on tells the assistant: read with the schema, and as starters on its pages.
  'addOn.assistant',
  // What a template writes when a value is missing: a block tied to a value, a backup after a bar. The email renderer's.
  'email.showWhen',
  'placeholder.backup',
  // A phone side: its key is made at install, and its preview built in a project being designed.
  'frontend.mobile',
  // The price question: a host's rule on its orders, and the add-on's side of it. Asked inside every save that moves an order's price.
  'table.adjust',
  'addOn.adjuster',
  // An amount a ledger's action decides (a card pays what is due, as far as it goes): the save answers what it took.
  'ledger.decides',
  // The last four characters of a code, kept beside it: cut by Adminium whenever the code is made.
  'column.codeLast4',
  // A code a ledger's own answer brings on a row it adds (an older card, under the code its holder has): kept as given, after its checks.
  'code.givenByLedger',
  // A column that keeps a table's name: a rename of that table rewrites its rows.
  'column.tableRef',
  // The rows an add-on's tables start with, its one settings row, and an index a table declares over a set of columns.
  'seeds',
  'addOn.settingsTable',
  'table.indexes',
  // What an add-on declares in an app's words and Adminium writes at its install: its tables under its own prefix,
  // its option lists, its generated pages and its section of the rail, its roles (a page of its code is opened only
  // by a role that holds it), the documents its rows print.
  'requiredSchema.prefixed',
  'optionLists',
  'pages',
  'navGroups',
  'roles',
  'documents',
  // An add-on's own sample rows, added to its own tables and taken out again.
  'sampleData',
  // The rows an app ships for an add-on it names: added with the app's sample while that add-on is here for it.
  'sampleData.addOns',
  // The buttons of a record page: which a caller is offered, and a move or a set made through the record's own action.
  'states.actions',
  // One typed code looked up across an add-on's code tables, as the caller reads them.
  'addOn.lookUp',
  // Pages built on the data kit: the dashboard publishes it to a page whose add-on asks for it.
  'addOn.hostApi.2',
  // What a related tab says while it is empty, and whether it offers a new row: carried to the page at install.
  'config.tabs',
  // A list's own bulk action: one row of a child table for each row ticked, offered to who may make it.
  'config.bulk',
  // A board's columns as its page names them: the rows of a table its cards link to, or an enum's values, written to the page at install.
  'config.board',
  // The rules an app or an add-on ships: bound to its install, the owner's once they change one.
  'automations',
  // An add-on's stock words, and a public entry they answer: in, low or out for the rows a page asks about.
  'addOn.words',
  'availability.words',
  // An add-on's rows listed on another table's record page: a tab there, for who reads them.
  'addOn.recordTabs',
  // Two links on a dashboard's toolbar, one of them the page's main action: each drawn for who may open its page.
  'toolbar.links',
  // What an app's role holds of a table of an add-on it names: written while the add-on is there for the app, taken back when it is not.
  'roles.tables',
  // What an add-on lets an app's role hold of its tables: every grant above is cut to it, and a grant on such a table carries its columns.
  'table.appGrants',
  // An update a role's limit lets reach a row only while a column of it holds some value: judged on the stored row.
  'roles.writableFrom',
  // An add-on that may use another (`addOns.suggests`): a document the other draws waits for it, and is mailed without it meanwhile.
  'addOns',
  // A mail block sent only with a value, or only without it; and an add-on's mail that links into a page of the app it serves.
  'email.onlyWith',
  'email.onlyWithout',
  'outbox.pages.app',
  // Rows found by a table and a row: an add-on's rows for an order, listed in mail and in a document.
  'rows.pair',
  // A row opened by its own code: a code of another length is refused before the lookup, and a miss is held against the cards' count.
  'unlockBy.self',
  // An add-on's public entries, served through the key of an app that names it, and its one link key of its own.
  'publicAccess',
  'publicKeys',
  // An add-on's own outbox table and its email templates: sent by the sender that sends an app's.
  'outbox',
  'emailTemplates',
  // A ledger an add-on keeps and the rules that hand rows to it: a save that crosses a rule's point writes the ledger's rows with it.
  // With them: a move only a ledger's own change makes, a cap a row may lift, a total whose change is told after the save.
  'addOn.ledgers',
  'table.postings',
  'states.planned',
  // A move refused once a date of its row has passed: judged under the write's locks, for every writer.
  'states.notPast',
  // A new child row moves its parent by the parent's own listed move (states.ts `moveParentsOnCreate`).
  'states.moveOnCreate',
  // A column a public write fills only with some values of another: asked for then, refused at any other time.
  'publicAccess.requiresWhen',
  'rollup.capUnless',
  'column.announce',
  // A link from a table into an add-on's, judged as it is written; text held to a name or a note; a customer's key made from an address.
  'column.addOnLink',
  // Such a link filled from the settings row's own link when nobody chooses one: left empty while the add-on is away.
  'column.addOnLink.default',
  'column.plainText',
  'column.customerKey',
  // A column that holds a staff member: marked on the column, and what a row's people are read from.
  'column.staff',
  // Text in which people are mentioned: each one named is somebody who signs in, and is told after the save.
  'column.mentions',
  // A position on the map and an area, each in a json column: read, checked and made alike on every write.
  'column.place',
  'column.area',
  // A link that may name only a row meeting some conditions: judged when a write sets or moves it, on every door but an undo.
  'column.linkable',
  // Such a link whose named row must hold what the row written holds: judged also when a write moves what the row's side reads.
  'linkable.same',
  // A column that holds files a signed-in person uploaded: judged by the upload and by every write that names one.
  'column.file',
  // Whose a row is, and a role whose read, update or delete reaches only some rows: the test every read and write of a row carries.
  'table.belongs',
  'roles.rows',
  // Several reaches for one action, any one enough; a listing that counts only while a column of it holds some values:
  // both inside that same test, on every door that carries it.
  'rows.several',
  'listing.while',
  // A record's button that hands its row to anybody a role could not otherwise name.
  'states.handOver',
  // A total that is the newest child row's value, settled by the statement that settles a sum.
  'rollup.latest',
  // Sample data's own people and teams: made as staff who cannot sign in, named by the sample's rows, removed with them.
  'sampleData.people',
  // An app's starting rows (`seeds`): written by its install as an add-on's are, into empty tables only.
  'app.seeds',
  // A row takes a resource for a time: no two overlap, within the resource's hours; held by the lock a booking's write holds.
  'table.occupies',
  // A running number a sample's rows may take: only the check of a sample file reads the mark, the write path already numbers them.
  'sequence.sample',
  // The parts of an app: a switch per part, read wherever something of a part is served or run.
  'app.modules',
  'roles.names',
  // An app that shows maps: its install asks, once for the install, whether they are shown.
  'app.maps',
  // A rule tells the person a staff column of its record names (or of a linked row); nobody there is a line in the run's log.
  'automations.staffRecipient',
  // A row visited once for each spell it matches: kept per rule and row, closed when the row stops matching.
  'automations.perSpell',
  // A notice told at once, also in the reader's quiet hours.
  'automations.urgent',
  // A summary for each person, read as that person when it is sent.
  'automations.digest',
  // A section of one: the rows of the people its reader leads now, a column added up over every row, a line a person, a sum against a target.
  'digest.reach',
  'digest.sum',
  'digest.by',
  'digest.target',
  // A row a step makes, kept in the run's trace for the steps after it.
  'automations.stepName',
  // More than twelve rules in one manifest: each is installed as the first twelve are.
  'automations.many',
  // A reply to the person a staff column names: their sign-in address, looked up when the message goes; nobody there is no header.
  'automations.replyTo',
  'outbox.replyTo',
  // A notice to the people who lead a team of the person a staff column names, who can open the record; roles when there is none.
  'automations.lead',
  // A notice or an e-mail to the people a table lists against the record, of them only who sign in and can open it when it goes (automations/listed-recipients.ts).
  'automations.listed',
  // A person's name read from a staff column in a rule's text and e-mail; the record's address in a rule's e-mail to a person who can open it.
  'automations.staffName',
  'automations.recordUrl',
  // A rule run by a change reads its record as it was: kept with the run for its steps, never served, dropped when it ends.
  'automations.was',
  // An amount of time read from the app's settings row when a scan's or a step's conditions are read.
  'automations.settingAmount',
  // A value a step writes read from the settings row as the rule reads it (a person only while they sign in); a day so many days on, on the business's calendar.
  'automations.settingValue',
  'automations.daysAfter',
  // A person for that staff column when the setting names nobody who signs in: the record's own staff column, or one a link further (record-write.ts).
  'automations.settingElse',
  // A message about a row that was removed, with the row's own values kept for it; a message no longer stops its row being removed.
  'outbox.onDelete',
  // Where a table's record opens on the app's staff side: a notice, its email and a search hit open there (apps/record-address.ts).
  'frontend.records',
  // A page kept off the sidebar, and an entry of the app's section that is not a page: both read when the menu is built.
  'nav.offRail',
  'navLinks',
  // An app's e-mail naming the person a staff column names: their name as the people list gives it, nothing else of them (outbox/sender.ts).
  'outbox.staffName',
  // A dashboard card of a part (hidden while it is off, left out with it), its column headings by language, a link to one staff screen.
  'card.module',
  'card.columnLabels',
  'link.staffPath',
  // Rows read by the people they belong to and by nothing else: not in the view a rule, a public door, a kiosk's key or an owner's
  // code reads through, and refused by name as a file out, a file in, a scheduled report and a document.
  'table.private',
  // A number or a time of day against another column, a span of days, a moment not before now: judged with the dates (write-service `boundIssues`).
  'bounds.other',
  'bounds.now',
  // A stamp no writer gives: dropped from every write, refused on a brought file's line (crud/decide.ts).
  'stamp.strict',
  // A stamp beside `requiredWhen`: a brought line is judged as sent, before stamps (crud/decide.ts `stampLeftOut`).
  'requiredWhen.stamp',
];

export interface UnbuiltWord {
  /** The word as the manifest writes it (`pages`, `column.addOnLink`). */
  word: string;
  /** Dotted path to where the document writes it. */
  path: string;
  /** The release of Adminium that runs it. */
  release: string;
}

/**
 * Every word of a manifest document, of either kind, that this server does
 * not run yet. Pure: no database, no server — the folder check calls it too.
 */
export function unbuiltInManifest(document: unknown, words: Readonly<Record<string, string>> = UNBUILT_MANIFEST_WORDS): UnbuiltWord[] {
  return installFloorWords(document).flatMap((found) => {
    const release = words[found.word];
    return release === undefined ? [] : [{ ...found, release }];
  });
}

/**
 * Refuses a manifest that uses a word this server does not run yet: 422, the
 * same reason an older server gives a newer app, naming the release to move
 * to and each word with its place.
 */
export function refuseUnbuiltManifest(document: unknown, subject: string, serverVersion: string, words?: Readonly<Record<string, string>>): void {
  const found = unbuiltInManifest(document, words);
  if (found.length === 0) return;
  const release = found.map((word) => word.release).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] as string;
  const named = [...new Set(found.map((word) => `"${word.word}"`))].join(', ');
  throw new ValidationFailedError(
    `${subject} uses ${named}, which Adminium ${release} runs and this Adminium ${serverVersion} does not. Take ${found.length === 1 ? 'it' : 'them'} out, or move to Adminium ${release}.`,
    { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: release, serverVersion, words: found },
  );
}

/** 501: the table (or entry) declares a rule this server cannot keep yet. */
export class RuleNotBuiltError extends AppError {
  override readonly name = 'RuleNotBuiltError';

  constructor(table: string, rule: string) {
    super(501, 'RULE_NOT_BUILT', `"${table}" declares a rule this server does not run yet (${rule}), so it takes no writes.`, { table, rule });
  }
}

/** The first rule of this table's that is not built yet, or null. */
export function unbuiltRuleOf(
  table: EffectiveTable | undefined,
  rules: readonly UnbuiltTableRule[] = UNBUILT_TABLE_RULES,
  model?: Pick<EffectiveModel, 'tables' | 'relations'>,
): string | null {
  if (table === undefined) return null;
  return rules.find((candidate) => candidate.on(table, model))?.rule ?? null;
}

/** Throws `RULE_NOT_BUILT` for a table that carries a rule not built yet. */
export function refuseUnbuiltTable(
  target: { table: { id: string; table: EffectiveTable | undefined }; view?: { model: Pick<EffectiveModel, 'tables' | 'relations'> } | undefined },
  rules?: readonly UnbuiltTableRule[],
): void {
  const rule = unbuiltRuleOf(target.table.table, rules, target.view?.model);
  if (rule !== null) throw new RuleNotBuiltError(target.table.id, rule);
}

/** The first rule of this public entry's that is not built yet, or null. */
export function unbuiltEntryRuleOf(
  entry: Readonly<Record<string, unknown>>,
  rules: readonly UnbuiltEntryRule[] = UNBUILT_ENTRY_RULES,
): string | null {
  return rules.find((candidate) => candidate.on(entry))?.rule ?? null;
}
