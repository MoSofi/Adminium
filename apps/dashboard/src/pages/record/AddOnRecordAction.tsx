// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S ACTION ON A RECORD PAGE (`record.actions`, drawn by Adminium).
 *
 * A button beside Edit, in the add-on's own words and icon, offered by the
 * server only on a table of the kind the fill names (a companies table) and
 * only to a reader who may change it (`GET /pages/:id` · `recordActions`). It
 * opens a side sheet from the inline-end edge (full width on a phone) that
 * holds the add-on's code for it:
 *
 *  - the fill's file, as the add-ons list names it with its fingerprint,
 *    loaded the way the settings panel's fill is (`loadAddOnNamespace`: the
 *    browser checks the bytes before it runs them), and its `register()`'s
 *    `record.actions` fill drawn with `render(props)`;
 *  - handed exactly {@link RecordActionProps}: the table as the add-on's
 *    tables name it, the row's key, the row as the reader sees it, what the
 *    reader may do to it, and a way to close the sheet;
 *  - inside its add-on's key and copy, so its data kit reads that copy's
 *    tables and every call to its add-on's routes, and to the engine's routes
 *    for this kind of table (`/api/v1/leads/<key>`), names the copy on the
 *    record's database;
 *  - behind a boundary: code that cannot be loaded, or that throws, says so
 *    in a sentence and has run nothing more.
 *
 * Focus is held in the sheet while it is open (a dialog) and goes back to the
 * button when it closes. Closing it re-reads the record, so what the fill
 * wrote shows at once.
 */
import { Component, Suspense, useEffect, useId, useLayoutEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { RecordActionProps } from '@adminium/add-on-contracts';
import { Button, Drawer, DrawerClose, DrawerTitle, DrawerTrigger, Spinner } from '@adminium/ui';

import { scopeInstall } from '../../app/api.js';
import type { RecordActionFact } from '../../api/pages.js';
import { InstallScoped } from '../../add-ons/InstallScoped.js';
import { loadAddOnNamespace } from '../../add-ons/client.js';
import { AddOnInstallContext, AddOnKeyContext } from '../../add-ons/data-kit/context.js';
import { addOnWords } from '../../add-ons/messages.js';
import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';
import { addOnsQuery, type AddOnDto } from '../../studio/add-ons/addOnsApi.js';

/** The slot the fill fills. */
export const RECORD_ACTIONS_SLOT = 'record.actions';

/** What a module's `register()` hands back for this slot: a fill drawn with the props. */
interface ActionFill {
  slot: string;
  /** The kind of table the fill acts on, as the manifest's `on` names it (`kind` in the add-ons' own host types). */
  on?: string;
  kind?: string;
  render: (props: RecordActionProps) => ReactNode;
}

type FillState = { status: 'loading' } | { status: 'ready'; fill: ActionFill } | { status: 'failed' };

/**
 * The `record.actions` fill of a module's `register()` for a kind of table:
 * the one that names that kind (`on` or `kind`), else one that names none.
 */
export function actionFillOf(namespace: Record<string, unknown> | null, kind: string): ActionFill | null {
  const register = namespace?.['register'];
  if (typeof register !== 'function') return null;
  const registered = (register as () => unknown)() as { fills?: unknown } | null;
  const fills = (Array.isArray(registered?.fills) ? (registered.fills as unknown[]) : []).filter(
    (one): one is ActionFill => typeof one === 'object' && one !== null && (one as ActionFill).slot === RECORD_ACTIONS_SLOT && typeof (one as ActionFill).render === 'function',
  );
  const kindOf = (one: ActionFill): string | undefined => one.on ?? one.kind;
  return fills.find((one) => kindOf(one) === kind) ?? fills.find((one) => kindOf(one) === undefined) ?? null;
}

/** The add-on's copy whose code is drawn, and the file of its fill, as the add-ons list names them to this reader. */
export function actionBundle(addOns: readonly AddOnDto[] | undefined, action: Pick<RecordActionFact, 'addOn' | 'installId' | 'client'>): { addOn: AddOnDto; bundle: AddOnDto['bundles'][number] } | null {
  const copy = (addOns ?? []).find((one) => one.key === action.addOn && (one.installId === undefined || one.installId === action.installId));
  const bundle = copy?.bundles.find((file) => file.path === action.client && file.ref === undefined && file.panel === undefined);
  return copy === undefined || bundle === undefined ? null : { addOn: copy, bundle };
}

/** The fill's own crash, kept off the page. */
class FillBoundary extends Component<{ children: ReactNode; onError: () => void }, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

/** While the sheet is open, the engine's routes for this kind of table name the add-on's copy too. */
function KindScoped({ addOnKey, installId, children }: { addOnKey: string; installId: string; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const off = scopeInstall(`/api/v1/leads/${encodeURIComponent(addOnKey)}`, installId);
    setReady(true);
    return off;
  }, [addOnKey, installId]);
  return ready ? <>{children}</> : null;
}

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Spinner />
    </div>
  );
}

