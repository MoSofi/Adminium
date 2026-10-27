// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Words and checks the privacy page's tabs share: the https check on the
 * notice's address, what an erasure's "What goes" and "What stays" say, and
 * the refusal when the server's address keys cannot be read.
 */
import { t } from '../../i18n/t.js';
import { isHttpsAddress, type GoesItem, type StaysItem } from './privacyApi.js';

/** The https check the notice's address field shows as it is typed: blank is not refused here (Save stays off instead). */
export function noticeUrlError(value: string): string | null {
  if (value.trim() === '' || isHttpsAddress(value)) return null;
  return t('studio:privacy.notice.httpsOnly', 'Use an https:// address, such as https://www.example.com/privacy.');
}

/** 503 `ADDRESS_KEYS_LOCKED`: the server cannot read its address keys, so it neither searches nor erases. */
export function lockedWords(): string {
  return t('studio:privacy.person.locked', 'This server can’t read its address keys (its secret was changed), so nobody can be found or erased. Ask whoever runs this server.');
}

/**
 * The person's erased address, as typed to confirm: the same address in any
 * case, with spaces around it or not (the server compares the same way).
 */
export function confirmMatches(typed: string, address: string): boolean {
  const want = address.trim().toLowerCase();
  return want !== '' && typed.trim().toLowerCase() === want;
}

/** One "What goes" item, its count first so the number can be set in mono. */
export function goesWords(item: GoesItem): string {
  const label = item.label ?? item.table ?? '';
  const count = item.count;
  switch (item.kind) {
    case 'people':
      return t('studio:privacy.erase.goes.people', '{count, plural, one {# row} other {# rows}} in {label}', { count, label });
    case 'copy':
      return t('studio:privacy.erase.goes.copy', '{count, plural, one {# copy} other {# copies}} in {label}', { count, label });
    case 'outbox':
      return t('studio:privacy.erase.goes.outbox', '{count, plural, one {# e-mail} other {# e-mails}} in {label}', { count, label });
    case 'consent':
      return t('studio:privacy.erase.goes.consent', '{count, plural, one {# consent entry} other {# consent entries}}', { count });
    case 'campaign-mail':
      return t('studio:privacy.erase.goes.campaignMail', '{count, plural, one {# campaign e-mail} other {# campaign e-mails}}', { count });
    case 'files':
      return t('studio:privacy.erase.goes.files', '{count, plural, one {# file} other {# files}}', { count });
  }
}

/** One "What stays" item, and how long it stays (null: as long as its app keeps it). */
export function staysWords(item: StaysItem): { line: string; kept: string | null } {
  const count = item.count ?? 0;
  const label = item.label ?? item.table ?? '';
  const kept = item.forever
    ? t('studio:privacy.erase.stays.forGood', 'Kept for good.')
    : item.keptDays === null
      ? null
      : t('studio:privacy.erase.stays.days', '{count, plural, one {Kept for # day.} other {Kept for # days.}}', { count: item.keptDays });
  switch (item.kind) {
    case 'do-not-email':
      return { line: t('studio:privacy.erase.stays.doNotEmail', 'Their address stays on the do-not-email list as a code, so they’re never e-mailed again.'), kept: null };
    case 'app-rows': {
      const line =
        item.reason === 'health'
          ? t('studio:privacy.erase.stays.lawHealth', '{count, plural, one {# row} other {# rows}} in {label}, because health law needs them.', { count, label })
          : item.reason === 'contract'
            ? t('studio:privacy.erase.stays.lawContract', '{count, plural, one {# row} other {# rows}} in {label}, because a contract needs them.', { count, label })
            : item.reason === 'safety'
              ? t('studio:privacy.erase.stays.lawSafety', '{count, plural, one {# row} other {# rows}} in {label}, because safety law needs them.', { count, label })
              : t('studio:privacy.erase.stays.lawTax', '{count, plural, one {# row} other {# rows}} in {label}, because tax law needs them.', { count, label });
      return { line, kept };
    }
    case 'documents':
      return { line: t('studio:privacy.erase.stays.documents', '{count, plural, one {# document, as it was sent.} other {# documents, as they were sent.}}', { count }), kept };
    case 'invoices':
      return { line: t('studio:privacy.erase.stays.invoices', '{count, plural, one {# invoice, because tax law needs it.} other {# invoices, because tax law needs them.}}', { count }), kept };
    case 'payments':
      return { line: t('studio:privacy.erase.stays.payments', '{count, plural, one {# payment record.} other {# payment records.}}', { count }), kept };
    case 'payment-events':
      return { line: t('studio:privacy.erase.stays.paymentEvents', '{count, plural, one {# message from a payment service.} other {# messages from the payment services.}}', { count }), kept };
    case 'automation-runs':
      return { line: t('studio:privacy.erase.stays.automationRuns', '{count, plural, one {# rule run in the rules’ history.} other {# rule runs in the rules’ history.}}', { count }), kept };
    case 'notifications':
      return { line: t('studio:privacy.erase.stays.notifications', '{count, plural, one {# notification to staff.} other {# notifications to staff.}}', { count }), kept };
    case 'campaign-failures':
      return { line: t('studio:privacy.erase.stays.campaignFailures', '{count, plural, one {# failed campaign send, kept with the campaign’s send log.} other {# failed campaign sends, kept with the campaign’s send log.}}', { count }), kept };
    case 'exports':
      return { line: t('studio:privacy.erase.stays.exports', 'Data exports staff made of a table may hold them, until each one expires.'), kept };
  }
}
