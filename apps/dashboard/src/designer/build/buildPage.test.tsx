// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The build page, mounted through the real `/design/$sessionId` route, its
 * history read from the catch-up route and its live part sent down a socket
 * this test drives.
 *
 *  1. History draws as it streamed: the message, the text, the steps folded
 *     and summed, "Saved as".
 *  2. Live: text arrives with a caret; a gap in the numbers reads again.
 *  3. Enter sends a turn; while it runs the button is a stop.
 *  4. Cards: a question answered by a choice or in the person's own words, a
 *     data loss kept or removed, a package added.
 *  5. How a turn ended: stopped (Continue, put the files back), a limit
 *     (keep going), a failed model (try again).
 *  6. The top bar: rename, the versions, going back with a dialog that says
 *     the list keeps the later ones.
 *  7. The chat's width moves with the arrow keys, within its bounds.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { DesignerEvent, DesignerEventBody, DesignerVersion } from '../api.js';

const ID = 'ds_000000000000000000000007';

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  constructor() {
    FakeSocket.all.push(this);
  }
  send(frame: string): void {
    this.sent.push(frame);
  }
  close(): void {}
}

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

let calls: Call[];
let stored: DesignerEvent[];
let versions: DesignerVersion[];
let seq: number;

const ev = (turn: number, body: DesignerEventBody, at = seq * 100): DesignerEvent => {
  seq += 1;
  return { ...body, seq, turn, at } as DesignerEvent;
};

const SESSION = {
  id: ID,
  appKey: 'repairs',
  title: 'Repair Desk',
  target: 'auto',
  connectionId: 'env:anthropic',
  model: 'claude-test',
  createdAt: 1,
  updatedAt: 1,
  turns: 1,
  version: 2,
  createdApp: true,
  tokens: { in: 0, out: 0 },
};

beforeEach(() => {
  calls = [];
  seq = 0;
  stored = [];
  versions = [
    { n: 1, name: 'v1', at: Date.now() - 60_000, current: false },
    { n: 2, name: 'v2', at: Date.now() - 30_000, current: false },
    { n: 3, name: 'v3', at: Date.now() - 10_000, current: true },
  ];
  FakeSocket.all = [];
  window.localStorage.clear();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }) }));
      if (url === '/api/v1/system/info') {
        return Promise.resolve(jsonResponse(200, { runtime: 'self-host', smtpConfigured: false, networkFeaturesAllowed: true, lanShare: false, desktopDemo: false, designer: { mode: 'local', link: true } }));
      }
      if (url === `/api/v1/designer/sessions/${ID}` && method === 'GET') return Promise.resolve(jsonResponse(200, { session: SESSION, waiting: [], active: false }));
      if (url === `/api/v1/designer/sessions/${ID}` && method === 'PATCH') return Promise.resolve(jsonResponse(200, { session: { ...SESSION, ...body }, waiting: [], active: false }));
      if (url.startsWith(`/api/v1/designer/sessions/${ID}/events-since`)) {
        const after = Number(new URL(url, 'http://x').searchParams.get('after'));
        return Promise.resolve(jsonResponse(200, { events: stored.filter((event) => event.seq > after), last: stored.at(-1)?.seq ?? 0, more: false }));
      }
      if (url === `/api/v1/designer/sessions/${ID}/versions`) return Promise.resolve(jsonResponse(200, { available: true, versions }));
      if (url === `/api/v1/designer/sessions/${ID}/turns`) return Promise.resolve(jsonResponse(202, { turn: 9 }));
      if (url === `/api/v1/designer/sessions/${ID}/stop`) return Promise.resolve(jsonResponse(200, { stopped: true }));
      if (url === `/api/v1/designer/sessions/${ID}/answers`) return Promise.resolve(jsonResponse(200, { answered: true }));
      if (url.includes('/restore')) return Promise.resolve(jsonResponse(200, { version: { n: 4, name: 'v4' }, applied: true }));
      if (url === '/api/v1/designer/models') {
        return Promise.resolve(
          jsonResponse(200, {
            connections: [{ id: 'env:anthropic', provider: 'anthropic', source: 'environment', state: 'ok', models: [{ id: 'claude-test', label: 'Claude Test' }] }],
            selected: { connectionId: 'env:anthropic', model: 'claude-test' },
            verdicts: [],
            canAdd: true,
          }),
        );
      }
      if (url === '/api/v1/designer/sessions') return Promise.resolve(jsonResponse(200, { apps: [] }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
    }),
  );
});

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

async function open() {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [`/design/${ID}`] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('complementary', { name: 'Chat' });
  return router;
}

/** Open the socket and send events down it, as the server would. */
function live(...events: DesignerEvent[]): void {
  // The session's own socket is the first one opened; the preview opens another for `app-changed`.
  const socket = FakeSocket.all[0];
  if (socket === undefined) throw new Error('no socket');
  act(() => {
    for (const event of events) socket.onmessage?.({ data: JSON.stringify({ channel: `designer:${ID}`, type: 'designer', data: event, ts: '' }) });
  });
}

