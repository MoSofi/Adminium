/**
 * CLI test doubles (not collected — no `.test`).
 *
 * The CLI's whole design goal is that no subcommand reaches past
 * `CliRuntime` — so faking that one object is enough to drive every command
 * with zero infrastructure: no meta store, no source database, no listening
 * socket. A command that started doing its own queries or its own HTTP would
 * fail here, which is the point.
 */
import { vi } from 'vitest';

import type { CliIo } from '../src/cli/io.js';
import type { CliDeps, CliRuntime, StartedServer } from '../src/cli/runtime.js';
import type { Env } from '../src/config/env.js';

export const TEST_SECRET = 'a-sufficiently-long-test-secret';

/** A scripted {@link CliIo}: canned answers in, captured output out. */
export interface FakeIo extends CliIo {
  stdout(): string;
  stderr(): string;
  /** Questions asked, in order — lets a wizard test assert the step sequence. */
  questions(): string[];
}

export interface FakeIoOptions {
  /** Answers handed to `ask`/`confirm`, in order. Exhausted → '' / the default. */
  answers?: string[];
  interactive?: boolean;
}

export function fakeIo(opts: FakeIoOptions = {}): FakeIo {
  let out = '';
  let err = '';
  const asked: string[] = [];
  const answers = [...(opts.answers ?? [])];

  return {
    out(line = '') {
      out += `${line}\n`;
    },
    err(line = '') {
      err += `${line}\n`;
    },
    async ask(question, askOpts = {}) {
      asked.push(question);
      const next = answers.shift();
      return Promise.resolve(next === undefined || next === '' ? (askOpts.default ?? '') : next);
    },
    async confirm(question, defaultYes = true) {
      asked.push(question);
      const next = answers.shift();
      if (next === undefined || next === '') return Promise.resolve(defaultYes);
      return Promise.resolve(next.toLowerCase() === 'y' || next.toLowerCase() === 'yes');
    },
    isInteractive: opts.interactive ?? true,
    async close() {
      return Promise.resolve();
    },
    stdout: () => out,
    stderr: () => err,
    questions: () => [...asked],
  };
}

/**
 * A {@link CliRuntime} of `vi.fn()`s. Every field is a spy, so a test asserts
 * "the command called THIS service with THESE options" rather than re-checking
 * the service's own behavior (which has its own suites).
 */
export type FakeRuntime = CliRuntime & {
  runService: Record<string, ReturnType<typeof vi.fn>>;
  applyService: Record<string, ReturnType<typeof vi.fn>>;
  promptService: Record<string, ReturnType<typeof vi.fn>>;
};

export function fakeRuntime(overrides: Partial<CliRuntime> = {}): FakeRuntime {
  const runtime = {
    env: { ADMINIUM_DATA_DIR: './data', ADMINIUM_SECRET: TEST_SECRET } as unknown as Env,
    metaStore: {
      meta: { db: {}, dialect: 'sqlite' },
      url: 'sqlite::memory:',
      engine: 'sqlite',
      source: 'embedded',
      close: vi.fn(async () => Promise.resolve()),
    },
    manager: {
      testDsn: vi.fn(),
      enforceMetaPlacement: vi.fn(),
      connections: { create: vi.fn(), update: vi.fn() },
      disposeAll: vi.fn(async () => Promise.resolve()),
    },
    runService: { getRun: vi.fn(), receiveResponse: vi.fn() },
    applyService: { buildPlanForRun: vi.fn(), applyRun: vi.fn() },
    promptService: { createRunForConnection: vi.fn(), loadLatestModel: vi.fn() },
    allowed: { templates: ['page-crud'], widgets: ['kpi-stat-card'] },
    promptServiceError: null,
    close: vi.fn(async () => Promise.resolve()),
    ...overrides,
  } as unknown as FakeRuntime;
  return runtime;
}

export interface FakeDepsOptions {
  env?: Record<string, string | undefined>;
  runtime?: CliRuntime;
  cwd?: string;
  exportZip?: CliDeps['exportZip'];
  importZip?: CliDeps['importZip'];
}

/** {@link CliDeps} whose `openRuntime`/`startServer` never touch the world. */
export function fakeDeps(opts: FakeDepsOptions = {}): CliDeps & {
  openRuntime: ReturnType<typeof vi.fn>;
  startServer: ReturnType<typeof vi.fn>;
  exportZip: ReturnType<typeof vi.fn>;
  importZip: ReturnType<typeof vi.fn>;
  runtime: CliRuntime;
} {
  const runtime = opts.runtime ?? fakeRuntime();
  const started: StartedServer = {
    url: 'http://localhost:4600',
    app: {} as StartedServer['app'],
    close: vi.fn(async () => Promise.resolve()),
  };
  return {
    env: opts.env ?? { ADMINIUM_SECRET: TEST_SECRET },
    cwd: opts.cwd ?? '/tmp',
    openRuntime: vi.fn(async () => Promise.resolve(runtime)),
    startServer: vi.fn(async () => Promise.resolve(started)),
    exportZip: vi.fn(opts.exportZip ?? (async () => Promise.reject(new Error('not stubbed')))),
    importZip: vi.fn(opts.importZip ?? (async () => Promise.reject(new Error('not stubbed')))),
    runtime,
  } as unknown as CliDeps & {
    openRuntime: ReturnType<typeof vi.fn>;
    startServer: ReturnType<typeof vi.fn>;
    exportZip: ReturnType<typeof vi.fn>;
    importZip: ReturnType<typeof vi.fn>;
    runtime: CliRuntime;
  };
}
