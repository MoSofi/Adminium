/**
 * The receiving end of the local bridge — `takeBridgeTicket` plus the wizard's
 * hand-off prefill (`./bridgeSeed.ts`, `ConnectWizard`).
 *
 * The behaviours pinned here are the ones the bridge's safety story depends on
 * at this end: the ticket leaves the URL the moment it is read, the redeemed
 * DSN lands in a field the user can SEE rather than being submitted for them,
 * and a spent or expired ticket degrades to an ordinary, usable wizard.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
import { ConnectWizard } from './ConnectWizard.js';
import {
  BRIDGE_PARAM,
  captureBridgeTicket,
  hasPendingBridgeTicket,
  takeBridgeTicket,
} from './bridgeSeed.js';

const DSN = 'postgres://ava:secret@db.acme.io:5432/prod';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWizard(bridgeTicket: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectWizard
        onOpenApp={() => undefined}
        bridgeTicket={bridgeTicket}
        lineDelayMs={0}
        pollIntervalMs={1}
      />
    </QueryClientProvider>,
  );
}

describe('captureBridgeTicket / takeBridgeTicket', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/studio/connect');
  });

  it('captures the ticket the site redirected with', () => {
    window.history.replaceState({}, '', `/studio/connect?${BRIDGE_PARAM}=tkt_123`);
    captureBridgeTicket();
    expect(takeBridgeTicket()).toBe('tkt_123');
  });

  it('strips it from the URL in the same breath', () => {
    // A credential-adjacent value has no business surviving in history for a
    // page the user will come back to.
    window.history.replaceState({}, '', `/studio/connect?${BRIDGE_PARAM}=tkt_123`);
    captureBridgeTicket();
    expect(window.location.search).toBe('');
  });

  it('leaves other query parameters alone', () => {
    window.history.replaceState({}, '', `/studio/connect?keep=1&${BRIDGE_PARAM}=tkt_123`);
    captureBridgeTicket();
    expect(window.location.search).toBe('?keep=1');
    expect(takeBridgeTicket()).toBe('tkt_123');
  });

  it('survives the first-run detour to /setup', () => {
    // THE case this storage hop exists for: a fresh install client-side
    // redirects `/studio/connect` straight to `/setup`, so a ticket read only
    // by the connect route would be thrown away before the user had anywhere
    // to put it.
    window.history.replaceState({}, '', `/studio/connect?${BRIDGE_PARAM}=tkt_123`);
    captureBridgeTicket();
    window.history.replaceState({}, '', '/setup');
    expect(hasPendingBridgeTicket()).toBe(true);
    window.history.replaceState({}, '', '/studio/connect');
    expect(takeBridgeTicket()).toBe('tkt_123');
  });

  it('is single-use at this end too', () => {
    window.history.replaceState({}, '', `/studio/connect?${BRIDGE_PARAM}=tkt_123`);
    captureBridgeTicket();
    expect(takeBridgeTicket()).toBe('tkt_123');
    expect(takeBridgeTicket()).toBeNull();
    expect(hasPendingBridgeTicket()).toBe(false);
  });

  it('captures nothing when there is no ticket, or an empty one', () => {
    captureBridgeTicket();
    expect(hasPendingBridgeTicket()).toBe(false);
    window.history.replaceState({}, '', `/studio/connect?${BRIDGE_PARAM}=`);
    captureBridgeTicket();
    expect(hasPendingBridgeTicket()).toBe(false);
  });
});

/**
 * The bridge redemptions among all calls the wizard made.
 *
 * These assertions used to be `toHaveBeenCalledOnce()` on the whole mock, which
 * conflated "the ticket was redeemed once" — the invariant that matters, since
 * a second redemption 404s on a single-use ticket — with "the wizard issued
 * exactly one request in its lifetime", which was only incidentally true. The
 * meta-placement probe (`GET /meta/placement`, which decides whether the meta
 * step can move the store) made the second claim false without touching the
 * first.
 */
function bridgeCalls(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes('/api/v1/bridge/seed/'));
}

describe('ConnectWizard — bridge hand-off', () => {
  it('redeems the ticket and shows the DSN on the source step', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { dsn: DSN, engine: 'postgres' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWizard('tkt_123');

    // It lands on `source`, not further in: the whole promise of the bridge is
    // that the string went to this machine, and the way that is made visible is
    // showing it to the user before anything dials out.
    await waitFor(() => {
      expect(screen.getByText('Connect your database')).toBeDefined();
    });
    const field = await screen.findByDisplayValue(DSN);
    expect(field).toBeDefined();

    expect(bridgeCalls(fetchMock)).toEqual(['/api/v1/bridge/seed/tkt_123']);
  });

  it('tells the user where the string came from', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: { dsn: DSN, engine: 'postgres' } })));
    renderWizard('tkt_123');
    expect(await screen.findByText('Connection string received')).toBeDefined();
  });

  it('redeems exactly once', async () => {
    // The route strips the ticket from the URL, but a re-render must not fire a
    // second redemption either — the second would 404 on a single-use ticket
    // and surface as a spurious failure notice.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { dsn: DSN, engine: 'postgres' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = renderWizard('tkt_123');
    await screen.findByDisplayValue(DSN);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <ConnectWizard onOpenApp={() => undefined} bridgeTicket="tkt_123" lineDelayMs={0} pollIntervalMs={1} />
      </QueryClientProvider>,
    );
    expect(bridgeCalls(fetchMock)).toHaveLength(1);
  });

  it('infers the engine from the scheme when the site did not send one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: { dsn: 'mysql://u:p@h:3306/db', engine: null } })));
    renderWizard('tkt_123');
    expect(await screen.findByDisplayValue('mysql://u:p@h:3306/db')).toBeDefined();
  });

  it('degrades to an ordinary wizard when the ticket is spent or expired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          error: { code: 'BRIDGE_SEED_NOT_FOUND', message: 'gone', requestId: 'req_t' },
        }),
      ),
    );
    renderWizard('tkt_123');

    expect(await screen.findByText('That hand-off could not be used')).toBeDefined();
    // Still fully usable by hand — the failure is a notice, not a dead end.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined();
  });

  it('does not call the bridge at all without a ticket', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    renderWizard(null);
    await waitFor(() => {
      expect(screen.getByText('What do you need?')).toBeDefined();
    });
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('/bridge/');
    }
  });
});
