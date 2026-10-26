// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `I18nProvider` over the LIVE instance, not the one boot made.
 *
 * The override layer replaces the instance rather than patching it
 * (`refreshOverrides` on every boot, `resyncOverrides` on reconnect), and a
 * language switch acts on whichever is live. A provider handed the boot
 * instance once kept it: everything that reads its words through the provider
 * (`useT`, `useMaybeT` — every widget's chrome) stayed in the boot language
 * and without the owner's rewording, while the plain `t()` moved on.
 *
 * Every swap is followed by `bumpI18nRevision()`, so following the revision
 * is enough to follow the instance.
 */
import { getI18nRevision, subscribeI18nRevision } from '@adminium/i18n';
import { I18nProvider } from '@adminium/i18n/react';
import { useSyncExternalStore, type ReactNode } from 'react';

import { getI18nInstance } from './t.js';

export function LiveI18nProvider({ children }: { children: ReactNode }): ReactNode {
  useSyncExternalStore(subscribeI18nRevision, getI18nRevision, getI18nRevision);
  const i18n = getI18nInstance();
  if (i18n === null) throw new Error('LiveI18nProvider rendered before initDashboardI18n()');
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
