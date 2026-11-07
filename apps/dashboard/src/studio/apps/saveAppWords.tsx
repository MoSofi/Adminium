// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app: the words for what the server's Check list says.
 *
 * The server names every item by a code, its kind, the item's own name and
 * the field, and adds one English sentence. Every code it sends is worded
 * here in every language from those parts alone: a number or a value its
 * English carries beyond them is not said. A code this dashboard does not
 * know yet (a newer server) shows the server's own sentence after the item's
 * name, the way the install review shows the server's words it has no key
 * for. A secret is named by kind, item and field, never by its value: the
 * server never sends one.
 */
import type { ReactNode } from 'react';
import { MonoText } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { workspaceSaveRefusal } from './workspaceFiles/workspaceSaveWords.js';
import type { AnswerChoice, CheckItem, GateProblem } from './saveAppApi.js';

/**
 * A sentence whose named values render in mono (table names, keys,
 * versions), wherever the language puts them.
 */
export function monoSentence(text: (marks: Record<string, string>) => string, values: Record<string, string>): ReactNode {
  const names = Object.keys(values);
  const marks = Object.fromEntries(names.map((name, index) => [name, `\uE000${String(index)}\uE001`]));
  const parts = text(marks).split(/(\uE000\d+\uE001)/);
  return parts.map((part, index) => {
    const match = /^\uE000(\d+)\uE001$/.exec(part);
    if (match === null) return part;
    const name = names[Number(match[1])];
    return <MonoText key={index}>{name === undefined ? '' : values[name]}</MonoText>;
  });
}

/** What kind of thing an item is, as a person names it. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'table':
      return t('studio:saveApp.kind.table', 'Table');
    case 'column':
      return t('studio:saveApp.kind.column', 'Column');
    case 'page':
      return t('studio:saveApp.kind.page', 'Page');
    case 'view':
      return t('studio:saveApp.kind.view', 'Saved view');
    case 'role':
      return t('studio:saveApp.kind.role', 'Role');
    case 'automation':
      return t('studio:saveApp.kind.automation', 'Automation');
    case 'email':
      return t('studio:saveApp.kind.email', 'Email template');
    case 'document':
      return t('studio:saveApp.kind.document', 'Document');
    case 'report':
      return t('studio:saveApp.kind.report', 'Report');
    case 'invoice':
      return t('studio:saveApp.kind.invoice', 'Invoice layout');
    case 'schedule':
      return t('studio:saveApp.kind.schedule', 'Scheduled report');
    case 'public':
      return t('studio:saveApp.kind.public', 'Public access');
    case 'payments':
      return t('studio:saveApp.kind.payments', 'Payments setup');
    case 'rows':
      return t('studio:saveApp.kind.rows', 'Rows');
    case 'add-on':
      return t('studio:saveApp.kind.addOn', 'Add-on');
    case 'option-list':
      return t('studio:saveApp.kind.optionList', 'Option list');
    case 'setting':
      return t('studio:saveApp.kind.setting', 'Setting');
    case 'instance':
      return t('studio:saveApp.kind.instance', 'Look and words');
    case 'file':
      return t('studio:saveApp.kind.file', 'File');
    case 'list':
      return t('studio:saveApp.kind.optionList', 'Option list');
    default:
      return t('studio:saveApp.kind.app', 'App');
  }
}

export function answerLabel(choice: AnswerChoice, item?: Pick<CheckItem, 'code'>): string {
  switch (choice) {
    case 'carry-as-text':
      // A key of several columns is carried as those columns kept unique together, not as text.
      return item?.code === 'COMPOSITE_KEY'
        ? t('studio:saveApp.check.answer.carryKey', 'Keep them unique together')
        : t('studio:saveApp.check.answer.carry', 'Carry as text');
    case 'leave-out':
      return t('studio:saveApp.check.answer.leaveOut', 'Leave it out');
    case 'make-shared':
      return t('studio:saveApp.check.answer.makeShared', 'Make shared');
    case 'clear':
      return t('studio:saveApp.check.answer.clear', 'Clear this field');
    case 'keep':
      return t('studio:saveApp.check.answer.keep', 'It is not a key');
  }
}

/** What an answer does to the file, said once it is given. */
export function answeredSentence(item: CheckItem, choice: AnswerChoice): string {
  switch (choice) {
    case 'clear':
      return t('studio:saveApp.check.done.clear', 'The field will be empty in the file. Nothing on this server changes.');
    case 'leave-out':
      return item.kind === 'column'
        ? t('studio:saveApp.check.done.leaveOutColumn', 'The column is left out of the file. The table on this server is unchanged.')
        : t('studio:saveApp.check.done.leaveOut', 'It is left out of the file. Nothing on this server changes.');
    case 'keep':
      return t('studio:saveApp.check.done.keep', 'Marked as not a key. It goes in as written.');
    case 'carry-as-text':
      return item.code === 'COMPOSITE_KEY'
        ? t('studio:saveApp.check.done.carryKey', 'It goes in with those columns kept unique together, and no key. The table on this server is unchanged.')
        : t('studio:saveApp.check.done.carry', 'It goes in as text. The column on this server is unchanged.');
    case 'make-shared':
      return t('studio:saveApp.check.done.makeShared', 'It goes in as a shared view of the app. Here it stays as it is.');
  }
}

/** `table.column`, or the item alone. */
function placeOf(item: CheckItem): string {
  return item.field === undefined || item.field === '' ? item.item : `${item.item}.${item.field}`;
}

