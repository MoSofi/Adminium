// SPDX-License-Identifier: AGPL-3.0-only
/**
 * StatePage — renders a system state by id (route `/state/$stateId`) and
 * wires each state's primary/secondary CTA to its real recovery action
 * (table). Unknown ids render the branded 404.
 */
import { useNavigate } from '@tanstack/react-router';

import { isSystemStateId, type SystemStateId } from '../app/query.js';
import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { useDocumentPageTitle } from '../shell/documentTitle.js';
import { NotFoundPage } from './NotFoundPage.js';
import { StateHero } from './StateHero.js';
import { SYSTEM_STATES } from './stateMap.js';

export interface StatePageProps {
  stateId: string;
  /** Present when the failure carried a server request id. */
  requestId?: string | null | undefined;
  /** Inline (content-outlet) rendering — shell + nav stay usable. */
  fullPage?: boolean | undefined;
  /** Override for Retry-style CTAs (query refetch instead of hard reload). */
  onRetry?: (() => void) | undefined;
}

/** The state's own heading — what the tab is named after. Unknown id ⇒ 404. */
export function systemStateTitle(stateId: string): string {
  const spec = SYSTEM_STATES[isSystemStateId(stateId) ? stateId : 'not-found'];
  return t(spec.title.key, spec.title.en);
}

/**
 * A system state as a WHOLE SCREEN with no shell around it: the `/state/$id`
 * route, the authed layout's error boundary, the routed 404.
 *
 * The tab is named here and not inside `StatePage` because that component is
 * ALSO rendered inside the shell — a forbidden panel in the content outlet,
 * a page-scoped failure under a topbar that still names the page. There the
 * topbar owns the tab, and a second writer would fight it.
 */
export function SystemStateScreen(props: StatePageProps) {
  useDocumentPageTitle(systemStateTitle(props.stateId));
  return <StatePage {...props} />;
}

export function StatePage({ stateId, requestId, fullPage = true, onRetry }: StatePageProps) {
  const navigate = useNavigate();

  if (!isSystemStateId(stateId)) return <NotFoundPage />;
  if (stateId === 'not-found') return <NotFoundPage requestId={requestId ?? null} />;
  const spec = SYSTEM_STATES[stateId];

  const retry = onRetry ?? (() => window.location.reload());
  const toLogin = () => void navigate({ to: '/login' });

  const primaryActions: Partial<Record<SystemStateId, () => void>> = {
    forbidden: () => void navigate({ to: '/' }),
    error: retry,
    'db-unreachable': retry,
    maintenance: retry,
    'rate-limited': retry,
    offline: retry,
    'expired-link': toLogin,
    'expired-session': toLogin,
    // Studio connect wizard lands in M5 — home is the honest target.
    'empty-no-sources': () => void navigate({ to: '/' }),
    'read-only': () => void navigate({ to: '/' }),
    // `suspended` has no primary action: its "Contact owner" target is the
    // cloud customer-portal deep link, which v1 does not
    // ship. It used to be wired to `() => undefined`, which rendered a button
    // that ate the click — the dead-CTA bug wearing a handler. Absent from this
    // map, StateHero omits the button and the body copy carries the instruction.
  };

  const secondaryActions: Partial<Record<SystemStateId, () => void>> = {
    forbidden: () => window.history.back(),
    'rate-limited': () => window.history.back(),
    'expired-link': toLogin,
    'read-only': () => window.history.back(),
    // No primary for `connection-paused`: retrying cannot change the answer
    // until a person resumes the connection (see its note in stateMap.ts).
    'connection-paused': () => window.history.back(),
  };

  return (
    <>
      {/* A full-page state inside the shell IS the screen — "Access denied",
          not the name of the page it replaced. Rendered through the channel so
          the topbar stays the single writer; outside the shell there is no
          channel and this draws nothing (`SystemStateScreen` names those). */}
      {fullPage ? <PageActions documentTitle={t(spec.title.key, spec.title.en)} /> : null}
      <StateHero
        spec={spec}
        fullPage={fullPage}
        requestId={requestId}
        onPrimary={primaryActions[stateId]}
        onSecondary={secondaryActions[stateId]}
      />
    </>
  );
}
