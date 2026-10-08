// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { DesignerEvent, DesignerEventBody } from '../api.js';
import { stepLine } from './stepLine.js';
import { foldTurns, heldBy, isWorking, spendWarnings, waitingCards, type StepRow } from './turns.js';

let seq = 0;
const at = (turn: number, body: DesignerEventBody, time = seq * 100): DesignerEvent => {
  seq += 1;
  return { ...body, seq, turn, at: time } as DesignerEvent;
};

describe('foldTurns', () => {
  it('draws a turn from its events: message, text, steps in place, a version and how it ended', () => {
    seq = 0;
    const turns = foldTurns([
      at(1, { kind: 'turn-started', text: 'A repair desk.' }, 0),
      at(1, { kind: 'text', delta: 'I will build ' }),
      at(1, { kind: 'step', id: 's1', tool: 'write_file', label: 'Writing a', state: 'running', subject: 'apps/r/manifest/tables/jobs.json' }),
      at(1, { kind: 'text', delta: 'it.' }),
      at(1, { kind: 'step', id: 's1', tool: 'write_file', label: 'Wrote a', state: 'done', ms: 30, subject: 'apps/r/manifest/tables/jobs.json' }),
      at(1, { kind: 'step', id: 's2', tool: 'write_file', label: 'Wrote b', state: 'done', ms: 20, subject: 'apps/r/manifest/tables/parts.json' }),
      at(1, { kind: 'step', id: 's3', tool: 'check_app', label: 'Checked', state: 'done', ms: 5, count: 0 }),
      at(1, { kind: 'usage', step: 3, tokensIn: 100, tokensOut: 10, estimated: false, turnTokens: 12400 }),
      at(1, { kind: 'check', ok: true, findings: [] }),
      at(1, { kind: 'apply', ok: true, state: 'installed' }),
      at(1, { kind: 'version', n: 1, name: 'v1' }),
      at(1, { kind: 'turn-finished', outcome: 'done' }, 2500),
    ]);
    expect(turns).toHaveLength(1);
    const [turn] = turns;
    expect(turn).toMatchObject({ text: 'A repair desk.', reply: 'I will build it.', version: { n: 1, name: 'v1' }, outcome: 'done', startedAt: 0, finishedAt: 2500, changedFiles: true, stepCount: 3 });
    // The two writes, one after another, are one row; the check and the apply follow.
    expect(turn?.steps.map((row) => [row.tool, row.state, row.folded])).toEqual([
      ['write_file', 'done', 2],
      ['check_app', 'done', 1],
      ['apply', 'done', 1],
    ]);
    expect(turn?.steps[0]?.subject).toBeUndefined();
    expect(isWorking(turns)).toBe(false);
  });

  it('says a good apply once, however many times the turn applied', () => {
    seq = 0;
    const turns = foldTurns([
      at(1, { kind: 'turn-started', text: 'x' }),
      at(1, { kind: 'step', id: 'a', tool: 'apply_app', label: 'Applied', state: 'done' }),
      at(1, { kind: 'apply', ok: true, state: 'installed' }),
      at(1, { kind: 'apply', ok: true, state: 'installed' }),
      at(1, { kind: 'turn-finished', outcome: 'done' }),
    ]);
    expect(turns[0]?.steps.map((row) => row.tool)).toEqual(['apply_app']);
  });

  it('keeps a lone write named, a running step in place, and a turn with no end as working', () => {
    seq = 0;
    const turns = foldTurns([
      at(2, { kind: 'turn-started', text: 'Add parts.' }),
      at(2, { kind: 'step', id: 'a', tool: 'write_file', label: 'Wrote', state: 'done', subject: 'apps/r/x.json' }),
      at(2, { kind: 'step', id: 'b', tool: 'build_sides', label: 'Building', state: 'running' }),
    ]);
    expect(turns[0]?.steps.map((row) => [row.tool, row.state, row.subject])).toEqual([
      ['write_file', 'done', 'apps/r/x.json'],
      ['build_sides', 'running', undefined],
    ]);
    expect(isWorking(turns)).toBe(true);
  });

  it('joins a write still running to the row above it, so the list never grows and then shrinks', () => {
    seq = 0;
    const first = [
      at(1, { kind: 'turn-started', text: 'x' }),
      at(1, { kind: 'step', id: 'a', tool: 'write_file', label: 'Wrote a', state: 'done', ms: 10, subject: 'apps/r/a.json' }),
      at(1, { kind: 'step', id: 'b', tool: 'write_file', label: 'Writing b', state: 'running', subject: 'apps/r/b.json' }),
    ];
    const running = foldTurns(first)[0]?.steps ?? [];
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ id: 'a', state: 'running', folded: 2, subject: 'apps/r/b.json' });
    expect(stepLine(running[0] as StepRow)).toBe('Writing \u0001');

    const done = foldTurns([...first, at(1, { kind: 'step', id: 'b', tool: 'write_file', label: 'Wrote b', state: 'done', ms: 5, subject: 'apps/r/b.json' })])[0]?.steps ?? [];
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ id: 'a', state: 'done', folded: 2 });
    expect(stepLine(done[0] as StepRow)).toBe('Wrote 2 files');

    // A write that fails stands on its own line, and says it was not written.
    const failed = foldTurns([...first, at(1, { kind: 'step', id: 'b', tool: 'write_file', label: 'Could not write b', state: 'failed', ms: 5, subject: 'apps/r/b.json', ended: 'error', detail: 'That is not valid JSON' })])[0]?.steps ?? [];
    expect(failed.map((row) => row.state)).toEqual(['done', 'failed']);
    expect(stepLine(failed[1] as StepRow)).toBe('Could not write \u0001');
    expect(failed[1]?.detail).toBe('That is not valid JSON');
  });

  it('tells a miss from a failure: a file or reference that is not there', () => {
    seq = 0;
    const rows =
      foldTurns([
        at(1, { kind: 'turn-started', text: 'x' }),
        at(1, { kind: 'step', id: 'a', tool: 'read_reference', label: 'No such reference', state: 'failed', ms: 1, subject: 'adminium-surface/references/guides/own-row.md', ended: 'miss' }),
        // A session written before misses were told apart.
        at(1, { kind: 'step', id: 'b', tool: 'read_reference', label: 'No such reference', state: 'failed', ms: 1, subject: 'x.md', ended: 'error' }),
        at(1, { kind: 'step', id: 'c', tool: 'read_file', label: 'Could not read', state: 'failed', ms: 1, subject: 'apps/r/nope.json', ended: 'miss' }),
        at(1, { kind: 'step', id: 'd', tool: 'read_file', label: 'Could not read', state: 'failed', ms: 1, subject: '../.env', ended: 'error', detail: 'outside' }),
      ])[0]?.steps ?? [];
    expect(rows.map((row) => row.state)).toEqual(['missed', 'missed', 'missed', 'failed']);
    expect(stepLine(rows[0] as StepRow)).toBe('Looked for \u0001 — not there');
    expect(stepLine(rows[3] as StepRow)).toBe('Could not read \u0001');
  });

  it('lists the cards still waiting, and none once answered or the turn ended', () => {
    seq = 0;
    const question = { id: 'c1', type: 'question' as const, question: 'Prices?', choices: ['Yes', 'No'] };
    const asking = [at(1, { kind: 'turn-started', text: 'x' }), at(1, { kind: 'card', card: question })];
    expect(waitingCards(foldTurns(asking))).toEqual([question]);
    const answered = [...asking, at(1, { kind: 'card-answered', id: 'c1', value: { text: 'Yes' } })];
    expect(waitingCards(foldTurns(answered))).toEqual([]);
    expect(foldTurns(answered)[0]?.cards[0]).toMatchObject({ answered: true, answer: { text: 'Yes' } });
    expect(waitingCards(foldTurns([...asking, at(1, { kind: 'turn-finished', outcome: 'stopped' })]))).toEqual([]);
  });

  it('keeps what went wrong: a failed check, a build, an apply, a limit, an error', () => {
    seq = 0;
    const turns = foldTurns([
      at(1, { kind: 'turn-started', text: 'x' }),
      at(1, { kind: 'check', ok: false, findings: [{ file: 'tables/jobs.json', path: 'columns', message: 'no such column', level: 'error' }, { file: 'a', path: '', message: 'note', level: 'note' }] }),
      at(1, { kind: 'build', ok: false, problems: ['src/App.tsx: x is not defined'] }),
      at(1, { kind: 'apply', ok: false, state: 'refused', stage: 'check', message: 'The check found errors.' }),
      at(1, { kind: 'limit', which: 'steps', value: 60 }),
      at(1, { kind: 'error', code: 'server', message: 'overloaded', provider: 'anthropic', status: 529 }),
      at(1, { kind: 'turn-finished', outcome: 'not-applied' }),
    ]);
    const [turn] = turns;
    expect(turn?.steps.map((row) => [row.tool, row.state, row.count ?? null])).toEqual([
      ['check', 'failed', 1],
      ['build', 'failed', null],
      ['apply', 'failed', null],
    ]);
    expect(turn?.steps[0]?.detail).toBe('tables/jobs.json · no such column');
    expect(turn).toMatchObject({ notApplied: 'The check found errors.', limit: { which: 'steps', value: 60 }, error: { provider: 'anthropic', status: 529 }, changedFiles: false, stepCount: 0 });
  });
});