/**
 * The item named the way the list names it, `Kind ‘item’ · field`, then the
 * sentence. The field is shown where it tells the person something (a column,
 * a language, a card's place); a fixed field name of the server's is not.
 */
function named(item: CheckItem, sentence: ReactNode, withField = true): ReactNode {
  return (
    <>
      <span className="font-semibold">{t('studio:saveApp.check.named', '{kind} ‘{item}’', { kind: kindLabel(item.kind), item: item.item })}</span>
      {!withField || item.field === undefined || item.field === '' ? null : (
        <>
          {' · '}
          <MonoText>{item.field}</MonoText>
        </>
      )}
      {' · '}
      {sentence}
    </>
  );
}

/** The sentence for one Check item. */
export function checkSentence(item: CheckItem): ReactNode {
  const kind = kindLabel(item.kind);
  // Table and column names render in mono: `{table}` is the item, `{column}` is `table.column`.
  const db = (text: (marks: Record<string, string>) => string) => monoSentence(text, { table: item.item, column: placeOf(item) });
  // `{column}` alone, where the sentence names its table too.
  const rowsOf = (text: (marks: Record<string, string>) => string) => monoSentence(text, { table: item.item, column: item.field ?? '' });
  switch (item.code) {
    case 'SECRET_FOUND':
      return monoSentence(
        (m) => t('studio:saveApp.check.secret', '{kind} ‘{item}’ · {field} · holds a saved secret of this server.', { kind, item: item.item, field: m['field']! }),
        { field: item.field ?? '' },
      );
    case 'SECRET_LIKELY':
      return monoSentence(
        (m) => t('studio:saveApp.check.secretLikely', '{kind} ‘{item}’ · {field} · looks like a key.', { kind, item: item.item, field: m['field']! }),
        { field: item.field ?? '' },
      );
    case 'TYPE_NO_FORM':
    case 'COMPOSITE_LINK':
      return monoSentence((m) => t('studio:saveApp.check.noType', '{column} has no matching type. Carry it as text, or leave it out.', { column: m['column']! }), {
        column: placeOf(item),
      });
    case 'COLUMN_NAME_NO_FORM':
      return monoSentence((m) => t('studio:saveApp.check.columnName', '{column} has a name an app file cannot hold. Leave it out, or rename it first.', { column: m['column']! }), {
        column: placeOf(item),
      });
    case 'COMPOSITE_KEY':
      return monoSentence(
        (m) => t('studio:saveApp.check.compositeKey', '{table} is keyed by several columns together. Carry them kept unique together, or leave the table out.', { table: m['table']! }),
        { table: item.item },
      );
    case 'PAGE_TABLE_LEFT_OUT':
      return t('studio:saveApp.check.pageTable', '‘{page}’ shows a table that is not in the app. Leave the page out, or put its table in.', { page: item.item });
    case 'PERSONAL_VIEW':
      return t('studio:saveApp.check.personalView', '‘{view}’ is somebody’s own view. Make it a shared view of the app, or leave it out.', { view: item.item });
    case 'EMAIL_NO_ENGLISH':
      // A rule that sends such a mail is asked about too, by the rule's name.
      return item.kind === 'automation'
        ? t('studio:saveApp.check.ruleEmailEnglish', '‘{rule}’ sends a mail with no US English text, which an app’s mail needs. Leave the rule out, or write one first.', { rule: item.item })
        : t('studio:saveApp.check.emailEnglish', '‘{email}’ has no US English text, which an app’s mail needs. Leave it out, or write one first.', { email: item.item });
    case 'RULE_BUILTIN_EMAIL':
      return t('studio:saveApp.check.ruleBuiltinEmail', '‘{rule}’ sends a built-in mail, which is not saved in an app. Leave the rule out, or change it first.', { rule: item.item });
    case 'RULE_APP_EMAIL':
      return t('studio:saveApp.check.ruleAppEmail', '‘{rule}’ sends a mail of an installed app, which is not saved in this one. Leave the rule out, or change it first.', { rule: item.item });
    case 'RULE_TELLS_PEOPLE':
      return t('studio:saveApp.check.ruleTellsPeople', '‘{rule}’ tells people by name, and an app tells roles. Leave it out, or change it to tell a role first.', { rule: item.item });
    case 'RULE_ROLE_LEFT_OUT':
      // Asked when the rule tells no role the app has; said when it only loses some.
      return item.group === 'choice' ? t('studio:saveApp.check.ruleRoles', '‘{rule}’ tells only roles that are not in the app (a built-in role, or one left out). Leave it out, or change it to tell another role first.', { rule: item.item }) : named(item, t('studio:saveApp.info.ruleRole', 'A role this rule tells is not in the app (a built-in role, or one left out), so it is not told.'), false);
    case 'ROWS_PERSONAL_REQUIRED':
      return monoSentence(
        (m) => t('studio:saveApp.check.rowsPersonal', '{column} is personal or looks like a key, and every row needs a value in it. Include its values, or leave the rows of {table} out.', { column: m['column']!, table: m['table']! }),
        { column: placeOf(item), table: item.item },
      );
    case 'ROWS_HIDDEN_REQUIRED':
      return db((m) => t('studio:saveApp.check.rowsHidden', '{column} never travels (a code a shared link opens its row with, or a column your role does not read), and every row needs a value in it. Leave the rows of {table} out.', { column: m['column']!, table: m['table']! }));
    case 'ROWS_REQUIRED_CYCLE':
      return monoSentence(
        (m) => t('studio:saveApp.check.rowsCycle', 'The rows of {table} need rows of another table that need them back. Leave the rows of one of them out.', { table: m['table']! }),
        { table: item.item },
      );
    case 'NO_PAGE':
      return t('studio:saveApp.check.noPage', 'An app needs at least one page. Include a page of this database.');

    // ── After you install ──
    case 'RULE_WEBHOOK':
      return t('studio:saveApp.after.webhook', 'The web address of ‘{rule}’', { rule: item.item });
    case 'RULE_WEBHOOK_HEADER':
      return t('studio:saveApp.after.webhookHeader', 'The header values of ‘{rule}’', { rule: item.item });
    case 'RULE_ADDRESSES':
      return t('studio:saveApp.after.addresses', 'The fixed addresses of ‘{rule}’', { rule: item.item });
    case 'SYSTEM_GRANT':
      return t('studio:saveApp.after.systemGrant', 'The {role} role’s console rights (they never travel)', { role: item.item });
    case 'PAYMENT_KEY':
      return t('studio:saveApp.after.paymentKey', 'The payment keys for {item}', { item: item.item });
    case 'DOCUMENT_RECIPIENT':
      return t('studio:saveApp.after.documentRecipient', 'Who receives ‘{document}’', { document: item.item });
    case 'INSTANCE_EMAIL_SENDER':
      return t('studio:saveApp.after.instanceSender', 'Who the system email ‘{email}’ is sent from', { email: item.item });
    case 'ADD_ON_CREDENTIALS':
      return monoSentence((m) => t('studio:saveApp.after.addOnCredentials', 'The keys and passwords of {addOn}', { addOn: m['addOn']! }), { addOn: item.item });
    case 'ADD_ON_SETTING':
      return monoSentence((m) => t('studio:saveApp.after.addOnSetting', 'The {setting} setting of {addOn}', { setting: m['setting']!, addOn: m['addOn']! }), { setting: item.field ?? '', addOn: item.item });
    case 'BANK_ACCOUNT':
      return t('studio:saveApp.after.bankAccount', 'The bank account a transfer is paid into (paying by transfer stays off until then)');
    case 'CONTACT_LEFT_OUT':
      return t('studio:saveApp.after.contact', 'The contact address and phone of ‘{item}’', { item: item.item });
    case 'PAYMENT_LINES_LEFT_OUT':
      return t('studio:saveApp.after.paymentLines', 'The payment lines (where to pay) of ‘{item}’', { item: item.item });

    // ── Tables and columns ──
    case 'VIEW_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.viewNotCarried', '{table} is a view of the database, not a table: an app makes tables only, so it is left out.', { table: m['table']! }));
    case 'TABLE_NO_COLUMNS':
      return db((m) => t('studio:saveApp.info.tableNoColumns', '{table} has no column an app file can hold, so it is left out.', { table: m['table']! }));
    case 'KEY_FIELD_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.keyFieldNotCarried', 'The column {table} names its rows by is left out, so the target names them its own way.', { table: m['table']! }));
    case 'EXISTING_CUSTOMERS_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.existingCustomers', '{table} lets existing customers get marketing mail. An install never switches that on: whoever sends campaigns there decides it, with their own tick.', { table: m['table']! }));
    case 'KEY_NOT_UNIQUE':
      return db((m) => t('studio:saveApp.info.keyNotUnique', '{table} is carried without its key, and its key columns cannot be kept unique together.', { table: m['table']! }));
    case 'UNIQUE_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.uniqueNotCarried', '{table} keeps some columns unique together in a way an app file cannot hold; the target goes without it.', { table: m['table']! }));
    case 'INDEX_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.indexNotCarried', '{table} has an index an app file cannot hold; the target goes without it.', { table: m['table']! }));
    case 'STATE_ROLE_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.stateRole', 'A move between the states of {table} is kept for a role that is not in the app; it keeps the roles that are, or is left out if none is.', { table: m['table']! }));
    case 'APP_TABLE_RENAMED':
      return db((m) => t('studio:saveApp.info.appTableRenamed', '{table} is an installed app’s table, saved under another name, so the install could not find it.', { table: m['table']! }));
    case 'ENUM_EMPTY_VALUE':
      return db((m) => t('studio:saveApp.info.enumEmpty', '{column} allows an empty answer, which an app file’s choices cannot hold; it is left off the list.', { column: m['column']! }));
    case 'LONG_TEXT':
      return db((m) => t('studio:saveApp.info.longText', '{column} has a length limit an app file does not keep; it travels as text of any length.', { column: m['column']! }));
    case 'TIMESTAMP_ZONE':
      return db((m) => t('studio:saveApp.info.timestampZone', '{column} keeps a time without a zone; an app file makes it a time with a zone.', { column: m['column']! }));
    case 'KEY_NUMBERED':
      return db((m) => t('studio:saveApp.info.keyNumbered', '{column} is a number key the database does not count itself; an install makes it count.', { column: m['column']! }));
    case 'SEMANTIC_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.semanticNotCarried', '{column} was marked as a kind of value an app file cannot name; the target guesses it again.', { column: m['column']! }));
    case 'UNIQUE_TEXT_WIDTH':
      return db((m) => t('studio:saveApp.info.uniqueTextWidth', '{column} is unique and of any length; an app file gives it a length limit so every database can keep it unique.', { column: m['column']! }));
    case 'COLUMN_FIELD_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.columnFieldNotCarried', '{column} keeps a setting here only: an app file cannot hold it as it is.', { column: m['column']! }));
    case 'LINK_REMOVAL_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.linkRemoval', '{column} was taken off a link Adminium guessed; the target guesses its links again.', { column: m['column']! }));
    case 'LINK_TABLE_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.linkTableLeftOut', '{column} links to a table that is not in the app, so it is carried as a plain column.', { column: m['column']! }));
    case 'LINK_NOT_TO_KEY':
      return db((m) => t('studio:saveApp.info.linkNotToKey', '{column} links to a column that is not its table’s one key; an app file links only to a key, so it is carried as a plain column.', { column: m['column']! }));
    case 'DEFAULT_NOT_CARRIED':
      return db((m) => t('studio:saveApp.info.defaultNotCarried', '{column} has a default the database works out; an app file cannot carry it, so the target’s column has none.', { column: m['column']! }));
    case 'RULE_NOT_CARRIED':
      // A column's rule names the column; a table's names a rule or setting, which says nothing to a person.
      return item.kind === 'column'
        ? db((m) => t('studio:saveApp.info.columnRule', '{column} keeps a rule here only: an app file cannot carry it as it is.', { column: m['column']! }))
        : monoSentence((m) => t('studio:saveApp.info.tableRule', '{table} keeps a rule or setting here only: an app file cannot carry it as it is.', { table: m['table']! }), { table: item.item });
    case 'LIST_NOT_CARRIED':
      return named(item, t('studio:saveApp.info.listNotCarried', 'An app file cannot hold this list as it is, so it is left out.'));

    // ── Rows ──
    case 'ROWS_TABLE_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.rowsTableLeftOut', 'The rows of {table} stay behind: the table is not in the app.', { table: m['table']! }));
    case 'ROWS_PRIVATE':
      return db((m) => t('studio:saveApp.info.rowsPrivate', '{table} is private: only the people its rows belong to write it, so it starts empty.', { table: m['table']! }));
    case 'ROWS_VIEW_GONE':
      return db((m) => t('studio:saveApp.info.rowsViewGone', 'The view chosen for {table} is not there any more: its rows are picked in key order.', { table: m['table']! }));
    case 'ROWS_VIEW_UNREAD':
      return db((m) => t('studio:saveApp.info.rowsViewUnread', 'The view chosen for {table} filters in a way the save cannot read: its rows are picked in key order.', { table: m['table']! }));
    case 'ROWS_FIRST':
      return db((m) => t('studio:saveApp.info.rowsFirst', 'Only the first rows of {table} travel. Pick a saved view to choose others.', { table: m['table']! }));
    case 'ROWS_FILES_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.rowsFiles', 'Some files in the rows of {table} stay behind (only pictures travel, and only in sample rows); those cells are empty.', { table: m['table']! }));
    case 'ROWS_BYTES_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.rowsBytes', 'Raw bytes in the rows of {table} cannot travel in an app file; those cells are empty.', { table: m['table']! }));
    case 'ROWS_JSON_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.rowsJson', 'Some json values in the rows of {table} hold keys starting with “@”, which an app file reads as directions; those cells are empty.', { table: m['table']! }));
    case 'ROWS_PERSONAL_EMPTY':
      return db((m) => t('studio:saveApp.info.rowsPersonalEmpty', '{column} holds personal data or looks like a secret: its values stay behind and the rows carry it empty. Tick it to carry them.', { column: m['column']! }));
    case 'ROWS_PERSONAL_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.rowsPersonalLeftOut', '{column} holds personal data or looks like a secret: its values stay behind, and the target fills its default. Tick it to carry them.', { column: m['column']! }));
    case 'ROWS_PEOPLE_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.rowsPeople', '{column} holds or names staff members: people never travel, so the rows carry it empty.', { column: m['column']! }));
    case 'ROWS_CODE_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.rowsCode', '{column} is a code Adminium makes: its values never travel, whatever is ticked, and the target makes new ones.', { column: m['column']! }));
    case 'ROWS_LINK_CODE_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.rowsLinkCode', '{column} is the code a shared link opens its row with: its values never travel, whatever is ticked.', { column: m['column']! }));
    case 'ROWS_UNREADABLE_LEFT_OUT':
      return db((m) => t('studio:saveApp.info.rowsUnreadable', '{column} is not shown to your role: its values never travel, whatever is ticked.', { column: m['column']! }));
    case 'ROWS_PARENT_EMPTY':
      return rowsOf((m) => t('studio:saveApp.info.rowsParentEmpty', 'Some rows of {table} carry {column} empty: the rows it names do not travel with them.', { table: m['table']!, column: m['column']! }));
    case 'ROWS_PARENT_LEFT_OUT':
      return rowsOf((m) => t('studio:saveApp.info.rowsParentLeftOut', 'Some rows of {table} stay behind: they need {column}, and the rows it names do not travel with them.', { table: m['table']!, column: m['column']! }));
    case 'ROWS_CYCLE_EMPTY':
      return rowsOf((m) => t('studio:saveApp.info.rowsCycleEmpty', 'Some sample rows of {table} carry {column} empty: they and the rows they name point at each other, and sample rows are written in one pass.', { table: m['table']!, column: m['column']! }));

    // ── Pages ──
    case 'WIDGET_TABLE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.widgetTable', 'A card reads a table that is not in the app, so the card was left out.'));
    case 'COLUMN_TABLE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.columnTable', 'A column counts rows of a table that is not in the app, so the column was left out.'));
    case 'FORM_FIELD_LEFT_OUT':
      return named(item, t('studio:saveApp.info.formField', 'A form field picks rows of a table that is not in the app, so the field was left out.'));
    case 'PAGE_LINK_LEFT_OUT':
      return named(item, t('studio:saveApp.info.pageLink', 'A link opens a page that is not in the app, so it will lead nowhere there.'));
    case 'INSTANCE_VALUE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.instanceValue', 'An entry names something that exists only on this server (a person, a role, a record of its own), so it was left out.'));
    case 'DESTINATION_LEFT_OUT':
      return named(item, t('studio:saveApp.info.destination', 'Files go to the default storage of the server the app is installed on.'));
    case 'TAB_TABLE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.tabTable', 'A related tab shows a table that is not in the app, so the tab was left out.'), false);
    case 'MEASURE_TABLE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.measureTable', 'A page total adds up a table that is not in the app, so the total was left out.'), false);
    case 'VIEWS_TOO_MANY':
      return named(item, t('studio:saveApp.info.viewsTooMany', 'The page already carries as many views as an app file holds, so this one was left out.'), false);
    case 'PAGE_UNREADABLE':
      return named(item, t('studio:saveApp.info.pageUnreadable', 'The page has no document Adminium can read, so it was left out.'));
    case 'PAGE_DISABLED':
      return named(item, t('studio:saveApp.info.pageDisabled', 'The page is switched off here; it is switched on where the app is installed.'));

    // ── Roles ──
    case 'LIMIT_TABLE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.limitTable', 'A limit names a table that is not in the app, so that part of the limit is left out.'));
    case 'ADD_ON_TABLE_ACTION':
      return named(item, t('studio:saveApp.info.addOnTableAction', 'Export and import on an add-on’s table are not carried; the role gets them by hand.'));
    case 'GRANT_TABLE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.grantTable', 'A grant on a table that is not in the app is left out.'));
    case 'GRANT_PAGE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.grantPage', 'A grant on a page that is not in the app is left out.'));
    case 'ADD_ON_NOT_HERE':
      // A role's grant on an add-on's settings, or an add-on the saved parts name.
      return item.kind === 'role' ? named(item, t('studio:saveApp.info.grantAddOn', 'A grant on the settings of an add-on this database does not have is left out.')) : named(item, t('studio:saveApp.info.addOnNotHere', 'It is named by what is saved but is not installed here, so any version of it is asked for.'));
    case 'APP_SCREENS':
      // The server names the app, or says every app in words of its own.
      return item.field === 'every app' ? named(item, t('studio:saveApp.info.appScreensAll', 'A grant on the screens of every app is not carried.'), false) : named(item, t('studio:saveApp.info.appScreens', 'A grant on another app’s screens is not carried.'));
    case 'SCREENS_ONLY':
      return named(item, t('studio:saveApp.info.screensOnly', 'The app has no screens of its own, so the role opens the dashboard.'));

    // ── Email templates ──
    case 'BUILTIN_EMAIL':
      return named(item, t('studio:saveApp.info.builtinEmail', 'A built-in mail is not saved in an app.'));
    case 'EMAIL_MISSING':
      return named(item, t('studio:saveApp.info.emailMissing', 'This mail has no live text, so it is left out.'));
    case 'EMAIL_NOT_SENT':
      return named(item, t('studio:saveApp.info.emailNotSent', 'No rule of the app sends this mail and it is not a campaign, so it is left out.'));
    case 'EMAIL_NOT_OURS':
      return named(item, t('studio:saveApp.info.emailNotOurs', 'This mail belongs to an installed app, so it is left out.'));
    case 'BUILTIN_EMAIL_EDITED':
      return named(item, t('studio:saveApp.info.builtinEmailEdited', 'An edited built-in mail travels with this server’s look and words, not in this app.'));
    case 'EMAIL_FILE_MISSING':
      return named(item, t('studio:saveApp.info.emailFileMissing', 'A file this mail carries could not be read, so it is left out.'), false);
    case 'EMAIL_FILE_KIND':
      return named(item, t('studio:saveApp.info.emailFileKind', 'A file this mail carries is not a kind an app’s mail may carry, so it is left out.'), false);
    case 'EMAIL_LANGUAGE_EMPTY':
      return named(item, t('studio:saveApp.info.emailLanguageEmpty', 'A language of this mail has no subject or nothing left to send, so that language is left out.'));
    case 'EMAIL_HTML_BLOCK':
      return named(item, t('studio:saveApp.info.emailHtml', 'An app’s mail may not hold an HTML block, so that block is left out.'));
    case 'EMAIL_LIBRARY_PICTURE':
      return named(item, t('studio:saveApp.info.emailLibraryPicture', 'A picture from the Files library does not travel in a mail’s text, so that block is left out.'));
    case 'EMAIL_ROWS_TABLE':
      return named(item, t('studio:saveApp.info.emailRowsTable', 'A block lists the rows of a table that is not in the app, so that block is left out.'));
    case 'EMAIL_BLOCK_STYLE':
      return named(item, t('studio:saveApp.info.emailBlockStyle', 'How some blocks look (their padding, colours and borders) is not saved in an app.'));
    case 'EMAIL_DOCUMENT_ATTACHMENT':
      return named(item, t('studio:saveApp.info.emailDocument', 'A document drawn for each mail is not carried; only files are.'), false);

    // ── Automations ──
    case 'RULE_NO_DATABASE':
      return named(item, t('studio:saveApp.info.ruleNoDatabase', 'This rule is not tied to a database, so it is not saved in an app.'));
    case 'RULE_UNFINISHED':
      return named(item, t('studio:saveApp.info.ruleUnfinished', 'This rule is not finished, so it is left out.'));
    case 'RULES_TOO_MANY':
      return named(item, t('studio:saveApp.info.rulesTooMany', 'The app already carries as many rules as a file holds, so this one is left out.'));
    case 'RULE_TABLE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.ruleTable', 'This rule reads a table that is not in the app, so it is left out.'));
    case 'RULE_EMAIL_LEFT_OUT':
      return named(item, t('studio:saveApp.info.ruleEmailLeftOut', 'This rule sends a mail you left out, so it is left out too.'));
    case 'RULE_STEP_KIND':
      return named(item, t('studio:saveApp.info.ruleStep', 'This rule has a step an app cannot carry, so it is left out.'));
    case 'RULE_DOCUMENT_LEFT_OUT':
      return named(item, t('studio:saveApp.info.ruleDocument', 'This rule draws a document that is not in the app, so it is left out.'));

    // ── Documents ──
    case 'DOCUMENT_TRIGGER_NO_FORM':
      return named(item, t('studio:saveApp.info.documentTrigger', 'What draws it cannot be said in a file: it arrives drawn by hand only.'), false);
    case 'DOCUMENT_OFF':
      return named(item, t('studio:saveApp.info.documentOff', 'It is switched off here, so it is not saved.'));
    case 'DOCUMENT_LEFT_OUT':
    case 'PUBLIC_ENDPOINT_LEFT_OUT':
      return named(item, t('studio:saveApp.info.cannotSay', 'It cannot be said in a file as it is, so it is not saved.'));

    // ── This server's look and words ──
    case 'INSTANCE_OWN_LANGUAGE':
      return named(item, t('studio:saveApp.info.ownLanguage', 'It is a language made here: it is switched on where the app is installed only if that server has it too.'));
    case 'INSTANCE_DEFAULT_OFF':
      return named(item, t('studio:saveApp.info.defaultLanguageOff', 'The language everybody starts in is switched off here, so which language comes first stays out.'), false);
    case 'INSTANCE_LEFT':
      return named(item, t('studio:saveApp.info.instanceLeft', 'A saved app cannot carry this as it is, so it stays out.'), false);
    case 'INSTANCE_WORDS_CUT':
      return t('studio:saveApp.info.wordsCut', 'There are more changed words than a saved app carries: the rest stay out.');
    case 'INSTANCE_EMAIL_HTML':
      return named(item, t('studio:saveApp.info.instanceEmailHtml', 'This system email holds an HTML block, which a saved app cannot carry: it stays out.'), false);
    case 'INSTANCE_EMAIL_LOOK':
      return named(item, t('studio:saveApp.info.instanceEmailLook', 'The look of this system email (its name, mark and colour) stays here: it is sent with the look of the server it is installed on.'), false);
    case 'INSTANCE_EMAIL_STYLE':
      return named(item, t('studio:saveApp.info.instanceEmailStyle', 'The block styles of this system email stay here: its blocks travel in the plain style.'), false);
    case 'INSTANCE_EMAIL_FILES':
      return named(item, t('studio:saveApp.info.instanceEmailFiles', 'What this system email attaches stays as the server it is installed on has it.'), false);
    case 'INSTANCE_SECRET_SETTING':
      return named(item, t('studio:saveApp.info.secretSetting', 'A secret setting never travels: it is set again on the server the app is installed on, if it is needed there.'));
    case 'INSTANCE_NOTHING':
      return t('studio:saveApp.info.instanceNothing', 'Nothing of this server’s look, languages, wording, system emails or settings was changed, so none of it travels.');
    case 'INSTANCE_TICKED':
      return t('studio:saveApp.info.instanceTicked', 'This server’s look, languages, wording, system emails and settings travel. They are written over the server it is installed on only when the person installing ticks them.');
    case 'INSTANCE_PICTURE_LEFT':
      return item.item === 'favicon' ? t('studio:saveApp.info.faviconLeft', 'The browser tab icon could not be carried (it is gone from the Files library, cannot be read, or is not a PNG, JPEG, WebP, GIF or SVG picture), so it stays out.') : t('studio:saveApp.info.logoLeft', 'The logo could not be carried (it is gone from the Files library, cannot be read, or is not a PNG, JPEG, WebP, GIF or SVG picture), so it stays out.');

    // ── Apps and add-ons ──
    case 'APP_FROM_FILE':
      return named(item, t('studio:saveApp.info.appFromFile', 'It was installed from a file. Its tables, pages and rules stay with it; save it again where it was made.'));
    case 'APPS_TOO_MANY':
      return named(item, t('studio:saveApp.info.appsTooMany', 'The file already names as many apps as it can: install this one on the target first.'));
    case 'APP_REQUIRED':
      return named(item, t('studio:saveApp.info.appRequired', 'It must be installed on the target database first, at the version it has here or later.'));
    case 'ADD_ONS_TOO_MANY':
      return named(item, t('studio:saveApp.info.addOnsTooMany', 'The file already names as many add-ons as it can: install this one on the target by hand.'));

    // ── Payments ──
    case 'PAYABLE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.payableLeftOut', 'It is not saved as payable: its table, a column of it, or its set-up cannot travel.'));
    case 'PAYMENT_WAY_NARROWED':
      return named(item, t('studio:saveApp.info.paymentWayNarrowed', 'It is offered here for some payable tables only; after installing it is offered for all of them until that is chosen again.'), false);
    case 'PAY_PAGE_CONTACTS':
      return t('studio:saveApp.info.payPageContacts', 'The pay page’s logo and contact details are not saved: they are set again after installing.');
    case 'PAYMENTS_LEFT_OUT':
      return t('studio:saveApp.info.paymentsLeftOut', 'The payments set-up cannot be said in a file, so it is not saved.');

    // ── Public access ──
    case 'PUBLIC_SCOPE_BY_HAND':
      return named(item, t('studio:saveApp.info.publicScopeByHand', 'A public scope written by hand cannot be said in a file, so it is not saved.'));
    case 'PUBLIC_KEY_LEFT_OUT':
      return named(item, t('studio:saveApp.info.publicKeyLeftOut', 'This key cannot be said in a file as it is, so it is not saved. Make one again after installing if it is needed.'));
    case 'PUBLIC_ENDPOINT_SHARED':
      return named(item, t('studio:saveApp.info.publicShared', 'It is served through another key too, which is not saved that way: after installing it is served through one key only.'));
    case 'PUBLIC_ENDPOINT_UNUSED':
      return named(item, t('studio:saveApp.info.publicUnused', 'No key that is saved serves it, so it is not saved.'));
    case 'PUBLIC_ENDPOINT_NARROWED':
      return named(item, t('studio:saveApp.info.publicNarrowed', 'What strangers may filter, search or sort by is not saved: after installing they may do less here.'));
    case 'PUBLIC_KEYS_NEW':
      return t('studio:saveApp.info.publicKeysNew', 'New keys are made when it is installed: the apps that call it need the new key, and its allowed origins are set again.');

    // ── Reports, invoices and schedules ──
    case 'PICTURE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.pictureLeftOut', 'A picture linked from elsewhere is not saved: put it in again after installing.'), false);
    case 'CUSTOMER_LINES_LEFT_OUT':
      return named(item, t('studio:saveApp.info.customerLines', 'Its example customer and delivery lines are not saved: they may name a real person.'), false);
    case 'SCHEDULE_LEFT_OUT':
      return named(item, t('studio:saveApp.info.scheduleLeftOut', 'The page it reports on is not saved, so it is not saved either.'));

    case 'MIN_VERSION':
      return null;
    default:
      // A code this dashboard does not know yet (a newer server): its own sentence.
      return named(item, item.message);
  }
}

