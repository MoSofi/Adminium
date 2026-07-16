/**
 * `apply-llm-response` exit codes — 06-llm-assist.md §10.4:
 *
 *   "`--dry-run` prints the same per-path validation errors and diff rows the UI
 *    shows. Exit codes: `0` applied, `2` validation failed, `3` nothing accepted."
 *
 * This is a PUBLISHED CONTRACT — CI pipelines branch on these numbers — so it
 * gets its own suite rather than living as three cases inside the dispatch tests.
 * Every path is driven through the real `runCli` against a faked runtime, so
 * what is asserted is the code the process would actually exit with.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SuggestionDiff } from '@adminium/llm';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_YES_ABOVE } from '../src/cli/commands/apply-llm-response.js';
import { runCli } from '../src/cli/run.js';
import { selectAcceptedByConfidence } from '../src/llm/apply-service.js';
import { fakeDeps, fakeIo, fakeRuntime, TEST_SECRET, type FakeRuntime } from './cli-helpers.js';

const ENV = { ADMINIUM_SECRET: TEST_SECRET };

/** A run parked in `awaiting_response` — what `generate-prompt` leaves behind. */
const awaitingRun = {
  id: 'run_1',
  connectionId: 'conn_1',
  snapshotId: 'snap_1',
  status: 'awaiting_response',
  chunksTotal: 1,
  chunksReceived: 0,
  responseJson: null,
};

function diffRow(overrides: Partial<SuggestionDiff> = {}): SuggestionDiff {
  return {
    id: 'label.table.public.orders',
    category: 'label',
    table: 'public.orders',
    status: 'llm-new',
    llmValue: 'Orders',
    heuristicValue: undefined,
    confidence: 0.9,
    ...overrides,
  } as SuggestionDiff;
}

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-apply-'));
  file = join(dir, 'response.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1 }), 'utf8');
});

/** A runtime whose BYO intake validates cleanly and yields `diff`. */
function runtimeWithDiff(diff: SuggestionDiff[]): FakeRuntime {
  const runtime = fakeRuntime();
  runtime.runService.getRun.mockResolvedValue(awaitingRun);
  runtime.promptService.loadLatestModel.mockResolvedValue({ snapshotId: 'snap_1', model: {} });
  runtime.runService.receiveResponse.mockResolvedValue({
    run: { ...awaitingRun, status: 'validated', chunksReceived: 1, responseJson: {} },
    validation: { response: {}, errors: [], warnings: [] },
  });
  runtime.applyService.buildPlanForRun.mockResolvedValue({ diff, plan: {}, model: {} });
  runtime.applyService.applyRun.mockResolvedValue({
    run: { ...awaitingRun, status: 'applied' },
    review: { accepted: diff.map((row) => row.id), rejected: [] },
    counts: { overrides: diff.length, pages: 0, navGroupUpdates: 0 },
    partial: false,
    plan: {},
    summary: {},
    undo: {},
  });
  return runtime;
}

const argv = (...extra: string[]): string[] => ['apply-llm-response', '--run', 'run_1', '--file', file, ...extra];

// ── 0 — applied ──────────────────────────────────────────────────────────────

describe('exit 0 — applied', () => {
  it('applies the accepted rows and exits 0', async () => {
    const runtime = runtimeWithDiff([diffRow({ confidence: 0.9 })]);
    const io = fakeIo();
    await expect(runCli(argv(), { io, deps: fakeDeps({ env: ENV, runtime, cwd: dir }) })).resolves.toBe(0);
    expect(runtime.applyService.applyRun).toHaveBeenCalledWith('run_1', ['label.table.public.orders']);
    expect(io.stdout()).toContain('Applied 1 suggestion(s)');
  });

  it('prints the diff table before applying', async () => {
    const runtime = runtimeWithDiff([diffRow({ confidence: 0.9 })]);
    const io = fakeIo();
    await runCli(argv(), { io, deps: fakeDeps({ env: ENV, runtime, cwd: dir }) });
    expect(io.stdout()).toContain('category');
    expect(io.stdout()).toContain('public.orders');
    expect(io.stdout()).toContain('0.90');
  });

  it('forwards --chunk to the BYO intake', async () => {
    const runtime = runtimeWithDiff([diffRow()]);
    await runCli(argv('--chunk', '2'), { io: fakeIo(), deps: fakeDeps({ env: ENV, runtime, cwd: dir }) });
    expect(runtime.runService.receiveResponse).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ chunkIndex: 2 }),
    );
  });

  it('honors --yes-above, applying only rows at or above it', async () => {
    const runtime = runtimeWithDiff([
      diffRow({ id: 'a', confidence: 0.95 }),
      diffRow({ id: 'b', confidence: 0.5 }),
    ]);
    await runCli(argv('--yes-above', '0.9'), {
      io: fakeIo(),
      deps: fakeDeps({ env: ENV, runtime, cwd: dir }),
    });
    expect(runtime.applyService.applyRun).toHaveBeenCalledWith('run_1', ['a']);
  });

  it('defaults the threshold to the review screen\'s 0.8', async () => {
    const runtime = runtimeWithDiff([
      diffRow({ id: 'high', confidence: 0.85 }),
      diffRow({ id: 'low', confidence: 0.75 }),
    ]);
    await runCli(argv(), { io: fakeIo(), deps: fakeDeps({ env: ENV, runtime, cwd: dir }) });
    expect(DEFAULT_YES_ABOVE).toBe(0.8);
    expect(runtime.applyService.applyRun).toHaveBeenCalledWith('run_1', ['high']);
  });
});

