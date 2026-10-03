// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/design` and `/design/$sessionId` — Adminium Designer, outside the app shell.
 *
 * The route's own check (in the router) has already decided the server runs
 * the Designer. What is left is who is here: with no session, the one-use link
 * was spent (a second tab, a copied link), and the way in is the command
 * again. The pages mount what the shell would have given them: toasts, and
 * the `designer` messages.
 */
import { Suspense, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getI18nRevision, subscribeI18nRevision } from '@adminium/i18n';

import { bootstrapQuery } from '../app/bootstrap.js';
import { AppToastProvider } from '../pages/toasts.js';
import { useDesignerMessages } from './designerMessages.js';
import { useLateDesignToken } from './lateToken.js';
import { SpentLinkPage } from './SpentLinkPage.js';
import { BuildPage } from './build/BuildPage.js';
import { DesignerHome } from './home/DesignerHome.js';

function Signed({ sessionId }: { sessionId: string | null }): ReactNode {
  useDesignerMessages();
  // A language picked in the top bar lands after its messages load; the router's outlet would not re-render for it.
  useSyncExternalStore(subscribeI18nRevision, getI18nRevision, getI18nRevision);
  return <AppToastProvider>{sessionId === null ? <DesignerHome /> : <BuildPage key={sessionId} sessionId={sessionId} />}</AppToastProvider>;
}

export function DesignerRoute({ sessionId = null }: { sessionId?: string | null }): ReactNode {
  useLateDesignToken();
  // Read, never fetched here: the route's check already asked, and a 401 left no data.
  const bootstrap = useQuery({ ...bootstrapQuery(), enabled: false });
  if (bootstrap.data === undefined) {
    return (
      <Suspense fallback={null}>
        <SpentLinkPage />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={null}>
      <Signed sessionId={sessionId} />
    </Suspense>
  );
}