/** Items said together: the senders of several templates are one thing to fill in. */
export function groupedAfter(items: readonly CheckItem[]): { key: string; text: ReactNode }[] {
  const out: { key: string; text: ReactNode }[] = [];
  const senders = items.filter((item) => item.code === 'SENDER');
  const schedules = items.filter((item) => item.code === 'SCHEDULE_RECIPIENTS');
  for (const item of items) {
    if (item.code === 'SENDER' || item.code === 'SCHEDULE_RECIPIENTS') continue;
    out.push({ key: `${item.code}|${item.kind}|${item.item}|${item.field ?? ''}`, text: checkSentence(item) });
  }
  if (senders.length > 0) {
    out.push({
      key: 'SENDER',
      text: t('studio:saveApp.after.senders', '{count, plural, one {The sender address for # email template} other {The sender address for # email templates}}', {
        count: new Set(senders.map((item) => item.item)).size,
      }),
    });
  }
  if (schedules.length > 0) {
    out.push({
      key: 'SCHEDULE_RECIPIENTS',
      text: t('studio:saveApp.after.schedules', '{count, plural, one {Who receives the # scheduled report} other {Who receives the # scheduled reports}}', {
        count: new Set(schedules.map((item) => item.item)).size,
      }),
    });
  }
  return out;
}

