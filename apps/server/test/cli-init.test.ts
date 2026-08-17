// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The setup wizard's shape (`src/cli/commands/init.ts`).
 *
 * Split out from `cli-commands.test.ts` because the wizard is the one command
 * that bootstraps the meta store on its way through — `firstRun` seeds the
 * built-in roles, which `start` only reaches behind `--skip-migrate`. Stubbing
 * it is a whole-module mock, so it gets its own file rather than leaking into
 * every other subcommand's expectations.
 *
 * What is asserted here is the wizard's SHAPE: which door it offers first, what
 * each door then asks, and the wording rules the old wizard broke — no jargon
 * without a preamble, and no `…` in anything anyone has to type.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@adminium/meta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@adminium/meta')>()),
  // The fake CliRuntime's meta handle is a plain object; the real firstRun
  // would try to migrate it. Everything downstream of the bootstrap is what
  // these tests are about, so it is stubbed to the "already migrated" answer.
  firstRun: vi.fn(async () => Promise.resolve({ appliedMigrations: [] })),
}));

vi.mock('../src/connections/introspect.js', () => ({ runIntrospection: vi.fn() }));
vi.mock('../src/generate/run.js', () => ({ runGeneration: vi.fn() }));

const { runIntrospection } = await import('../src/connections/introspect.js');
const { runGeneration } = await import('../src/generate/run.js');
const { runCli } = await import('../src/cli/run.js');
const { fakeDeps, fakeIo, fakeRuntime, TEST_SECRET } = await import('./cli-helpers.js');

let ENV: Record<string, string>;

beforeEach(async () => {
  // A fresh data dir per test: the meta question is skipped when a bootstrap
  // file already answers it, so a shared directory would make these order-dependent.
  ENV = {
    ADMINIUM_SECRET: TEST_SECRET,
    ADMINIUM_DATA_DIR: await mkdtemp(join(tmpdir(), 'adminium-init-')),
  };
});

// ── the tables step ──────────────────────────────────────────────────────────

describe('adminium init — which tables the panel covers', () => {
  const SCHEMA = {
    tables: [
      { id: 'public.customers' },
      { id: 'public.orders' },
      { id: 'public.products' },
      // Adminium's own store, which lands in the SOURCE database whenever the
      // meta store is placed there — a supported §3.1 configuration.
      { id: 'public.adminium_users', semantics: { role: 'system' } },
      { id: 'public.adminium_pages', system: true },
      // Join tables are traversed, never paged.
      { id: 'public.orders_products', semantics: { role: 'join-table' } },
    ],
  };

  const runTables = async (picks?: (number | string)[][]) => {
    const runtime = fakeRuntime();
    (runtime.manager.testDsn as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      latencyMs: 3,
      serverVersion: '16.2',
      readOnly: false,
    });
    (runtime.manager.connections.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'conn_1',
      settings: {},
    });
    vi.mocked(runIntrospection).mockResolvedValue({
      snapshot: { schema: SCHEMA },
      noop: false,
      proposedMasks: 0,
    } as never);
    vi.mocked(runGeneration).mockResolvedValue({
      pages: [],
      navGroups: [],
      warnings: [],
    } as never);

    const io = fakeIo({
      selections: [
        'Here in the terminal',
        0,
        'Full admin panel',
        'Paste a connection string',
        'Let me pick a subset',
      ],
      answers: ['postgres://u:p@localhost:5432/shop', 'shop'],
      ...(picks === undefined ? {} : { picks }),
    });
    const code = await runCli([], { io, deps: fakeDeps({ env: ENV, runtime }) });
    return { io, code, runtime };
  };

  it('does not offer Adminium its own tables to build an admin panel over', async () => {
    // THE BUG: with the meta store in the source database, the picker listed
    // adminium_users, adminium_sessions and the rest. Generation then declined
    // to page them, so the count the wizard reported was never what you got.
    const { io } = await runTables();
    const menus = io.menus().filter((menu) => menu.title.startsWith('Which tables'));
    // Two menus share this title: the all-or-subset question, then the checkbox
    // list it opens. The last one is the list of actual tables.
    expect(menus[0]?.labels[0]).toBe('All 3 of them');
    expect(menus.at(-1)?.labels.join(' ')).not.toContain('adminium_');
    expect(menus.at(-1)?.labels).toEqual(['customers', 'orders', 'products']);
  });

  it('counts only the tables it will actually page', async () => {
    const { io } = await runTables();
    expect(io.stdout()).toContain('Found 3 tables.');
    expect(io.stdout()).not.toContain('Found 6 tables.');
  });

  it('narrows by ticking boxes, not by spelling table names', async () => {
    // Typing a comma-separated list meant reading a truncated hint, holding it
    // in your head, and a typo silently dropping the table rather than failing.
    const { io, runtime } = await runTables([['customers', 'orders']]);
    expect(io.questions()).not.toContain('Tables to include, comma-separated');
    expect(runtime.manager.connections.update).toHaveBeenCalledWith('conn_1', {
      settings: expect.objectContaining({
        includedTables: ['public.customers', 'public.orders'],
      }),
    });
  });
});

