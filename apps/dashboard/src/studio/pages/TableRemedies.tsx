// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Everything the page screens offer about the TABLE a page is built from,
 * in one place, so the create screen and the edit screen cannot drift:
 *
 *   - no table yet → "start a new table for this page" (remedy 4), opened by
 *     itself when the connection has nothing to pick;
 *   - a table that cannot back the template → the fit panel and its remedies;
 *   - a linked table chosen through a key (remedy 2) → what that means, and a
 *     way back to the table the operator picked.
 *
 * The screens keep the STATE (table, the related choice) because it is part
 * of what they save; this component only renders it and reports choices.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { FitTableSetup } from './FitTableSetup.js';
import { newTableDraftQuery, type RelatedTableDto } from './fitApi.js';
import { TemplateFitPanel } from './TemplateFitPanel.js';

/** A page bound to a linked table, titled through its key (remedy 2). */
export interface RelatedChoice {
  /** The table the operator picked, which the page is titled from. */
  from: string;
  offer: RelatedTableDto;
}

export interface TableRemediesProps {
  connectionId: string;
  template: string;
  table: string | null;
  related: RelatedChoice | null;
  /** The connection has no table to pick — the new-table entry opens itself. */
  noTables: boolean;
  /** Bind to this table (or none), dropping any related choice. */
  onChooseTable: (table: string | null) => void;
  onChooseRelated: (choice: RelatedChoice) => void;
}

export function TableRemedies({
  connectionId,
  template,
  table,
  related,
  noTables,
  onChooseTable,
  onChooseRelated,
}: TableRemediesProps) {
  const [startNew, setStartNew] = useState(false);

  // Whether this template can be given a table of its own. The same key
  // `FitTableSetup` asks first, so opening the entry reuses this reply; a null
  // draft is the engine saying the template has no repair descriptors, and the
  // entry is then not offered at all rather than offered and empty.
  const draftProbe = useQuery(
    newTableDraftQuery({
      connectionId,
      template,
      name: null,
      people: null,
      enabled: table === null,
    }),
  );

  if (table === null) {
    if (draftProbe.data === undefined || draftProbe.data === null) return null;
    return startNew || noTables ? (
      <FitTableSetup
        connectionId={connectionId}
        template={template}
        showRefusal
        onCreated={(next) => {
          onChooseTable(next);
          setStartNew(false);
        }}
      />
    ) : (
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStartNew(true)}
          data-testid="studio-pages-create-new-table"
        >
          {t('studio:pages.fit.table.open', 'Or start a new table for this page')}
        </Button>
      </div>
    );
  }

  if (related !== null) {
    return (
      <Alert
        tone="info"
        role="status"
        data-testid="studio-pages-fit-related-chosen"
        title={t(
          'studio:pages.fit.related.chosen',
          'Built on {table}, each entry titled with “{title}” from {from}',
          {
            table: related.offer.label ?? related.offer.tableId,
            title: related.offer.titleColumn,
            from: related.from,
          },
        )}
        body={
          <Button
            variant="ghost"
            size="sm"
            data-testid="studio-pages-fit-related-undo"
            onClick={() => onChooseTable(related.from)}
          >
            {t('studio:pages.fit.related.undo', 'Go back to {table}', { table: related.from })}
          </Button>
        }
      />
    );
  }

  return (
    <TemplateFitPanel
      connectionId={connectionId}
      table={table}
      template={template}
      onUseTable={onChooseTable}
      onUseRelated={(offer) => onChooseRelated({ from: table, offer })}
    />
  );
}