/** The information items, with the roles' notes counted as the comp says them. */
export function groupedInfo(items: readonly CheckItem[], tables: number, minVersion: string): { key: string; text: ReactNode }[] {
  const out: { key: string; text: ReactNode }[] = [];
  const widened = items.filter((item) => item.code === 'WILDCARD_NARROWED');
  const builtin = items.filter((item) => item.code === 'BUILTIN_ROLE_CHANGED');
  if (widened.length > 0) {
    out.push({
      key: 'WILDCARD_NARROWED',
      text: t(
        'studio:saveApp.info.wildcard',
        '{roles, plural, one {# role can use every table.} other {# roles can use every table.}} {tables, plural, one {In the app they cover this # table only.} other {In the app they cover these # tables only.}}',
        { roles: new Set(widened.map((item) => item.item)).size, tables },
      ),
    });
  }
  if (builtin.length > 0) {
    out.push({
      key: 'BUILTIN_ROLE_CHANGED',
      text: t('studio:saveApp.info.builtinRoles', '{count, plural, one {The # built-in role stays behind.} other {The # built-in roles stay behind.}}', {
        count: new Set(builtin.map((item) => item.item)).size,
      }),
    });
  }
  for (const item of items) {
    if (item.code === 'WILDCARD_NARROWED' || item.code === 'BUILTIN_ROLE_CHANGED' || item.code === 'MIN_VERSION') continue;
    out.push({ key: `${item.code}|${item.kind}|${item.item}|${item.field ?? ''}`, text: checkSentence(item) });
  }
  out.push({
    key: 'MIN_VERSION',
    text: monoSentence((m) => t('studio:saveApp.info.minVersion', 'Needs Adminium {version} or newer.', { version: m['version']! }), { version: minVersion }),
  });
  return out;
}

