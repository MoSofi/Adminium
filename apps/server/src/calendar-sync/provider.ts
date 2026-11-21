// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The factory seam: one calendar provider, built for one account and one
 * operation, never cached. A switched-off add-on stops at the next call.
 *
 * The provider gets a client that adds the bearer header, never the token.
 * Every answer goes through the contract's guard. A provider that cannot be
 * built is `unavailable`: no account changes state because a package went
 * missing in a redeploy (SYN-17).
 */
import {
  CALENDAR_ANSWER_SCHEMAS,
  CALENDAR_PROVIDER_CONTRACT,
  CALENDAR_PROVIDER_FACTORY,
  CALENDAR_PROVIDER_VERSION,
  DEMO_CALENDAR_KEY,
  DEMO_CALENDAR_SUBJECT_PREFIX,
  calendarError,
  guardCalendarProvider,
  isCalendarError,
  readDemoHook,
  type CalendarAnswer,
  type CalendarProvider,
  type CreateCalendarProvider,
  type DemoCalendarBackend,
  type HookAnswer,
  type HookDelivery,
  createDemoCalendarBackend,
} from '@adminium/add-on-contracts';
import type { ConnectedAccount } from '@adminium/meta';

import { providerByKey, type AddOnRuntimeState } from '../add-ons/runtime.js';
import { AccountTokenError, parseAddOn, type ConnectedAccounts } from '../connected-accounts/service.js';

export type ProviderLookup =
  | { ok: true; key: string; provider: CalendarProvider }
  /** `reconnect`: the person must connect again. `setup`: the install's. `unavailable`: try again later. */
  | { ok: false; reason: 'reconnect' | 'setup' | 'unavailable' };

export interface CalendarProviderDeps {
  accounts: ConnectedAccounts;
  runtime: () => AddOnRuntimeState | null;
  /** The in-process demo backend, where this server offers it. */
  demo: DemoCalendarBackend | null;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

export const isDemoAccount = (account: Pick<ConnectedAccount, 'subject'>): boolean => account.subject.startsWith(DEMO_CALENDAR_SUBJECT_PREFIX);

function factoryOf(module: unknown): CreateCalendarProvider | null {
  const direct = (module as Record<string, unknown> | null)?.[CALENDAR_PROVIDER_FACTORY];
  if (typeof direct === 'function') return direct as CreateCalendarProvider;
  const viaDefault = ((module as { default?: Record<string, unknown> } | null)?.default ?? null)?.[CALENDAR_PROVIDER_FACTORY];
  return typeof viaDefault === 'function' ? (viaDefault as CreateCalendarProvider) : null;
}

/**
 * The built-in demo calendar, only where the server says it is a developer's or
 * a test's. An npm install run as a service often has no `NODE_ENV` at all, so
 * unset, `production` and any other spelling get none.
 */
export function demoCalendarFor(nodeEnv: string | undefined): DemoCalendarBackend | null {
  return nodeEnv === 'test' || nodeEnv === 'development' ? createDemoCalendarBackend() : null;
}

function factoryByKey(deps: CalendarProviderDeps, key: string): CreateCalendarProvider | null {
  const state = deps.runtime();
  const entry = state === null ? null : providerByKey(state, CALENDAR_PROVIDER_CONTRACT, CALENDAR_PROVIDER_VERSION, key);
  return entry === null ? null : factoryOf(entry.module);
}

export async function calendarProviderFor(deps: CalendarProviderDeps, account: ConnectedAccount, options?: { ending?: boolean }): Promise<ProviderLookup> {
  if (isDemoAccount(account)) {
    if (deps.demo === null) return { ok: false, reason: 'unavailable' };
    return { ok: true, key: DEMO_CALENDAR_KEY, provider: guardCalendarProvider(deps.demo.providerFor(account.subject), deps.log) };
  }
  const install = await deps.accounts.installOf(account.manifestId).catch(() => null);
  if (install === null) return { ok: false, reason: 'unavailable' };
  const factory = factoryByKey(deps, install.spec.key);
  if (factory === null) return { ok: false, reason: 'unavailable' };
  try {
    const client = await deps.accounts.tokens.clientFor(account.id, options);
    return { ok: true, key: install.spec.key, provider: guardCalendarProvider(factory({ http: client.http as (input: string | URL, init?: RequestInit) => Promise<Response> }), deps.log) };
  } catch (error) {
    if (error instanceof AccountTokenError) {
      if (error.failure === 'reconnect') return { ok: false, reason: 'reconnect' };
      if (error.failure === 'setup') return { ok: false, reason: 'setup' };
    }
    return { ok: false, reason: 'unavailable' };
  }
}

/** The key an account's calendar service goes by. */
export async function providerKeyOf(deps: CalendarProviderDeps, account: ConnectedAccount): Promise<string | null> {
  if (isDemoAccount(account)) return DEMO_CALENDAR_KEY;
  const install = await deps.accounts.installOf(account.manifestId).catch(() => null);
  return install === null ? null : install.spec.key;
}

/**
 * Reads a delivery for a provider key. No account and no token: a delivery is
 * read before anyone is known. Null: this provider's code is not loaded.
 */
export function readHookFor(deps: CalendarProviderDeps, key: string, delivery: HookDelivery): CalendarAnswer<HookAnswer> | null {
  if (key === DEMO_CALENDAR_KEY) {
    if (deps.demo === null) return null;
    const answer = readDemoHook(delivery);
    if (isCalendarError(answer)) return answer;
    return CALENDAR_ANSWER_SCHEMAS.readHook.safeParse(answer).success ? answer : calendarError('UNAVAILABLE');
  }
  const factory = factoryByKey(deps, key);
  if (factory === null) return null;
  try {
    const noCalls = async (): Promise<Response> => {
      throw new Error('A delivery is read without calling anyone.');
    };
    return guardCalendarProvider(factory({ http: noCalls }), deps.log).readHook(delivery);
  } catch {
    return calendarError('UNAVAILABLE');
  }
}

export { parseAddOn };
