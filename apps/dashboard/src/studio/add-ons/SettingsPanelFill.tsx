// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN SETTINGS CONTROL (`settings.add-on.panel`), DRAWN WHERE ITS
 * SETTINGS ARE EDITED.
 *
 * Some settings are a shape no generated control can draw — a list of the
 * days a business is closed, picked from a country's holidays — and the
 * add-on that declares one ships its own form for it as a fill of this slot.
 * Its file is a slot file (`/add-ons/<key>/bundle/<path>`, pinned like a
 * page's code) whose `register()` hands back the add-on's fills; the fill is
 * given the stored values, a `patch` that saves a change to them (the same
 * `PUT /add-ons/:key/settings` the generated form uses, so the same gate:
 * who manages add-ons, or who holds `addOn:<key>:settings`), and the
 * catalogue samples a shop's own host would pass — none here, as a dashboard
 * has no one catalogue.
 *
 * An add-on that declares no such fill, or whose list entry names no file for
 * it, draws nothing; one whose code cannot be fetched, or that throws, says
 * so in a sentence and leaves the rest of the form as it is.
 */
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@adminium/ui';

import { loadAddOnNamespace } from '../../add-ons/client.js';
import { t } from '../../i18n/t.js';
import { ADD_ONS_QUERY_KEY, saveAddOnSettings, type AddOnDto } from './addOnsApi.js';

/** The slot an add-on's own settings form fills. */
export const SETTINGS_SLOT = 'settings.add-on.panel';

/** What the fill is handed: the slot's payload, as `@adminium/add-on-host` types it. */
interface SettingsPanelPayload {
  settings: Record<string, unknown>;
  patch: (values: Record<string, unknown>) => void;
  samples: readonly unknown[];
}

interface Fill {
  slot: string;
  render: (payload: SettingsPanelPayload) => ReactNode;
}

type FillState = { status: 'loading' } | { status: 'ready'; fill: Fill } | { status: 'failed' };

/** The file of an add-on's settings fill, as the add-ons list names it to this reader; null when there is none. */
export function settingsFillBundle(addOn: Pick<AddOnDto, 'slots' | 'bundles'>): AddOnDto['bundles'][number] | null {
  // Read defensively: an older server's list, or a test's, may carry neither.
  const slot = (addOn.slots ?? []).find((one) => one.slot === SETTINGS_SLOT);
  if (slot === undefined) return null;
  return (addOn.bundles ?? []).find((bundle) => bundle.path === slot.client && bundle.ref === undefined && bundle.panel === undefined) ?? null;
}

/** The fill's own crash, kept off the form around it. */
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

/** The fill of `settings.add-on.panel` a module's `register()` hands back, or null. */
function settingsFillOf(namespace: Record<string, unknown> | null): Fill | null {
  const register = namespace?.['register'];
  if (typeof register !== 'function') return null;
  const registered = (register as () => unknown)() as { fills?: unknown } | null;
  const fills = Array.isArray(registered?.fills) ? (registered.fills as unknown[]) : [];
  const fill = fills.find((one): one is Fill => typeof one === 'object' && one !== null && (one as Fill).slot === SETTINGS_SLOT && typeof (one as Fill).render === 'function');
  return fill ?? null;
}

export function SettingsPanelFill({ addOn }: { addOn: AddOnDto }) {
  const queryClient = useQueryClient();
  const bundle = settingsFillBundle(addOn);
  const [state, setState] = useState<FillState>({ status: 'loading' });
  const [values, setValues] = useState<Record<string, unknown>>(addOn.settingValues);
  // What the server last said it holds: what a refused change goes back to.
  const saved = useRef<Record<string, unknown>>(addOn.settingValues);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (bundle === null) return;
    let alive = true;
    setState({ status: 'loading' });
    loadAddOnNamespace({ url: bundle.url, integrity: bundle.integrity }).then(
      (namespace) => {
        if (!alive) return;
        const fill = settingsFillOf(namespace);
        setState(fill === null ? { status: 'failed' } : { status: 'ready', fill });
      },
      () => {
        if (alive) setState({ status: 'failed' });
      },
    );
    return () => {
      alive = false;
    };
  }, [bundle?.url, bundle?.integrity]);

  if (bundle === null) return null;
  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <p role="alert" className="text-sm text-danger">
        {t('studio:addOns.settings.fillFailed', 'This add-on’s own settings control could not be loaded. Nothing from it has been run.')}
      </p>
    );
  }

  const patch = (change: Record<string, unknown>) => {
    // Drawn at once with the change; saved, and the list read again, so every other reader of the values sees it.
    setValues((current) => ({ ...current, ...change }));
    setSaveFailed(false);
    saveAddOnSettings(addOn.key, change).then(
      (reply) => {
        saved.current = reply.values;
        setValues(reply.values);
        void queryClient.invalidateQueries({ queryKey: ADD_ONS_QUERY_KEY });
      },
      () => {
        setSaveFailed(true);
        setValues(saved.current);
      },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <FillBoundary onError={() => setState({ status: 'failed' })}>{state.fill.render({ settings: values, patch, samples: [] })}</FillBoundary>
      {saveFailed && (
        <p role="alert" className="text-sm text-danger">
          {t('studio:addOns.settings.fillSaveFailed', 'That change could not be saved. Nothing was changed.')}
        </p>
      )}
    </div>
  );
}
