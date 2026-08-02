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
  const runTerminal = async (opts: { selections?: (number | string)[]; answers?: string[] } = {}) => {
    const runtime = fakeRuntime();
    (runtime.manager.testDsn as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { message: 'nope' },
    });
    const io = fakeIo({
      selections: ['Here in the terminal', ...(opts.selections ?? [])],
      answers: opts.answers ?? [],
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
    expect(questions).toContain('Connection string for that database');
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
    const source = io.menus().find((menu) => menu.title === 'How do you want to connect?');
    expect(source?.labels).toHaveLength(3);
    expect(source?.labels[0]).toContain('Paste a connection string');
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

