// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The assistant modal, phase by phase.
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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantModal } from './AssistantModal.js';
import type { AssistantHostContext } from './hostContext.js';

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
    return Promise.resolve(jsonOk(handler()));
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
});

afterEach(() => {
  cleanup();
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
async function openModal(options: { host?: Partial<AssistantHostContext>; availability?: Record<string, unknown> } = {}) {
  routes[key('GET', `${BASE}/availability`)] = () => availability(options.availability ?? {});
  routes[key('POST', `${BASE}/sessions`)] = () => sessionReply();
  const onClose = vi.fn();
  const view = render(<AssistantModal host={makeHost(options.host ?? {})} open onClose={onClose} />);
  await screen.findByText('Describe the template you need…', {}, { timeout: 2000 }).catch(() => null);
  return { onClose, view };
}

// ─── the shell ───────────────────────────────────────────────────────────────

describe('the shell', () => {
  it('names itself, the page it is on, and what it can read', async () => {
    await openModal();
    const dialog = await screen.findByRole('dialog');
    // The dialog has an accessible NAME, which is what a screen reader
    // announces when focus lands in it — the assistant and the page it is on.
    const labelledBy = dialog.getAttribute('aria-labelledby') ?? '';
    const title = document.getElementById(labelledBy);
    expect(title?.textContent).toContain('Milo');
    expect(title?.textContent).toContain('Email templates');
    // The blurb is composed HERE from the server's counts, so it can be
    // translated; the server never sends a sentence.
    expect(within(dialog).getByText(/3 templates · 2 campaigns/)).toBeTruthy();
    // The scope chip says how much else is readable, and the token chip starts at zero.
    expect(within(dialog).getByTitle('Data this session can read')).toBeTruthy();
    expect(within(dialog).getByTitle('Tokens used this session').textContent).toContain('0 tokens');
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

  it('closes the session when the modal closes', async () => {
    routes[key('POST', `${BASE}/sessions/ast_1/close`)] = () => null;
    const { view, onClose } = await openModal();
    await screen.findByText(/I can see your email templates/);
    view.rerender(<AssistantModal host={makeHost()} open={false} onClose={onClose} />);
    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/sessions/ast_1/close'))).toBe(true);
    });
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
      expect(posts[1]?.body).toEqual({ text: 'Make it shorter' });
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
      expect(posts[1]?.body).toEqual({ picks: { tpl: 't2' } });
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
    const onClose = vi.fn();
    routes[key('GET', `${BASE}/availability`)] = () => availability();
    routes[key('POST', `${BASE}/sessions`)] = () => sessionReply();
    render(<AssistantModal host={makeHost({ applyDraft })} open onClose={onClose} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Draft a reminder/ }));
    await user.click(await screen.findByRole('button', { name: 'Enable actions' }));
    await user.click(screen.getByRole('button', { name: 'Open in editor' }));

    // An editor host has somewhere to put it: nothing is written, so nothing
    // is confirmed, and the modal gets out of the way.
    expect(applyDraft).toHaveBeenCalledWith({ kind: 'template', name: 'Welcome' });
    expect(calls.some((call) => call.url.includes('/actions'))).toBe(false);
    expect(onClose).toHaveBeenCalled();
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
});

describe('when the assistant cannot work here', () => {
  it('names the missing provider and offers the page that fixes it', async () => {
    routes[key('GET', `${BASE}/availability`)] = () =>
      availability({ enabled: false, reason: 'no-provider', provider: null });
    const onOpenSettings = vi.fn();
    render(<AssistantModal host={makeHost()} open onClose={vi.fn()} onOpenSettings={onOpenSettings} />);

    expect(await screen.findByText('No AI provider is configured yet.')).toBeTruthy();
    // The composer is closed: there is nothing to send it to.
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Settings → AI' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('tells a session that cannot reach Settings to ask an administrator instead', async () => {
    routes[key('GET', `${BASE}/availability`)] = () =>
      availability({ enabled: false, reason: 'no-provider', canConfigure: false });
    render(<AssistantModal host={makeHost()} open onClose={vi.fn()} />);

    // A link that would 403 is worse than a sentence.
    expect(await screen.findByText(/Ask an administrator to set one up\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Settings → AI' })).toBeNull();
  });

  it('names the air-gapped instance rather than blaming the configuration', async () => {
    routes[key('GET', `${BASE}/availability`)] = () =>
      availability({ enabled: false, reason: 'network-disabled' });
    render(<AssistantModal host={makeHost()} open onClose={vi.fn()} />);
    expect(await screen.findByText('Outbound network features are off on this instance.')).toBeTruthy();
  });

  it('names the missing permission, and offers nothing to press', async () => {
    routes[key('GET', `${BASE}/availability`)] = () =>
      availability({ enabled: false, reason: 'forbidden', canConfigure: true });
    render(<AssistantModal host={makeHost()} open onClose={vi.fn()} />);
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
    render(<AssistantModal host={makeHost({ context: 'invoices' })} open onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Create an invoice for a customer/ }));

    // Every page's preview is its own, this one included: a record has no
    // sheet until it is a document, and deciding THAT needs the page's own
    // arithmetic, which this tree does not have. So the modal hands over the
    // artefact plus the one thing the turn knows and the artefact does not.
    const preview = await screen.findByTestId('host-preview');
    expect(preview.getAttribute('data-based-on')).toBe('Consulting');
  });

  it('names the connection in the scope chip on the report page', async () => {
    routes[key('GET', `${BASE}/availability`)] = () => availability();
    routes[key('POST', `${BASE}/sessions`)] = () => ({
      ...sessionReply(),
      facts: { values: { reports: 4, tables: 12, connection: 'Warehouse' }, scope: { primary: 'Warehouse', extra: 12 } },
    });
    render(<AssistantModal host={makeHost({ context: 'report' })} open onClose={vi.fn()} />);
    const chip = await screen.findByTitle('Data this session can read');
    expect(chip.textContent).toContain('Warehouse · 12 tables');
  });
});
