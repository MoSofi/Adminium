// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Signed copy waits for an update of Invoices & Receipts." — said on the
 * install's done screen and under an update's notice, for each of the app's
 * documents whose add-on is attached and does not draw its kind yet. The
 * install and the update went through; the document (and the email
 * attachment made of it) comes with the add-on's next version, with no step
 * of the app's.
 */
import { Alert } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { DocumentsWaiting } from './appsApi.js';

export function DocumentsWaitingNotice({ waiting }: { waiting: DocumentsWaiting['waiting'] | undefined }) {
  if (waiting === undefined || waiting.length === 0) return null;
  return (
    <Alert
      data-part="documents-waiting"
      tone="info"
      title={t('studio:appDocuments.waiting.title', '{count, plural, one {A document waits for an add-on update} other {# documents wait for an add-on update}}', {
        count: waiting.length,
      })}
    >
      <ul className="list-disc ps-5">
        {waiting.map((entry) => (
          <li key={`${entry.table}:${entry.kind}`}>
            {t('studio:appDocuments.waiting.item', '{document}: {addOn} does not draw it yet. It is made when {addOn} is updated.', {
              document: entry.name,
              addOn: entry.addOnName,
            })}
          </li>
        ))}
      </ul>
    </Alert>
  );
}
