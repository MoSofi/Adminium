// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A page that drafts, in the panel: its drafts, their locks and their confirm, phase by phase.
 *
 * WHAT IS WORTH PINNING HERE, and it is not the layout:
 *
 *  1. the two locks — a session that may save still cannot until somebody
 *     enables actions, and a session that may not save is told so and is never
 *     offered the button;
 *  2. the confirm — nothing writes until a second press, and the dialog names
 *     the audit key the row will carry;
 *  3. the thread — every turn keeps its bubble and its cards, because that is
 *     the difference between a conversation and a form;
 *  4. what a turn that FAILED shows, which is the one screen that has to
 *     explain itself;
 *  5. the unavailable states, each with the reason and with the settings link
 *     offered only to a session that could use it.
 *
 * i18n IS DELIBERATELY NOT INSTALLED. Every string here is a `t(key, English)`
 * call, so with no instance the English renders and these assertions read as
 * the copy does. It also keeps the messages gate honest for the wave that adds
 * it: `useAssistantMessages` short-circuits when there is no instance, so a
 * `use()` that would hang inside a synchronous `render` never runs.
 *
 * The axe pass is NOT here: happy-dom cannot host axe-core, so every phase is
 * swept in the e2e a11y spec instead. What this file checks is the a11y
 * PROPERTIES a DOM can answer for — the dialog's name, the tabs' panels, the
 * labelled icon-only controls.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageActionsProvider } from '../../shell/PageActionsProvider.js';
import { makeBootstrap } from '../../test/fixtures.js';
import { AskAssistant } from '../AskAssistant.js';
import { AssistantDock } from './AssistantDock.js';
import { resetDock } from './dockStore.js';
import type { AssistantHostContext } from '../hostContext.js';

// Beside the page, as on a wide window: how it stands is the layout test's.
vi.mock('./dockLayout.js', async (original) => ({
  ...(await original<typeof import('./dockLayout.js')>()),
  dockLayout: () => 'docked',
}));

// ─── the wire, scripted ──────────────────────────────────────────────────────

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];
let routes: Record<string, () => unknown> = {};

function key(method: string, url: string): string {
  return `${method} ${url.split('?')[0] ?? url}`;
}

/** A route's refusal, in the server's own error envelope. */
class Refusal {
  constructor(
    private readonly status: number,
    private readonly details: Record<string, unknown>,
  ) {}

  response(): Response {
    const body = { error: { code: 'CONFLICT', message: 'raw server text', requestId: 'req_test', details: this.details } };
    return { ok: false, status: this.status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  }
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, method, body });
    const handler = routes[key(method, url)];
    if (handler === undefined) throw new Error(`unscripted request: ${method} ${url}`);
    const answer = handler();
    return Promise.resolve(answer instanceof Refusal ? answer.response() : jsonOk(answer));
  });
  // No socket in happy-dom: the modal falls back to reading the row, which is
  // what a browser with a blocked WebSocket does too.
  vi.stubGlobal(
    'WebSocket',
    class {
      close(): void {
        // no-op
      }
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        // no-op
      }
      disconnect(): void {
        // no-op
      }
    },
  );
});

afterEach(() => {
  cleanup();
  resetDock();
  vi.unstubAllGlobals();
});

const BASE = '/api/v1/assistant';

function availability(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    reason: null,
    name: 'Milo',
    rowData: true,
    canWrite: true,
    canConfigure: true,
    provider: 'anthropic',
    model: 'm',
    budget: { limit: 500_000, used: 0, resetsAt: Date.UTC(2026, 9, 10), left: true },
    ...overrides,
  };
}

function sessionReply() {
  return {
    session: {
      id: 'ast_1',
      context: 'email',
      status: 'open',
      provider: 'anthropic',
      model: 'm',
      tokensIn: 0,
      tokensOut: 0,
      createdAt: 1,
    },
    facts: { values: { templates: 3, campaigns: 2, tables: 12 }, scope: { primary: '', extra: 12 } },
    nextTurnTokens: 1200,
  };
}