const posted = (suffix: string) => calls.filter((call) => call.method === 'POST' && call.url === `/api/v1/designer/sessions/${ID}${suffix}`).map((call) => call.body);

function finishedTurn(): DesignerEvent[] {
  return [
    ev(1, { kind: 'turn-started', text: 'A bike repair shop.' }, 0),
    ev(1, { kind: 'text', delta: 'I built Repair Desk.' }),
    ev(1, { kind: 'step', id: 'a', tool: 'write_file', label: 'Wrote', state: 'done', ms: 400, subject: 'apps/repairs/manifest/tables/jobs.json' }),
    ev(1, { kind: 'step', id: 'b', tool: 'write_file', label: 'Wrote', state: 'done', ms: 300, subject: 'apps/repairs/manifest/tables/bikes.json' }),
    ev(1, { kind: 'step', id: 'c', tool: 'check_app', label: 'Checked', state: 'done', ms: 50, count: 0 }),
    ev(1, { kind: 'version', n: 1, name: 'v1' }),
    ev(1, { kind: 'turn-finished', outcome: 'done' }, 1200),
  ];
}

describe('the build page', () => {
  it('draws the history as it streamed', async () => {
    stored = finishedTurn();
    await open();
    expect(await screen.findByText('A bike repair shop.')).toBeTruthy();
    expect(screen.getByText('I built Repair Desk.')).toBeTruthy();
    const summary = screen.getByRole('button', { name: /3 steps · 1\.2 s/ });
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(summary);
    expect(screen.getByText('Wrote 2 files')).toBeTruthy();
    expect(screen.getByText('Checked the app — no errors')).toBeTruthy();
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByText(/Saved as/).textContent).toBe('Saved as v1');
  });

  it('streams a turn with a caret, reads again on a gap, sends on Enter and stops', async () => {
    const history = finishedTurn();
    stored = history;
    await open();
    await screen.findByText('A bike repair shop.');
    const box = screen.getByRole('textbox', { name: 'Message to Adminium Designer' });
    await userEvent.type(box, 'Add the counter screens.{Enter}');
    expect(posted('/turns')).toEqual([{ text: 'Add the counter screens.' }]);

    const begun = ev(2, { kind: 'turn-started', text: 'Add the counter screens.' });
    const first = ev(2, { kind: 'text', delta: 'Working on it' });
    stored = [...history, begun, first];
    live(begun, first);
    expect(await screen.findByText('Working on it')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Working/ }).getAttribute('aria-expanded')).toBe('true');
    // While it runs, the button stops it.
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(posted('/stop')).toHaveLength(1);

    // The server has two more; the socket delivers only the second. The page reads what it missed.
    const missed = ev(2, { kind: 'step', id: 'x', tool: 'build_sides', label: 'Building', state: 'running' });
    const later = ev(2, { kind: 'text', delta: ', nearly there.' });
    stored = [...history, begun, first, missed, later];
    const before = calls.filter((call) => call.url.includes('events-since')).length;
    live(later);
    await waitFor(() => expect(calls.filter((call) => call.url.includes('events-since')).length).toBeGreaterThan(before));
    expect(await screen.findByText('Working on it, nearly there.')).toBeTruthy();
    expect(screen.getByText('Building the screens')).toBeTruthy();
  });

  it('answers a question by a choice, and in the person’s own words', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'Mechanics.' }),
      ev(1, { kind: 'card', card: { id: 'q1', type: 'question', question: 'Should mechanics see part prices?', choices: ['Yes', 'No, hide prices'] } }),
    ];
    await open();
    const card = await screen.findByRole('group', { name: 'Should mechanics see part prices?' });
    await userEvent.click(within(card).getByRole('button', { name: 'No, hide prices' }));
    expect(posted('/answers')).toEqual([{ cardId: 'q1', value: { text: 'No, hide prices' } }]);

    await userEvent.click(within(card).getByRole('button', { name: 'Answer in my own words' }));
    const box = screen.getByRole('textbox', { name: 'Message to Adminium Designer' });
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('placeholder')).toBe('Answer the question above…');
    // A card waits: the button sends, it is not a stop.
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    await userEvent.type(box, 'Only the owner.{Enter}');
    expect(posted('/answers').at(-1)).toEqual({ cardId: 'q1', value: { text: 'Only the owner.' } });
    expect(posted('/turns')).toEqual([]);
  });

  it('asks before data is removed, and before a package is added', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'Drop notes.' }),
      ev(1, { kind: 'card', card: { id: 'r1', type: 'removal', appKey: 'repairs', changes: [{ kind: 'column', table: 'repairs_jobs', tableName: 'jobs', column: 'notes', rows: 127 }] } }),
      ev(1, { kind: 'card', card: { id: 'p1', type: 'package', name: 'qrcode', version: '1.5.4', why: 'QR codes on the customer page.' } }),
    ];
    await open();
    const removal = await screen.findByRole('alert', { name: 'This change removes data' });
    expect(removal.textContent).toContain('Removing the column notes from jobs deletes what is stored in it: 127 rows have a value.');
    await userEvent.click(within(removal).getByRole('button', { name: 'Keep the column' }));
    await userEvent.click(within(removal).getByRole('button', { name: 'Remove it and its data' }));
    // The test DOM pads the mono spans of the name with spaces; the text itself is exact.
    const pkg = screen.getByRole('group', { name: /A package is needed:\s*qrcode/ });
    expect(document.getElementById(pkg.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('A package is needed: qrcode (1.5.4). Add it?');
    await userEvent.click(within(pkg).getByRole('button', { name: 'Add it' }));
    expect(posted('/answers')).toEqual([
      { cardId: 'r1', value: { accept: false } },
      { cardId: 'r1', value: { accept: true } },
      { cardId: 'p1', value: { accept: true } },
    ]);
  });

  it('says a card left unanswered by a turn that ended was not answered, and offers no buttons', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'Drop notes.' }),
      ev(1, { kind: 'card', card: { id: 'r1', type: 'removal', appKey: 'repairs', changes: [{ kind: 'table', table: 'repairs_notes', tableName: 'notes', rows: 3 }] } }),
      ev(1, { kind: 'card', card: { id: 'p1', type: 'package', name: 'qrcode', version: '1.5.4', why: '' } }),
      ev(1, { kind: 'turn-finished', outcome: 'stopped' }),
    ];
    await open();
    const removal = await screen.findByRole('alert', { name: 'This change removes data' });
    expect(removal.textContent).toContain('Removing the table notes deletes its 3 rows.');
    expect(within(removal).getByText('No answer was given.')).toBeTruthy();
    expect(within(removal).queryByRole('button')).toBeNull();
    const pkg = screen.getByRole('group', { name: /A package is needed/ });
    expect(within(pkg).getByText('No answer was given.')).toBeTruthy();
    expect(within(pkg).queryByRole('button')).toBeNull();
  });

  it('offers to continue or put the files back after a stop', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'Add parts.' }),
      ev(1, { kind: 'step', id: 'a', tool: 'write_file', label: 'Wrote', state: 'done', subject: 'apps/repairs/x.json' }),
      ev(1, { kind: 'stopped' }),
      ev(1, { kind: 'turn-finished', outcome: 'stopped' }),
    ];
    await open();
    expect(await screen.findByText('Stopped. Nothing from this turn was saved as a version.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Put the files back' }));
    await waitFor(() => expect(calls.some((call) => call.url === `/api/v1/designer/sessions/${ID}/versions/2/restore`)).toBe(true));
    expect(calls.find((call) => call.url.endsWith('/versions/2/restore'))?.body).toEqual({ record: false });
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(posted('/turns')).toEqual([{ text: 'Continue.' }]);
  });

  it('says a limit and keeps going, and says a failed model and tries again', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'Build it all.' }),
      ev(1, { kind: 'version', n: 5, name: 'v5' }),
      ev(1, { kind: 'limit', which: 'steps', value: 60 }),
      ev(1, { kind: 'turn-finished', outcome: 'limit' }),
      ev(2, { kind: 'turn-started', text: 'Go on.' }),
      ev(2, { kind: 'error', code: 'server', message: 'overloaded', provider: 'Anthropic', status: 529 }),
      ev(2, { kind: 'turn-finished', outcome: 'failed' }),
    ];
    await open();
    expect((await screen.findByText(/This turn reached its limit of/)).textContent).toBe('This turn reached its limit of 60 steps. The work so far is saved as v5.');
    // Only the last turn's buttons act.
    expect(screen.queryByRole('button', { name: 'Keep going' })).toBeNull();
    const failed = screen.getByRole('alert');
    expect(failed.textContent).toContain('The model stopped answering (Anthropic, 529). Nothing was lost.');
    await userEvent.click(within(failed).getByRole('button', { name: 'Try again' }));
    expect(posted('/turns')).toEqual([{ text: 'Go on.' }]);
  });

  it('renames the app, lists the versions and goes back with a word on what stays', async () => {
    stored = finishedTurn();
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Repair Desk' }));
    const field = screen.getByRole('textbox', { name: 'Name of this app' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Tandem Repairs{Enter}');
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ title: 'Tandem Repairs' });

    await userEvent.click(screen.getByRole('button', { name: 'Version v3: v3' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Go back to v1: v1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Go back to v1?' });
    expect(dialog.textContent).toContain('Your files return to v1. v2 and v3 stay in the list, so you can come forward again. Data already in the database is kept.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(calls.find((call) => call.url.endsWith('/versions/1/restore'))?.body).toEqual({ record: true }));
    expect(await screen.findByText('Your files are as they were in v1.')).toBeTruthy();
  });

  it('moves the chat’s edge with the arrow keys, within 340 and 600', async () => {
    await open();
    const edge = screen.getByRole('separator', { name: 'Resize the chat' });
    expect(edge.getAttribute('aria-valuenow')).toBe('420');
    edge.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(edge.getAttribute('aria-valuenow')).toBe('460');
    for (let i = 0; i < 20; i += 1) await userEvent.keyboard('{ArrowLeft}');
    expect(edge.getAttribute('aria-valuenow')).toBe('340');
  });
});
