// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/desktop/setup` and the §7-item-4 CSRF token (08-server-api.md), on the path
 * the straight-line walk does not cover: a RESUME.
 *
 * The wizard is the only surface in the app that holds a session without ever
 * having bootstrapped — it is a child of the router ROOT, because on a fresh
 * install there is no account to bootstrap as. On the walk, step 3 mints the
 * session and hands back the token with it (`setup/setupApi.ts`).
 *
 * A refresh does not walk. `desktopSetupState.ts` restores the wizard from
 * `sessionStorage`, so a reload during step 4 re-mounts straight onto the
 * generate step with the account already created, the session still in the
 * cookie jar — and an empty token holder, because the module-level holder died
 * with the page. The password is deliberately not persisted, so there is no
 * re-auth path. Every call step 4 makes from there is a session-authenticated,
 * browser-provenanced, tokenless mutation: 403 `CSRF_FAILED`, and a wizard
 * stuck on "Something went wrong".
 *
 * ─── WHY THE ASSERTION IS ON THE WIZARD'S OWN REQUEST ────────────────────────
 *
 * Because the bug is a RACE, and any weaker assertion misses it. Components in
 * step 4's subtree already subscribe to the bootstrap query, so `/bootstrap`
 * does get fetched on this step — just not before `prepare()` has dispatched
 * `POST /desktop/demo-database` in the same commit. "The token eventually
 * arrives" was true the whole time the product was broken. What has to be true
 * is that the FIRST mutation carries it, so that is what this reads: the
 * headers on the wizard's own create call.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { CSRF_HEADER, setCsrfToken } from '../../app/api.js';
import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { INITIAL_DESKTOP_SETUP_STATE } from './desktopSetupState.js';

const RESUMED_TOKEN = 'tok_from_bootstrap_on_resume';
const STORAGE_KEY = 'adminium-desktop-setup';
const DEMO_URL = '/api/v1/desktop/demo-database';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

/**
 * A refreshed browser mid-step-4: the wizard state survived in sessionStorage,
 * the in-memory token holder did not. `connectionId` stays null — the refresh
 * landed before the create finished, which is the window the resume exists for.
 */
function seedResumedWizard(step: string): void {
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...INITIAL_DESKTOP_SETUP_STATE, step, source: 'demo' }),
  );
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.startsWith('/api/v1/bootstrap')) {
      // A session IS in the cookie jar — the account was created before the
      // refresh — so `/bootstrap` answers and issues this session's token.
      return Promise.resolve(
        jsonResponse(200, { data: makeBootstrap({ csrfToken: RESUMED_TOKEN }) }),
      );
    }
    if (url.startsWith(DEMO_URL)) {
      return Promise.resolve(jsonResponse(201, { data: { connectionId: 'conn_demo' } }));
    }
    return Promise.resolve(jsonResponse(200, { data: {} }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWizard() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const fetchMock = stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/desktop/setup'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { fetchMock, queryClient };
}

/** The headers the wizard put on its request to `url`, or null if it made none. */
function headersFor(
  fetchMock: ReturnType<typeof vi.fn>,
  url: string,
): Record<string, string> | null {
  const call = fetchMock.mock.calls.find((entry) => String(entry[0]).startsWith(url));
  if (call === undefined) return null;
  return (call[1] as { headers?: Record<string, string> } | undefined)?.headers ?? {};
}

beforeEach(() => {
  setCsrfToken(null);
  window.sessionStorage.clear();
});

afterEach(() => {
  setCsrfToken(null);
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('the desktop wizard, resumed after a reload', () => {
  it('carries the CSRF token on the FIRST mutation step 4 makes', async () => {
    seedResumedWizard('generate');
    const { fetchMock } = renderWizard();

    await waitFor(() => {
      expect(headersFor(fetchMock, DEMO_URL), 'step 4 must create its source').not.toBeNull();
    });

    expect(
      headersFor(fetchMock, DEMO_URL)?.[CSRF_HEADER],
      'the resumed wizard must prime the token from /bootstrap BEFORE it creates the ' +
        'database — a token that lands afterwards is a 403 on the create',
    ).toBe(RESUMED_TOKEN);
  });

  it('does not bootstrap on the steps that run before the account exists', async () => {
    // `location` is where a first run starts. There is no session yet, so the
    // fetch could only 401 — and a doomed authed request on every fresh install
    // is noise in the log of the one screen nobody can skip.
    seedResumedWizard('location');
    const { fetchMock } = renderWizard();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(headersFor(fetchMock, '/api/v1/bootstrap')).toBeNull();
  });
});