function turn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'atn_1',
    sessionId: 'ast_1',
    seq: 1,
    status: 'done',
    jobId: 'job_1',
    askText: 'Draft a welcome email',
    say: 'Here is a draft.',
    steps: [
      { id: 'c1', state: 'done', icon: 'database', label: 'Read the tables', detail: 'orders', tables: ['conn_1.main.orders'] },
    ],
    ask: null,
    result: null,
    error: null,
    tokensIn: 400,
    tokensOut: 120,
    createdAt: 1,
    finishedAt: 2,
    // Asked on the page the panel is opened on in these tests: a draft made here is at home here.
    context: 'email',
    answer: null,
    on: { pageId: null, documentId: null, title: null, scope: null },
    ...overrides,
  };
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Welcome email',
    meta: 'template · 4 blocks',
    workTitle: 'Drafted a welcome email',
    basedOn: null,
    artefact: { kind: 'template', name: 'Welcome' },
    warning: null,
    details: [{ label: 'Format', value: 'Adminium email · 4 blocks' }],
    checks: ['Every variable exists'],
    followups: ['Make it shorter'],
    sources: ['conn_1.main.orders'],
    diff: {
      against: null,
      adds: 2,
      dels: 0,
      lines: [
        { sign: '+', text: 'subject: Welcome aboard' },
        { sign: '+', text: '  email.heading: Welcome' },
      ],
      truncated: false,
    },
    ...overrides,
  };
}

function makeHost(overrides: Partial<AssistantHostContext> = {}): AssistantHostContext {
  return {
    context: 'email',
    host: { connectionIds: ['conn_1'] },
    renderPreview: (artefact, meta) => (
      <div data-testid="host-preview" data-based-on={meta.basedOn ?? ''}>
        {String(artefact.name)}
      </div>
    ),
    onCreated: vi.fn(),
    ...overrides,
  };
}

/** Open the modal with the standard happy-path scripting. */
/**
 * Open the panel on a page that drafts, with the standard happy-path scripting: the page tells
 * the shell what it is and hands over its renderer through its own Ask button, as a host does.
 */
async function openModal(options: { host?: Partial<AssistantHostContext>; availability?: Record<string, unknown> } = {}) {
  routes[key('GET', `${BASE}/availability`)] = () => availability(options.availability ?? {});
  routes[key('GET', `${BASE}/sessions/current`)] ??= () => ({ session: null, turns: [], earlier: 0, aged: false });
  routes[key('POST', `${BASE}/facts`)] ??= () => ({ facts: sessionReply().facts, nextTurnTokens: 1200 });
  routes[key('POST', `${BASE}/sessions`)] = () => sessionReply();
  const host = makeHost(options.host ?? {});
  /** The page on screen: swapped by a test that walks away and back. */
  let walk: (next: AssistantHostContext | null) => void = () => undefined;
  function Page() {
    const [current, setCurrent] = useState<AssistantHostContext | null>(host);
    walk = setCurrent;
    return current === null ? null : <AskAssistant host={current} slot="manager" />;
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['bootstrap'], makeBootstrap({ assistant: { allowed: true, name: 'Milo' } } as never));
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <PageActionsProvider>
          <div data-testid="page-column">
            <Page />
          </div>
          <AssistantDock visible />
        </PageActionsProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) });
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByTestId('assistant-looking-at').textContent).not.toBe('Loading conversation…'));
  return { host, view, router, walk: (next: AssistantHostContext | null) => act(() => walk(next)) };
}

// ─── the shell ───────────────────────────────────────────────────────────────

describe('the shell', () => {
  it('names itself, and says what it knows of the page it is on', async () => {
    await openModal();
    // Beside the page it is a landmark with a NAME, which is what a screen reader announces.
    const panel = await screen.findByRole('complementary', { name: 'Milo' });
    // The line is composed HERE from the server's counts, so it can be translated; the server
    // never sends a sentence.
    await waitFor(() => expect(within(panel).getByTestId('assistant-looking-at').textContent).toMatch(/3 templates · 2 campaigns/));
  });

  it('greets with what it can see and offers three things to try', async () => {
    await openModal();
    expect(await screen.findByText(/I can see your email templates/)).toBeTruthy();
    expect(screen.getByText('Try')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Draft a reminder for an unpaid invoice/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Localise the Welcome template into German/ })).toBeTruthy();
  });

  it('shows what the next request will cost before it is sent', async () => {
    await openModal();
    expect(await screen.findByText('~1200 tokens')).toBeTruthy();
  });
});

// ─── the two locks ───────────────────────────────────────────────────────────