describe('spendWarnings', () => {
  it('keeps the session’s mark for good and the turn’s mark only while that turn is working', () => {
    seq = 0;
    const first = [
      at(1, { kind: 'turn-started', text: 'Build it.' }),
      at(1, { kind: 'usage', step: 1, tokensIn: 1_600_000, tokensOut: 10, estimated: false, turnTokens: 1_600_010 }),
      at(1, { kind: 'spend', which: 'turn-tokens', mark: 1_500_000, used: 1_600_010 }),
      at(1, { kind: 'spend', which: 'turn-tokens', mark: 1_500_000, used: 1_700_000 }),
    ];
    expect(foldTurns(first)[0]?.spend).toEqual([{ which: 'turn-tokens', mark: 1_500_000 }]);
    expect(spendWarnings(foldTurns(first))).toEqual([{ which: 'turn-tokens', mark: 1_500_000 }]);
    // It ended nothing: the turn is still running.
    expect(isWorking(foldTurns(first))).toBe(true);

    const later = [
      ...first,
      at(1, { kind: 'spend', which: 'session-tokens', mark: 15_000_000, used: 15_000_001 }),
      at(1, { kind: 'turn-finished', outcome: 'done' }),
      at(2, { kind: 'turn-started', text: 'And a list.' }),
    ];
    // The turn ended: its own mark is no longer said. The session's stays.
    expect(spendWarnings(foldTurns(later.slice(0, -1)))).toEqual([{ which: 'session-tokens', mark: 15_000_000 }]);
    expect(spendWarnings(foldTurns(later))).toEqual([{ which: 'session-tokens', mark: 15_000_000 }]);
    expect(spendWarnings([])).toEqual([]);
  });
});

