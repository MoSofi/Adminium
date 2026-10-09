// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The assistant's panel.
 *
 * WHAT IS PINNED HERE, and it is not the look (the comp is, and the e2e and
 * the stories hold the panel against it):
 *
 *  1. one conversation a person: found again on load, made by the first
 *     question and not before, ended only by "New conversation";
 *  2. every question carries the page it is asked on, read from the page
 *     channel, and what "these" means there, unless the person put it away;
 *  3. what each refusal becomes: still working elsewhere, closed elsewhere,
 *     no model, the day used up, a conversation closed for its age;
 *  4. how it stands: a landmark beside the page, or a dialog in front of it
 *     with the page inert and Escape to close;
 *  5. what the bubble is told while the panel is closed.
 *
 * i18n is not installed, as in the window's test: the English renders.
 */
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageActions, PageActionsProvider } from '../../shell/PageActionsProvider.js';
import { AssistantDock } from './AssistantDock.js';
import type { DockLayout } from './dockLayout.js';
import { resetDock, setDockOpen, useDockOpen, useDockSignal } from './dockStore.js';

// How it stands is decided from measurements a DOM without layout cannot give: said by the test.
let layout: DockLayout = 'docked';
vi.mock('./dockLayout.js', async (original) => ({
  ...(await original<typeof import('./dockLayout.js')>()),
  dockLayout: () => layout,
}));

interface Call {
  url: string;
  method: string;
  body: unknown;
}
let calls: Call[] = [];
let routes: Record<string, (body: unknown) => unknown> = {};
const BASE = '/api/v1/assistant';
const key = (method: string, url: string) => `${method} ${url.split('?')[0] ?? url}`;

class Refusal {
  constructor(
    readonly status: number,
    readonly details: Record<string, unknown>,
  ) {}
}

function respond(answer: unknown): Response {
  if (answer instanceof Refusal) {
    const body = { error: { code: 'CONFLICT', message: 'raw server text', requestId: 'req', details: answer.details } };
    return { ok: false, status: answer.status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  }
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => answer } as unknown as Response;
}

const availability = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  reason: null,
  name: 'Milo',
  rowData: true,
  canWrite: true,
  canConfigure: true,
  provider: 'anthropic',
  model: 'm',
  budget: { limit: 500_000, used: 0, resetsAt: Date.UTC(2026, 9, 10), left: true },
  ...over,
});
const session = { id: 'ast_1', context: 'data', status: 'open', provider: 'anthropic', model: 'm', tokensIn: 0, tokensOut: 0, createdAt: 1 };
const facts = (values: Record<string, unknown> = { tables: 14, page: 'Customers', table: 'main.customers' }) => ({
  facts: { values, scope: { primary: 'main.customers', extra: 13 } },
  nextTurnTokens: 3300,
});
function turn(over: Record<string, unknown> = {}) {
  return {
    id: 'atn_1',
    sessionId: 'ast_1',
    seq: 1,
    status: 'done',
    jobId: 'job_1',
    askText: 'How many rows are shown here?',
    say: 'There are 12 rows shown here.',
    steps: [],
    ask: null,
    result: null,
    error: null,
    tokensIn: 400,
    tokensOut: 20,
    createdAt: 1,
    finishedAt: 2,
    context: 'data',
    answer: { sources: ['c.main.customers'], reads: [], truncated: false },
    on: { pageId: 'page_1', documentId: null, title: 'Customers', scope: null },
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  layout = 'docked';
  routes = {
    [key('GET', `${BASE}/availability`)]: () => availability(),
    [key('GET', `${BASE}/sessions/current`)]: () => ({ session: null, turns: [], earlier: 0, aged: false }),
    [key('POST', `${BASE}/facts`)]: () => facts(),
  };
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, method, body });
    const handler = routes[key(method, url)];
    if (handler === undefined) throw new Error(`unscripted request: ${method} ${url}`);
    const answer = handler(body);
    // A handler may hold its reply back: a server that has not answered yet.
    return answer instanceof Promise ? answer.then(respond) : Promise.resolve(respond(answer));
  });
  vi.stubGlobal('WebSocket', class { close(): void {} });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
});

afterEach(() => {
  cleanup();
  resetDock();
  vi.unstubAllGlobals();
});

const CUSTOMERS = { context: 'data', host: { connectionIds: ['c1'], pageId: 'page_1' } };

/** The shell's row: the page column, then the panel, sharing the page channel. */
function mount(page: ReactNode = <PageActions assistant={CUSTOMERS} assistantShown={{ title: 'Customers' }} />, visible = true) {
  function Signals() {
    return <output data-testid="signals">{`${String(useDockOpen())}|${useDockSignal()}`}</output>;
  }
  const rootRoute = createRootRoute({
    component: () => (
      <PageActionsProvider>
        <div data-testid="page-column">
          <Signals />
          {page}
        </div>
        <AssistantDock visible={visible} />
      </PageActionsProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) });
  return render(<RouterProvider router={router} />);
}