// ── 2 — validation failed ────────────────────────────────────────────────────

describe('exit 2 — validation failed', () => {
  it('exits 2 and applies nothing when the response is fatally invalid', async () => {
    const runtime = fakeRuntime();
    runtime.runService.getRun.mockResolvedValue(awaitingRun);
    runtime.promptService.loadLatestModel.mockResolvedValue({ snapshotId: 'snap_1', model: {} });
    runtime.runService.receiveResponse.mockResolvedValue({
      run: awaitingRun,
      validation: {
        response: undefined,
        errors: [{ path: 'tables[0].label', code: 'INVALID_TYPE', message: 'Expected string' }],
        warnings: [],
      },
    });
    const io = fakeIo();
    await expect(runCli(argv(), { io, deps: fakeDeps({ env: ENV, runtime, cwd: dir }) })).resolves.toBe(2);
    expect(runtime.applyService.applyRun).not.toHaveBeenCalled();
  });

  it('prints the per-path errors the UI shows (§10.4)', async () => {
    const runtime = fakeRuntime();
    runtime.runService.getRun.mockResolvedValue(awaitingRun);
    runtime.promptService.loadLatestModel.mockResolvedValue({ snapshotId: 'snap_1', model: {} });
    runtime.runService.receiveResponse.mockResolvedValue({
      run: awaitingRun,
      validation: {
        response: undefined,
        errors: [{ path: 'tables[0].label', code: 'INVALID_TYPE', message: 'Expected string' }],
        warnings: [],
      },
    });
    const io = fakeIo();
    await runCli(argv(), { io, deps: fakeDeps({ env: ENV, runtime, cwd: dir }) });
    expect(io.stderr()).toContain('Validation failed');
    expect(io.stderr()).toContain('tables[0].label');
    expect(io.stderr()).toContain('INVALID_TYPE');
    expect(io.stderr()).toContain('Expected string');
  });

  it('exits 2 even with --dry-run: invalid is invalid', async () => {
    const runtime = fakeRuntime();
    runtime.runService.getRun.mockResolvedValue(awaitingRun);
    runtime.promptService.loadLatestModel.mockResolvedValue({ snapshotId: 'snap_1', model: {} });
    runtime.runService.receiveResponse.mockResolvedValue({
      run: awaitingRun,
      validation: {
        response: undefined,
        errors: [{ path: 'x', code: 'BAD', message: 'nope' }],
        warnings: [],
      },
    });
    await expect(
      runCli(argv('--dry-run'), { io: fakeIo(), deps: fakeDeps({ env: ENV, runtime, cwd: dir }) }),
    ).resolves.toBe(2);
  });
});

// ── 3 — nothing accepted ─────────────────────────────────────────────────────