/** The sheet's content: the fill's code, loaded once the sheet opens. */
function ActionFillHost({ action, props }: { action: RecordActionFact; props: RecordActionProps }) {
  const addOns = useQuery(addOnsQuery);
  const found = actionBundle(addOns.data, action);
  const [state, setState] = useState<FillState>({ status: 'loading' });

  useEffect(() => {
    if (found === null) return;
    let alive = true;
    setState({ status: 'loading' });
    loadAddOnNamespace({ url: found.bundle.url, integrity: found.bundle.integrity, hostApi: found.addOn.hostApi }).then(
      (namespace) => {
        if (!alive) return;
        const fill = actionFillOf(namespace, action.kind);
        setState(fill === null ? { status: 'failed' } : { status: 'ready', fill });
      },
      () => {
        if (alive) setState({ status: 'failed' });
      },
    );
    return () => {
      alive = false;
    };
  }, [found?.bundle.url, found?.bundle.integrity, found?.addOn.hostApi, action.kind]);

  if (addOns.isPending) return <Loading />;
  if (found === null || state.status === 'failed') {
    return (
      <p role="alert" className="px-5 py-4 text-sm text-danger">
        {t('ui:pages.record.addOnAction.failed', 'This could not be loaded. Nothing from it has been run.')}
      </p>
    );
  }
  if (state.status === 'loading') return <Loading />;
  const { fill } = state;
  return (
    <FillBoundary onError={() => setState({ status: 'failed' })}>
      <Suspense fallback={<Loading />}>
        <InstallScoped addOnKey={action.addOn} installId={action.installId}>
          <KindScoped addOnKey={action.addOn} installId={action.installId}>
            <AddOnKeyContext.Provider value={action.addOn}>
              <AddOnInstallContext.Provider value={action.installId}>{fill.render(props)}</AddOnInstallContext.Provider>
            </AddOnKeyContext.Provider>
          </KindScoped>
        </InstallScoped>
      </Suspense>
    </FillBoundary>
  );
}

export interface AddOnRecordActionProps {
  action: RecordActionFact;
  /** The row's key, as the data routes take it. */
  recordId: string;
  /** The row as the page holds it for the reader; null until it loads. */
  row: Readonly<Record<string, unknown>> | null;
  /** May the reader change the record: the server offered the action only if so, and the page says so again. */
  canUpdate: boolean;
  /** The record's name: the sheet's description for a screen reader (the fill says it on screen). */
  recordName: string | null;
  /** The sheet closed: the page reads the record again. */
  onClosed?: (() => void) | undefined;
}

export default function AddOnRecordAction({ action, recordId, row, canUpdate, recordName, onClosed }: AddOnRecordActionProps) {
  const [open, setOpen] = useState(false);
  const subtitleId = useId();
  const Icon = lucideByName(action.icon);
  const label = addOnWords(action.addOn, action.labelKey, action.label);
  // Not offered to a reader who may not change the record, nor before it is read.
  if (!canUpdate || row === null) return null;
  const change = (next: boolean) => {
    setOpen(next);
    if (!next) onClosed?.();
  };
  const props: RecordActionProps = { table: action.table, rowKey: recordId, row, grants: { update: canUpdate }, close: () => change(false) };
  return (
    <Drawer open={open} onOpenChange={change} side="end" aria-describedby={recordName === null ? undefined : subtitleId} className="w-[540px] max-sm:w-full max-sm:max-w-full max-sm:border-s-0">
      {/* The dialog's own trigger: it says it opens a dialog, and focus comes back to it when the sheet closes. */}
      <DrawerTrigger asChild>
        <Button size="sm" variant="primary" iconLeft={<Icon aria-hidden="true" />} className="max-sm:h-11 max-sm:px-3.5">
          {label}
        </Button>
      </DrawerTrigger>
      {/* The sheet's header is the host's: its title and close. The fill draws its own line under it, its body and its footer. */}
      <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <DrawerTitle className="text-section text-fg">{label}</DrawerTitle>
          {/* The record it acts on, for a screen reader: the fill says it on screen. */}
          {recordName === null ? null : (
            <p id={subtitleId} className="sr-only">
              {recordName}
            </p>
          )}
        </div>
        <DrawerClose
          aria-label={t('ui:action.close', 'Close')}
          className="nb-ib -me-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <X className="size-[18px]" aria-hidden="true" />
        </DrawerClose>
      </div>
      {/* The fill lays out its own body and its sticky footer in what is left of the sheet's height. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{open ? <ActionFillHost action={action} props={props} /> : null}</div>
    </Drawer>
  );
}