describe('what this session is allowed to do', () => {
  it('locks the write actions until somebody enables them, and says whose choice that is', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ status: 'done', result: result() }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));

    const save = await screen.findByRole('button', { name: 'Save template' });
    expect(save.hasAttribute('disabled')).toBe(true);
    expect(save.getAttribute('title')).toBe('Enable actions to let Milo do this');
    // A read-only action is NOT locked: it changes nothing, so neither reason applies.
    expect(screen.getByRole('button', { name: 'Send test email' }).hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Enable actions' }));
    expect(screen.getByRole('button', { name: 'Save template' }).hasAttribute('disabled')).toBe(false);
    // The bar goes once actions are on — there is nothing left for it to say.
    expect(screen.queryByText(/is read-only right now/)).toBeNull();
  });

  it('tells a role that cannot save so, and never offers it the button', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ status: 'done', result: result() }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal({ availability: { canWrite: false } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));

    expect(screen.getByText('Your role can look, draft and preview here, but not save.')).toBeTruthy();
    // No way out of this one: it is a fact about the role, not a guardrail.
    expect(screen.queryByRole('button', { name: 'Enable actions' })).toBeNull();
    const save = await screen.findByRole('button', { name: 'Save template' });
    expect(save.hasAttribute('disabled')).toBe(true);
    expect(save.getAttribute('title')).toBe('Your role cannot do this here');
  });
});

// ─── the thread ──────────────────────────────────────────────────────────────

describe('a turn, end to end', () => {
  beforeEach(() => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ status: 'done', result: result() }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
  });

  it('shows what was asked, what ran, and what came back', async () => {
    await openModal();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'Draft a welcome email');
    await user.keyboard('{Enter}');

    // The question, in the person's own words.
    expect(await screen.findByText('Draft a welcome email')).toBeTruthy();
    // What ran, with the table it read on the row.
    expect(screen.getByText('Read the tables')).toBeTruthy();
    expect(screen.getByText('conn_1.main.orders')).toBeTruthy();
    expect(screen.getByText('done')).toBeTruthy();
    // And the draft.
    expect(screen.getByText('Welcome email')).toBeTruthy();
    expect(screen.getByTestId('host-preview').textContent).toBe('Welcome');
  });

  it('offers three ways of looking at the draft, each with a panel behind it', async () => {
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    await screen.findByText('Welcome email');

    // A tray of triggers with no panel is a switch wearing a tablist's
    // clothes; each of these has one.
    const tabs = screen.getByRole('tablist');
    expect(within(tabs).getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tabpanel')).toBeTruthy();

    await user.click(within(tabs).getByRole('tab', { name: 'Diff' }));
    // The diff is COMPUTED, and says so when there is no base document.
    expect(screen.getByText('New Email templates — fields it will write')).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText('subject: Welcome aboard')).toBeTruthy();

    await user.click(within(tabs).getByRole('tab', { name: 'Details' }));
    // Sources read is the row Settings → AI's promise is kept in. (The same
    // table name is also a chip on the step row above, hence the panel scope.)
    const details = screen.getByRole('tabpanel');
    expect(within(details).getByText('Sources read')).toBeTruthy();
    expect(within(details).getByText('conn_1.main.orders')).toBeTruthy();
    // The model's own claim, labelled as its own.
    expect(within(details).getByText('Every variable exists')).toBeTruthy();
    expect(within(details).getByText('400 in · 120 out')).toBeTruthy();
  });

  it('keeps every turn in the thread rather than only the last', async () => {
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    // The bubble shows what the SERVER recorded as the question.
    await screen.findByText('Draft a welcome email');

    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ id: 'atn_2', seq: 2, askText: 'Make it shorter', status: 'done', result: result() }),
      jobId: 'job_2',
      nextTurnTokens: 950,
    });
    await user.type(screen.getByRole('textbox'), 'Make it shorter');
    await user.keyboard('{Enter}');

    await screen.findByText('Make it shorter', { selector: 'p' });
    // Both questions are still on screen: a session has many turns, and
    // scrolling back to the first one is the ordinary thing to want.
    expect(screen.getByText('Draft a welcome email')).toBeTruthy();
  });

  it('submits a follow-up the model suggested', async () => {
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    await screen.findByText('Welcome email');

    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ id: 'atn_2', seq: 2, askText: 'Make it shorter', status: 'done' }),
      jobId: 'job_2',
      nextTurnTokens: 950,
    });
    await user.click(screen.getByRole('button', { name: 'Make it shorter' }));
    await waitFor(() => {
      const posts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/turns'));
      expect(posts).toHaveLength(2);
      expect(posts[1]?.body).toMatchObject({ text: 'Make it shorter', context: 'email' });
    });
  });
});

