/**
 * StatePage — renders a system state by id (route `/state/$stateId`,
 * 09-generated-app.md §6.1) and wires each state's primary/secondary CTA to
 * its real recovery action (§6.1 table). Unknown ids render the branded 404.
 */
import { useNavigate } from '@tanstack/react-router';

import { isSystemStateId, type SystemStateId } from '../app/query.js';
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
    // Studio connect wizard lands in M5 (09-T11) — home is the honest target.
    'empty-no-sources': () => void navigate({ to: '/' }),
    'read-only': () => void navigate({ to: '/' }),
    suspended: () => undefined, // cloud customer-portal deep link (12-cloud-platform.md)
  };

  const secondaryActions: Partial<Record<SystemStateId, () => void>> = {
    forbidden: () => window.history.back(),
    'rate-limited': () => window.history.back(),
    'expired-link': toLogin,
    'read-only': () => window.history.back(),
  };

  return (
    <StateHero
      spec={spec}
      fullPage={fullPage}
      requestId={requestId}
      onPrimary={primaryActions[stateId]}
      onSecondary={secondaryActions[stateId]}
    />
  );
}