describe('what a person does outside a turn', () => {
  /** An event the server marks as a person's: it carries the last turn's number, and belongs to no turn. */
  const mine = (turn: number, body: DesignerEventBody): DesignerEvent => ({ ...at(turn, body), by: 'person' });
  const finished = (): DesignerEvent[] => [
    at(1, { kind: 'turn-started', text: 'A repair desk.' }, 0),
    at(1, { kind: 'apply', ok: true, state: 'installed' }),
    at(1, { kind: 'version', n: 1, name: 'v1' }),
    at(1, { kind: 'turn-finished', outcome: 'done' }, 900),
  ];

  it('a hand save after a finished turn adds no row, keeps the reply’s own version, and leaves nothing working', () => {
    seq = 0;
    const events = [
      ...finished(),
      mine(1, { kind: 'hold', what: 'save' }),
      mine(1, { kind: 'check', ok: false, findings: [{ file: 'a.json', path: '', message: 'not valid JSON', level: 'error' }] }),
      mine(1, { kind: 'build', ok: false, problems: ['no'] }),
      mine(1, { kind: 'apply', ok: true, state: 'unchanged' }),
      mine(1, { kind: 'version', n: 2, name: 'v2 · Your edit to design.css' }),
      mine(1, { kind: 'released', what: 'save' }),
    ];
    const turns = foldTurns(events);
    expect(turns).toHaveLength(1);
    expect(isWorking(turns)).toBe(false);
    expect(turns[0]?.steps.map((row) => row.tool)).toEqual(['apply']);
    expect(turns[0]?.version).toEqual({ n: 1, name: 'v1' });
    expect(turns[0]?.buildFailed).toBeNull();
    expect(heldBy(events)).toBeNull();
  });

  it('a session with no turn stays with no turn: nothing reads as working after a hand save', () => {
    seq = 0;
    const events = [mine(0, { kind: 'hold', what: 'save' }), mine(0, { kind: 'version', n: 1, name: 'v1 · Your edit to design.css' }), mine(0, { kind: 'released', what: 'save' })];
    expect(foldTurns(events)).toEqual([]);
    expect(isWorking(foldTurns(events))).toBe(false);
    // 0.3.17's own style event, before events said whose they were, is a person's too when it comes at turn 0.
    expect(foldTurns([mine(0, { kind: 'style', skill: 'warm', title: 'Warm table' })])).toEqual([]);
  });

  it('a style change and going back still say themselves under the last reply', () => {
    seq = 0;
    const turns = foldTurns([
      ...finished(),
      mine(1, { kind: 'hold', what: 'style' }),
      mine(1, { kind: 'style', skill: 'warm', title: 'Warm table', fonts: [] }),
      mine(1, { kind: 'version', n: 2, name: 'v2' }),
      mine(1, { kind: 'released', what: 'style' }),
    ]);
    expect(turns[0]?.style).toEqual({ title: 'Warm table', fonts: [] });
    expect(turns[0]?.version).toEqual({ n: 2, name: 'v2' });
    expect(turns[0]?.steps.map((row) => row.tool)).toEqual(['apply']);
  });

  it('says what holds the folder while it is held, and nothing once it is handed back', () => {
    seq = 0;
    const held = [...finished(), mine(1, { kind: 'hold', what: 'restore' })];
    expect(heldBy(held)).toBe('restore');
    expect(heldBy([...held, mine(1, { kind: 'released', what: 'restore' })])).toBeNull();
    expect(heldBy([])).toBeNull();
  });

  it('a look the Designer took is no step of the turn', () => {
    seq = 0;
    const turns = foldTurns([at(1, { kind: 'turn-started', text: 'x' }, 0), at(1, { kind: 'sight', side: 'customer', path: '/menu' })]);
    expect(turns[0]?.stepCount).toBe(0);
    expect(isWorking(turns)).toBe(true);
  });
});

