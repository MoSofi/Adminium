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
 *  5b. A spending mark passed ends nothing: a red notice above the message
 *     box, a sound once when it happens while the page is open.
 *  6. The top bar: rename, the versions, going back with a dialog that says
 *     the list keeps the later ones.
 *  7. The chat's width moves with the arrow keys, within its bounds.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { DesignerEvent, DesignerEventBody, DesignerVersion, YourApp } from '../api.js';

const spendSound = vi.hoisted(() => ({ playSpendSound: vi.fn() }));
vi.mock('./spendSound.js', () => spendSound);

const ID = 'ds_000000000000000000000007';
const NEW_ID = 'ds_000000000000000000000008';

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
let yourApps: YourApp[];
let look: { direction: 'clean' | 'warm' | 'bold' | 'calm' } | null;
let stored: DesignerEvent[];
let versions: DesignerVersion[];
let seq: number;
let uploads: number;
let readsImages: boolean | null;

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
  yourApps = [];
  look = null;
  seq = 0;
  uploads = 0;
  readsImages = true;
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
      if (url === `/api/v1/designer/sessions/${ID}` && method === 'GET') return Promise.resolve(jsonResponse(200, { session: SESSION, waiting: [], active: false, look }));
      if (url === `/api/v1/designer/sessions/${ID}/look`) return Promise.resolve(jsonResponse(200, { look: { direction: body?.['direction'] }, version: { n: 2, name: 'v2' }, applied: true }));
      if (url === `/api/v1/designer/sessions/${ID}` && method === 'PATCH') return Promise.resolve(jsonResponse(200, { session: { ...SESSION, ...body }, waiting: [], active: false }));
      if (url.startsWith(`/api/v1/designer/sessions/${ID}/events-since`)) {
        const after = Number(new URL(url, 'http://x').searchParams.get('after'));
        return Promise.resolve(jsonResponse(200, { events: stored.filter((event) => event.seq > after), last: stored.at(-1)?.seq ?? 0, more: false }));
      }
      if (url === `/api/v1/designer/sessions/${ID}/versions`) return Promise.resolve(jsonResponse(200, { available: true, versions }));
      if (url.startsWith(`/api/v1/designer/sessions/${ID}/attachments?`)) {
        const file = init?.body as File;
        if (file.name === 'refused.csv') return Promise.resolve(jsonResponse(422, { error: { code: 'VALIDATION_FAILED', message: 'That file does not read as a CSV.', requestId: 'r' } }));
        uploads += 1;
        return Promise.resolve(jsonResponse(201, { attachment: { id: `att_${String(uploads).padStart(20, '0')}`, label: file.name, kind: file.type === 'text/csv' ? 'csv' : 'image', mediaType: file.type, bytes: file.size } }));
      }
      if (url === '/api/v1/designer/models/reads-images') return Promise.resolve(jsonResponse(200, { readsImages }));
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
      if (url === '/api/v1/designer/sessions' && method === 'POST') return Promise.resolve(jsonResponse(201, { session: { ...SESSION, id: NEW_ID, turns: 0, version: null, createdApp: false }, turn: null }));
      if (url === '/api/v1/designer/sessions') return Promise.resolve(jsonResponse(200, { apps: yourApps }));
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

  it('draws the reply as Markdown and a miss plainly, not as a failure', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'A bike repair shop.' }, 0),
      ev(1, { kind: 'text', delta: '## Done\n\nI built **Repair Desk** with:\n\n- a `jobs` table\n- a board\n\n<img src=x onerror=alert(1)>' }),
      ev(1, { kind: 'step', id: 'a', tool: 'read_reference', label: 'No such reference', state: 'failed', ms: 2, subject: 'adminium-app/references/guides/nope.md', ended: 'miss' }),
      ev(1, { kind: 'step', id: 'b', tool: 'write_file', label: 'Could not write', state: 'failed', ms: 2, subject: 'apps/repairs/manifest/tables/jobs.json', ended: 'error', detail: 'That is not valid JSON, and nothing was written.' }),
      ev(1, { kind: 'turn-finished', outcome: 'done' }, 900),
    ];
    await open();
    const chat = screen.getByRole('complementary', { name: 'Chat' });
    expect((await within(chat).findByRole('heading', { name: 'Done' })).tagName).toBe('H3');
    expect(within(chat).getByText('Repair Desk').tagName).toBe('STRONG');
    expect(within(chat).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['a jobs table', 'a board']);
    expect(chat.querySelector('img')).toBeNull();
    expect(within(chat).getByText('<img src=x onerror=alert(1)>')).toBeTruthy();

    await userEvent.click(within(chat).getByRole('button', { name: /2 steps/ }));
    const miss = within(chat).getByText(/Looked for/);
    expect(miss.textContent).toBe('Looked for adminium-app/references/guides/nope.md — not there');
    expect(miss.className).not.toContain('text-danger');
    const failed = within(chat).getByText(/Could not write/);
    expect(failed.className).toContain('text-danger');
    expect(within(chat).getByText('That is not valid JSON, and nothing was written.')).toBeTruthy();
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
    // A card that waits takes the focus: it is never left unseen below the fold.
    await waitFor(() => expect(document.activeElement).toBe(card));
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

  it('asks how it should look in the page’s own words, with a swatch for each direction, and sends the direction back', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'A bakery.' }),
      ev(1, { kind: 'card', card: { id: 'l1', type: 'question', question: 'How should it look?', choices: ['clean', 'warm', 'bold', 'calm', 'surprise'], look: true } }),
    ];
    await open();
    const card = await screen.findByRole('group', { name: 'How should it look?' });
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'CleanNeutral greys, a clear blue, crisp corners',
      'WarmCream and brown, a serif for headings, round corners',
      'BoldBlack on white, one strong colour, heavy type',
      'CalmSoft green-grey, light type, room to breathe',
      'Surprise me',
      'Describe it in my own words',
    ]);
    await userEvent.click(within(card).getByRole('button', { name: /^Warm/ }));
    await userEvent.click(within(card).getByRole('button', { name: 'Surprise me' }));
    expect(posted('/answers')).toEqual([
      { cardId: 'l1', value: { text: 'warm' } },
      { cardId: 'l1', value: { text: 'surprise' } },
    ]);
    // Answered, it says the direction by its name, not its id.
    live(ev(1, { kind: 'card-answered', id: 'l1', value: { type: 'question', text: 'warm' } }));
    await waitFor(() => expect(card.textContent).toContain('You answered: Warm'));
  });

  it('asks for the packages a screen needs on one card', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'A bakery.' }),
      ev(1, { kind: 'card', card: { id: 'p3', type: 'package', name: 'react', version: '19.2.0', why: 'The app’s own screens are built with these.', also: [{ name: 'react-dom', version: '19.2.0' }, { name: '@adminiumjs/public-client', version: '0.3.16' }] } }),
    ];
    await open();
    const pkg = await screen.findByRole('group', { name: /Packages are needed/ });
    expect(document.getElementById(pkg.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Packages are needed: react (19.2.0), react-dom (19.2.0), @adminiumjs/public-client (0.3.16). Add them?');
    await userEvent.click(within(pkg).getByRole('button', { name: 'Add them' }));
    expect(posted('/answers')).toEqual([{ cardId: 'p3', value: { accept: true } }]);
  });

  it('changes the look from under the last turn with no turn started, and says what it was changed to', async () => {
    look = { direction: 'clean' };
    stored = finishedTurn();
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Change the look' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.slice(0, 5))).toEqual(['Clean', 'WarmC', 'BoldB', 'CalmS']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: /^Warm/ }));
    await waitFor(() => expect(calls.filter((call) => call.url === `/api/v1/designer/sessions/${ID}/look`).map((call) => call.body)).toEqual([{ direction: 'warm' }]));
    expect(posted('/turns')).toEqual([]);
    live(ev(1, { kind: 'look', direction: 'warm' }), ev(1, { kind: 'version', n: 2, name: 'v2' }));
    expect(await screen.findByText('Look changed to Warm')).toBeTruthy();

    // An app with no screens of its own (or a copy of a published one) is offered no look.
    cleanup();
    look = null;
    await open();
    await screen.findByText('I built Repair Desk.');
    expect(screen.queryByRole('button', { name: 'Change the look' })).toBeNull();
  });

  it('says a provider’s own reason when it refused, as text', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'A bakery.' }),
      ev(1, { kind: 'error', code: 'http', message: 'ollama: HTTP 402 — {"error":"this model is not included in your free usage, add usage credits: https://ollama.com/settings"}', provider: 'ollama', status: 402 }),
      ev(1, { kind: 'turn-finished', outcome: 'failed' }),
    ];
    await open();
    const note = await screen.findByRole('alert');
    expect(note.textContent).toContain('The model stopped answering (ollama, 402). Nothing was lost.');
    expect(note.textContent).toContain('this model is not included in your free usage, add usage credits: https://ollama.com/settings');
    expect(note.querySelector('a')).toBeNull();
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

  it('asks before an add-on is got, says what getting it sends, and says more when the list is off', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'Invoices for my jobs.' }),
      ev(1, { kind: 'card', card: { id: 'a1', type: 'add-on', key: 'invoices', name: 'Invoices & Receipts', version: '1.0.7', line: 'Invoices and receipts for an app.' } }),
      ev(1, { kind: 'card', card: { id: 'a2', type: 'add-on', key: 'bookings', name: 'bookings', version: null, line: '', listOff: true } }),
      ev(1, { kind: 'card', card: { id: 'a3', type: 'add-on', key: 'quotes', name: 'Quotes', version: '1.0.0', line: '', here: true } }),
    ];
    await open();
    const listed = await screen.findByRole('group', { name: 'This app needs the add-on Invoices & Receipts (1.0.7), which is not on this server. Get it?' });
    expect(listed.textContent).toContain('Invoices and receipts for an app.');
    expect(listed.textContent).toContain('names this add-on and its version to adminium.dev');
    await userEvent.click(within(listed).getByRole('button', { name: 'Get it' }));

    const off = screen.getByRole('group', { name: /Switch the list of adminium.dev on and get it\?/ });
    expect(off.textContent).toContain('tells it this server’s address, the time and its Adminium version');
    await userEvent.click(within(off).getByRole('button', { name: 'Do without' }));
    expect(within(off).getByRole('button', { name: 'Switch it on and get it' })).toBeTruthy();

    const here = screen.getByRole('group', { name: /It is on this server and not installed/ });
    expect(here.textContent).toContain('Nothing is downloaded.');
    expect(within(here).getByRole('button', { name: 'Install it' })).toBeTruthy();
    expect(posted('/answers')).toEqual([
      { cardId: 'a1', value: { accept: true } },
      { cardId: 'a2', value: { accept: false } },
    ]);
  });

  it('attaches files to a message: they go up first, the turn names them, and one can be taken off', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:shot', revokeObjectURL: () => undefined }));
    readsImages = false;
    await open();
    const input = document.querySelector<HTMLInputElement>('[data-part="attach-input"]')!;
    await userEvent.upload(input, [new File(['png'], 'shot.png', { type: 'image/png' }), new File(['a,b\n1,2\n'], 'orders.csv', { type: 'text/csv' }), new File(['x'], 'extra.csv', { type: 'text/csv' })]);
    const list = screen.getByRole('list', { name: 'Attached files' });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['shot.png', 'orders.csv', 'extra.csv']);
    // Said before sending, not after a wasted turn.
    expect(await screen.findByText('claude-test does not read pictures. Describe what matters in it, or pick a model that does.')).toBeTruthy();
    await userEvent.click(within(list).getByRole('button', { name: 'Take extra.csv off' }));

    // What is plainly neither kind is said at once, and nothing is sent for it.
    fireEvent.drop(screen.getByRole('textbox', { name: 'Message to Adminium Designer' }), { dataTransfer: { files: [new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' })], types: ['Files'] } });
    expect(screen.getByRole('alert').textContent).toBe('Only a picture (PNG, JPEG, WebP or GIF) or a CSV file can be attached.');

    await userEvent.type(screen.getByRole('textbox', { name: 'Message to Adminium Designer' }), 'Like this, with these orders.{Enter}');
    await waitFor(() => expect(posted('/turns')).toEqual([{ text: 'Like this, with these orders.', attachments: ['att_00000000000000000001', 'att_00000000000000000002'] }]));
    const order = calls.filter((call) => call.method === 'POST' && call.url.includes(`/sessions/${ID}/`)).map((call) => call.url.replace(/\?.*/, '').split('/').pop());
    expect(order).toEqual(['attachments', 'attachments', 'turns']);
    // Sent: the box and its files are cleared.
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Attached files' })).toBeNull());
  });

  it('keeps the message and says why when the server refuses a file', async () => {
    await open();
    await userEvent.upload(document.querySelector<HTMLInputElement>('[data-part="attach-input"]')!, new File(['<html>'], 'refused.csv', { type: 'text/csv' }));
    const box = screen.getByRole('textbox', { name: 'Message to Adminium Designer' });
    await userEvent.type(box, 'Use this.{Enter}');
    expect(await screen.findByText('That file does not read as a CSV.')).toBeTruthy();
    expect(posted('/turns')).toEqual([]);
    expect((box as HTMLTextAreaElement).value).toBe('Use this.');
  });

  it('shows a sent message’s files, and asks before a file’s rows are loaded', async () => {
    stored = [
      ev(1, { kind: 'turn-started', text: 'Here are my orders.', attachments: [{ id: 'att_00000000000000000001', label: 'orders.csv', kind: 'csv', rows: 1204 }, { id: 'att_00000000000000000002', label: 'shot.png', kind: 'image' }] }),
      ev(1, { kind: 'card', card: { id: 'r1', type: 'rows', attachment: 'att_00000000000000000001', file: 'orders.csv', table: 'orders', rows: 1200, left: 4, reasons: ['row 7, email: is required'], mapping: [{ from: 'Customer', to: 'name' }, { from: 'E-mail', to: 'email' }] } }),
    ];
    await open();
    const files = await screen.findByRole('list', { name: 'Attached files' });
    expect(files.textContent).toContain('orders.csv');
    expect(files.textContent).toContain('1,204 rows');
    const picture = within(files).getByRole('link', { name: 'Open shot.png in a new tab' });
    expect(picture.getAttribute('href')).toBe(`/api/v1/designer/sessions/${ID}/attachments/att_00000000000000000002`);
    expect(picture.getAttribute('rel')).toBe('noreferrer');

    const card = screen.getByRole('group', { name: /Load 1,200 rows from\s*orders.csv\s*into\s*orders\s*\?/ });
    expect(card.textContent).toContain('Customer → name');
    expect(card.textContent).toContain('4 rows do not pass the table’s checks and are left out. row 7, email: is required');
    await userEvent.click(within(card).getByRole('button', { name: 'Do not load' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Load them' }));
    expect(posted('/answers')).toEqual([
      { cardId: 'r1', value: { accept: false } },
      { cardId: 'r1', value: { accept: true } },
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

  it('warns above the message box past a spending mark, with a sound once, and stops nothing', async () => {
    spendSound.playSpendSound.mockClear();
    // A session read from its file: the session's mark was passed earlier. It is said, not sounded.
    const history = [
      ev(1, { kind: 'turn-started', text: 'Build it all.' }),
      ev(1, { kind: 'spend', which: 'session-tokens', mark: 15_000_000, used: 15_000_400 }),
      ev(1, { kind: 'turn-finished', outcome: 'done' }),
    ];
    stored = history;
    await open();
    const chat = screen.getByRole('complementary', { name: 'Chat' });
    expect((await within(chat).findByRole('alert')).textContent).toBe('This session has used more than 15,000,000 tokens. Nothing is stopped. A new session starts the count again. Start a new session');
    expect(spendSound.playSpendSound).not.toHaveBeenCalled();

    // A turn passes its own mark while the page is open: heard once, and the turn goes on.
    const begun = ev(2, { kind: 'turn-started', text: 'More.' });
    const over = ev(2, { kind: 'spend', which: 'turn-tokens', mark: 1_500_000, used: 1_500_900 });
    const after = ev(2, { kind: 'text', delta: 'Still at it.' });
    stored = [...history, begun, over, after];
    live(begun, over, after);
    expect(await screen.findByText('Still at it.')).toBeTruthy();
    expect(within(chat).getByRole('alert').textContent).toContain('This turn has used more than 1,500,000 tokens and is still working.');
    expect(within(chat).getByRole('alert').textContent).toContain('This session has used more than 15,000,000 tokens.');
    expect(spendSound.playSpendSound).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByText(/reached its limit/)).toBeNull();
  });

  it('starts a new session on the same app, lists the earlier ones, and offers neither a twin nor one mid-turn', async () => {
    yourApps = [
      {
        key: 'repairs',
        name: 'Repair Desk',
        version: 2,
        editedAt: 5,
        sessionId: ID,
        sessions: [
          { id: ID, title: 'Repair Desk', updatedAt: Date.now() - 60_000, turns: 1 },
          { id: 'ds_000000000000000000000001', title: 'Repair Desk, first try', updatedAt: Date.now() - 3_600_000, turns: 12 },
        ],
      },
    ];
    stored = [...finishedTurn(), ev(2, { kind: 'turn-started', text: 'More.' }), ev(2, { kind: 'spend', which: 'session-tokens', mark: 15_000_000, used: 15_000_001 })];
    const router = await open();
    // A turn is running: no new session from under it.
    const button = await screen.findByRole('button', { name: 'New session' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(within(screen.getByRole('alert')).queryByRole('button', { name: 'Start a new session' })).toBeNull();

    live(ev(2, { kind: 'turn-finished', outcome: 'done' }));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    // The earlier sessions stay reachable.
    await userEvent.click(screen.getByRole('button', { name: 'Sessions on this app' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([expect.stringMatching(/^Repair Desk.*1 turn$/), expect.stringMatching(/^Repair Desk, first try.*12 turns$/)]);
    await userEvent.keyboard('{Escape}');

    // The spend notice's last sentence has a button behind it.
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Start a new session' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/design/${NEW_ID}`));
    expect(calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/designer/sessions').map((call) => call.body)).toEqual([
      { appKey: 'repairs', name: 'Repair Desk', target: 'auto', connectionId: 'env:anthropic', model: 'claude-test' },
    ]);
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
