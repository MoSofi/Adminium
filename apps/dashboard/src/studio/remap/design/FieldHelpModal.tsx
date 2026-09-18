// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plain-language help for the column switches.
 *
 * ─── Who this is for ───────────────────────────────────────────────────────
 *
 * Somebody who knows their business and not their database. "Required",
 * "Unique" and "Primary key" are three words that sound similar, do different
 * things, and are impossible to guess between — and getting Primary key wrong
 * is not cosmetic: a table without one is read-only in the generated app, and
 * a table with the wrong one cannot be edited row by row.
 *
 * So the copy here describes CONSEQUENCES in the operator's terms ("two
 * customers could not share an email address"), not definitions in the
 * database's ("enforces a UNIQUE constraint"). The one place a technical term
 * appears is where the operator will meet it again in the SQL preview.
 */
import { Modal, ModalBody, ModalHeader } from '@adminium/ui';

import { t } from '../../../i18n/t.js';

export interface FieldHelpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Entry {
  term: string;
  what: string;
  example: string;
}

export function FieldHelpModal({ open, onOpenChange }: FieldHelpModalProps) {
  const entries: Entry[] = [
    {
      term: t('studio:design.help.type.term', 'Type'),
      what: t(
        'studio:design.help.type.what',
        'What kind of information the field holds — words, whole numbers, money, a date, a yes/no answer. Picking the right one is what lets Adminium show a date picker instead of a text box, and add up a column of money.',
      ),
      example: t(
        'studio:design.help.type.example',
        'A phone number is usually text, not a number — numbers drop leading zeros.',
      ),
    },
    {
      term: t('studio:design.help.required.term', 'Required'),
      what: t(
        'studio:design.help.required.what',
        'The field must be filled in. A row cannot be saved while it is empty.',
      ),
      example: t(
        'studio:design.help.required.example',
        'An order needs a customer, so that field is required. A delivery note is optional, so it is not.',
      ),
    },
    {
      term: t('studio:design.help.unique.term', 'Unique'),
      what: t(
        'studio:design.help.unique.what',
        'No two rows may hold the same value. The database refuses the second one.',
      ),
      example: t(
        'studio:design.help.unique.example',
        'Two customers should not share an email address — mark it unique and they cannot.',
      ),
    },
    {
      term: t('studio:design.help.primaryKey.term', 'Primary key'),
      what: t(
        'studio:design.help.primaryKey.what',
        'The field that identifies each row — the one Adminium uses to tell one row from another. Every table should have exactly one, and it is almost always the "id" field created for you.',
      ),
      example: t(
        'studio:design.help.primaryKey.example',
        'Without a primary key, Adminium can list the rows but cannot edit or delete an individual one.',
      ),
    },
    {
      term: t('studio:design.help.default.term', 'Starts as'),
      what: t(
        'studio:design.help.default.what',
        'What the field holds when nobody fills it in. The database puts the value there itself, so it is also what fills the field for rows created outside Adminium.',
      ),
      example: t(
        'studio:design.help.default.example',
        'A "created at" field that starts as the current date and time never has to be typed, and cannot be wrong.',
      ),
    },
    {
      term: t('studio:design.help.values.term', 'Allowed values'),
      what: t(
        'studio:design.help.values.what',
        'The complete list of answers this field accepts. The database refuses anything else, and Adminium shows the list as buttons or a menu instead of a text box.',
      ),
      example: t(
        'studio:design.help.values.example',
        'A status of new, in progress or done. Nobody can type "in-progres" and create a fourth status by accident.',
      ),
    },
    {
      term: t('studio:design.help.keyGeneration.term', 'How the key is filled'),
      what: t(
        'studio:design.help.keyGeneration.what',
        'Where each row’s id comes from. Counting up from the last row gives 1, 2, 3 and is what most tables want; a unique id is a long random one, which is harder to guess and harder to read out loud.',
      ),
      example: t(
        'studio:design.help.keyGeneration.example',
        'Only PostgreSQL can generate a unique id and hand it straight back, so on the other engines the key counts up.',
      ),
    },
    {
      term: t('studio:design.help.link.term', 'Link to another table'),
      what: t(
        'studio:design.help.link.what',
        'Connects this row to a row in another table, and asks the database to keep the connection honest — you cannot point at something that is not there.',
      ),
      example: t(
        'studio:design.help.link.example',
        'A reservation links to a client. Adminium then shows the client on the reservation, and the reservations on the client.',
      ),
    },
  ];

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="md">
      <ModalHeader
        title={t('studio:design.help.title', 'What these fields mean')}
        subtitle={t(
          'studio:design.help.subtitle',
          'Plain-language descriptions of each setting, and what it changes for the people using your app.',
        )}
        closeLabel={t('studio:design.help.close', 'Close')}
      />
      <ModalBody>
        <dl className="flex flex-col gap-4">
          {entries.map((entry) => (
            <div key={entry.term} className="flex flex-col gap-1">
              <dt className="text-body font-medium text-fg">{entry.term}</dt>
              <dd className="flex flex-col gap-1">
                <span className="text-body text-fg-muted">{entry.what}</span>
                <span className="text-caption text-fg-subtle">{entry.example}</span>
              </dd>
            </div>
          ))}
        </dl>
      </ModalBody>
    </Modal>
  );
}