const posts = (suffix: string) => calls.filter((call) => call.method === 'POST' && call.url.endsWith(suffix)).map((call) => call.body as Record<string, unknown>);
const lookingAt = () => screen.getByTestId('assistant-looking-at').textContent;

describe('the conversation', () => {
  it('opens on nothing: the page it is looking at, a greeting, and no conversation made yet', async () => {
    mount(
      <>
        <PageActions assistant={CUSTOMERS} assistantShown={{ title: 'Customers' }} />
        <PageActions assistantView={{}} assistantShown={{ rows: 214 }} />
      </>,
    );
    await screen.findByTestId('assistant-looking-at');
    await waitFor(() => expect(lookingAt()).toBe('Customers · 214 rows shown'));
    expect(await screen.findByText('I can read what this page shows, and the other tables your role can read.')).toBeTruthy();
    await waitFor(() => expect(posts('/facts')).toHaveLength(1));
    expect(posts('/facts')[0]).toMatchObject({ context: 'data', host: { pageId: 'page_1' } });
    expect(posts('/sessions')).toHaveLength(0);
    expect((screen.getByTestId('assistant-new') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says it is loading the conversation until the server has answered, and takes no question meanwhile', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => new Promise(() => undefined);
    mount();
    expect((await screen.findByTestId('assistant-looking-at')).textContent).toBe('Loading conversation…');
    expect((screen.getByTestId('assistant-input') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('Try')).toBeNull();
  });

  it('makes the conversation with the first question, and asks it on the page with what the page shows', async () => {
    routes[key('POST', `${BASE}/sessions`)] = () => ({ session, facts: facts().facts, nextTurnTokens: 3300 });
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({ turn: turn(), jobId: 'job_1', nextTurnTokens: 9 });
    mount(
      <>
        <PageActions assistant={CUSTOMERS} assistantShown={{ title: 'Customers' }} />
        <PageActions assistantView={{ q: 'an', order: 'name.asc' }} assistantShown={{ rows: 8 }} />
      </>,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('assistant-input'), 'How many rows are shown here?{Enter}');
    expect(await screen.findByText('There are 12 rows shown here.')).toBeTruthy();

    expect(posts('/sessions')).toEqual([{ kind: 'panel', context: 'data', host: { connectionIds: ['c1'], pageId: 'page_1', view: { q: 'an', order: 'name.asc' } } }]);
    expect(posts('/turns')).toEqual([
      { text: 'How many rows are shown here?', context: 'data', host: { connectionIds: ['c1'], pageId: 'page_1', view: { q: 'an', order: 'name.asc' } } },
    ]);
    // Every turn says where it was asked.
    expect(screen.getByTestId('assistant-asked-on').textContent).toBe('on Customers');
    // The estimate under the field stays the page's, not the size of the next message alone.
    expect(await screen.findByText('~3300 tokens')).toBeTruthy();
  });

  it('finds the conversation the person left, with where each question was asked and what "these" meant', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => ({
      session,
      earlier: 4,
      aged: false,
      turns: [
        turn({ on: { pageId: 'page_1', documentId: null, title: 'Customers', scope: { kind: 'selection', count: 3 } } }),
        turn({ id: 'atn_2', seq: 2, askText: 'And orders?', say: 'Eighteen.', on: { pageId: 'page_2', documentId: null, title: 'Orders', scope: null } }),
      ],
    });
    mount();
    expect(await screen.findByText('Eighteen.')).toBeTruthy();
    expect(screen.getAllByTestId('assistant-asked-on').map((label) => label.textContent)).toEqual(['on Customers', 'on Orders']);
    expect(screen.getByTestId('assistant-asked-scope').textContent).toBe('3 selected');
    expect(screen.getByText('4 earlier messages are not shown.')).toBeTruthy();
    // No greeting over a conversation.
    expect(screen.queryByText('Try')).toBeNull();
  });

  it('ends only when the person starts a new one', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => ({ session, earlier: 0, aged: false, turns: [turn()] });
    routes[key('POST', `${BASE}/sessions/ast_1/close`)] = () => null;
    mount();
    await screen.findByText('There are 12 rows shown here.');
    await userEvent.setup().click(screen.getByTestId('assistant-new'));
    await waitFor(() => expect(screen.queryByText('There are 12 rows shown here.')).toBeNull());
    expect(posts('/close')).toHaveLength(1);
    expect(screen.getByText('Try')).toBeTruthy();
  });

  it('on a screen that said nothing of itself, is the general assistant and is told the route', async () => {
    routes[key('POST', `${BASE}/facts`)] = () => facts({ tables: 14 });
    mount(null);
    await waitFor(() => expect(posts('/facts')).toHaveLength(1));
    expect(posts('/facts')[0]).toMatchObject({ context: 'general', host: { connectionIds: [] } });
    expect(await screen.findByText('I can read the tables your role can read, and tell you where things are done.')).toBeTruthy();
    expect(lookingAt()).toBe('This workspace');
  });

  it('stops a question that is being answered', async () => {
    routes[key('POST', `${BASE}/sessions`)] = () => ({ session, facts: facts().facts, nextTurnTokens: 3300 });
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({ turn: turn({ status: 'running', say: null, answer: null }), jobId: 'job_1', nextTurnTokens: 9 });
    routes[key('GET', `${BASE}/sessions/ast_1/turns/atn_1`)] = () => turn({ status: 'cancelled', say: null, answer: null });
    routes[key('POST', `${BASE}/sessions/ast_1/turns/atn_1/cancel`)] = () => null;
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('assistant-input'), 'Count them{Enter}');
    // The send button has become Stop, and nothing more can be typed meanwhile.
    const stop = await screen.findByTestId('assistant-stop');
    expect(screen.queryByTestId('assistant-send')).toBeNull();
    expect((screen.getByTestId('assistant-input') as HTMLInputElement).disabled).toBe(true);
    await user.click(stop);
    await waitFor(() => expect(posts('/cancel')).toHaveLength(1));
    expect(await screen.findByTestId('assistant-send')).toBeTruthy();
  });
});

