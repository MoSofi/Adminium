// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Campaigns in the editor: *Send campaign* saves first and POSTs the
 * audience with the picked roles, then reads *Campaign sent!*; *Schedule*
 * sends `scheduleAt` and reads *Campaign scheduled!*; a running run's chip
 * follows a synthetic `jobs:<id>` progress event and `completed` refetches
 * the document; the Design tab's campaign status pills have no click
 * handler (D13); a scheduled campaign's header shows the chip and *Cancel
 * schedule* POSTs `/cancel`. The realtime client is replaced at the module
 * seam so events can be fired by hand.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import type { RealtimeEvent } from '../../app/ws.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { EmailDocumentDetail, EmailRunView } from '../api.js';

interface FakeClient {
  channels: readonly string[];
  onEvent: (event: RealtimeEvent) => void;
}

const realtime = vi.hoisted(() => ({ clients: [] as { channels: readonly string[]; onEvent: (event: unknown) => void }[] }));
vi.mock('../../app/ws.js', () => ({
  createRealtimeClient: (options: { channels: readonly string[]; onEvent: (event: unknown) => void }) => {
    realtime.clients.push(options);
    // Every method of the real client is a no-op here — the shell's client included.
    return new Proxy({}, { get: () => () => undefined });
  },
}));

function run(status: EmailRunView['status'], extra: Partial<EmailRunView> = {}): EmailRunView {
  return {
    id: 'run_1',
    status,
    total: 5,
    sent: 0,
    failed: 0,
    skipped: 1,
    scheduledAt: Date.UTC(2999, 0, 1, 10),
    startedAt: null,
    finishedAt: null,
    jobId: 'job_1',
    audience: { kind: 'users' },
    failures: [],
    createdAt: 1,
    ...extra,
  };
}

function detail(latest?: EmailRunView): EmailDocumentDetail {
  return {
    id: 'et_c',
    kind: 'campaign',
    key: 'launch',
    locale: 'en_US',
    name: 'Launch',
    subject: 'Big news',
    category: 'marketing',
    enabled: true,
    needsTranslation: false,
    archivedAt: null,
    updatedAt: 1,
    isBuiltin: false,
    isBuiltinCopy: false,
    starter: null,
    brand: null,
    heading: 'Hello',
    topicLabel: 'Launch',
    document: { subject: 'Big news', preheader: '', blocks: [{ id: 'b_h', block: 'email.heading', data: { text: 'Hello {{name}}' }, style: {} }], footer: '', brand: null, attachments: [] },
    vars: ['name'],
    languages: [{ id: 'et_c', locale: 'en_US', needsTranslation: false, enabled: true, archived: false }],
    attachmentsResolved: [],
    ...(latest === undefined ? {} : { run: latest }),
  };
}

