// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app: the words for what the server's Check list says.
 *
 * The server names every item by a code, its kind, the item's own name and
 * the field, and adds one English sentence. The codes a person acts on, and
 * the ones the comp draws, are worded here in every language from those
 * parts; any other code shows the server's own sentence after the item's
 * name, the way the install review shows the server's words it has no key
 * for. A secret is named by kind, item and field, never by its value: the
 * server never sends one.
 */
import type { ReactNode } from 'react';
import { MonoText } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { AnswerChoice, CheckItem } from './saveAppApi.js';

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

/** The sentence for one Check item. */
export function checkSentence(item: CheckItem): ReactNode {
  const kind = kindLabel(item.kind);
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
    case 'EMAIL_NO_ENGLISH':
      return t('studio:saveApp.check.emailEnglish', '‘{email}’ has no US English text, which an app’s mail needs. Leave it out, or write one first.', { email: item.item });
    case 'ROWS_PERSONAL_REQUIRED':
      return monoSentence(
        (m) => t('studio:saveApp.check.rowsPersonal', '{column} is personal or looks like a key, and every row needs a value in it. Include its values, or leave the rows of {table} out.', { column: m['column']!, table: m['table']! }),
        { column: placeOf(item), table: item.item },
      );
    case 'ROWS_REQUIRED_CYCLE':
      return monoSentence(
        (m) => t('studio:saveApp.check.rowsCycle', 'The rows of {table} need rows of another table that need them back. Leave the rows of one of them out.', { table: m['table']! }),
        { table: item.item },
      );
    case 'NO_PAGE':
      return t('studio:saveApp.check.noPage', 'An app needs at least one page. Include a page of this database.');
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
    case 'MIN_VERSION':
      return null;
    default:
      return (
        <>
          <span className="font-semibold">
            {kind} ‘{item.item}’
          </span>
          {item.field === undefined || item.field === '' ? null : (
            <>
              {' · '}
              <MonoText>{item.field}</MonoText>
            </>
          )}
          {' · '}
          {item.message}
        </>
      );
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
