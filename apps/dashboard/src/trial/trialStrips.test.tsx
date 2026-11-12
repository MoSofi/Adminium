// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trial mode on screen: the two strips with days left (and on the last day),
 * the one strip once the trial has ended (from the end date, never a count of
 * 0) with the page's writes locked and "Read-only" after the title, Upgrade
 * only with the operator's address and in the same tab, the full warning
 * sentence on a phone, the strips' own mounts on the sign-in and setup
 * pages (the setup wizard's in `trialSetupMount.test.tsx`), and Upgrade's
 * place in the user menu.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider, TooltipProvider } from '@adminium/ui';
import { useWriteLock } from '@adminium/widgets';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../app/api.js';
import type { SystemInfo, TrialInfo } from '../app/capabilities.js';
import { offByOperatorText } from '../settings/OffByOperator.js';
import { AuthScreenLayout } from '../auth/AuthScreenLayout.js';
import { installTestI18n } from '../i18n/testing.js';
import { PageActionsProvider, PageTitleAdornmentSlot } from '../shell/PageActionsProvider.js';
import { ShortcutsProvider } from '../shell/ShortcutsProvider.js';
import { Topbar } from '../shell/Topbar.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { TrialMount } from './TrialMount.js';
import { daysLeftAt } from './TrialStrips.js';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
      <a href={to} className={className}>
        {children}
      </a>
    ),
    useRouter: () => ({ history: { push: vi.fn() } }),
    useNavigate: () => vi.fn(),
  };
});

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const UPGRADE = 'https://operator.example/upgrade?instance=https%3A%2F%2Fhollis.try.example.com';
const SENTENCE = 'This is a test environment. Please don’t put real customer data in.';

function trialEnding(inMs: number, upgradeUrl: string | null = UPGRADE): TrialInfo {
  return { on: true, endsAt: new Date(Date.now() + inMs).toISOString(), daysLeft: inMs > 0 ? Math.ceil(inMs / DAY) : null, upgradeUrl };
}

/** `/system/info` as a server answers it, with or without a trial. */
function withInfo(trial: TrialInfo | undefined, children: ReactNode, deployLink = false): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const info: Partial<SystemInfo> = { deployLink, ...(trial === undefined ? {} : { trial }) };
  client.setQueryData(['system', 'info'], info);
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** What the write lock holds, drawn so a test can read it. */
function LockProbe(): ReactNode {
  return <output data-testid="lock">{useWriteLock() ?? 'open'}</output>;
}

describe('the trial strips', () => {
  it('with days left: the warning, then "9 days left · Export everything · Upgrade", neither closable', async () => {
    render(withInfo(trialEnding(9 * DAY - HOUR), <TrialMount shell />));
    const warning = await screen.findByTestId('trial-test-environment');
    expect(warning.getAttribute('role')).toBe('note');
    expect(warning.textContent).toBe(SENTENCE);
    const days = screen.getByTestId('trial-days');
    expect(days.getAttribute('role')).toBe('note');
    expect(days.textContent).toContain('9 days left');
    expect(screen.getByRole('link', { name: 'Export everything' }).getAttribute('href')).toBe('/studio/settings/export');
    const upgrade = screen.getByRole('link', { name: 'Upgrade' });
    expect(upgrade.getAttribute('href')).toBe(UPGRADE);
    // The same tab: no target, nothing that says it opens elsewhere.
    expect(upgrade.hasAttribute('target')).toBe(false);
    expect(screen.queryByRole('button', { name: /close|dismiss/i })).toBeNull();
    expect(screen.queryByTestId('trial-ended')).toBeNull();
  });

  it('on the last day: "1 day left"', async () => {
    render(withInfo(trialEnding(5 * HOUR), <TrialMount shell />));
    expect((await screen.findByTestId('trial-days')).textContent).toContain('1 day left');
    expect(daysLeftAt(trialEnding(5 * HOUR), Date.now())).toBe(1);
  });

  it('without the operator’s Upgrade address: no Upgrade', async () => {
    render(withInfo(trialEnding(3 * DAY, null), <TrialMount shell />));
    expect((await screen.findByTestId('trial-days')).textContent).toContain('3 days left');
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull();
  });

  it('on a phone: the whole sentence, free to wrap, never the short form', async () => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event('resize'));
    render(withInfo(trialEnding(9 * DAY), <TrialMount shell />));
    const warning = await screen.findByTestId('trial-test-environment');
    expect(warning.textContent).toBe(SENTENCE);
    expect(warning.className).toContain('flex-wrap');
    const sentence = warning.querySelector('span');
    expect(sentence?.className ?? '').not.toMatch(/truncate|nowrap|ellipsis/);
    expect(warning.getAttribute('aria-label')).toBeNull();
  });

  it('ended, from the end date: one strip, role="status", "Read-only" after the title, writes locked', async () => {
    // The server's count is still 1: the state is the end date's, not the count's.
    const trial = { ...trialEnding(-HOUR), daysLeft: 1 };
    render(
      withInfo(
        trial,
        <PageActionsProvider>
          <h1>Orders</h1>
          <PageTitleAdornmentSlot />
          <TrialMount shell />
          <LockProbe />
        </PageActionsProvider>,
      ),
    );
    const ended = await screen.findByTestId('trial-ended');
    expect(ended.getAttribute('role')).toBe('status');
    expect(ended.textContent).toContain('This trial has ended.');
    expect(ended.textContent).toContain('Export everything');
    expect(screen.getByRole('link', { name: 'Upgrade' }).getAttribute('href')).toBe(UPGRADE);
    expect(screen.queryByTestId('trial-test-environment')).toBeNull();
    expect(screen.queryByTestId('trial-days')).toBeNull();
    expect((await screen.findByTestId('trial-read-only')).textContent).toBe('Read-only');
    expect(screen.getByTestId('lock').textContent).toBe('Read-only: this trial has ended');
  });

  it('ends on time on a page left open, and unlocks when the shell goes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = render(withInfo(trialEnding(2 * 1000), <><TrialMount shell /><LockProbe /></>));
    expect(await screen.findByTestId('trial-days')).toBeTruthy();
    expect(screen.getByTestId('lock').textContent).toBe('open');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(await screen.findByTestId('trial-ended')).toBeTruthy();
    expect(screen.getByTestId('lock').textContent).toBe('Read-only: this trial has ended');
    view.unmount();
    render(withInfo(undefined, <LockProbe />));
    expect(screen.getByTestId('lock').textContent).toBe('open');
  });

  it('says a refused write in the same words, on any screen that shows the server’s refusal', () => {
    expect(offByOperatorText(new ApiError(403, 'OFF_BY_OPERATOR', 'x', 'r', { question: 'writes', reason: 'trial-ended' }))).toBe('Read-only: this trial has ended');
  });

  it('draws nothing, and fetches nothing, on a server with no trial', () => {
    render(withInfo({ on: false, endsAt: null, daysLeft: null, upgradeUrl: null }, <TrialMount shell />));
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the strips’ own mounts outside the shell', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: false } })));
  });

  it('on the sign-in page (and every screen of its layout, the setup token screen among them): above the card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: false } })));
    render(withInfo(trialEnding(9 * DAY), <AuthScreenLayout documentTitle="Sign in"><form aria-label="Sign in" /></AuthScreenLayout>));
    const warning = await screen.findByTestId('trial-test-environment');
    const form = screen.getByRole('form', { name: 'Sign in' });
    // Before the card in the page's order.
    expect(warning.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('trial-days').textContent).toContain('9 days left');
    // Signed out, no page's writes are locked.
    expect(screen.queryByTestId('trial-read-only')).toBeNull();
  });

  it('keeps a field typed into as the strips arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: false } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // The sign-in page paints before `/system/info` answers.
    client.setQueryData(['system', 'info'], {});
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <AuthScreenLayout documentTitle="Sign in">
            <input aria-label="Email" />
          </AuthScreenLayout>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const field = screen.getByRole('textbox', { name: 'Email' });
    await userEvent.setup().type(field, 'dana@');
    act(() => client.setQueryData(['system', 'info'], { trial: trialEnding(9 * DAY) }));
    expect(await screen.findByTestId('trial-test-environment')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBe(field);
    expect((field as HTMLInputElement).value).toBe('dana@');
  });

  it('on the sign-in page of a server with no trial: the layout alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: false } })));
    render(withInfo(undefined, <AuthScreenLayout documentTitle="Sign in"><form aria-label="Sign in" /></AuthScreenLayout>));
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

});

