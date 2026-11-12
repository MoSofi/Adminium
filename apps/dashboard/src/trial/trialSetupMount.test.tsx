// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The setup wizard sits outside the shell, so the trial's strips have their
 * own mount there, above the wizard. What the mount draws is
 * `trialStrips.test.tsx`'s; this proves the page carries it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SetupPage } from '../setup/SetupPage.js';
import { SETUP_STATE_QUERY_KEY } from '../setup/setupState.js';

const wizardWords = vi.hoisted(() => Object.assign(Promise.resolve(), { status: 'fulfilled', value: undefined }));
vi.mock('../setup/onboarding/OnboardingPage.js', () => ({ OnboardingPage: () => <div data-testid="setup-wizard" /> }));
vi.mock('../setup/onboarding/onboardingMessages.js', () => ({ onboardingMessagesReady: () => wizardWords }));
vi.mock('./TrialMount.js', () => ({ TrialMount: () => <div data-testid="trial-mount" /> }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }));

describe('the setup wizard', () => {
  it('draws the trial strips’ mount above the wizard', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(SETUP_STATE_QUERY_KEY, { required: true, passwordMinLength: 12, tokenRequired: false });
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <SetupPage />
        </Suspense>
      </QueryClientProvider>,
    );
    const wizard = await screen.findByTestId('setup-wizard');
    const mount = screen.getByTestId('trial-mount');
    expect(mount.compareDocumentPosition(wizard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
