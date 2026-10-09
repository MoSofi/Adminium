// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The pieces the modal is made of, on their own.
 *
 * Two things here are not reachable from the modal test and are worth their
 * own file. The LIVE STEP FOLD is the mechanism behind the working card — a
 * row appears when its call is issued and is replaced when it returns — and
 * happy-dom has no socket, so the modal test never exercises it. And each
 * PAGE'S COPY is a claim about a different product surface: the invoices page
 * must not greet somebody with the email page's sentence.
 */
import { renderHook, act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeEvent } from '../app/ws.js';
import { readAnswer, readResult } from './api.js';
import { contextCopy, confirmCopy, echoText } from './contexts.js';
import { ASSISTANT_ICONS, ASSISTANT_STEP_ICONS, assistantIcon, stepIcon } from './icons.js';
import { AnswerFoot, ForgotDivider, partialReads, tableName } from './parts/AnswerFoot.js';
import { DiffView } from './parts/DiffView.js';
import { SuggestionCard } from './parts/SuggestionCard.js';
import { StepsCard } from './parts/StepsCard.js';
import { useTurnProgress } from './useTurnProgress.js';

// The socket, captured rather than opened.
let listener: ((event: RealtimeEvent) => void) | null = null;
const stop = vi.fn();

vi.mock('../app/ws.js', () => ({
  createRealtimeClient: (options: { onEvent: (event: RealtimeEvent) => void }) => {
    listener = options.onEvent;
    return { start: () => undefined, stop };
  },
}));

function progress(message: unknown): RealtimeEvent {
  return { channel: 'jobs:job_1', type: 'progress', data: { message: JSON.stringify(message) }, ts: '' };
}

afterEach(() => {
  cleanup();
  listener = null;
  stop.mockClear();
});