// ── the last screen ──────────────────────────────────────────────────────────

describe('adminium init — what happens once the pages exist', () => {
  const runToEnd = async (argv: string[] = []) => {
    const runtime = fakeRuntime();
    (runtime.manager.testDsn as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      latencyMs: 3,
      serverVersion: '16.2',
      readOnly: false,
    });
    (runtime.manager.connections.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'conn_1',
      settings: {},
    });
    vi.mocked(runIntrospection).mockResolvedValue({
      snapshot: { schema: { tables: [{ id: 'public.customers' }] } },
      noop: false,
      proposedMasks: 0,
    } as never);
    vi.mocked(runGeneration).mockResolvedValue({
      pages: [{}],
      navGroups: [{}],
      warnings: [],
    } as never);

    const io = fakeIo({
      selections: ['Here in the terminal', 0, 'Full admin panel', 'Paste a connection string'],
      answers: ['postgres://u:p@localhost:5432/shop', 'shop'],
    });
    const deps = fakeDeps({ env: ENV, runtime });
    const code = await runCli(argv, { io, deps });
    return { io, code, deps };
  };

  it('opens the app it just built', async () => {
    // The terminal path used to open nothing: seven questions, pages generated,
    // then a silent prompt. `--no-open` was honoured in browser mode only, so
    // the flag to turn this off was the only half of it that existed.
    const { deps, io } = await runToEnd();
    expect(deps.openBrowser).toHaveBeenCalledWith('http://localhost:4600');
    expect(io.stdout()).toContain('Opening it in your browser');
  });

  it('honours --no-open here too, and still says where to go', async () => {
    const { deps, io } = await runToEnd(['--no-open']);
    expect(deps.openBrowser).not.toHaveBeenCalled();
    expect(io.stdout()).toContain('Open that URL to continue.');
    expect(io.stdout()).toContain('http://localhost:4600');
  });

  it('closes on the URL, because that is where the eye is', async () => {
    // It always printed the URL — five lines up, above the tips and below any
    // generation warnings, with a note about log levels as the closing line.
    // On screen, but not where you look when a long command goes quiet.
    const { io } = await runToEnd();
    const lines = io.stdout().trimEnd().split('\n');
    expect(lines.at(-1)).toContain('http://localhost:4600');
    expect(lines.at(-1)).toContain('Ctrl-C to stop');
  });

  it('does not end on a note about logging', async () => {
    const { io } = await runToEnd();
    const lines = io.stdout().trimEnd().split('\n');
    expect(lines.at(-1)).not.toContain('--log-level');
    // Still said, just demoted to an aside.
    expect(io.stdout()).toContain('--log-level info');
  });

  it('ends the same way through the browser door', async () => {
    // Two front doors, one ending — they drifted apart precisely because each
    // wrote its own.
    const io = fakeIo({ selections: ['In your browser'] });
    await runCli([], { io, deps: fakeDeps({ env: ENV }) });
    const lines = io.stdout().trimEnd().split('\n');
    expect(lines.at(-1)).toContain('http://localhost:4600');
    expect(lines.at(-1)).toContain('Ctrl-C to stop');
  });
});

// ── the server's log level ───────────────────────────────────────────────────

describe('adminium init — the terminal is a UI, not a log sink', () => {
  // The server defaults to `info`, and Fastify logs a line per request. Browser
  // mode opens the dashboard immediately, so one SPA load used to bury the URL,
  // the pairing code and the next steps under a screen of `GET /assets/…`.
  it('runs the server quietly, so browser mode is not buried in request logs', async () => {
    const deps = fakeDeps({ env: ENV });
    await runCli([], { io: fakeIo({ selections: ['In your browser'] }), deps });
    expect(deps.openRuntime.mock.calls[0]?.[0]?.ADMINIUM_LOG_LEVEL).toBe('warn');
  });

  it('leaves an ADMINIUM_LOG_LEVEL already in the environment alone', async () => {
    // Someone who exported it made a decision; the wizard does not overrule it.
    const deps = fakeDeps({ env: { ...ENV, ADMINIUM_LOG_LEVEL: 'debug' } });
    await runCli([], { io: fakeIo({ selections: ['In your browser'] }), deps });
    expect(deps.openRuntime.mock.calls[0]?.[0]?.ADMINIUM_LOG_LEVEL).toBe('debug');
  });

  it('--log-level wins over both the default and the environment', async () => {
    const deps = fakeDeps({ env: { ...ENV, ADMINIUM_LOG_LEVEL: 'debug' } });
    await runCli(['--log-level', 'trace'], {
      io: fakeIo({ selections: ['In your browser'] }),
      deps,
    });
    expect(deps.openRuntime.mock.calls[0]?.[0]?.ADMINIUM_LOG_LEVEL).toBe('trace');
  });

  it('says it is quiet, and how to undo that', async () => {
    // A foreground process saying nothing is indistinguishable from a hung one.
    const io = fakeIo({ selections: ['In your browser'] });
    await runCli([], { io, deps: fakeDeps({ env: ENV }) });
    expect(io.stdout()).toContain('--log-level info');
  });

  it('does not claim to be quiet when it was told to be loud', async () => {
    const io = fakeIo({ selections: ['In your browser'] });
    await runCli(['--log-level', 'info'], { io, deps: fakeDeps({ env: ENV }) });
    expect(io.stdout()).toContain('Logging at info');
    expect(io.stdout()).not.toContain('Quiet by default');
  });
});

