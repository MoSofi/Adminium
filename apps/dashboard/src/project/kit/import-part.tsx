// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's `ImportWizard`, as code of its own: the dashboard's import wizard
 * with its table already chosen. What a person may import is decided by the
 * server, as on the dashboard's own Import page.
 */

import { useMemo, type ReactNode } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ImportWizardProps } from '@adminium/server/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { ImportWizardPage, type ImportTarget } from '../../data-io/ImportWizardPage.js';
import { connectionForDatabase } from '../bootstrapProject.js';

export default function ImportPart({ database, table, columns }: ImportWizardProps): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const connectionId = connectionForDatabase(bootstrap, database);
  if (connectionId === null) {
    throw new Error(`There is no database "${database}" in adminium.config.ts, or it has no connection yet.`);
  }
  const target = useMemo<ImportTarget>(
    () => ({ connectionId, table, columns: columns.map((column) => ({ key: column.key, ...(column.label === undefined ? {} : { label: column.label }) })) }),
    [connectionId, table, columns],
  );
  return (
    <div className="min-w-0" data-part="kit-import">
      <ImportWizardPage initialTarget={target} />
    </div>
  );
}
