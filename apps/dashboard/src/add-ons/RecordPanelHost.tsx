// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN SCREEN ON A RECORD PAGE (`addOn.panels`).
 *
 * The panel is the add-on's code, drawn in a tab of the record page the way
 * one of its pages is drawn on a page of its own (`AddOnPageHost`): the
 * module is fetched from the panel's own address — which names this record,
 * so the server can ask whether the reader reaches it — and pinned to the
 * fingerprint the add-ons list gives for it; it runs inside its add-on's key
 * (the data kit's hooks read it), behind a boundary that keeps its crash off
 * the page.
 *
 * It is handed the record: the table, the row's key, and the key of the
 * add-on's row this record links to (null when the link is empty). A panel
 * the list names no file for — its reader lacks the panel's permission, or
 * the package ships none — draws nothing at all, never an error: a package
 * may declare a screen and not ship it yet.
 */
import { Component, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RecordPanelProps } from '@adminium/add-on-contracts';
import { Spinner } from '@adminium/ui';

import type { RecordPanelFact } from '../api/pages.js';
import { addOnsQuery } from '../studio/add-ons/addOnsApi.js';
import { t } from '../i18n/t.js';
import { isComponent, loadAddOnModule } from './client.js';
import { AddOnKeyContext } from './data-kit/context.js';

type PanelComponent = (props: RecordPanelProps) => ReactNode;

/** A panel's own crash, kept off the record page. */
class PanelBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

/** The address of a panel's code for one record: the list's own address, with the record it is drawn on. */
export function panelUrl(base: string, record: { connectionId: string; table: string; row: string }): string {
  const query = new URLSearchParams({ connection: record.connectionId, table: record.table, row: record.row });
  return `${base}?${query.toString()}`;
}

export interface RecordPanelHostProps {
  panel: RecordPanelFact;
  connectionId: string;
  table: string;
  recordId: string;
  /** The record as the page holds it: the linked row's key is read from the panel's link column. */
  row: Readonly<Record<string, unknown>> | null;
}

export default function RecordPanelHost({ panel, connectionId, table, recordId, row }: RecordPanelHostProps) {
  const addOns = useQuery(addOnsQuery);
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; Component: PanelComponent } | { status: 'failed' }>({ status: 'loading' });
  const installed = addOns.data?.find((addOn) => addOn.key === panel.addOn);
  const bundle = installed?.bundles.find((file) => file.panel === panel.id);
  const url = bundle === undefined ? undefined : panelUrl(bundle.url, { connectionId, table, row: recordId });

  useEffect(() => {
    if (bundle === undefined || url === undefined) return;
    let alive = true;
    setState({ status: 'loading' });
    loadAddOnModule({ url, integrity: bundle.integrity, hostApi: installed?.hostApi }).then(
      (value) => {
        if (alive) setState(isComponent(value) ? { status: 'ready', Component: value as PanelComponent } : { status: 'failed' });
      },
      () => {
        if (alive) setState({ status: 'failed' });
      },
    );
    return () => {
      alive = false;
    };
  }, [url, bundle?.integrity, installed?.hostApi]);

  // No file named for this panel: nothing is drawn (see the header).
  if (addOns.isPending || bundle === undefined) return null;
  if (state.status === 'failed') {
    return <p className="text-sm text-fg-muted">{t('ui:pages.record.panelFailed', 'This panel could not be loaded. Nothing from it has been run.')}</p>;
  }
  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  const linkedValue = row?.[panel.column];
  const linked = linkedValue === null || linkedValue === undefined || linkedValue === '' ? null : String(linkedValue);
  const Panel = state.Component;
  return (
    <PanelBoundary onError={() => setState({ status: 'failed' })}>
      <Suspense
        fallback={
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        }
      >
        <AddOnKeyContext.Provider value={panel.addOn}>
          <Panel connectionId={connectionId} table={table} row={recordId} linked={linked} />
        </AddOnKeyContext.Provider>
      </Suspense>
    </PanelBoundary>
  );
}
