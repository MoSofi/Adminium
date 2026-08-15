/**
 * Onboarding surface (M5-T06): the progress ring, the reactive checklist at
 * /welcome (steps ✓ come straight from server-derived state), and the shell
 * entry banner whose dismissal persists per user.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ProgressRing } from './ProgressRing.js';
import { OnboardingEntry } from './OnboardingEntry.js';
import type { OnboardingState } from './api.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function state(overrides: Partial<OnboardingState['checklist']> = {}, dismissed = false): OnboardingState {
  const steps = overrides.steps ?? [
    { key: 'connect-database', done: true },
    { key: 'choose-tables', done: false },
    { key: 'invite-teammates', done: false },
    { key: 'workspace-defaults', done: false },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return {
    checklist: { steps, doneCount, totalCount: steps.length, complete: doneCount === steps.length, ...overrides },
    dismissed,
  };
}

interface FetchStub {
  onboarding: OnboardingState;
  roles?: string[];
}

function stubFetch({ onboarding, roles = ['super-admin'] }: FetchStub) {
  let current = onboarding;
  const dismissCalls: Array<{ dismissed: boolean }> = [];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles, nav: { groups: [] } }) }));
    }
    if (url === '/api/v1/onboarding' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: current }));
    }
    if (url === '/api/v1/onboarding/dismiss' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { dismissed: boolean };
      dismissCalls.push(body);
      current = { ...current, dismissed: body.dismissed };
      return Promise.resolve(jsonResponse(200, { data: current }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no', requestId: 'r' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return { fetchMock, dismissCalls };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProgressRing', () => {
  it('formats the completion percentage', () => {
    const { container } = render(<ProgressRing done={2} total={4} />);
    expect(container.querySelector('text')?.textContent).toBe('50%');
  });

  it('is empty at zero total without dividing by zero', () => {
    const { container } = render(<ProgressRing done={0} total={0} />);
    expect(container.querySelector('text')?.textContent).toBe('0%');
  });
});

describe('OnboardingChecklist (/welcome)', () => {
  async function renderWelcome(onboarding: OnboardingState) {
    const stub = stubFetch({ onboarding });
    const queryClient = createQueryClient();
    const router = createAppRouter(queryClient, {
      history: createMemoryHistory({ initialEntries: ['/welcome'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return stub;
  }

  it('renders the reactive checklist and progress ring', async () => {
    await renderWelcome(state());
    // Personalized welcome keeper.
    expect(await screen.findByText('Welcome to Adminium, Ava 👋')).toBeDefined();
    // 1 of 4 done → 25%.
    await waitFor(() => {
      expect(document.querySelector('[data-part="onboarding-progress-ring"] text')?.textContent).toBe('25%');
    });
    // Each step reflects server-derived done-ness, not click state.
    const connect = document.querySelector('[data-step="connect-database"]');
    const tables = document.querySelector('[data-step="choose-tables"]');
    expect(connect?.getAttribute('data-done')).toBe('true');
    expect(tables?.getAttribute('data-done')).toBe('false');
    expect(screen.getByText('Connect a database')).toBeDefined();
    expect(screen.getByText('Choose your tables')).toBeDefined();
  });

  it('dismisses from "Skip for now" and persists it', async () => {
    const { dismissCalls } = await renderWelcome(state());
    const skip = await screen.findByRole('button', { name: 'Skip for now' });
    await userEvent.click(skip);
    await waitFor(() => {
      expect(dismissCalls).toEqual([{ dismissed: true }]);
    });
  });
});

describe('OnboardingEntry (/studio/settings)', () => {
  function renderEntry(onboarding: OnboardingState, roles = ['super-admin']) {
    const stub = stubFetch({ onboarding, roles });
    const boot = makeBootstrap({ roles });
    const rootRoute = createRootRoute({ component: () => <OnboardingEntry bootstrap={boot} /> });
    const queryClient = createQueryClient();
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/somewhere'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    return stub;
  }

  it('shows the banner for an admin with an incomplete workspace', async () => {
    renderEntry(state());
    expect(await screen.findByRole('button', { name: 'Continue setup' })).toBeDefined();
  });

  it('dismisses permanently, leaving no way-back affordance', async () => {
    const { dismissCalls } = renderEntry(state());
    const dismiss = await screen.findByRole('button', { name: 'Dismiss setup checklist' });
    await userEvent.click(dismiss);
    await waitFor(() => {
      expect(dismissCalls).toEqual([{ dismissed: true }]);
    });
    // The entry now lives on /studio/settings rather than shell-global, so a
    // dismissed checklist renders nothing at all — the surface stays reachable
    // via that page, not via a slim strip above every route.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Continue setup' })).toBeNull();
    });
    expect(screen.queryByRole('button', { name: /Getting started/ })).toBeNull();
  });

  it('renders nothing for a non-admin', async () => {
    renderEntry(state(), ['viewer']);
    // Query is disabled for non-admins → no banner ever appears.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Continue setup' })).toBeNull();
  });
});
