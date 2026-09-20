// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/apps`.
 *
 * Router-mounted like its public-api sibling, because the things worth proving
 * exist only through the router: the route is LAZY (entry-budget law), it sits
 * behind `StudioGuard`, and the heading goes through PageActions.
 *
 * What matters here:
 *
 *  1. a surface without `surface.json` says "rebuild", and offers NO placement
 * control — a toggle that cannot take effect is worse than none;
 *  2. the placement select writes the D9 setting, nothing else;
 *  3. the domains editor saves the WHOLE map, and a refused save shows every
 *     issue the server named — the operator is the only person who can fix it;
 *  4. a save that lands states the TTL + DNS/proxy reality instead of implying
 *     the domain is already live.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import {
  customerAppKeys,
  domainsFromRows,
  rowsFromDomains,
  type SurfaceSummaryDto,
  type SurfacesListReply,
} from './hostedAppsApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function makeSurface(over: Partial<SurfaceSummaryDto> = {}): SurfaceSummaryDto {
  return {
    appKey: 'clients',
    side: 'staff',
    prefix: '/apps/clients/staff',
    navAvailable: true,
    navItems: 3,
    staffPlacement: 'internal',
    connectionId: null,
    boundKey: null,
    nameOverride: null,
    // What the app is called with no override: its own baked label.
    appName: 'Outline',
    domains: [],
    ...over,
  };
}

function makeReply(over: Partial<SurfacesListReply> = {}): SurfacesListReply {
  return {
    instances: {},
    surfaces: [
      makeSurface(),
      makeSurface({
        side: 'customer',
        prefix: '/apps/clients/customer',
        navAvailable: false,
        navItems: 0,
        staffPlacement: null,
        boundKey: { id: 'pbk_1', name: 'portal key', prefix: 'adm_pub_4f2a91cd' },
        domains: ['shop.example.com'],
      }),
    ],
    domains: { 'shop.example.com': { appKey: 'clients', side: 'customer' } },
    ...over,
  };
}

interface StubOptions {
  reply?: SurfacesListReply;
  /** Connections the binding picker offers; the picker hides below two. */
  connections?: { id: string; name: string }[];
  /** Make PUT /surfaces/domains fail with named issues. */
  domainIssues?: boolean;
}