/**
 * A refusal of the file itself (a gate's problem), worded from its code. The
 * place in the file it names renders in mono; the server's English is never
 * shown, and a code this dashboard does not know reads as the general refusal.
 */
export function problemSentence(problem: Pick<GateProblem, 'code' | 'path'>): ReactNode {
  const path = problem.path ?? '';
  switch (problem.code) {
    case 'INSTANCE_ID_LEFT':
      return path === ''
        ? t('studio:saveApp.problem.instanceIdNoPlace', 'The file would hold an id of this server, so it cannot be made. Leave out what holds it, then check again.')
        : monoSentence((m) => t('studio:saveApp.problem.instanceId', 'The file would hold an id of this server at {place}, so it cannot be made. Leave out what holds it, then check again.', { place: m['place']! }), { place: path });
    case 'MANIFEST_INVALID':
      return path === ''
        ? t('studio:saveApp.problem.manifestNoPlace', 'The file would not pass the checks every app file meets, so it cannot be made. Leave out what it names, then check again.')
        : monoSentence((m) => t('studio:saveApp.problem.manifest', 'The file would not pass the checks every app file meets at {place}, so it cannot be made. Leave out what it names, then check again.', { place: m['place']! }), { place: path });
    case 'PLAN_REFUSED':
      return path === ''
        ? t('studio:saveApp.problem.planNoPlace', 'Installing the file would be refused, so it cannot be made. Leave out what it names, then check again.')
        : monoSentence((m) => t('studio:saveApp.problem.plan', 'Installing the file would be refused at {place}, so it cannot be made. Leave out what it names, then check again.', { place: m['place']! }), { place: path });
    default:
      return t('studio:saveApp.problem.other', 'The file cannot be made as it is. Leave out what was added last, then check again.');
  }
}