describe('what "these" will mean', () => {
  const withView = (view: Record<string, unknown>, shown: Record<string, unknown> = {}) => (
    <>
      <PageActions assistant={CUSTOMERS} assistantShown={{ title: 'Customers' }} />
      <PageActions assistantView={view} assistantShown={shown} />
    </>
  );

  it('says ticked rows, a filtered grid with its count, or the open record; and nothing for a whole table', async () => {
    const { unmount } = mount(withView({ selectedIds: ['1', '2', '3'], q: 'an' }, { rows: 8 }));
    expect((await screen.findByTestId('assistant-chip-scope')).textContent).toContain('3 selected');
    unmount();

    const filtered = mount(withView({ q: 'an' }, { rows: 8 }));
    expect((await screen.findByTestId('assistant-chip-scope')).textContent).toContain('8 filtered rows');
    filtered.unmount();

    const record = mount(
      <>
        <PageActions assistant={CUSTOMERS} assistantView={{ recordId: '1042' }} assistantShown={{ title: 'Orders', record: 'Order #1042' }} />
      </>,
    );
    expect((await screen.findByTestId('assistant-chip-scope')).textContent).toContain('Order #1042');
    expect(lookingAt()).toBe('Orders · Order #1042 open');
    record.unmount();

    mount(withView({ order: 'name.asc' }, { rows: 214 }));
    await screen.findByTestId('assistant-input');
    expect(screen.queryByTestId('assistant-chip-scope')).toBeNull();
  });

  it('can be put away: the next question is asked without it', async () => {
    routes[key('POST', `${BASE}/sessions`)] = () => ({ session, facts: facts().facts, nextTurnTokens: 3300 });
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({ turn: turn(), jobId: 'job_1', nextTurnTokens: 9 });
    mount(withView({ selectedIds: ['1', '2', '3'] }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ask without “3 selected”' }));
    expect(screen.queryByTestId('assistant-chip-scope')).toBeNull();
    await user.type(screen.getByTestId('assistant-input'), 'How many customers?{Enter}');
    await screen.findByText('There are 12 rows shown here.');
    expect(posts('/turns')[0]).toEqual({ text: 'How many customers?', context: 'data', host: { connectionIds: ['c1'], pageId: 'page_1' } });
  });
});

describe('what a refusal becomes', () => {
  async function askRefused(details: Record<string, unknown>) {
    routes[key('GET', `${BASE}/sessions/current`)] = () => ({ session, earlier: 0, aged: false, turns: [turn()] });
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => new Refusal(409, details);
    mount();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('assistant-input'), 'And now?{Enter}');
    return user;
  }

  it('says the last question is still being worked on, when it is running in another window', async () => {
    await askRefused({ reason: 'busy' });
    expect((await screen.findByTestId('assistant-still-working')).textContent).toBe('Milo is still working on your last question.');
    expect(screen.queryByText('raw server text')).toBeNull();
  });

  it('says the conversation was closed in another window, and offers a new one', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/close`)] = () => null;
    const user = await askRefused({ reason: 'closed' });
    const note = await screen.findByTestId('assistant-closed-elsewhere');
    expect(note.textContent).toContain('This conversation was closed in another window.');
    expect((screen.getByTestId('assistant-input') as HTMLInputElement).disabled).toBe(true);
    await user.click(within(note).getByRole('button', { name: 'New conversation' }));
    await waitFor(() => expect(screen.queryByTestId('assistant-closed-elsewhere')).toBeNull());
    expect((screen.getByTestId('assistant-input') as HTMLInputElement).disabled).toBe(false);
  });

  it('marks the day used up and takes no more questions', async () => {
    await askRefused({ reason: 'budget', limit: 1000, used: 1000, resetsAt: Date.UTC(2026, 9, 10, 0) });
    expect(await screen.findByTestId('assistant-allowance-used')).toBeTruthy();
    expect((screen.getByTestId('assistant-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('says there is no model, with the way to settings only for who may change them', async () => {
    routes[key('GET', `${BASE}/availability`)] = () => availability({ enabled: false, reason: 'no-provider', canConfigure: false });
    mount();
    await waitFor(() => expect(lookingAt()).not.toBe('Loading conversation…'));
    expect((screen.getByTestId('assistant-input') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
    expect(posts('/facts')).toHaveLength(0);
  });

  it('says once that the earlier conversation was closed for its age', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => ({ session: null, turns: [], earlier: 0, aged: true });
    mount();
    expect((await screen.findByTestId('assistant-aged')).textContent).toBe('Your earlier conversation was closed because of its age.');
    // Still the place to ask from.
    expect(screen.getByText('Try')).toBeTruthy();
  });
});

describe('a draft made on another page', () => {
  it('keeps its title, says where it was made, and offers the way there instead of its actions', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => ({
      session,
      earlier: 0,
      aged: false,
      turns: [
        turn({
          askText: 'Draft an email for our autumn menu.',
          say: 'Here it is.',
          context: 'email',
          answer: null,
          on: { pageId: null, documentId: null, title: null, scope: null },
          result: { title: 'Autumn at Juniper Kitchen', meta: 'template', workTitle: 'Drafted', basedOn: null, light: true, details: [], checks: [], followups: [], sources: [], warning: null },
        }),
      ],
    });
    mount();
    const card = await screen.findByTestId('assistant-parked-draft');
    expect(card.textContent).toContain('Autumn at Juniper Kitchen');
    expect(card.textContent).toContain('Made on Email templates.');
    const link = screen.getByRole('link', { name: /Open Email templates to use this draft/ });
    expect(link.getAttribute('href')).toBe('/email-templates');
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(screen.getByTestId('assistant-asked-on').textContent).toBe('on Email templates');
  });
});

describe('how it stands', () => {
  it('beside the page it is a landmark named for the assistant, and the page stays usable', async () => {
    mount();
    const dock = await screen.findByRole('complementary', { name: 'Milo' });
    expect(dock.getAttribute('data-layout')).toBe('docked');
    expect((screen.getByTestId('page-column') as HTMLElement).inert).toBeFalsy();
  });

  it('over the page it is a dialog: the page is inert, the field has focus, Escape closes it', async () => {
    layout = 'over';
    setDockOpen(true);
    mount();
    const dock = await screen.findByRole('dialog', { name: 'Milo' });
    expect(dock.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect((screen.getByTestId('page-column') as HTMLElement).inert).toBe(true));
    // Focus is inside from the start (the panel itself while it loads), and on the field once it can be typed in.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('assistant-input')));
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('signals').textContent).toBe('false|idle'));
  });

  it('waits behind a dialog of the page itself', async () => {
    mount(
      <>
        <PageActions assistant={CUSTOMERS} />
        <div role="dialog" aria-modal="true">
          a record
        </div>
      </>,
    );
    expect(await screen.findByTestId('assistant-dimmed')).toBeTruthy();
    expect((screen.getByTestId('assistant-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('closes from its own button', async () => {
    setDockOpen(true);
    mount();
    await userEvent.setup().click(await screen.findByTestId('assistant-close'));
    await waitFor(() => expect(screen.getByTestId('signals').textContent).toBe('false|idle'));
  });
});

describe('while it is closed', () => {
  it('draws nothing, and tells the bubble a question is being answered and then that an answer waits', async () => {
    let status = 'running';
    routes[key('GET', `${BASE}/sessions/current`)] = () => ({ session, earlier: 0, aged: false, turns: [turn({ status: 'running', say: null, answer: null })] });
    routes[key('GET', `${BASE}/sessions/ast_1/turns/atn_1`)] = () => turn(status === 'running' ? { status: 'running', say: null, answer: null } : {});
    mount(undefined, false);
    expect(screen.queryByTestId('assistant-dock')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('signals').textContent).toBe('false|working'));
    status = 'done';
    // No event says it ended (there is no socket here): the row is read as well, and that finds it.
    await waitFor(() => expect(screen.getByTestId('signals').textContent).toBe('false|unread'), { timeout: 9000 });
    await act(async () => undefined);
  }, 14_000);
});