describe('exit 3 — nothing accepted', () => {
  it('exits 3 when every row is below the threshold', async () => {
    const runtime = runtimeWithDiff([diffRow({ confidence: 0.4 })]);
    const io = fakeIo();
    await expect(runCli(argv(), { io, deps: fakeDeps({ env: ENV, runtime, cwd: dir }) })).resolves.toBe(3);
    expect(runtime.applyService.applyRun).not.toHaveBeenCalled();
    expect(io.stdout()).toContain('Nothing accepted');
  });

  it('exits 3 when the diff is empty', async () => {
    const runtime = runtimeWithDiff([]);
    await expect(
      runCli(argv(), { io: fakeIo(), deps: fakeDeps({ env: ENV, runtime, cwd: dir }) }),
    ).resolves.toBe(3);
  });

  it('exits 3 when a chunked run still awaits more chunks — nothing to accept yet', async () => {
    const runtime = fakeRuntime();
    runtime.runService.getRun.mockResolvedValue({ ...awaitingRun, chunksTotal: 3 });
    runtime.promptService.loadLatestModel.mockResolvedValue({ snapshotId: 'snap_1', model: {} });
    runtime.runService.receiveResponse.mockResolvedValue({
      run: { ...awaitingRun, chunksTotal: 3, chunksReceived: 1, status: 'awaiting_response' },
      validation: { response: {}, errors: [], warnings: [] },
    });
    const io = fakeIo();
    await expect(runCli(argv('--chunk', '1'), { io, deps: fakeDeps({ env: ENV, runtime, cwd: dir }) })).resolves.toBe(3);
    expect(io.stdout()).toContain('Chunk 1/3 accepted');
    expect(runtime.applyService.applyRun).not.toHaveBeenCalled();
  });

  it('suggests lowering the bar rather than leaving the user stuck', async () => {
    const runtime = runtimeWithDiff([diffRow({ confidence: 0.4 })]);
    const io = fakeIo();
    await runCli(argv(), { io, deps: fakeDeps({ env: ENV, runtime, cwd: dir }) });
    expect(io.stdout()).toContain('--yes-above');
  });
});

// ── --dry-run ────────────────────────────────────────────────────────────────

describe('--dry-run applies nothing', () => {
  it('exits 0 and never calls applyRun', async () => {
    const runtime = runtimeWithDiff([diffRow({ confidence: 0.9 })]);
    const io = fakeIo();
    await expect(
      runCli(argv('--dry-run'), { io, deps: fakeDeps({ env: ENV, runtime, cwd: dir }) }),
    ).resolves.toBe(0);
    expect(runtime.applyService.applyRun).not.toHaveBeenCalled();
    expect(io.stdout()).toContain('Nothing was written');
    expect(io.stdout()).toContain('would apply 1');
  });

  it('prints the same diff rows a real apply would (§10.4)', async () => {
    const rows = [diffRow({ id: 'a', confidence: 0.9 })];
    const dryIo = fakeIo();
    await runCli(argv('--dry-run'), {
      io: dryIo,
      deps: fakeDeps({ env: ENV, runtime: runtimeWithDiff(rows), cwd: dir }),
    });
    const wetIo = fakeIo();
    await runCli(argv(), { io: wetIo, deps: fakeDeps({ env: ENV, runtime: runtimeWithDiff(rows), cwd: dir }) });

    // The table is identical; only the trailing summary differs.
    const table = (text: string): string => text.split('\n').slice(0, 3).join('\n');
    expect(table(dryIo.stdout())).toBe(table(wetIo.stdout()));
  });

  it('still exits 3 when nothing would be accepted', async () => {
    const runtime = runtimeWithDiff([diffRow({ confidence: 0.1 })]);
    await expect(
      runCli(argv('--dry-run'), { io: fakeIo(), deps: fakeDeps({ env: ENV, runtime, cwd: dir }) }),
    ).resolves.toBe(3);
  });
});

// ── the shared selector the threshold rides on ───────────────────────────────

describe('selectAcceptedByConfidence — shared with the review screen (§8.2/§10.3)', () => {
  it('accepts actionable rows at or above the threshold (inclusive)', () => {
    const diff = [
      diffRow({ id: 'exact', confidence: 0.8 }),
      diffRow({ id: 'above', confidence: 0.81 }),
      diffRow({ id: 'below', confidence: 0.79 }),
    ];
    expect(selectAcceptedByConfidence(diff, 0.8)).toEqual(['exact', 'above']);
  });

  it('never accepts a user-locked row — user > llm provenance holds at any threshold', () => {
    const diff = [diffRow({ id: 'locked', status: 'user-locked', confidence: 1 })];
    expect(selectAcceptedByConfidence(diff, 0)).toEqual([]);
  });

  it('never accepts heuristic-only rows — the LLM offered nothing to apply', () => {
    const diff = [diffRow({ id: 'h', status: 'heuristic-only', confidence: 1 })];
    expect(selectAcceptedByConfidence(diff, 0)).toEqual([]);
  });

  it('accepts each actionable status', () => {
    const diff = [
      diffRow({ id: 'agree', status: 'agree' }),
      diffRow({ id: 'conflict', status: 'conflict' }),
      diffRow({ id: 'new', status: 'llm-new' }),
      diffRow({ id: 'rejects', status: 'rejects-heuristic' }),
    ];
    expect(selectAcceptedByConfidence(diff, 0.5)).toEqual(['agree', 'conflict', 'new', 'rejects']);
  });
});