// ── the front-door choice ────────────────────────────────────────────────────

describe('adminium init — browser vs terminal', () => {
  it('asks which front door before anything else', async () => {
    const io = fakeIo({ selections: ['In your browser'] });
    await expect(runCli([], { io, deps: fakeDeps({ env: ENV }) })).resolves.toBe(0);
    expect(io.menus()[0]?.title).toBe('How would you like to set this up?');
  });

  it('browser mode boots the server and asks NOTHING else in the terminal', async () => {
    // The whole point of the graphical door: the Studio wizard owns intent,
    // source, tables and meta placement, so re-asking any of them here would be
    // a terminal questionnaire the user just declined.
    const deps = fakeDeps({ env: ENV });
    const io = fakeIo({ selections: ['In your browser'] });

    await expect(runCli([], { io, deps })).resolves.toBe(0);

    expect(deps.startServer).toHaveBeenCalledOnce();
    expect(io.menus()).toHaveLength(1);
    expect(io.stdout()).toContain('http://localhost:4600');
    expect(io.stdout()).not.toContain('Where should that state live?');
  });

  it('browser mode opens a browser at the URL it just bound', async () => {
    const deps = fakeDeps({ env: ENV });
    const io = fakeIo({ selections: ['In your browser'] });
    await runCli([], { io, deps });
    expect(deps.openBrowser).toHaveBeenCalledWith('http://localhost:4600');
    expect(io.stdout()).toContain('Opening it in your browser');
  });

  it('--no-open prints the URL without launching anything', async () => {
    const deps = fakeDeps({ env: ENV });
    const io = fakeIo({ selections: ['In your browser'] });
    await runCli(['--no-open'], { io, deps });
    expect(deps.openBrowser).not.toHaveBeenCalled();
    expect(io.stdout()).toContain('Open that URL to continue.');
  });

  it('falls back to printing the URL when no browser could be launched', async () => {
    // A headless box or a missing xdg-open is an ordinary outcome, not a
    // failure: setup still succeeded and the URL is still the next step.
    const deps = fakeDeps({ env: ENV, browserOpens: false });
    const io = fakeIo({ selections: ['In your browser'] });
    await expect(runCli([], { io, deps })).resolves.toBe(0);
    expect(io.stdout()).toContain('Open that URL to continue.');
  });

  it('--browser skips the question entirely', async () => {
    const io = fakeIo();
    await expect(runCli(['--browser'], { io, deps: fakeDeps({ env: ENV }) })).resolves.toBe(0);
    expect(io.menus()).toHaveLength(0);
  });

  it('does not offer the browser to a terminal that cannot host the menu', async () => {
    // A pipe, CI, or TERM=dumb: asking would render as a wall of text and the
    // graphical path is strictly better there anyway, so it is simply taken.
    const io = fakeIo({ interactive: true, tui: false });
    await runCli([], { io, deps: fakeDeps({ env: ENV }) });
    expect(io.menus().map((menu) => menu.title)).not.toContain(
      'How would you like to set this up?',
    );
  });
});

// ── the terminal path's prompts ──────────────────────────────────────────────

