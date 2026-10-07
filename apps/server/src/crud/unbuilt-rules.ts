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

export const UNBUILT_TABLE_RULES: readonly UnbuiltTableRule[] = [
  // A price rule: the order's table, and each child table whose rows are its lines, its codes or its refunds.
  // Written unpriced, an order would be saved at full price with a code on it and nobody told.
  {
    rule: 'adjust',
    on: (table, model) =>
      table.adjust !== undefined ||
      (model?.tables ?? []).some((order) => {
        const adjust = order.adjust;
        if (adjust === undefined) return false;
        return adjust.lines.some((part) => !('self' in part) && part.table === table.id) || adjust.codes?.table === table.id || adjust.refunds?.table === table.id;
      }),
  },
];

/** The public entry keys whose behaviour is not built yet. */
export const UNBUILT_ENTRY_RULES: readonly UnbuiltEntryRule[] = [];

/** The release that asks an add-on what an order's price is lowered by. */
const PRICE_QUESTION_RELEASE = '0.3.19';

/**
 * The words of a manifest this server reads and does not run yet, each with
 * the release that runs it. The change that builds a word moves it from here
 * to {@link MANIFEST_WORDS_RUN}: every word the manifest package can name is
 * in one of the two, and a test says so.
 */
export const UNBUILT_MANIFEST_WORDS: Readonly<Partial<Record<ManifestWordName, string>>> = {
  // The last four characters of a code, kept beside it: its first user is a card, which comes with the price question.
  'column.codeLast4': PRICE_QUESTION_RELEASE,
  // The price question: a host's rule, the add-on's side of it, and an amount a ledger's action decides.
  'table.adjust': PRICE_QUESTION_RELEASE,
  'addOn.adjuster': PRICE_QUESTION_RELEASE,
  'ledger.decides': PRICE_QUESTION_RELEASE,
};

/** The newer words of a manifest this server runs: nothing is refused for using one. */
export const MANIFEST_WORDS_RUN: readonly ManifestWordName[] = [
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
  'rollup.capUnless',
  'column.announce',
  // A link from a table into an add-on's, judged as it is written; text held to a name or a note; a customer's key made from an address.
  'column.addOnLink',
  'column.plainText',
  'column.customerKey',
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
