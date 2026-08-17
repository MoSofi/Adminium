/**
 * The Studio section of the avatar menu (09-generated-app.md §8: Studio
 * "shares the shell; a 'Studio' section appears in the user menu and via `G`
 * then `S`").
 *
 * Until this landed, every `/studio/*` and `/settings/*` route was reachable
 * only by typing the URL: the sidebar's `PLATFORM_NAV` never listed them, the
 * avatar menu's "Preferences" pointed at the personal account page, and the
 * onboarding banner — the one surface that linked to Studio — returns `null`
 * once the checklist completes. So this asserts REACHABILITY, not markup: an
 * admin can get to the connections hub and workspace settings from the shell,
 * and a viewer is not shown doors that `StudioGuard` would only 403 on.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider, TooltipProvider } from '@adminium/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ShortcutsProvider } from './ShortcutsProvider.js';
import { Topbar } from './Topbar.js';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useRouter: () => ({ history: { push: vi.fn() } }), useNavigate: () => vi.fn() };
});

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/me/notifications')) {
        return Promise.resolve(jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } }));
      }
      if (url.startsWith('/api/v1/system/info')) {
        return Promise.resolve(
          jsonResponse(200, {
            version: '0.5.0',
            node: 'v22.0.0',
            dialect: 'sqlite',
            runtime: 'self-host',
            smtpConfigured: false,
            networkFeaturesAllowed: true,
          }),
        );
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_a' } }),
      );
    }),
  );
}

function renderTopbar(roles: string[]) {
  stubFetch();
  const onOpenStudio = vi.fn();
  const onOpenStudioSettings = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ThemeProvider>
        <TooltipProvider>
          <ShortcutsProvider>
            <Topbar
              bootstrap={makeBootstrap({ roles })}
              title="Customers"
              onOpenPalette={() => {}}
              onSignOut={() => {}}
              onOpenAccount={() => {}}
              onOpenStudio={onOpenStudio}
              onOpenStudioSettings={onOpenStudioSettings}
            />
          </ShortcutsProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onOpenStudio, onOpenStudioSettings };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('avatar menu Studio section', () => {
  it('gives an admin a way into the connections hub and workspace settings', async () => {
    const user = userEvent.setup();
    const { onOpenStudio, onOpenStudioSettings } = renderTopbar(['admin']);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Data connections' }));
    expect(onOpenStudio).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Workspace settings' }));
    expect(onOpenStudioSettings).toHaveBeenCalledTimes(1);
  });

  it('leaves Pages out of the menu — Workspace settings owns that entry point', async () => {
    const user = userEvent.setup();
    renderTopbar(['admin']);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByRole('menuitem', { name: 'Workspace settings' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Pages' })).toBeNull();
  });

  it('hides the section from roles StudioGuard would reject', async () => {
    const user = userEvent.setup();
    renderTopbar(['viewer']);

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    // The personal-account items still render — this gates Studio, not the menu.
    expect(await screen.findByRole('menuitem', { name: 'Profile' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Data connections' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Workspace settings' })).toBeNull();
  });
});

/**
 * The light/dark control moved out of the header and into this menu. Both
 * halves matter: the first asserts the preference is still REACHABLE by mouse
 * (⌘⇧L, the ⌘K palette and the auth screen keep their own paths), the second
 * is what stops the header button quietly reappearing beside the bell.
 */
describe('avatar menu theme item', () => {
  it('toggles the theme from the menu, with no theme button left in the header', async () => {
    const user = userEvent.setup();
    renderTopbar(['viewer']);

    expect(screen.queryByRole('button', { name: /(Light|Dark) mode/ })).toBeNull();

    const before = document.documentElement.getAttribute('data-theme');
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /(Light|Dark) mode/ }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).not.toBe(before);
    });
  });
});
