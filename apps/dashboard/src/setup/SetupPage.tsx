// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/setup` route component: resolves the server's password policy, then
 * renders the wizard — six steps since, two before it. On a server that asks
 * for its one-time setup token, the token screen comes first.
 *
 * The "is setup still open?" decision lives in the route guard
 * (../app/router.tsx), not here — by the time this renders, the guard has
 * already established that setup is required.
 */
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { use, useState, type ReactNode } from 'react';

import { OnboardingPage } from './onboarding/OnboardingPage.js';
import { onboardingMessagesReady } from './onboarding/onboardingMessages.js';
import { TrialMount } from '../trial/TrialMount.js';
import { SetupTokenScreen } from './SetupTokenScreen.js';
import { SETUP_STATE_QUERY_KEY, setupStateQuery, type SetupState } from './setupState.js';

export function SetupPage(): ReactNode {
  // The wizard's own namespace is deferred. Awaiting it HERE, on the
  // same Suspense boundary that already waits for the password policy, is what
  // keeps a translated locale from painting a screen of English fallbacks —
  // the contract every deferred namespace owes its surface.
  use(onboardingMessagesReady());
  const { data } = useSuspenseQuery(setupStateQuery());
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tokenAccepted, setTokenAccepted] = useState(false);

  if (data.tokenRequired === true && !tokenAccepted) {
    return (
      <SetupTokenScreen
        onAccepted={() => setTokenAccepted(true)}
        onClosed={() => {
          // The cached state still says "required", and `/login` would bounce
          // straight back here on it.
          queryClient.setQueryData<SetupState>(SETUP_STATE_QUERY_KEY, { ...data, required: false, tokenRequired: false });
          void router.navigate({ to: '/login' });
        }}
      />
    );
  }
  return (
    <>
      {/* A trial's strips, above the wizard (the token screen has them through its layout). */}
      <TrialMount />
      <OnboardingPage
        passwordMinLength={data.passwordMinLength}
        databaseConnected={data.databaseConnected === true}
      />
    </>
  );
}
