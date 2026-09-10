// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/setup` route component (M10-T04): resolves the server's password policy,
 * then renders the wizard — six steps since 45-T10, two before it.
 *
 * The "is setup still open?" decision lives in the route guard
 * (../app/router.tsx), not here — by the time this renders, the guard has
 * already established that setup is required.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import { use, type ReactNode } from 'react';

import { OnboardingPage } from './onboarding/OnboardingPage.js';
import { onboardingMessagesReady } from './onboarding/onboardingMessages.js';
import { setupStateQuery } from './setupApi.js';

export function SetupPage(): ReactNode {
  // The wizard's own namespace is deferred (45-T08). Awaiting it HERE, on the
  // same Suspense boundary that already waits for the password policy, is what
  // keeps a translated locale from painting a screen of English fallbacks —
  // the contract every deferred namespace owes its surface.
  use(onboardingMessagesReady());
  const { data } = useSuspenseQuery(setupStateQuery());
  return <OnboardingPage passwordMinLength={data.passwordMinLength} />;
}
