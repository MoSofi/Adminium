// SPDX-License-Identifier: AGPL-3.0-only
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
  /** Every choice list `select`/`multiselect` was offered, in order. */
  menus(): { title: string; labels: string[] }[];
}

export interface FakeIoOptions {
  /** Answers handed to `ask`/`confirm`, in order. Exhausted → '' / the default. */
  answers?: string[];
  /**
   * Answers handed to `select`, in order — either a 0-based index or the exact
   * label to pick. Labels are preferred in tests: an index silently keeps
   * passing when a menu gains a row, a label fails loudly, which is the whole
   * point of asserting the wizard's shape.
   */
  selections?: (number | string)[];
  /**
   * Answers handed to `multiselect`, in order — labels or 0-based indices.
   * Exhausted → everything, which is the prompt's own opening state.
   */
  picks?: (number | string)[][];
  interactive?: boolean;
  /** Drives `supportsTui`; defaults to `interactive`. */
  tui?: boolean;
}

export function fakeIo(opts: FakeIoOptions = {}): FakeIo {
  let out = '';
  let err = '';
  const asked: string[] = [];
  const offered: { title: string; labels: string[] }[] = [];
  const answers = [...(opts.answers ?? [])];
  const selections = [...(opts.selections ?? [])];
  const picks = [...(opts.picks ?? [])];
  const interactive = opts.interactive ?? true;

  return {
    out(line = '') {
      out += `${line}\n`;
    },
    err(line = '') {
      err += `${line}\n`;
    },
    // The rail methods record their CONTENT, undecorated. What glyph a line
    // hangs off is `nodeIo`'s business and is asserted against the pure
    // renderers in cli-tui.test.ts; a wizard test asserting on `◇` would be
    // testing the paint job, and would break on every restyle.
    intro(title) {
      out += `${title}\n`;
    },
    step(text) {
      out += `${text}\n`;
    },
    // The `tone` argument is deliberately dropped here — it is styling, and
    // what a wizard test cares about is that the line was said at all.
    note(text = '') {
      out += `${text}\n`;
    },
    warn(text) {
      out += `${text}\n`;
    },
    outro(text) {
      out += `${text}\n`;
    },
    async ask(question, askOpts = {}) {
      asked.push(question);
      for (;;) {
        const next = answers.shift();
        const value = next === undefined || next === '' ? (askOpts.default ?? '') : next;
        // The real `ask` re-prompts until `validate` passes, so the fake must
        // too — otherwise a test scripting a bad-then-good pair would get the
        // bad one back and the validation would never be exercised.
        const problem = askOpts.validate?.(value) ?? null;
        if (problem === null) return Promise.resolve(value);
        err += `${problem}\n`;
        if (answers.length === 0) return Promise.resolve(value);
      }
    },
    async confirm(question, defaultYes = true) {
      asked.push(question);
      const next = answers.shift();
      if (next === undefined || next === '') return Promise.resolve(defaultYes);
      return Promise.resolve(next.toLowerCase() === 'y' || next.toLowerCase() === 'yes');
    },
    async select(title, choices, selectOpts = {}) {
      const labels = choices.map((choice) => choice.label);
      asked.push(title);
      offered.push({ title, labels });
      const next = selections.shift();
      if (next === undefined) return Promise.resolve(selectOpts.defaultIndex ?? 0);
      if (typeof next === 'number') return Promise.resolve(next);
      const index = labels.findIndex((label) => label === next);
      if (index === -1) {
        throw new Error(
          `fakeIo.select: no choice labelled ${JSON.stringify(next)} in ${JSON.stringify(title)} — offered ${JSON.stringify(labels)}`,
        );
      }
      return Promise.resolve(index);
    },
    async multiselect(title, choices, multiOpts = {}) {
      const labels = choices.map((choice) => choice.label);
      asked.push(title);
      offered.push({ title, labels });
      const next = picks.shift();
      if (next === undefined) {
        return Promise.resolve([...(multiOpts.selected ?? labels.map((_, i) => i))]);
      }
      return Promise.resolve(
        next
          .map((entry) => {
            if (typeof entry === 'number') return entry;
            const index = labels.indexOf(entry);
            if (index === -1) {
              throw new Error(
                `fakeIo.multiselect: no choice labelled ${JSON.stringify(entry)} in ${JSON.stringify(title)} — offered ${JSON.stringify(labels)}`,
              );
            }
            return index;
          })
          .sort((a, b) => a - b),
      );
    },
    isInteractive: interactive,
    supportsTui: opts.tui ?? interactive,
    async close() {
      return Promise.resolve();
    },
    stdout: () => out,
    stderr: () => err,
    questions: () => [...asked],
    menus: () => offered.map((menu) => ({ ...menu, labels: [...menu.labels] })),
  };
}

/**
 * A {@link CliRuntime} of `vi.fn()`s. Every field is a spy, so a test asserts
 * "the command called THIS service with THESE options" rather than re-checking
 * the service's own behavior (which has its own suites).
 */
type Spy = ReturnType<typeof vi.fn>;

/**
 * Every method of `S`, replaced by the spy standing in for it. The keys stay
 * bound to the real service, so a stub for a method that no longer exists is a
 * compile error rather than a silently dead line.
 */
type SpiedService<S> = { [K in keyof NonNullable<S>]: Spy };

/**
 * `Omit` rather than a plain intersection: on `CliRuntime & { runService: ... }`
 * TypeScript resolves `runService.getRun` against the FIRST member that declares
 * it — the real `RunService` — so the spy half never contributed `.mockResolvedValue`
 * and every stub in the CLI suites was an error waiting to be typechecked.
 */
export type FakeRuntime = Omit<CliRuntime, 'runService' | 'applyService' | 'promptService'> & {
  runService: SpiedService<CliRuntime['runService']>;
  applyService: SpiedService<CliRuntime['applyService']>;
  promptService: SpiedService<CliRuntime['promptService']>;
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
  /** Whether the fake browser launch reports success. */
  browserOpens?: boolean;
  /** What the fake `startServer` reports as the bridge pairing code. */
  bridgePairingCode?: string | null;
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
    bridgePairingCode: opts.bridgePairingCode ?? null,
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
    openBrowser: vi.fn(async () => Promise.resolve(opts.browserOpens ?? true)),
    runtime,
  } as unknown as CliDeps & {
    openRuntime: ReturnType<typeof vi.fn>;
    startServer: ReturnType<typeof vi.fn>;
    exportZip: ReturnType<typeof vi.fn>;
    importZip: ReturnType<typeof vi.fn>;
    openBrowser: ReturnType<typeof vi.fn>;
    runtime: CliRuntime;
  };
}