/** The reason code a refusal carries in its details. */
function reasonOfError(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const reason = (error.details as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' ? reason : null;
}

/**
 * A refusal of a save, its check or its download, worded from the reason it
 * carries, else from its error code. The server's English is never shown.
 */
export function saveErrorText(error: unknown): string {
  switch (reasonOfError(error)) {
    case 'SNAPSHOT_MISSING':
      return t('studio:saveApp.error.snapshotMissing', 'This database has not been read yet. Refresh its schema, then save.');
    case 'APP_KEY_SAVED_ELSEWHERE':
      return t('studio:saveApp.error.keyElsewhere', 'An app with this key was saved from another database. Give this app another key.');
    case 'APP_VERSION_SAVED':
      return t('studio:saveApp.error.versionSaved', 'This version was saved before. Save a newer version.');
    case 'APP_VERSION_OLDER':
      return t('studio:saveApp.error.versionOlder', 'A higher version was saved before. Save a version above it.');
    case 'SAVE_INSTANCE_NOT_YOURS':
      return t('studio:saveApp.error.instanceNotYours', 'Saving the look, languages, wording and system emails needs managing settings.');
    case 'SAVE_ROWS_NOT_YOURS':
      return t('studio:saveApp.error.rowsNotYours', 'Saving rows needs reading and exporting the whole table, and personal columns need reading them. Leave out what you may not save.');
    case 'SAVE_FILES_NOT_YOURS':
      return t('studio:saveApp.error.filesNotYours', 'The app carries files from the Files library, and saving them needs managing files.');
    case 'SAVE_TABLE_NOT_YOURS':
      return t('studio:saveApp.error.tableNotYours', 'You may not save a table you cannot read, nor a page or a public endpoint of one. Leave it out, then save again.');
    case 'SAVE_VIEW_NOT_YOURS':
      return t('studio:saveApp.error.viewNotYours', 'You may share only your own views. Leave out a view that is not yours, then save again.');
    case 'SAVE_REFUSED':
      return t('studio:saveApp.error.refused', 'The file cannot be made. Fix what blocks saving in Check, then save again.');
    case 'SAVE_NEEDS_ANSWERS':
      return t('studio:saveApp.error.needsAnswers', 'Something in Check still needs an answer. Answer it, then save again.');
    case 'SAVE_DOWNLOAD_NOT_YOURS':
      return t('studio:saveApp.error.downloadNotYours', 'You may not download this file again: it carries something you do not have the rights for.');
    default:
      break;
  }
  const workspace = workspaceSaveRefusal(reasonOfError(error));
  if (workspace !== null) return workspace;
  const code = error instanceof ApiError ? error.code : error instanceof TypeError ? 'OFFLINE' : null;
  switch (code) {
    case 'FORBIDDEN':
      return t('errors:FORBIDDEN', 'You don’t have permission to do that.');
    case 'NOT_FOUND':
      return t('errors:NOT_FOUND', 'That resource doesn’t exist or was removed.');
    case 'CONFLICT':
      return t('errors:CONFLICT', 'That change conflicts with the current state. Refresh and try again.');
    case 'VALIDATION_FAILED':
      return t('errors:VALIDATION_FAILED', 'Some fields need attention before this can be saved.');
    case 'RATE_LIMITED':
      return t('errors:RATE_LIMITED', 'Too many requests — wait a moment and try again.');
    case 'PAYLOAD_TOO_LARGE':
      return t('errors:PAYLOAD_TOO_LARGE', 'That request is too large.');
    case 'UNAUTHENTICATED':
      return t('errors:UNAUTHENTICATED', 'You need to sign in to continue.');
    case 'SESSION_EXPIRED':
      return t('errors:SESSION_EXPIRED', 'Your session expired. Sign in again to continue.');
    case 'OFFLINE':
      return t('errors:OFFLINE', 'You appear to be offline. Reconnect to continue.');
    default:
      return t('errors:INTERNAL', 'Something went wrong. Share the request id with support.');
  }
}

/** Why "Download again" is off for this person. */
export function notDownloadableText(): string {
  return t('studio:saveApp.saved.notDownloadable', 'Download again is not open to you: its copy is gone, or it carries something you do not have the rights for.');
}
