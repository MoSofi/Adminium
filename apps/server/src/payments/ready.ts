// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which payment services can take a checkout now, and in which mode.
 *
 * One answer for the pay page, the ways-to-pay preview and link minting, so
 * none of them offers a service another refuses: installed and switched on,
 * its server half loaded (from a package Adminium vouches for), not stopped,
 * and its key for the current mode saved and checked. The current mode is
 * live once live payments are switched on for that service, test before.
 */
import { PAYMENT_PROVIDER_CONTRACT, PAYMENT_PROVIDER_VERSION, type PaymentMode } from '@adminium/add-on-contracts';
import { addOnManifestSchema } from '@adminium/manifest';
import { paymentSettingsRepo, type ManifestsRepo, type MetaDb } from '@adminium/meta';

import { providerByKey, type AddOnRuntimeState } from '../add-ons/runtime.js';
import { emptyServiceState, serviceDocName, serviceStateSchema } from './services.js';

export interface ReadyDeps {
  meta: MetaDb;
  manifests: Pick<ManifestsRepo, 'list'>;
  runtime: () => AddOnRuntimeState | null;
}

/** Every installed payment add-on's key. */
export async function paymentAddOnKeys(deps: Pick<ReadyDeps, 'manifests'>): Promise<string[]> {
  const keys: string[] = [];
  for (const installed of await deps.manifests.list('add-on')) {
    if (installed.row.status !== 'installed') continue;
    const parsed = addOnManifestSchema.safeParse(installed.document);
    if (parsed.success && (parsed.data.addOn.provides ?? []).some((entry) => entry.contract === PAYMENT_PROVIDER_CONTRACT)) keys.push(parsed.data.key);
  }
  return keys;
}

/** The mode each service works in now, for the ones that can take a checkout. */
export async function readyPaymentProviders(deps: ReadyDeps): Promise<{ key: string; mode: PaymentMode }[]> {
  const runtime = deps.runtime();
  const docs = paymentSettingsRepo(deps.meta);
  const ready: { key: string; mode: PaymentMode }[] = [];
  for (const key of await paymentAddOnKeys(deps)) {
    const state = (await docs.get(serviceDocName(key), serviceStateSchema)) ?? emptyServiceState();
    const current = state.liveOn ? state.live : state.test;
    const loaded = runtime !== null && providerByKey(runtime, PAYMENT_PROVIDER_CONTRACT, PAYMENT_PROVIDER_VERSION, key) !== null;
    if (loaded && !state.stopped && current.check?.ok === true) ready.push({ key, mode: state.liveOn ? 'live' : 'test' });
  }
  return ready;
}

/**
 * The services that can take a checkout in one mode: loaded, not stopped, and
 * that mode's key checked. Live also needs live payments switched on; test
 * stays open after that, for staff's test payments and test links.
 */
export async function readyInMode(deps: ReadyDeps, mode: PaymentMode): Promise<string[]> {
  const runtime = deps.runtime();
  const docs = paymentSettingsRepo(deps.meta);
  const ready: string[] = [];
  for (const key of await paymentAddOnKeys(deps)) {
    const state = (await docs.get(serviceDocName(key), serviceStateSchema)) ?? emptyServiceState();
    const loaded = runtime !== null && providerByKey(runtime, PAYMENT_PROVIDER_CONTRACT, PAYMENT_PROVIDER_VERSION, key) !== null;
    if (loaded && !state.stopped && state[mode].check?.ok === true && (mode === 'test' || state.liveOn)) ready.push(key);
  }
  return ready;
}

/** Whether live payments are on for any service. */
export async function anyLiveOn(deps: ReadyDeps): Promise<boolean> {
  const docs = paymentSettingsRepo(deps.meta);
  for (const key of await paymentAddOnKeys(deps)) {
    if (((await docs.get(serviceDocName(key), serviceStateSchema)) ?? emptyServiceState()).liveOn) return true;
  }
  return false;
}
