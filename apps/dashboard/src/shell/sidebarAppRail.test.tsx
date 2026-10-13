// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's section of the rail: a page its app keeps off the sidebar is not
 * drawn (and a group left empty has no heading), an entry that is not a page
 * opens the address the server wrote for it, and an address that is not one
 * is never made a link. Rendered through the real shell.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { appPagesOf, type BootstrapData } from '../app/bootstrap.js';
import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const item = (over: Record<string, unknown>) => ({ pageId: 'p', slug: '', labelKey: 'x', fallback: 'x', icon: 'box', order: 1, connectionId: null, connectionName: null, currency: null, sourceTable: null, appKey: 'crm', addOnKey: null, ...over });
const link = (ref: string, fallback: string, href: string, document = false) => item({ pageId: `link:${ref}`, labelKey: `nav.link.crm.${ref}`, fallback, link: { href, document } });
const pageItem = (slug: string, fallback: string, over: Record<string, unknown> = {}) => item({ pageId: `page_${slug}`, slug, labelKey: `nav.${slug}`, fallback, ...over });

/** The twelve items of the design, with the app's other pages kept off the sidebar. */
const SECTION = {
  appKey: 'crm',
  label: 'Sales CRM',
  version: '1.0.0',
  staff: null,
  groups: [
    {
      key: '',
      label: null,
      items: [
        pageItem('crm-overview', 'Overview'),
        pageItem('crm-pipeline', 'Pipeline'),
        pageItem('crm-deals', 'Deals'),
        pageItem('crm-companies', 'Companies'),
        pageItem('crm-contacts', 'Contacts'),
        pageItem('crm-quotes', 'Quotes'),
        link('approvals', 'Approvals', '/apps/crm/staff/approvals', true),
        pageItem('crm-enquiries', 'Enquiries'),
        pageItem('crm-jobs', 'Jobs'),
        pageItem('crm-stages', 'Stages', { offRail: true }),
      ],
    },
    { key: 'setup', label: 'Set up', items: [link('rules', 'Rules', '/automations?app=crm'), link('emails', 'Emails', '/email-templates?app=crm'), link('sample-data', 'Sample data', '/studio/apps/crm')] },
    // Every page of this group is kept off the sidebar: no heading is drawn for it.
    { key: 'supply', label: 'Supply', items: [pageItem('crm-suppliers', 'Suppliers', { offRail: true }), pageItem('crm-orders', 'Purchase orders', { offRail: true })] },
  ],
};

async function renderRail(section: Record<string, unknown>, at = '/studio/connect'): Promise<ReturnType<typeof createAppRouter>> {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/branding')) return Promise.resolve(jsonResponse(200, { data: { appName: 'Adminium', logoUrl: null, showVersion: true } }));
      if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ appSections: [section] } as unknown as Partial<BootstrapData>) }));
      if (url.startsWith('/api/v1/me/notifications')) return Promise.resolve(jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_a' } }));
    }),
  );
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [at] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('navigation', { name: 'Primary' });
  return router;
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

const section = (): HTMLElement => document.querySelector<HTMLElement>('[data-part="nav-app-section"]')!;

describe('an app\'s section of the rail', () => {
  it('draws the twelve items, in order, and none of the pages kept off the sidebar', async () => {
    await renderRail(SECTION);
    const links = within(section()).getAllByRole('link');
    expect(links.map((entry) => [entry.textContent, entry.getAttribute('href')])).toEqual([
      ['Overview', '/p/crm-overview'],
      ['Pipeline', '/p/crm-pipeline'],
      ['Deals', '/p/crm-deals'],
      ['Companies', '/p/crm-companies'],
      ['Contacts', '/p/crm-contacts'],
      ['Quotes', '/p/crm-quotes'],
      ['Approvals', '/apps/crm/staff/approvals'],
      ['Enquiries', '/p/crm-enquiries'],
      ['Jobs', '/p/crm-jobs'],
      ['Rules', '/automations?app=crm'],
      ['Emails', '/email-templates?app=crm'],
      ['Sample data', '/studio/apps/crm'],
    ]);
    expect(within(section()).getByText('Set up')).toBeTruthy();
    // A group whose every page is kept off the sidebar has no heading.
    expect(within(section()).queryByText('Supply')).toBeNull();
    for (const off of ['Stages', 'Suppliers', 'Purchase orders']) expect(screen.queryByRole('link', { name: off })).toBeNull();
  });

  it('a page kept off the sidebar still resolves by its address; an entry that is not a page is no page', () => {
    const slugs = appPagesOf(makeBootstrap({ appSections: [SECTION] } as unknown as Partial<BootstrapData>)).map((page) => page.slug);
    expect(slugs).toContain('crm-stages');
    expect(slugs).toContain('crm-suppliers');
    expect(slugs).not.toContain('');
    expect(slugs).toHaveLength(11);
  });

  it('a dashboard screen is followed in place and marked while shown; the staff side opens as a document', async () => {
    const router = await renderRail(SECTION);
    const rules = within(section()).getByRole('link', { name: 'Rules' });
    expect(rules.getAttribute('target')).toBeNull();
    fireEvent.click(rules);
    await waitFor(() => expect(router.state.location.href).toBe('/automations?app=crm'));
    await waitFor(() => expect(within(section()).getByRole('link', { name: 'Rules' }).getAttribute('aria-current')).toBe('page'));
    expect(within(section()).getByRole('link', { name: 'Emails' }).getAttribute('aria-current')).toBeNull();

    const approvals = within(section()).getByRole('link', { name: 'Approvals' });
    expect(approvals.getAttribute('target')).toBe('_blank');
    expect(approvals.getAttribute('rel')).toBe('noreferrer');
  });

  it('an address that is not one is never made a link', async () => {
    const forged = {
      ...SECTION,
      groups: [
        {
          key: '',
          label: null,
          items: [
            link('a', 'Forged A', 'javascript:alert(1)'),
            link('b', 'Forged B', '//evil.example/x'),
            link('c', 'Forged C', '/\\evil.example'),
            link('d', 'Forged D', 'javascript:alert(1)', true),
            link('e', 'Forged E', 'data:text/html,x', true),
            pageItem('crm-deals', 'Deals'),
          ],
        },
      ],
    };
    await renderRail(forged);
    const hrefs = [...section().querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
    expect(hrefs).toEqual([null, null, null, null, null, '/p/crm-deals']);
  });

  it('a section left with nothing to draw is not drawn', async () => {
    await renderRail({ ...SECTION, groups: [SECTION.groups[2]!] });
    expect(document.querySelector('[data-part="nav-app-section"]')).toBeNull();
  });
});