function role(id: string, name: string) {
  return { id, slug: id, name, description: null, isBuiltin: false, memberCount: 2, createdAt: 1, updatedAt: 1 };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(current: () => EmailDocumentDetail) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, url, body });
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'], nav: { groups: [] } }) }));
      }
      if (url === '/api/v1/branding') return Promise.resolve(jsonResponse(200, { data: { appName: 'Northwind', logoUrl: null, showVersion: true } }));
      if (url === '/api/v1/settings/email') {
        return Promise.resolve(jsonResponse(200, { data: { configured: true, host: 'smtp', port: 587, user: 'u', from: 'no-reply@x.io', secure: true, senders: [], maxAttachmentBytes: 1 } }));
      }
      if (url === '/api/v1/email-templates/et_c' && (method === 'GET' || method === 'PUT')) return Promise.resolve(jsonResponse(200, current()));
      if (url === '/api/v1/email-blocks' && method === 'GET') return Promise.resolve(jsonResponse(200, { blocks: [] }));
      if (url === '/api/v1/roles') return Promise.resolve(jsonResponse(200, { roles: [role('r_admin', 'Admins'), role('r_editor', 'Editors')] }));
      if (url === '/api/v1/email-templates/et_c/audience/preview' && method === 'POST') {
        const input = body as { audience: { roleIds?: string[] } };
        return Promise.resolve(jsonResponse(200, input.audience.roleIds === undefined ? { total: 5, skipped: 1 } : { total: 2, skipped: 0 }));
      }
      if (url === '/api/v1/email-templates/et_c/send' && method === 'POST') {
        const input = body as { scheduleAt?: number };
        return Promise.resolve(jsonResponse(202, { run: input.scheduleAt === undefined ? run('running', { scheduledAt: 1 }) : run('scheduled', { scheduledAt: input.scheduleAt }) }));
      }
      if (url === '/api/v1/email-runs/run_1/cancel' && method === 'POST') return Promise.resolve(jsonResponse(200, { run: run('cancelled') }));
      if (url.startsWith('/api/v1/users')) return Promise.resolve(jsonResponse(200, { users: [], nextCursor: null, counts: { active: 1, invited: 0, suspended: 0 } }));
      if (url.startsWith('/api/v1/files?')) return Promise.resolve(jsonResponse(200, { data: [], nextCursor: null }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${method} ${url}` } }));
    }),
  );
  return calls;
}

async function renderEditor(current: () => EmailDocumentDetail) {
  const calls = stubFetch(current);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/email-templates/et_c'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByTestId('email-inspector');
  return { calls, user: userEvent.setup() };
}

function jobClient(): FakeClient {
  const client = realtime.clients.find((c) => c.channels.includes('jobs:job_1'));
  if (client === undefined) throw new Error('no jobs:job_1 subscription');
  return client as FakeClient;
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
  realtime.clients.length = 0;
});

describe('Campaigns', () => {
  it('Send campaign saves first, POSTs the audience with the picked roles, and reads Campaign sent!', async () => {
    const { user, calls } = await renderEditor(() => detail());
    const heading = screen.getByTestId('email-heading-input');
    await user.click(heading);
    await user.type(heading, '!');
    expect(screen.getByTestId('email-save-chip').textContent).toBe('Unsaved changes');
    await user.click(screen.getByTestId('email-send'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Send campaign' })).toBeDefined();
    expect(within(dialog).getByText('Variables are filled per recipient — {{name}} becomes each person’s name.')).toBeDefined();
    await waitFor(() => {
      expect(within(dialog).getByTestId('email-campaign-count').textContent).toBe('5 recipients · 1 opted out');
    });
    await user.click(within(dialog).getByRole('button', { name: 'Editors' }));
    await waitFor(() => {
      expect(within(dialog).getByTestId('email-campaign-count').textContent).toBe('2 recipients');
    });
    await user.click(within(dialog).getByTestId('email-campaign-send'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/send'))).toHaveLength(1);
    });
    const putIndex = calls.findIndex((c) => c.method === 'PUT');
    const sendIndex = calls.findIndex((c) => c.method === 'POST' && c.url.endsWith('/send'));
    expect(putIndex).toBeGreaterThan(-1);
    expect(putIndex).toBeLessThan(sendIndex);
    expect(calls[sendIndex]?.body).toEqual({ audience: { kind: 'users', roleIds: ['r_editor'] } });
    expect(await screen.findByText('Campaign sent!')).toBeDefined();
    expect(screen.getByText('Launch is on its way to 2 recipients.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('Schedule sends scheduleAt as epoch ms and reads Campaign scheduled!', async () => {
    const { user, calls } = await renderEditor(() => detail());
    await user.click(screen.getByTestId('email-send'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Schedule' }));
    const at = within(dialog).getByTestId('email-campaign-at');
    fireEvent.change(at, { target: { value: '2999-01-01T10:00' } });
    expect(within(dialog).getByTestId('email-campaign-send').textContent).toContain('Schedule campaign');
    await user.click(within(dialog).getByTestId('email-campaign-send'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/send'))).toBe(true);
    });
    const body = calls.find((c) => c.method === 'POST' && c.url.endsWith('/send'))?.body as { audience: unknown; scheduleAt: number };
    expect(body.audience).toEqual({ kind: 'users' });
    expect(body.scheduleAt).toBe(new Date('2999-01-01T10:00').getTime());
    // Nothing was dirty, so nothing was saved first.
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(await screen.findByText('Campaign scheduled!')).toBeDefined();
    expect(screen.getByText(/^Launch goes out /)).toBeDefined();
  });

  it('a running run wears Sending with the job channel progress; completed refetches the document', async () => {
    const { calls } = await renderEditor(() => detail(run('running', { sent: 2 })));
    const chip = screen.getByTestId('email-run-chip');
    expect(chip.getAttribute('data-status')).toBe('running');
    expect(chip.textContent).toContain('Sending · 0%');
    expect(screen.getByTestId('email-send').hasAttribute('disabled')).toBe(true);
    const client = jobClient();
    act(() => {
      client.onEvent({ channel: 'jobs:job_1', type: 'progress', data: { pct: 42, step: 'send', message: '2 sent · 0 failed' }, ts: '2026-09-06T10:00:00Z' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('email-run-chip').textContent).toContain('Sending · 42%');
    });
    const detailGets = () => calls.filter((c) => c.method === 'GET' && c.url === '/api/v1/email-templates/et_c').length;
    const before = detailGets();
    act(() => {
      client.onEvent({ channel: 'jobs:job_1', type: 'completed', data: { jobId: 'job_1', kind: 'email.campaign-run' }, ts: '2026-09-06T10:01:00Z' });
    });
    await waitFor(() => {
      expect(detailGets()).toBeGreaterThan(before);
    });
  });

  it('a scheduled run shows the chip, the status pills are display-only, and Cancel schedule POSTs /cancel', async () => {
    const { user, calls } = await renderEditor(() => detail(run('scheduled')));
    const chip = screen.getByTestId('email-run-chip');
    expect(chip.getAttribute('data-status')).toBe('scheduled');
    expect(chip.textContent).toContain('Scheduled · ');
    expect(screen.getByTestId('email-send').hasAttribute('disabled')).toBe(true);
    // Design → Brand & sender: a campaign's pills are display (D13) — clicking one changes nothing.
    await user.click(screen.getAllByTestId('email-pinned-row')[0] as HTMLElement);
    const panel = await screen.findByTestId('email-branding-panel');
    const pills = () => within(panel).getAllByTestId('email-status-pill');
    expect(pills().map((el) => el.getAttribute('data-status'))).toEqual(['draft', 'scheduled', 'sent']);
    expect(pills().every((el) => el.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(pills()[1]?.getAttribute('aria-pressed')).toBe('true');
    await user.click(pills()[2] as HTMLElement);
    expect(pills()[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('email-save-chip').textContent).toBe('All changes saved');
    await user.click(screen.getByTestId('email-cancel-run'));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/email-runs/run_1/cancel')).toHaveLength(1);
    });
    expect(await screen.findByText('Schedule cancelled')).toBeDefined();
  });
});
