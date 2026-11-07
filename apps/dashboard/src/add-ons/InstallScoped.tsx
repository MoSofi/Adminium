// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH COPY A SCREEN IS OF. The same add-on may be installed once per
 * database. While a screen of one copy is drawn (a record's panel, the
 * settings screen), every call to its add-on's routes names that copy
 * (`X-Adminium-Install`): the add-on's own code cannot know which database
 * it was opened for. The screen is drawn only once the scope is set, so its
 * first request already carries it. With no install to name (a server that
 * does not say), nothing is scoped.
 */
import { useLayoutEffect, useState, type ReactNode } from 'react';

import { scopeInstall } from '../app/api.js';

export function InstallScoped({ addOnKey, installId, children }: { addOnKey: string; installId: string | null; children: ReactNode }) {
  const [ready, setReady] = useState(installId === null);
  useLayoutEffect(() => {
    if (installId === null) return undefined;
    const off = scopeInstall(`/api/v1/add-ons/${encodeURIComponent(addOnKey)}`, installId);
    setReady(true);
    return off;
  }, [addOnKey, installId]);
  return ready ? <>{children}</> : null;
}
