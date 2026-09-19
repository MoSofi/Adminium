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
import { contextCopy, confirmCopy, echoText } from './contexts.js';
import { ASSISTANT_ICONS, ASSISTANT_STEP_ICONS, assistantIcon, stepIcon } from './icons.js';
import { DiffView } from './parts/DiffView.js';
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