describe('Upgrade in the user menu', () => {
  function stubInfo(trial: TrialInfo | undefined, deployLink: boolean) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.startsWith('/api/v1/me/notifications')) return jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } });
        if (url.startsWith('/api/v1/system/info')) {
          return jsonResponse(200, { version: '0.5.0', node: 'v22', dialect: 'sqlite', runtime: 'self-host', smtpConfigured: false, networkFeaturesAllowed: true, deployLink, ...(trial === undefined ? {} : { trial }) });
        }
        return jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } });
      }),
    );
  }

  function renderTopbar() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <TooltipProvider>
            <ShortcutsProvider>
              <Topbar
                bootstrap={makeBootstrap({ roles: ['admin'] })}
                title="Orders"
                onOpenPalette={() => {}}
                onToggleSidebar={() => {}}
                sidebarExpanded
                sidebarControls={null}
                onSignOut={() => {}}
                onOpenAccount={() => {}}
                onOpenPreferences={() => {}}
                onOpenStudio={() => {}}
                onOpenStudioSettings={() => {}}
                onOpenPayments={() => {}}
                onOpenHelp={() => {}}
                onOpenChangelog={() => {}}
              />
            </ShortcutsProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  }

  it('one group with "Put this online…", after the Studio group and before Help centre; opens in the same tab', async () => {
    stubInfo(trialEnding(9 * DAY), true);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const user = userEvent.setup();
    renderTopbar();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const upgrade = await screen.findByRole('menuitem', { name: 'Upgrade' });
    const items = screen.getAllByRole('menuitem').map((entry) => entry.textContent ?? '');
    const at = items.findIndex((label) => label === 'Upgrade');
    expect(items[at - 1]).toContain('Server settings');
    expect(items[at + 1]).toContain('Put this online…');
    expect(items[at + 2]).toContain('Help centre');
    // Its icon is the plain arrow-up circle, nothing that says "opens elsewhere".
    expect(upgrade.querySelector('svg.lucide-circle-arrow-up')).not.toBeNull();
    expect(upgrade.querySelector('svg.lucide-square-arrow-out-up-right')).toBeNull();
    await user.click(upgrade);
    expect(assign).toHaveBeenCalledWith(UPGRADE);
  });

  it.each([
    ['no trial', undefined],
    ['a trial without the operator’s address', trialEnding(9 * DAY, null)],
  ])('is not there with %s', async (_name, trial) => {
    stubInfo(trial, true);
    const user = userEvent.setup();
    renderTopbar();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByRole('menuitem', { name: 'Put this online…' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Upgrade' })).toBeNull());
  });

  it('stands alone in its group when the operator hides "Put this online…"', async () => {
    stubInfo(trialEnding(9 * DAY), false);
    const user = userEvent.setup();
    renderTopbar();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByRole('menuitem', { name: 'Upgrade' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Put this online…' })).toBeNull();
  });
});