// ─── asking back ─────────────────────────────────────────────────────────────

describe('when the assistant asks back', () => {
  const ask = {
    groups: [
      {
        key: 'tpl',
        title: 'Template',
        options: [
          { key: 't1', label: 'Standard', detail: 'The default' },
          { key: 't2', label: 'EU reverse charge', detail: 'For EU clients' },
        ],
      },
    ],
  };

  it('waits for a pick, then sends the answer with the labels that were seen', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ status: 'awaiting_picks', ask, say: 'Which template should I use?', steps: [] }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));

    expect(await screen.findByText('Which template should I use?')).toBeTruthy();
    // The go row says what is missing rather than being merely disabled.
    expect(screen.getByRole('button', { name: /Waiting on you/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Pick one option in each group')).toBeTruthy();

    const option = screen.getByRole('button', { name: /EU reverse charge/ });
    expect(option.getAttribute('aria-pressed')).toBe('false');
    await user.click(option);
    expect(option.getAttribute('aria-pressed')).toBe('true');

    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ id: 'atn_2', seq: 2, askText: null, status: 'done', result: result() }),
      jobId: 'job_2',
      nextTurnTokens: 950,
    });
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() => {
      const posts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/turns'));
      expect(posts[1]?.body).toMatchObject({ picks: { tpl: 't2' }, context: 'email' });
    });
    // The bubble for that turn shows the LABEL, not the key.
    expect(await screen.findByText('EU reverse charge', { selector: 'p' })).toBeTruthy();
  });

  it('renders a plain answer as the same card, with no groups and no go row', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ status: 'done', say: 'A campaign goes to a list; a template is reused.', steps: [] }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));

    expect(await screen.findByText('A campaign goes to a list; a template is reused.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Waiting on you/ })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});

// ─── writing something ───────────────────────────────────────────────────────

describe('saving a draft', () => {
  beforeEach(() => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ status: 'done', result: result() }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
  });

  it('asks once more, names the audit key, and only then writes', async () => {
    const onCreated = vi.fn();
    await openModal({ host: { onCreated } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    await user.click(await screen.findByRole('button', { name: 'Enable actions' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));

    // Nothing has been written yet.
    expect(calls.some((call) => call.url.includes('/actions'))).toBe(false);
    expect(screen.getByText('Save as a new template?')).toBeTruthy();
    expect(screen.getByText(/will create “Welcome email” as a draft in Email templates/)).toBeTruthy();
    // The REAL key the row will carry, not a mock.
    expect(screen.getByText('assistant.email.create')).toBeTruthy();

    routes[key('POST', `${BASE}/sessions/ast_1/turns/atn_1/actions`)] = () => ({
      echo: { kind: 'saved', open: false, name: 'Welcome' },
      created: { id: 'tpl_9', kind: 'template', name: 'Welcome' },
      sample: null,
    });
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({ id: 'tpl_9', kind: 'template', name: 'Welcome' }, false);
    });
    // The echo names what now exists rather than saying "done", and says it in
    // this page's own words.
    expect(await screen.findByText('Saved as a draft template.')).toBeTruthy();
  });

  it('saves a draft once: the button then says so, and open goes to what exists', async () => {
    const onCreated = vi.fn();
    await openModal({ host: { onCreated } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    await user.click(await screen.findByRole('button', { name: 'Enable actions' }));
    routes[key('POST', `${BASE}/sessions/ast_1/turns/atn_1/actions`)] = () => ({
      echo: { kind: 'saved', open: false, name: 'Welcome' },
      created: { id: 'tpl_9', kind: 'template', name: 'Welcome' },
      sample: null,
    });
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });

    // A second save would be a second document: the button is spent.
    const savedButton = await screen.findByRole('button', { name: 'Saved' });
    expect((savedButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save template' })).toBeNull();

    // And *open* opens the row that exists — no confirm, no second write.
    await user.click(screen.getByRole('button', { name: 'Open in editor' }));
    expect(onCreated).toHaveBeenLastCalledWith({ id: 'tpl_9', kind: 'template', name: 'Welcome' }, true);
    expect(calls.filter((call) => call.url.includes('/actions'))).toHaveLength(1);
  });

  it('writes nothing when the confirm is cancelled', async () => {
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    await user.click(await screen.findByRole('button', { name: 'Enable actions' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    const confirm = screen.getByRole('dialog', { name: 'Save as a new template?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Save as a new template?')).toBeNull();
    expect(calls.some((call) => call.url.includes('/actions'))).toBe(false);
  });

  it('puts the draft straight on an editor`s screen, with no confirm and no write', async () => {
    const applyDraft = vi.fn();
    await openModal({ host: { applyDraft } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    await user.click(await screen.findByRole('button', { name: 'Enable actions' }));
    await user.click(screen.getByRole('button', { name: 'Open in editor' }));

    // An editor host has somewhere to put it: nothing is written, so nothing is confirmed.
    expect(applyDraft).toHaveBeenCalledWith({ kind: 'template', name: 'Welcome' });
    expect(calls.some((call) => call.url.includes('/actions'))).toBe(false);
    expect(await screen.findByText('Drafted into the editor — review the highlighted blocks.')).toBeTruthy();
  });
});

// ─── when it goes wrong ──────────────────────────────────────────────────────

describe('a turn that failed', () => {
  it('keeps the steps, badges the card failed, and offers the question again', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({
        status: 'failed',
        result: null,
        error: { kind: 'provider', code: 'auth', message: 'Invalid API key' },
      }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));

    expect(await screen.findByText('failed')).toBeTruthy();
    // What ran is kept: the steps are the record of what the turn did do.
    expect(screen.getByText('Read the tables')).toBeTruthy();
    expect(screen.getByText('Invalid API key')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('words the too-long failure itself rather than showing the server`s sentence', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({
        status: 'failed',
        result: null,
        error: { kind: 'too-long', estimate: 200_000, limit: 160_000, message: 'raw server text' },
      }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));

    // A KIND, not a sentence: the advice that goes with it is advice to a
    // person and belongs in a message key.
    expect(await screen.findByText(/too long for the model — start a new session/)).toBeTruthy();
    expect(screen.queryByText('raw server text')).toBeNull();
  });

  it('tells who can act what to do when the model cannot follow the format, and offers no retry', async () => {
    const failed = () => ({
      turn: turn({
        status: 'failed',
        result: null,
        error: { kind: 'model-format', provider: 'ollama', model: 'gpt-oss:120b', message: 'raw server text' },
      }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = failed;
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));

    expect(await screen.findByText(/does not answer in the way Milo needs\. Choose another model in Settings → AI\./)).toBeTruthy();
    expect(screen.queryByText('raw server text')).toBeNull();
    // The model cannot do this: asking again changes nothing.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('tells someone who cannot choose the model to ask an administrator', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ status: 'failed', result: null, error: { kind: 'model-format', provider: 'ollama', model: 'm', message: 'raw' } }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal({ availability: { canConfigure: false } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    expect(await screen.findByText(/Ask an administrator to choose another model\./)).toBeTruthy();
    expect(screen.queryByText(/Settings → AI/)).toBeNull();
  });

  it('says a page could not be read, and offers the question again', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ status: 'failed', result: null, error: { kind: 'setup', message: 'SQLITE_BUSY: database is locked' } }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    expect(await screen.findByText('This page could not be read just now. Try asking again.')).toBeTruthy();
    expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('the daily allowance, in the window', () => {
  // Always ahead of the clock the test runs by: the bar goes by itself once the day has turned.
  const RESETS_AT = Date.now() + 6 * 3_600_000;

  it('says the day is used up and when it starts again, and takes no question', async () => {
    await openModal({ availability: { budget: { limit: 1000, used: 1000, resetsAt: RESETS_AT, left: false } } });
    const bar = await screen.findByTestId('assistant-allowance-used');
    expect(bar.textContent).toMatch(/Today’s allowance is used up\. It starts again at .*\d{1,2}[:.]\d{2}/);
    expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows the same when the server refuses the question that came one too late', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => new Refusal(409, { reason: 'budget', limit: 1000, used: 1000, resetsAt: RESETS_AT });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    expect(await screen.findByTestId('assistant-allowance-used')).toBeTruthy();
    expect(screen.queryByText('raw server text')).toBeNull();
  });

  it('marks the window when an answer used the last of the day, and keeps the answer', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ answer: { budget: { limit: 1000, used: 1200, resetsAt: RESETS_AT } } }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    expect(await screen.findByTestId('assistant-allowance-used')).toBeTruthy();
  });

  it('says a turn the allowance stopped part way, with nothing to try again', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({ status: 'failed', result: null, error: { kind: 'budget', limit: 1000, used: 1200, resetsAt: RESETS_AT, message: 'raw' } }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    expect(await screen.findByText('This stopped part way: today’s allowance is used up.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByTestId('assistant-allowance-used')).toBeTruthy();
  });

  it('says in its own words that the last question is still being worked on', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => new Refusal(409, { reason: 'busy', turnId: 'atn_0' });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    expect((await screen.findByTestId('assistant-still-working')).textContent).toBe('Milo is still working on your last question.');
    expect(screen.queryByText('raw server text')).toBeNull();
  });
});

describe('when the assistant cannot work here', () => {
  it('names the missing provider and offers the page that fixes it', async () => {
    routes[key('GET', `${BASE}/availability`)] = () =>
      availability({ enabled: false, reason: 'no-provider', provider: null });
    const { router } = await openModal({ availability: { enabled: false, reason: 'no-provider', provider: null } });

    expect(await screen.findByText('No AI provider is configured yet.')).toBeTruthy();
    // The composer is closed: there is nothing to send it to.
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Settings → AI' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio/settings/ai'));
  });

  it('tells a session that cannot reach Settings to ask an administrator instead', async () => {
    routes[key('GET', `${BASE}/availability`)] = () =>
      availability({ enabled: false, reason: 'no-provider', canConfigure: false });
    await openModal({ availability: { enabled: false, reason: 'no-provider', canConfigure: false } });

    // A link that would 403 is worse than a sentence.
    expect(await screen.findByText(/Ask an administrator to set one up\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Settings → AI' })).toBeNull();
  });

  it('names the air-gapped instance rather than blaming the configuration', async () => {
    routes[key('GET', `${BASE}/availability`)] = () =>
      availability({ enabled: false, reason: 'network-disabled' });
    await openModal({ availability: { enabled: false, reason: 'network-disabled' } });
    expect(await screen.findByText('Outbound network features are off on this instance.')).toBeTruthy();
  });

  it('names the missing permission, and offers nothing to press', async () => {
    routes[key('GET', `${BASE}/availability`)] = () =>
      availability({ enabled: false, reason: 'forbidden', canConfigure: true });
    await openModal({ availability: { enabled: false, reason: 'forbidden', canConfigure: true } });
    expect(await screen.findByText('You do not have permission to use Milo.')).toBeTruthy();
    // Nothing an operator configures fixes a grant, so the link is absent even
    // for a session that holds the settings key.
    expect(screen.queryByRole('button', { name: 'Open Settings → AI' })).toBeNull();
  });
});

// ─── the other three pages ───────────────────────────────────────────────────

describe('each page speaks for itself', () => {
  it('draws no preview of its own — the page does, and is told what the turn was built from', async () => {
    routes[key('GET', `${BASE}/availability`)] = () => availability();
    routes[key('POST', `${BASE}/sessions`)] = () => ({
      ...sessionReply(),
      session: { ...sessionReply().session, context: 'invoices' },
      facts: { values: { invoices: 8, templates: 3, write: true }, scope: { primary: '', extra: 4 } },
    });
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => ({
      turn: turn({
        status: 'done',
        result: result({
          title: 'March invoice',
          artefact: {
            basedOn: 'inv_1',
            body: { customerName: 'Company 1', items: [{ desc: 'Work', qty: '2', rate: '100.00' }] },
          },
          basedOn: 'Consulting',
        }),
      }),
      jobId: 'job_1',
      nextTurnTokens: 900,
    });
    routes[key('POST', `${BASE}/facts`)] = () => ({ facts: { values: { invoices: 8, templates: 3, write: true }, scope: { primary: '', extra: 4 } }, nextTurnTokens: 1200 });
    const scripted = routes[key('POST', `${BASE}/sessions`)]!;
    const scriptedTurn = routes[key('POST', `${BASE}/sessions/ast_1/turns`)]!;
    await openModal({ host: { context: 'invoices' } });
    routes[key('POST', `${BASE}/sessions`)] = scripted;
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = () => {
      const reply = scriptedTurn() as { turn: Record<string, unknown> };
      return { ...reply, turn: { ...reply.turn, context: 'invoices' } };
    };
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Create an invoice for a customer/ }));

    // Every page's preview is its own, this one included: a record has no
    // sheet until it is a document, and deciding THAT needs the page's own
    // arithmetic, which this tree does not have. So the modal hands over the
    // artefact plus the one thing the turn knows and the artefact does not.
    const preview = await screen.findByTestId('host-preview');
    expect(preview.getAttribute('data-based-on')).toBe('Consulting');
  });

  it('names the connection the report page reads, in the line under its name', async () => {
    routes[key('POST', `${BASE}/facts`)] = () => ({
      facts: { values: { reports: 4, tables: 12, connection: 'Warehouse' }, scope: { primary: 'Warehouse', extra: 12 } },
      nextTurnTokens: 1200,
    });
    await openModal({ host: { context: 'report' } });
    await waitFor(() => expect(screen.getByTestId('assistant-looking-at').textContent).toMatch(/4 reports · Warehouse · 12 readable tables/));
  });
});

// ─── a draft belongs to its page and its document ────────────────────────────

describe('a draft and the page it was made for', () => {
  const drafted = (on: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    session: sessionReply().session,
    earlier: 0,
    aged: false,
    turns: [turn({ result: result(), on: { pageId: null, documentId: null, title: null, scope: null, ...on }, ...over })],
  });

  it('is live on its own page, and says where it is pressed with every action', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => drafted({});
    routes[key('POST', `${BASE}/sessions/ast_1/turns/atn_1/actions`)] = () => ({ echo: { kind: 'saved', open: false, name: 'Welcome' }, created: { id: 'tpl_9', kind: 'template', name: 'Welcome' }, sample: null });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Enable actions' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await user.click(await screen.findByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/actions'))).toBe(true));
    const sent = calls.find((call) => call.url.endsWith('/actions'))!.body as { action: string; on: unknown };
    expect(sent.action).toBe('save');
    expect(sent.on).toEqual({ context: 'email' });
  });

  it('locks its actions again when the person walks away and comes back', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => drafted({});
    const { host, walk } = await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Enable actions' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enable actions' })).toBeNull());
    // To a page that drafts nothing (there the draft is parked), and back.
    walk(null);
    await screen.findByTestId('assistant-parked-draft');
    walk(host);
    // The permission was for that visit: it is asked for again.
    expect(await screen.findByRole('button', { name: 'Enable actions' })).toBeTruthy();
    expect(screen.queryByTestId('assistant-parked-draft')).toBeNull();
  });

  it('says a draft is saved after the panel is closed and opened again: the turn is read back', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => drafted({});
    routes[key('POST', `${BASE}/sessions/ast_1/turns/atn_1/actions`)] = () => ({ echo: { kind: 'saved', open: false, name: 'Welcome' }, created: { id: 'tpl_9', kind: 'template', name: 'Welcome' }, sample: null });
    routes[key('GET', `${BASE}/sessions/ast_1/turns/atn_1`)] = () => turn({ result: result({ saved: { id: 'tpl_9', kind: 'template', name: 'Welcome' } }) });
    await openModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Enable actions' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await user.click(await screen.findByRole('button', { name: 'Save as draft' }));
    // What the server recorded on the turn is what the card is drawn from now.
    await waitFor(() => expect(calls.some((call) => call.method === 'GET' && call.url.endsWith('/turns/atn_1'))).toBe(true));
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeTruthy();
  });

  it('made for one document, is parked on another document of the same kind', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => drafted({ documentId: 'tpl_1' });
    await openModal({ host: { host: { connectionIds: ['conn_1'], documentId: 'tpl_2' } } });
    const card = await screen.findByTestId('assistant-parked-draft');
    expect(card.textContent).toContain('Welcome email');
    expect(screen.getByRole('link', { name: /to use this draft/ }).getAttribute('href')).toBe('/email-templates/tpl_1');
    expect(screen.queryByRole('button', { name: 'Save template' })).toBeNull();
  });

  it('whose document was deleted keeps its title, says so, and offers nothing', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => drafted({ documentId: 'tpl_1', gone: true });
    await openModal();
    const card = await screen.findByTestId('assistant-parked-draft');
    expect(card.textContent).toContain('Welcome email');
    expect(card.textContent).toContain('This draft’s document was deleted.');
    expect(within(card).queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save template' })).toBeNull();
  });

  it('made for the document that is open, is live there', async () => {
    routes[key('GET', `${BASE}/sessions/current`)] = () => drafted({ documentId: 'tpl_1' });
    await openModal({ host: { host: { connectionIds: ['conn_1'], documentId: 'tpl_1' } } });
    expect(await screen.findByRole('button', { name: 'Save template' })).toBeTruthy();
    expect(screen.queryByTestId('assistant-parked-draft')).toBeNull();
  });

  it('served without its document, as an older turn is, asks for it whole before it can be used', async () => {
    const light = { ...result(), light: true } as Record<string, unknown>;
    delete light.artefact;
    delete light.diff;
    routes[key('GET', `${BASE}/sessions/current`)] = () => ({ ...drafted({}), turns: [turn({ result: light })] });
    routes[key('GET', `${BASE}/sessions/ast_1/turns/atn_1`)] = () => turn({ result: result() });
    await openModal();
    // The page's own renderer draws it once the document has arrived.
    expect(await screen.findByTestId('host-preview')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith('/turns/atn_1'))).toHaveLength(1);
  });
});

