// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { DesignerEvent, DesignerEventBody } from '../api.js';
import { foldTurns, isWorking, spendWarnings, waitingCards } from './turns.js';

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
