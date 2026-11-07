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
 *
 * WHICH COPY. An add-on may be installed once per database. The panel is the
 * copy on the record's database (else the one kept once per server): while
 * it is drawn, every call it makes to its add-on's routes names that copy
 * (`X-Adminium-Install`), as a page of one copy does, and its data kit reads
 * that copy's tables.
 */
import { Component, Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RecordPanelProps } from '@adminium/add-on-contracts';
import { Spinner } from '@adminium/ui';

import type { RecordPanelFact } from '../api/pages.js';
import { scopeInstall } from '../app/api.js';
import { addOnsQuery, type AddOnDto } from '../studio/add-ons/addOnsApi.js';
import { t } from '../i18n/t.js';
import { isComponent, loadAddOnModule } from './client.js';
import { AddOnInstallContext, AddOnKeyContext } from './data-kit/context.js';

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

/**
 * The copy of an add-on a record's panel is of: the one on the record's
 * database, else the one kept once per server. With one copy, that one (a
 * server older than this dashboard lists one row per key and says no more).
 */
export function copyForRecord(addOns: readonly AddOnDto[] | undefined, key: string, connectionId: string): AddOnDto | undefined {
  const copies = (addOns ?? []).filter((addOn) => addOn.key === key);
  // One copy: the key's only install, as it always was.
  if (copies.length <= 1) return copies[0];
  return copies.find((copy) => copy.connectionId === connectionId) ?? copies.find((copy) => copy.connectionId === null);
}

/** Names the panel's copy on its add-on's routes while it is drawn; the panel is drawn once the scope is set. */
function InstallScoped({ addOnKey, installId, children }: { addOnKey: string; installId: string | null; children: ReactNode }) {
  const [ready, setReady] = useState(installId === null);
  useLayoutEffect(() => {
    if (installId === null) return undefined;
    const off = scopeInstall(`/api/v1/add-ons/${encodeURIComponent(addOnKey)}`, installId);
    setReady(true);
    return off;
  }, [addOnKey, installId]);
  return ready ? <>{children}</> : null;
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
  const installed = copyForRecord(addOns.data, panel.addOn, connectionId);
  const installId = installed?.installId ?? null;
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
        <InstallScoped addOnKey={panel.addOn} installId={installId}>
          <AddOnKeyContext.Provider value={panel.addOn}>
            <AddOnInstallContext.Provider value={installId}>
              <Panel connectionId={connectionId} table={table} row={recordId} linked={linked} />
            </AddOnInstallContext.Provider>
          </AddOnKeyContext.Provider>
        </InstallScoped>
      </Suspense>
    </PanelBoundary>
  );
}