// ─── an answer in words, on a page of rows ───────────────────────────

describe('an answer on a data page', () => {
  const dataHost = { context: 'data' as const, host: { connectionIds: ['conn_1'], pageId: 'page_1' } };
  const answered = (answer: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    turn: turn({ askText: 'Who are our best customers?', say: 'Lena, Jonas and Mia.', result: null, context: 'data', answer, ...over }),
    jobId: 'job_1',
    nextTurnTokens: 900,
  });
  const asked = () => calls.filter((call) => call.method === 'POST' && call.url.endsWith('/turns')).map((call) => (call.body as { text: string }).text);

  async function ask(reply: () => unknown) {
    routes[key('POST', `${BASE}/sessions/ast_1/turns`)] = reply;
    const opened = await openModal({ host: dataHost });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox'), 'Who are our best customers?{Enter}');
    await screen.findByText('Lena, Jonas and Mia.');
    return { ...opened, user };
  }

  it('has no bar about switching actions on: a page of rows has none', async () => {
    await ask(() => answered({ sources: ['c.main.orders'], reads: [] }));
    expect(screen.queryByRole('button', { name: 'Enable actions' })).toBeNull();
  });

  it('says which tables it came from, and offers what to ask next', async () => {
    const { user } = await ask(() => answered({ sources: ['c.main.orders', 'c.main.customers'], reads: [], followups: ['Who comes next?'] }));
    expect((await screen.findByTestId('assistant-answer-foot')).textContent).toContain('orders, customers');
    await user.click(screen.getByRole('button', { name: 'Who comes next?' }));
    await waitFor(() => expect(asked()).toEqual(['Who are our best customers?', 'Who comes next?']));
  });

  it('says when nothing was read, and asks again to have it read', async () => {
    // Answered straight off, with no look at anything.
    const { user } = await ask(() => answered({ sources: [], reads: [] }, { steps: [] }));
    expect(await screen.findByText('Nothing was read for this answer.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Read again' }));
    await waitFor(() => expect(asked().at(-1)).toBe('Who are our best customers? Read the data to answer.'));
  });

  it('does not say "nothing was read" of an answer that looked something up, though no table was read', async () => {
    // Where a screen is, which add-ons there are, a table it turned out not to have access to.
    await ask(() => answered({ sources: [], reads: [] }, { steps: [{ id: 'c1', state: 'done', icon: 'compass', label: 'Looked for the place', detail: '', tables: [] }] }));
    expect(screen.queryByText('Nothing was read for this answer.')).toBeNull();
  });

  it('draws an add-on the answer points at, with the way in only for who may install', async () => {
    const card = { key: 'offers', name: 'Offers & gift cards', line: 'Codes and vouchers.' };
    await ask(() => answered({ sources: [], reads: [], suggest: [{ ...card, mayInstall: false }] }));
    expect(await screen.findByTestId('assistant-suggestion')).toBeTruthy();
    expect(screen.getByText('Ask an administrator to install this.')).toBeTruthy();
    expect(screen.queryByTestId('assistant-suggestion-open')).toBeNull();
    // An answer about what the workspace offers is not one that should have read rows.
    expect(screen.queryByText('Nothing was read for this answer.')).toBeNull();
  });

  it('says the oldest messages are no longer in mind, above the turn that lost them', async () => {
    await ask(() => answered({ sources: ['c.main.orders'], reads: [], forgot: 4 }));
    expect((await screen.findByTestId('assistant-forgot')).textContent).toContain('no longer has the first 4 messages in mind');
  });
});