describe('adminium init — the terminal path', () => {
  /** Drive the wizard to the meta question, then stop by failing the DSN test. */
  const runTerminal = async (
    opts: {
      selections?: (number | string)[];
      answers?: string[];
      picks?: (number | string)[][];
    } = {},
  ) => {
    const runtime = fakeRuntime();
    (runtime.manager.testDsn as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { message: 'nope' },
    });
    const io = fakeIo({
      selections: ['Here in the terminal', ...(opts.selections ?? [])],
      answers: opts.answers ?? [],
      ...(opts.picks === undefined ? {} : { picks: opts.picks }),
    });
    const code = await runCli([], { io, deps: fakeDeps({ env: ENV, runtime }) });
    return { io, code, runtime };
  };

  it('explains what the meta store is before asking where to put it', async () => {
    const { io } = await runTerminal();
    // The old wizard opened on "Where should Adminium keep its own data?" with
    // no context, which read as a question about the user's own database.
    expect(io.stdout()).toContain('separate from the database you are about to');
    expect(io.menus().map((menu) => menu.title)).toContain('Where should that state live?');
  });

  it('offers a real example instead of an unkeyable ellipsis for the meta DSN', async () => {
    const { io } = await runTerminal({
      selections: ['In a PostgreSQL or MySQL database I already run'],
      answers: ['postgres://u:p@localhost:5432/meta'],
    });
    const questions = io.questions().join('\n');
    expect(questions).toContain("Connection string for Adminium's own storage");
    expect(questions).not.toContain('…');
  });

  it('never puts an ellipsis in a prompt anyone has to type into', async () => {
    // `…` is not on a keyboard. A hint shaped like `postgres://… or mysql://…`
    // reads as a literal template, which is what made this step a dead end.
    const { io } = await runTerminal({ selections: ['Paste a connection string'] });
    for (const question of io.questions()) expect(question).not.toContain('…');
  });

  it('asks the intent question with one scannable label per option', async () => {
    const { io } = await runTerminal();
    const intent = io.menus().find((menu) => menu.title === 'What is this admin panel for?');
    expect(intent?.labels).toEqual([
      'Full admin panel',
      'Read-only analytics',
      'Data entry',
      'Support console',
    ]);
  });

  it('offers the three source modes as a menu', async () => {
    const { io } = await runTerminal();
    const source = io.menus().find((menu) => menu.title === 'How do you want to connect to it?');
    expect(source?.labels).toHaveLength(3);
    expect(source?.labels[0]).toContain('Paste a connection string');
  });

  it('names the two databases apart, so neither prompt is "which one again?"', async () => {
    // The wizard asks for a connection string twice within a minute — once for
    // Adminium's own store, once for the database being administered. When both
    // prompts read "Connection string", the second one is unanswerable.
    const { io } = await runTerminal({
      selections: [
        'In a PostgreSQL or MySQL database I already run',
        'Full admin panel',
        'Paste a connection string',
      ],
      answers: ['postgres://u:p@localhost:5432/meta', 'postgres://u:p@localhost:5432/shop'],
    });
    const questions = io.questions();
    expect(questions).toContain("Connection string for Adminium's own storage");
    expect(questions).toContain('Connection string for the database to administer');
    expect(io.stdout()).toContain('the database you want an admin panel FOR');
  });

  it('offers the meta DSN back, so one database can serve both', async () => {
    const { runtime } = await runTerminal({
      selections: [
        'In a PostgreSQL or MySQL database I already run',
        'Full admin panel',
        'The same database I just gave Adminium for its own storage',
      ],
      answers: ['postgres://u:p@localhost:5432/one'],
    });
    // Reused verbatim — no second prompt, and the same string reaches the probe.
    expect(runtime.manager.testDsn).toHaveBeenCalledWith(
      'postgres',
      'postgres://u:p@localhost:5432/one',
    );
  });

  it('never echoes the password back when offering that DSN', async () => {
    const { io } = await runTerminal({
      selections: ['In a PostgreSQL or MySQL database I already run', 'Full admin panel'],
      answers: ['postgres://u:hunter2@localhost:5432/one'],
    });
    expect(io.stdout()).not.toContain('hunter2');
  });

  it('does not offer to reuse a DSN the user was never shown', async () => {
    // With the meta store on disk (or configured by env), there is no "same one"
    // to point at — the option would name a string that never appeared.
    const { io } = await runTerminal({ selections: [0, 'Full admin panel'] });
    const source = io.menus().find((menu) => menu.title === 'How do you want to connect to it?');
    expect(source?.labels).toHaveLength(3);
    expect(source?.labels.join(' ')).not.toContain('The same database');
  });

  it('reaches the connection test with the DSN it was given', async () => {
    const { runtime, code } = await runTerminal({
      // Full run order: meta placement → intent → source mode. Meta is picked by
      // index because its label embeds the (temp) data directory.
      selections: [0, 'Full admin panel', 'Paste a connection string'],
      answers: ['postgres://u:p@localhost:5432/shop'],
    });
    expect(runtime.manager.testDsn).toHaveBeenCalledWith('postgres', 'postgres://u:p@localhost:5432/shop');
    expect(code).toBe(1); // the stubbed probe fails, which is how we stop here
  });
});

