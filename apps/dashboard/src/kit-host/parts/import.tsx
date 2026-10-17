// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The import wizard, mounted on an app's own screen.
 *
 * It is the dashboard's own wizard (`data-io/ImportWizard.tsx`, the very
 * component its Import page draws): paste rows or drop a file, map the
 * columns, see what the import would do with each line (new, already here,
 * refused), run it, read what it did. What the dashboard gives the wizard
 * from its session, the app gives here as props.
 *
 * The app says which table (or the few a person may pick from), with the
 * columns a file's columns can go to. The dashboard reads those from a page
 * of its own; an app's screen has no such page, and somebody whose role opens
 * only the app's screens could not read one.
 *
 * The part talks to this Adminium itself, with the person's own session and
 * the token the app hands over (`csrfToken`), or through the app's own
 * `fetch`. Every door it calls checks the person's rights on the table, and
 * what a door refuses is said in the wizard, in the reader's words: no right
 * to import, none to read what is matched against, none to update, a paste
 * that is too large. The page is never left blank.
 *
 * `update` changes the props of the wizard that is there: what was pasted,
 * the mapping and the step the person is on stay. Picking another table
 * starts over, since nothing of one table's mapping is another's.
 */
import { useMaybeT } from '@adminium/i18n/react';
import { Select } from '@adminium/ui';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { ImportWizard, type ImportTarget } from '../../data-io/ImportWizard.js';
import type { ImportProps, KitMounted } from '../contract.js';
import { importClient } from '../import-client.js';
import { mountReact } from '../root.js';

import './import.css';

function KitImport({ props }: { props: ImportProps }): ReactNode {
  const t = useMaybeT();
  const pickerId = useId();
  const headingId = useId();
  // What the app last gave, for the calls made later: a new token or a new fetch is used by the next one.
  const latest = useRef(props);
  latest.current = props;
  const client = useMemo(
    () =>
      importClient(
        () => latest.current.csrfToken,
        () => latest.current.fetch,
      ),
    [],
  );

  const [picked, setPicked] = useState(props.tables[0]?.table ?? '');
  const table = props.tables.find((one) => one.table === picked) ?? props.tables[0];
  // The table as text: a new list from the app that says the same table is the same target, and the mapping stays.
  const tableKey = table === undefined ? '' : JSON.stringify([props.connectionId, table.table, table.columns]);
  const target = useMemo<ImportTarget | null>(() => {
    if (tableKey === '') return null;
    const [connectionId, name, columns] = JSON.parse(tableKey) as [string, string, { key: string; label?: string; unique?: boolean }[]];
    return { connectionId, table: name, columns: columns.map(({ key, label }) => (label === undefined ? { key } : { key, label })) };
  }, [tableKey]);
  // Where the app marked columns no two rows share, lines are matched on those and on no other.
  const matchColumns = useMemo(() => {
    if (tableKey === '') return undefined;
    const unique = (JSON.parse(tableKey) as [string, string, { key: string; unique?: boolean }[]])[2].filter((column) => column.unique === true).map((column) => column.key);
    return unique.length === 0 ? undefined : unique;
  }, [tableKey]);
  const modesKey = (props.modes ?? []).join(',');
  const modes = useMemo(() => (modesKey === '' ? undefined : modesKey.split(',').map((mode) => (mode === 'update' ? ('upsert' as const) : ('skip' as const)))), [modesKey]);
  const sourcesKey = (props.sources ?? []).join(',');
  const sources = useMemo(() => (sourcesKey === '' ? undefined : (sourcesKey.split(',') as ('paste' | 'file')[])), [sourcesKey]);

  const named = props.title !== undefined ? { role: 'group', 'aria-labelledby': headingId } : props.ariaLabel !== undefined ? { role: 'group', 'aria-label': props.ariaLabel } : {};

  return (
    <div className="adm-kit-import" data-part="kit-import" {...named}>
      {props.title === undefined ? null : (
        <h2 id={headingId} className="adm-kit-import-title">
          {props.title}
        </h2>
      )}
      <ImportWizard
        // Another table is another import from its first step.
        key={table?.table ?? ''}
        client={client}
        t={t}
        target={target}
        targetName={table?.label ?? ''}
        {...(table?.matchOn === undefined ? {} : { matchOn: table.matchOn })}
        {...(matchColumns === undefined ? {} : { matchColumns })}
        {...(modes === undefined ? {} : { modes })}
        {...(sources === undefined ? {} : { sources })}
        onDone={(result) => latest.current.onDone?.(result)}
        {...(props.onClose === undefined ? {} : { onClose: () => latest.current.onClose?.() })}
        // One table: the person is not asked. Several: they pick, by the names the app gave.
        {...(props.tables.length < 2
          ? {}
          : {
              targetPicker: (
                <div className="adm-kit-field adm-kit-import-table">
                  <label className="adm-kit-label" htmlFor={pickerId}>
                    {t('dataio:import.targetLabel', 'Target table')}
                  </label>
                  <Select id={pickerId} data-testid="import-target" value={table?.table ?? ''} onChange={(event) => setPicked(event.currentTarget.value)}>
                    {props.tables.map((one) => (
                      <option key={one.table} value={one.table}>
                        {one.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ),
            })}
      />
    </div>
  );
}

export default function mountImport(element: Element, props: ImportProps): Promise<KitMounted<ImportProps>> {
  return mountReact<ImportProps>('import', element, props, (now) => <KitImport props={now} />);
}