function stubFetch(options: StubOptions = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url,
      ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) as unknown }),
    });

    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(
        jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }) }),
      );
    }
    if (url === '/api/v1/surfaces' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, options.reply ?? makeReply()));
    }
    // The page reads the connection list too, for the staff binding picker.
    // The installed-apps card the page now carries (47 step 3). Empty is the
    // state every assertion below was written against: an instance serving
    // surfaces from a directory, with nothing installed over the API.
    // The shelf (47 step 4b) suspends on this. Checked BEFORE `/api/v1/apps`,
    // which would otherwise swallow it as a prefix.
    if (url === '/api/v1/apps/catalog' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { apps: [], catalogFetchedAt: null, onlineEnabled: false }));
    }
    if (url === '/api/v1/apps' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { apps: [], staged: [] }));
    }
    if (url === '/api/v1/connections' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { connections: options.connections ?? [] }));
    }
    if (url === '/api/v1/surfaces/instances' && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { instances: unknown };
      return Promise.resolve(jsonResponse(200, { instances: body.instances }));
    }
    if (url.endsWith('/connection') && method === 'PUT') {
      return Promise.resolve(jsonResponse(200, { appKey: 'clients', connectionId: 'con_2' }));
    }
    if (url.endsWith('/name') && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { name: string | null };
      return Promise.resolve(jsonResponse(200, { appKey: 'clients', name: body.name }));
    }
    if (url.endsWith('/placement') && method === 'PUT') {
      return Promise.resolve(jsonResponse(200, { appKey: 'clients', staff: 'external' }));
    }
    if (url === '/api/v1/surfaces/domains' && method === 'PUT') {
      if (options.domainIssues === true) {
        return Promise.resolve(
          jsonResponse(422, {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'The domain map did not validate.',
              requestId: 'req_a',
              details: {
                issues: [
                  { path: 'not a host', message: '"not a host" is not a valid hostname.', code: 'invalid_host' },
                  {
                    path: 'admin.example.test',
                    message:
                      '"admin.example.test" is the host you are using to reach Studio — mapping it would take this dashboard away from you.',
                    code: 'request_host',
                  },
                ],
              },
            },
          }),
        );
      }
      const body = JSON.parse(String(init?.body)) as { domains: unknown };
      return Promise.resolve(jsonResponse(200, { domains: body.domains }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

async function renderPage(options: StubOptions = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(options);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/studio/apps'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...stub, queryClient };
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

describe('HostedAppsPage', () => {
  it('resolves the lazy route and lists every discovered surface', async () => {
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'Surfaces' })).toBeTruthy();
    // Staff row: open link + placement select at its stored value.
    expect(screen.getByRole('link', { name: '/apps/clients/staff/' })).toBeTruthy();
    expect((screen.getByLabelText(/Placement/) as HTMLSelectElement).value).toBe('internal');
    // Customer row: bound key summary + its mapped host.
    expect(screen.getByText(/adm_pub_4f2a91cd/)).toBeTruthy();
    expect(screen.getAllByText(/shop\.example\.com/).length).toBeGreaterThan(0);
  });

  it('a staff surface without surface.json says "rebuild" and offers NO placement control', async () => {
    await renderPage({
      reply: makeReply({
        surfaces: [makeSurface({ navAvailable: false, navItems: 0 })],
        domains: {},
      }),
    });
    expect(await screen.findByText(/rebuild this surface/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Placement/)).toBeNull();
  });

  it('writes the placement opt-out and nothing else', async () => {
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Surfaces' });
    await userEvent.selectOptions(screen.getByLabelText(/Placement/), 'external');
    await waitFor(() => {
      expect(
        calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/surfaces/clients/placement'),
      ).toBe(true);
    });
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ staff: 'external' });
  });

  it('saves the whole domain map and then states the TTL + DNS reality', async () => {
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'Domains' });
    await userEvent.click(screen.getByRole('button', { name: 'Attach a domain' }));
    const hosts = screen.getAllByLabelText(/^Host/);
    const added = hosts[hosts.length - 1] as HTMLInputElement;
    await userEvent.type(added, 'staff.example.com');
    const pickers = screen.getAllByLabelText(/^Surface/);
    await userEvent.selectOptions(pickers[pickers.length - 1] as HTMLSelectElement, 'clients/staff');
    await userEvent.click(screen.getByRole('button', { name: 'Save domains' }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/surfaces/domains')).toBe(
        true,
      );
    });
    expect(calls.find((c) => c.url === '/api/v1/surfaces/domains')?.body).toEqual({
      domains: {
        'shop.example.com': { appKey: 'clients', side: 'customer' },
        'staff.example.com': { appKey: 'clients', side: 'staff' },
      },
    });
    expect(await screen.findByText(/take effect within a few seconds/i)).toBeTruthy();
    expect(screen.getByText(/DNS and your proxy/i)).toBeTruthy();

    /*
     * THE THREE STEPS, asserted individually rather than as one blob.
     *
     * Saving is the moment the operator thinks they are finished and are not:
     * DNS, the proxy reload and the per-host sign-in are all still theirs to do,
     * and none of them is something this screen can detect or perform. A
     * mapping with those undone presents as a host that answers NOTHING, with
     * a perfectly correct mapping sitting behind it — so losing any one of
     * these lines costs a debugging session, not a nicety. One assertion each,
     * because a regression that drops a single step should name that step.
     */
    expect(screen.getByText(/Point the host at this server in your DNS/i)).toBeTruthy();
    expect(screen.getByText(/then reload the proxy/i)).toBeTruthy();
    expect(screen.getByText(/session cookies belong to one host/i)).toBeTruthy();
  });

  /*
   * The card had no way out to the docs at all, which is what left its
   * one-sentence subtitle as the entire guidance for a three-layer setup.
   */
  it("renames an app, and offers the app's own name as the placeholder", async () => {
    /*
     * The field every app needed and none had: the name is baked into each
     * bundle, so "Outline" sat in the sidebar of a real business's portal
     * because that is what the sample was called.
     *
     * The PLACEHOLDER is half the feature. Empty means "use what the app
     * ships", and showing that name greyed out is what says so — pre-filling
     * it would make the app's own name look like somebody's decision, and the
     * next save would freeze it there.
     */
    const { calls } = await renderPage();
    await screen.findByRole('heading', { name: 'App names' });

    const field = screen.getByLabelText('Name for clients') as HTMLInputElement;
    expect(field.value).toBe('');
    expect(field.getAttribute('placeholder')).toBe('Outline');

    await userEvent.type(field, 'Acme Client Hub');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/surfaces/clients/name'))).toBe(
        true,
      );
    });
    expect(calls.find((c) => c.url.endsWith('/surfaces/clients/name'))?.body).toEqual({
      name: 'Acme Client Hub',
    });
  });

  it('shows ONE name field per app, not one per surface', async () => {
    // The name belongs to the app; the surfaces list has a row per side. Two
    // fields for one name is two answers waiting to disagree.
    await renderPage();
    await screen.findByRole('heading', { name: 'App names' });
    expect(screen.getAllByLabelText(/^Name for /)).toHaveLength(1);
  });

  it('clearing the field sends null, which restores the built-in name', async () => {
    // Null is an instruction, not an empty value — the server drops the
    // override rather than storing "".
    const { calls } = await renderPage({
      reply: makeReply({
        surfaces: [makeSurface({ nameOverride: 'Acme Client Hub', appName: 'Acme Client Hub' })],
      }),
    });
    await screen.findByRole('heading', { name: 'App names' });

    const field = screen.getByLabelText('Name for clients') as HTMLInputElement;
    expect(field.value).toBe('Acme Client Hub');
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith('/surfaces/clients/name'))).toBe(true);
    });
    expect(calls.find((c) => c.url.endsWith('/surfaces/clients/name'))?.body).toEqual({
      name: null,
    });
  });

  it('links to the domain guide, and does so through the docs base', async () => {
    await renderPage();
    await screen.findByRole('heading', { name: 'Domains' });
    const link = screen.getByRole('link', { name: 'How to set up a domain' });
    expect(link.getAttribute('href')).toBe('https://docs.adminium.dev/self-hosting/app-domains');
    // Opens away from an unsaved editor, and `noreferrer` is the rule for
    // every outbound link in the dashboard.
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('shows EVERY issue a refused domain map came back with', async () => {
    await renderPage({ domainIssues: true });
    await screen.findByRole('heading', { name: 'Domains' });
    await userEvent.click(screen.getByRole('button', { name: 'Save domains' }));
    expect(await screen.findByText(/is not a valid hostname/)).toBeTruthy();
    expect(screen.getByText(/mapping it would take this dashboard away/)).toBeTruthy();
  });

  it('offers a connection picker only once there is a choice, and saves it', async () => {
    /*
     * The binding exists because "the only connection serving" stops being an
     * answer at two connections. Below that the app's inference is already
     * right, so the control would be a question with one possible answer.
     */
    const two = [
      { id: 'con_1', name: 'clients db' },
      { id: 'con_2', name: 'clinic db' },
    ];
    const { calls } = await renderPage({ connections: two });

    const picker = await screen.findByLabelText('Reads');
    await userEvent.selectOptions(picker, 'con_2');

    await waitFor(() => {
      expect(
        calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/surfaces/clients/connection'),
      ).toBe(true);
    });
    expect(calls.find((c) => c.url === '/api/v1/surfaces/clients/connection')?.body).toEqual({
      connectionId: 'con_2',
    });
  });

  it('hides the picker on a single-connection instance', async () => {
    await renderPage({ connections: [{ id: 'con_1', name: 'only db' }] });
    await screen.findByRole('heading', { name: 'Domains' });
    expect(screen.queryByLabelText('Reads')).toBeNull();
  });

  it('adds an instance and saves the whole map', async () => {
    /*
     * A full-map write: what the screen shows is what it sends. That is what
     * makes removing a row expressible without a second endpoint.
     */
    const two = [
      { id: 'con_1', name: 'clients db' },
      { id: 'con_2', name: 'berlin db' },
    ];
    const { calls } = await renderPage({ connections: two });

    await userEvent.click(await screen.findByRole('button', { name: 'Add an instance' }));
    await userEvent.type(screen.getByLabelText('URL segment'), 'berlin');
    // Two controls legitimately say "Reads": the per-surface binding above and
    // this row. The instances card renders last, so its is the final one.
    const reads = screen.getAllByLabelText(/^Reads$/);
    await userEvent.selectOptions(reads[reads.length - 1]!, 'con_2');
    await userEvent.click(screen.getByRole('button', { name: 'Save instances' }));

    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/v1/surfaces/instances')).toBe(true);
    });
    expect(calls.find((c) => c.url === '/api/v1/surfaces/instances')?.body).toEqual({
      instances: { clients: [{ slug: 'berlin', connectionId: 'con_2' }] },
    });
  });

  it('points a domain at an instance, and omits it for the app\'s own mount', async () => {
    /*
     * A mapped host is the one place the app cannot work out its own instance
     * — it never sees the domain map — so this picker is what makes a
     * per-business domain possible at all.
     */
    const { calls } = await renderPage({
      connections: [
        { id: 'con_1', name: 'a' },
        { id: 'con_2', name: 'b' },
      ],
      reply: makeReply({ instances: { clients: [{ slug: 'berlin', connectionId: 'con_2' }] } }),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Attach a domain' }));
    // The fixture already maps a host, so the row just added is the last one.
    const hosts = screen.getAllByLabelText('Host');
    await userEvent.type(hosts[hosts.length - 1]!, 'berlin.example.com');
    const pickers = screen.getAllByLabelText('Instance');
    await userEvent.selectOptions(pickers[pickers.length - 1]!, 'berlin');
    await userEvent.click(screen.getByRole('button', { name: 'Save domains' }));

    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/v1/surfaces/domains')).toBe(true);
    });
    const saved = (
      calls.find((c) => c.url === '/api/v1/surfaces/domains')?.body as {
        domains: Record<string, { instance?: string }>;
      }
    ).domains;
    expect(saved['berlin.example.com']).toEqual({
      appKey: 'clients',
      side: 'staff',
      instance: 'berlin',
    });
    // Every OTHER row omits it entirely — absent is "the app's own mount", and
    // an empty string is not a slug the server would accept.
    for (const [host, target] of Object.entries(saved)) {
      if (host !== 'berlin.example.com') expect(target.instance).toBeUndefined();
    }
  });

  it('shows no instance picker for an app that has none', async () => {
    await renderPage({ connections: [{ id: 'con_1', name: 'a' }] });
    await screen.findByRole('heading', { name: 'Domains' });
    await userEvent.click(screen.getByRole('button', { name: 'Attach a domain' }));
    expect(screen.queryByLabelText('Instance')).toBeNull();
  });

  it('hides the instances editor on a single-connection instance', async () => {
    await renderPage({ connections: [{ id: 'con_1', name: 'only db' }] });
    await screen.findByRole('heading', { name: 'Domains' });
    expect(screen.queryByRole('heading', { name: 'Instances' })).toBeNull();
  });

  it('renders the pointed empty state when nothing is served', async () => {
    await renderPage({ reply: { surfaces: [], domains: {}, instances: {} } });
    expect(await screen.findByText('No app surfaces are being served')).toBeTruthy();
    expect(screen.getByText(/ADMINIUM_SURFACES_DIR/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Domains' })).toBeNull();
  });
});

describe('derived state (pure)', () => {
  it('round-trips rows ⇄ map, dropping blank hosts on the way out', () => {
    const rows = rowsFromDomains({
      'b.example.com': { appKey: 'clients', side: 'staff' },
      'a.example.com': { appKey: 'clients', side: 'customer' },
    });
    expect(rows.map((row) => row.host)).toEqual(['a.example.com', 'b.example.com']);
    expect(
      domainsFromRows([
        ...rows,
        { key: 9, host: '   ', appKey: 'clients', side: 'staff', instance: '' },
      ]),
    ).toEqual({
      'a.example.com': { appKey: 'clients', side: 'customer' },
      'b.example.com': { appKey: 'clients', side: 'staff' },
    });
  });

  it('customerAppKeys picks customer sides only, sorted', () => {
    expect(
      customerAppKeys(
        makeReply({
          surfaces: [
            makeSurface({ appKey: 'zeta', side: 'customer' }),
            makeSurface({ appKey: 'alpha', side: 'customer' }),
            makeSurface({ appKey: 'staffonly', side: 'staff' }),
          ],
        }),
      ),
    ).toEqual(['alpha', 'zeta']);
  });
});