describe('following a turn', () => {
  it('adds a step when it starts and REPLACES it when it finishes, keeping its place', () => {
    const onTerminal = vi.fn();
    const { result } = renderHook(() => useTurnProgress('job_1', onTerminal));

    act(() => {
      listener?.(progress({ kind: 'step', id: 'c1', state: 'started', icon: 'database', label: 'Read rows', detail: '', tables: [], note: null }));
      listener?.(progress({ kind: 'step', id: 'c2', state: 'started', icon: 'search', label: 'Read schema', detail: '', tables: [], note: null }));
    });
    expect(result.current.steps.map((step) => step.id)).toEqual(['c1', 'c2']);
    expect(result.current.steps[0]?.state).toBe('started');

    act(() => {
      listener?.(
        progress({
          kind: 'step',
          id: 'c1',
          state: 'done',
          icon: 'database',
          label: 'Read rows',
          detail: '50 rows',
          tables: ['conn_1.main.orders'],
          note: { kind: 'ready' },
        }),
      );
    });
    // Still first: the card reads as one thing happening after another, not
    // as rows jumping about as they finish.
    expect(result.current.steps.map((step) => step.id)).toEqual(['c1', 'c2']);
    expect(result.current.steps[0]).toMatchObject({
      state: 'done',
      detail: '50 rows',
      tables: ['conn_1.main.orders'],
      note: { kind: 'ready' },
    });
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('ignores anything that is not a step envelope', () => {
    const { result } = renderHook(() => useTurnProgress('job_1', vi.fn()));
    act(() => {
      listener?.(progress({ kind: 'not-a-step' }));
      listener?.({ channel: 'jobs:job_1', type: 'progress', data: { message: 'not json' }, ts: '' });
      listener?.({ channel: 'jobs:job_1', type: 'progress', data: {}, ts: '' });
    });
    expect(result.current.steps).toEqual([]);
  });

  it('tells the caller once when the work stops, whatever it stopped as', () => {
    const onTerminal = vi.fn();
    renderHook(() => useTurnProgress('job_1', onTerminal));
    act(() => {
      listener?.({ channel: 'jobs:job_1', type: 'completed', data: {}, ts: '' });
      listener?.({ channel: 'jobs:job_1', type: 'failed', data: {}, ts: '' });
    });
    // Once: the caller reads the row, and reading it twice would double-count
    // nothing but would race itself.
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it('opens no socket for a turn with no job', () => {
    renderHook(() => useTurnProgress(null, vi.fn()));
    expect(listener).toBeNull();
  });
});

describe('the working card', () => {
  const step = {
    id: 'c1',
    state: 'done',
    icon: 'database',
    label: 'Read the tables',
    detail: 'orders',
    tables: ['conn_1.main.orders'],
    note: null,
  };

  it('counts steps rather than claiming a total it cannot know', () => {
    render(<StepsCard title="Working on it" steps={[step, { ...step, id: 'c2' }]} state="working" context="email" />);
    // Not "step 2 of 5": the model decides how many tools to call as it goes,
    // so a total here would be a progress bar that lies.
    expect(screen.getByText('step 2')).toBeTruthy();
  });

  it('badges the finished card done, and a failed one failed', () => {
    const { rerender } = render(<StepsCard title="Drafted it" steps={[step]} state="done" context="email" />);
    expect(screen.getByText('done')).toBeTruthy();
    rerender(<StepsCard title="Drafted it" steps={[step]} state="failed" context="email" />);
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('words the page-read step from the facts, per page, and leaves every other step alone', () => {
    // The server sends this one step with numbers and no sentence, so that the
    // wording is the operator's language and not the wire's. A page that never
    // arrives in facts keeps whatever the model said.
    const page = { id: 'page', state: 'done', icon: 'file-search', label: '', detail: '', tables: [], note: null };
    const { rerender } = render(
      <StepsCard
        title="Drafted it"
        steps={[{ ...page, facts: { templates: 3, campaigns: 2 } }, step]}
        state="done"
        context="email"
      />,
    );
    expect(screen.getByText('Read this page')).toBeTruthy();
    expect(screen.getByText('Email templates · 3 templates · branding')).toBeTruthy();
    // The model's own step is untouched.
    expect(screen.getByText('Read the tables')).toBeTruthy();

    rerender(
      <StepsCard
        title="Drafted it"
        steps={[{ ...page, facts: { invoices: 1, write: true } }]}
        state="done"
        context="invoices"
      />,
    );
    expect(screen.getByText('Invoices · 1 record · your role can write')).toBeTruthy();

    rerender(
      <StepsCard
        title="Drafted it"
        steps={[{ ...page, facts: { reports: 4, tables: 12 } }]}
        state="done"
        context="report"
      />,
    );
    expect(screen.getByText('Report builder · 4 reports · 12 readable tables')).toBeTruthy();
  });

  it('shows the note a step came back with', () => {
    render(
      <StepsCard
        title="Working on it"
        steps={[
          { ...step, note: { kind: 'ready' } },
          { ...step, id: 'c2', note: { kind: 'warnings', count: 2 } },
        ]}
        state="working" context="email"
      />,
    );
    expect(screen.getByText('ready')).toBeTruthy();
    expect(screen.getByText('2 warnings')).toBeTruthy();
  });
});

describe('what a turn was saved as', () => {
  it('reads the server`s note, and treats anything unreadable as not saved', () => {
    const draft = { title: 'Quarterly', artefact: { name: 'Quarterly' } };
    expect(readResult(draft)?.saved).toBeNull();
    expect(readResult({ ...draft, saved: 'yes' })?.saved).toBeNull();
    expect(readResult({ ...draft, saved: { kind: 'template' } })?.saved).toBeNull();
    expect(readResult({ ...draft, saved: { id: 'rpt_1', kind: 'template', name: 'Quarterly', at: 5 } })?.saved).toEqual({
      id: 'rpt_1',
      kind: 'template',
      name: 'Quarterly',
    });
  });
});

describe('the diff', () => {
  it('draws additions, removals and context, and says when it was cut', () => {
    render(
      <DiffView
        kind="Email templates"
        diff={{
          against: 'Welcome',
          adds: 1,
          dels: 1,
          lines: [
            { sign: ' ', text: 'subject: Welcome' },
            { sign: '-', text: '  email.text: old' },
            { sign: '+', text: '  email.text: new' },
          ],
          truncated: true,
        }}
      />,
    );
    expect(screen.getByText('Compared with Welcome')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('−1')).toBeTruthy();
    // Testing Library normalises leading whitespace; the indentation is the
    // projection's, and what matters is that the removal renders at all.
    expect(screen.getByText(/email\.text: old/)).toBeTruthy();
    expect(screen.getByText(/email\.text: new/)).toBeTruthy();
    // A cut comparison says so rather than quietly showing part of one.
    expect(screen.getByText(/The comparison was cut/)).toBeTruthy();
  });
});

describe('each page says its own thing', () => {
  it('names itself, its greeting and its actions', () => {
    const cases = [
      { context: 'email' as const, page: 'Email templates', action: 'Send test email' },
      { context: 'invoice-template' as const, page: 'Invoice templates', action: 'Preview another sample' },
      { context: 'invoices' as const, page: 'Invoices', action: 'Create draft invoice' },
      { context: 'report' as const, page: 'Report builder', action: 'Run full preview' },
    ];
    for (const entry of cases) {
      const copy = contextCopy(entry.context, { templates: 2, invoices: 1, reports: 3, tables: 5 }, 'Milo');
      expect(copy.page, entry.context).toBe(entry.page);
      expect(copy.suggestions, entry.context).toHaveLength(3);
      expect(copy.actions.map((action) => action.label), entry.context).toContain(entry.action);
      // Exactly one accent button per page: two primaries is no primary.
      expect(copy.actions.filter((action) => action.primary), entry.context).toHaveLength(1);
    }
  });

  it('marks the read-only actions as writing nothing', () => {
    const report = contextCopy('report', {}, 'Milo');
    expect(report.actions.find((action) => action.id === 'sample')?.writes).toBe(false);
    expect(report.actions.find((action) => action.id === 'save')?.writes).toBe(true);
  });

  it('names the real audit key in every confirm, and promises the editor only when asked', () => {
    for (const context of ['email', 'invoice-template', 'invoices', 'report'] as const) {
      const plain = confirmCopy(context, { name: 'Milo', title: 'Draft', open: false });
      expect(plain.auditKey, context).toBe(`assistant.${context}.create`);
      expect(plain.body, context).not.toContain('open it in the');
      const opening = confirmCopy(context, { name: 'Milo', title: 'Draft', open: true });
      expect(opening.body, context).toContain('open it in the');
    }
  });

  it('turns the server`s fact into this app`s sentence', () => {
    expect(echoText('email', { kind: 'saved', open: false }, 'Welcome')).toBe('Saved as a draft template.');
    expect(echoText('email', { kind: 'saved', open: true }, 'Welcome')).toContain('Opening it in the editor');
    expect(echoText('email', { kind: 'test-sent', to: 'ava@example.test' }, 'Welcome')).toContain(
      'ava@example.test',
    );
    expect(echoText('email', { kind: 'language-added', locale: 'de_DE' }, 'Welcome')).toContain('de_DE');
    // A kind this build does not know about says nothing rather than guessing.
    expect(echoText('email', { kind: 'what' }, 'Welcome')).toBeNull();
  });
});

describe('the glyphs', () => {
  it('draws every step icon the model is offered', () => {
    for (const name of ASSISTANT_STEP_ICONS) {
      expect(assistantIcon(name), name).not.toBeNull();
    }
  });

  it('falls back rather than failing a reply over decoration', () => {
    // An icon is decoration; spending a repair round-trip on one would be a
    // bad trade for the person waiting.
    expect(stepIcon('not-a-glyph')).toBe(stepIcon('search'));
    expect(assistantIcon('not-a-glyph')).toBeNull();
    expect(assistantIcon(null)).toBeNull();
  });

  it('carries exactly the names something can pass it, and no others', () => {
    // Every entry is a lucide import in this surface's chunk. One that no
    // code path can reach is weight a lazy chunk pays for nothing — and a
    // name a page CAN pass with no entry renders a hole. Both directions.
    const reachable = new Set<string>(ASSISTANT_STEP_ICONS);
    for (const context of ['email', 'invoice-template', 'invoices', 'report'] as const) {
      const copy = contextCopy(context, {}, 'Milo');
      reachable.add(copy.pageIcon);
      for (const chip of copy.suggestions) reachable.add(chip.icon);
      for (const action of copy.actions) reachable.add(action.icon);
      reachable.add(confirmCopy(context, { name: 'Milo', title: 'Draft', open: false }).icon);
    }
    expect([...Object.keys(ASSISTANT_ICONS)].sort()).toEqual([...reachable].sort());
  });
});

// ─── under an answer in words ──────────────────────────────────

describe('what stands under an answer', () => {
  const answer = (raw: Record<string, unknown>) => readAnswer({ sources: [], reads: [], truncated: false, ...raw })!;

  it('reads a stored answer, and claims nothing about a turn that recorded none', () => {
    expect(readAnswer(null)).toBeNull();
    expect(readAnswer(undefined)).toBeNull();
    expect(
      readAnswer({
        sources: ['c.main.orders', 7, ''],
        reads: [{ table: 'c.main.orders', tool: 'read_rows', returned: 50, total: 830 }, { tool: 'aggregate' }, 'x'],
        forgot: 4,
        followups: ['Who comes next?', 3],
        suggest: [{ key: 'offers', name: 'Offers', line: 'Codes.', mayInstall: true }, { key: 'nameless' }],
      }),
    ).toEqual({
      sources: ['c.main.orders'],
      reads: [{ table: 'c.main.orders', returned: 50, total: 830, sorted: false }],
      forgot: 4,
      followups: ['Who comes next?'],
      suggest: [{ key: 'offers', name: 'Offers', line: 'Codes.', mayInstall: true }],
      proposal: null,
    });
  });

  it('names a table as a person does', () => {
    expect(tableName('northwind.main.orders')).toBe('orders');
    expect(tableName('orders')).toBe('orders');
  });

  it('calls a read a part only when it was one: unordered, and short of the table', () => {
    const reads = answer({
      reads: [
        { table: 'c.main.orders', returned: 50, total: 830 },
        // The same table read further: one line, for the read that saw the most.
        { table: 'c.main.orders', returned: 200, total: 830 },
        // The top five of an ordered read is a whole answer to "the top five".
        { table: 'c.main.customers', returned: 5, total: 214, sorted: true },
        // All of it.
        { table: 'c.main.items', returned: 12, total: 12 },
        // A count: no rows came back to be a part of anything.
        { table: 'c.main.invoices' },
        // One row of many: read to learn the count that comes with it, not to conclude from the row.
        { table: 'c.main.shippers', returned: 1, total: 12 },
      ],
    }).reads;
    expect(partialReads(reads)).toEqual([{ table: 'c.main.orders', returned: 200, total: 830, sorted: false }]);
  });

  it('says where an answer came from, each table once', () => {
    render(<AnswerFoot reads answer={answer({ sources: ['c.main.orders', 'c.main.customers', 'd.main.orders'] })} />);
    const foot = screen.getByTestId('assistant-answer-foot');
    expect(foot.textContent).toContain('From:');
    expect(foot.textContent).toContain('orders, customers');
    expect(foot.textContent).not.toContain('Nothing was read');
  });

  it('says a part was read, with both numbers and the table', () => {
    render(<AnswerFoot reads answer={answer({ sources: ['c.main.orders'], reads: [{ table: 'c.main.orders', returned: 50, total: 830 }] })} />);
    expect(screen.getByText('Read 50 of 830 rows of orders.')).toBeTruthy();
  });

  it('says nothing was read where the assistant reads data, and offers to have it read', () => {
    const onReadAgain = vi.fn();
    render(<AnswerFoot reads answer={answer({})} onReadAgain={onReadAgain} />);
    expect(screen.getByText('Nothing was read for this answer.')).toBeTruthy();
    screen.getByRole('button', { name: 'Read again' }).click();
    expect(onReadAgain).toHaveBeenCalledTimes(1);
  });

  it('draws nothing under an answer on a page that does not read data and has nothing to offer', () => {
    const { container } = render(<AnswerFoot reads={false} answer={answer({})} />);
    expect(container.firstChild).toBeNull();
  });

  it('offers what to ask next as the person`s own message', () => {
    const onFollowup = vi.fn();
    render(<AnswerFoot reads answer={answer({ sources: ['c.main.orders'] })} followups={['Who comes next?']} onFollowup={onFollowup} />);
    screen.getByRole('button', { name: 'Who comes next?' }).click();
    expect(onFollowup).toHaveBeenCalledWith('Who comes next?');
  });

  it('says how many of the first messages are no longer in mind, by the assistant`s name', () => {
    render(<ForgotDivider count={4} name="Milo" />);
    expect(screen.getByRole('note').textContent).toBe('Milo no longer has the first 4 messages in mind.');
    cleanup();
    render(<ForgotDivider count={1} name="Ada" />);
    expect(screen.getByRole('note').textContent).toBe('Ada no longer has the first message in mind.');
  });
});

describe('the suggestion card', () => {
  const card = { key: 'offers', name: 'Offers & gift cards', line: 'Discounts, codes, vouchers and gift cards.' };

  it('offers the way in to a person who may install', () => {
    const onOpen = vi.fn();
    render(<SuggestionCard suggestion={{ ...card, mayInstall: true }} onOpen={onOpen} />);
    expect(screen.getByText('Offers & gift cards')).toBeTruthy();
    expect(screen.getByText('Discounts, codes, vouchers and gift cards.')).toBeTruthy();
    screen.getByRole('button', { name: 'Open Offers & gift cards in Add-ons' }).click();
    expect(onOpen).toHaveBeenCalledWith('offers');
    expect(screen.queryByText('Ask an administrator to install this.')).toBeNull();
  });

  it('tells anyone else who can, and has no button', () => {
    render(<SuggestionCard suggestion={{ ...card, mayInstall: false }} onOpen={vi.fn()} />);
    expect(screen.getByText('Ask an administrator to install this.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
