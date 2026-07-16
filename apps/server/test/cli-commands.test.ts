/**
 * Subcommand dispatch (M10-T01).
 *
 * The governing rule under test is the M10 risk mitigation: "CLI subcommands
 * share the same server services as the Studio routes; one code path, two front
 * doors." So these assert the CALL — which service, which options — against a
 * faked `CliRuntime`. The services' own behavior is covered by their own suites;
 * duplicating it here would just re-test them through a longer pipe.
 *
 * Nothing here boots a server or opens a database.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { chunkFileName, SAMPLING_MAX_VALUES } from '../src/cli/commands/generate-prompt.js';
import { composeDsn, parseTableSelection } from '../src/cli/commands/init.js';
import { formatBytes } from '../src/cli/commands/export-zip.js';
import { loadCliEnv, displayUrl } from '../src/cli/runtime.js';
import { runCli } from '../src/cli/run.js';
import { ImportZipError } from '../src/export/import-service.js';
import { PlaintextSecretError } from '../src/export/redaction.js';
import { fakeDeps, fakeIo, fakeRuntime, TEST_SECRET } from './cli-helpers.js';

const ENV = { ADMINIUM_SECRET: TEST_SECRET };

// ── env / flag precedence ────────────────────────────────────────────────────

describe('loadCliEnv — flags override the environment (01 §7.1)', () => {
  it('takes PORT from the environment when no flag is given', () => {
    expect(loadCliEnv({ ...ENV, PORT: '9000' }).PORT).toBe(9000);
  });

  it('lets --port beat PORT', () => {
    expect(loadCliEnv({ ...ENV, PORT: '9000' }, { port: 8080 }).PORT).toBe(8080);
  });

  it('lets --meta-url beat ADMINIUM_META_URL', () => {
    const env = loadCliEnv(
      { ...ENV, ADMINIUM_META_URL: 'sqlite:from-env.db' },
      { metaUrl: 'postgres://flag/db' },
    );
    expect(env.ADMINIUM_META_URL).toBe('postgres://flag/db');
  });

  it('fails fast and actionably when ADMINIUM_SECRET is absent', () => {
    expect(() => loadCliEnv({})).toThrow(/ADMINIUM_SECRET is required/);
    try {
      loadCliEnv({});
      expect.unreachable('should have thrown');
    } catch (error) {
      // The message must tell you how to fix it, not just what is wrong.
      expect((error as { hint: string }).hint).toContain('openssl rand -hex 32');
      expect((error as { code: number }).code).toBe(1);
    }
  });

  it('fails fast when ADMINIUM_SECRET is too short to derive a key from', () => {
    expect(() => loadCliEnv({ ADMINIUM_SECRET: 'short' })).toThrow(/ADMINIUM_SECRET is required/);
  });
});

describe('every command fails fast without ADMINIUM_SECRET', () => {
  it.each(['start', 'migrate', 'introspect', 'generate-prompt', 'export-zip'])(
    '%s exits 1 and names the variable',
    async (command) => {
      const io = fakeIo();
      const deps = fakeDeps({ env: {} });
      const argv = command === 'introspect' || command === 'generate-prompt'
        ? [command, '--connection', 'conn_1']
        : [command];
      await expect(runCli(argv, { io, deps })).resolves.toBe(1);
      expect(io.stderr()).toContain('ADMINIUM_SECRET');
      // Fail-fast means exactly that: no runtime was ever opened.
      expect(deps.openRuntime).not.toHaveBeenCalled();
    },
  );
});

describe('displayUrl', () => {
  it('rewrites a wildcard bind to something a browser can open', () => {
    expect(displayUrl('0.0.0.0', 4600)).toBe('http://localhost:4600');
    expect(displayUrl('::', 4600)).toBe('http://localhost:4600');
  });

  it('keeps an explicit host', () => {
    expect(displayUrl('127.0.0.1', 8080)).toBe('http://127.0.0.1:8080');
  });
});

// ── start ────────────────────────────────────────────────────────────────────

describe('adminium start', () => {
  it('boots through startServer and prints the URL', async () => {
    const io = fakeIo();
    const deps = fakeDeps({ env: ENV });
    await expect(runCli(['start', '--skip-migrate'], { io, deps })).resolves.toBe(0);
    expect(deps.startServer).toHaveBeenCalledOnce();
    expect(io.stdout()).toContain('http://localhost:4600');
  });

  it('passes --port through to the env the runtime is opened with', async () => {
    const deps = fakeDeps({ env: ENV });
    await runCli(['start', '--port', '8080', '--skip-migrate'], { io: fakeIo(), deps });
    expect(deps.openRuntime.mock.calls[0]?.[0]).toMatchObject({ PORT: 8080 });
  });

  it('warns on stderr when it falls back to the embedded SQLite meta store (§3.1 OD-1)', async () => {
    const io = fakeIo();
    const deps = fakeDeps({ env: ENV });
    await runCli(['start', '--skip-migrate'], { io, deps });
    expect(io.stderr()).toContain('Using embedded SQLite meta store');
    expect(io.stderr()).toContain('set ADMINIUM_META_URL for production');
  });

  it('does not warn when the meta store came from the environment', async () => {
    const io = fakeIo();
    const runtime = fakeRuntime();
    (runtime.metaStore as { source: string }).source = 'env';
    const deps = fakeDeps({ env: ENV, runtime });
    await runCli(['start', '--skip-migrate'], { io, deps });
    expect(io.stderr()).not.toContain('embedded SQLite');
  });

  it('rejects a non-numeric --port before opening anything', async () => {
    const io = fakeIo();
    const deps = fakeDeps({ env: ENV });
    await expect(runCli(['start', '--port', 'banana'], { io, deps })).resolves.toBe(1);
    expect(io.stderr()).toContain('--port must be a number');
    expect(deps.openRuntime).not.toHaveBeenCalled();
  });
});

// ── introspect ───────────────────────────────────────────────────────────────

describe('adminium introspect', () => {
  it('requires --connection', async () => {
    const io = fakeIo();
    await expect(runCli(['introspect'], { io, deps: fakeDeps({ env: ENV }) })).resolves.toBe(1);
    expect(io.stderr()).toContain('--connection <id> is required');
  });

  it('reports the snapshot and closes the runtime', async () => {
    const io = fakeIo();
    const deps = fakeDeps({ env: ENV });
    const introspect = vi.fn(async () =>
      Promise.resolve({
        snapshot: { id: 'snap_1', checksum: 'abcdef0123456789', schema: { tables: [{ id: 'public.orders' }] } },
        noop: false,
        proposedMasks: 2,
      }),
    );
    vi.doMock('../src/connections/introspect.js', () => ({ runIntrospection: introspect }));
    vi.resetModules();
    const { runCli: freshRunCli } = await import('../src/cli/run.js');

    await expect(freshRunCli(['introspect', '-c', 'conn_1'], { io, deps })).resolves.toBe(0);
    expect(introspect.mock.calls[0]?.[0]).toMatchObject({ connectionId: 'conn_1' });
    expect(io.stdout()).toContain('snap_1');
    expect(io.stdout()).toContain('1 tables');
    expect(io.stdout()).toContain('Proposed 2 PII mask override(s)');
    expect(deps.runtime.close).toHaveBeenCalled();
    vi.doUnmock('../src/connections/introspect.js');
    vi.resetModules();
  });
});

// ── generate-prompt (06 §10.4) ───────────────────────────────────────────────

describe('chunkFileName — "writes prompt file(s)"', () => {
  it('keeps the given name for a single-chunk run', () => {
    expect(chunkFileName('/tmp/prompt.md', 1, 1)).toBe('/tmp/prompt.md');
  });

  it('numbers each file of a chunked run before the extension', () => {
    expect(chunkFileName('/tmp/prompt.md', 2, 3)).toBe('/tmp/prompt.2.md');
  });

  it('handles a name with no extension', () => {
    expect(chunkFileName('/tmp/prompt', 2, 3)).toBe('/tmp/prompt.2');
  });
});

describe('adminium generate-prompt', () => {
  const artifact = (chunks: number) => ({
    tokenEstimate: 12_345,
    sections: [],
    chunks: Array.from({ length: chunks }, (_, i) => ({
      index: i + 1,
      total: chunks,
      byo: `PROMPT BODY ${String(i + 1)}`,
    })),
  });

  it('requires --connection', async () => {
    const io = fakeIo();
    await expect(runCli(['generate-prompt'], { io, deps: fakeDeps({ env: ENV }) })).resolves.toBe(1);
    expect(io.stderr()).toContain('--connection <id> is required');
  });

  it('calls the SAME prompt service the POST /llm/runs route calls, as a BYO run', async () => {
    const runtime = fakeRuntime();
    runtime.promptService.createRunForConnection.mockResolvedValue({
      run: { id: 'run_1', promptVersion: 'PROMPT_V1' },
      artifact: artifact(1),
      snapshotId: 'snap_1',
    });
    const deps = fakeDeps({ env: ENV, runtime });
    const io = fakeIo();

    await expect(runCli(['generate-prompt', '-c', 'conn_1'], { io, deps })).resolves.toBe(0);
    expect(runtime.promptService.createRunForConnection).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn_1', path: 'byo', sampling: null }),
    );
  });

  it('prints the runId and token estimate §10.4 requires', async () => {
    const runtime = fakeRuntime();
    runtime.promptService.createRunForConnection.mockResolvedValue({
      run: { id: 'run_abc', promptVersion: 'PROMPT_V1' },
      artifact: artifact(1),
      snapshotId: 'snap_1',
    });
    const io = fakeIo();
    await runCli(['generate-prompt', '-c', 'conn_1'], { io, deps: fakeDeps({ env: ENV, runtime }) });
    expect(io.stdout()).toContain('runId:          run_abc');
    expect(io.stdout()).toContain('token estimate: ~12345');
  });

  it('forwards --sections and --locales as parsed lists', async () => {
    const runtime = fakeRuntime();
    runtime.promptService.createRunForConnection.mockResolvedValue({
      run: { id: 'run_1', promptVersion: 'PROMPT_V1' },
      artifact: artifact(1),
      snapshotId: 'snap_1',
    });
    await runCli(
      ['generate-prompt', '-c', 'conn_1', '--sections', 'labels,enums', '--locales', 'en_US,de_DE'],
      { io: fakeIo(), deps: fakeDeps({ env: ENV, runtime }) },
    );
    expect(runtime.promptService.createRunForConnection).toHaveBeenCalledWith(
      expect.objectContaining({ sections: ['labels', 'enums'], locales: ['en_US', 'de_DE'] }),
    );
  });

  it('--sampling opts in at the same cap as the Studio wizard, and is off by default', async () => {
    const runtime = fakeRuntime();
    runtime.promptService.createRunForConnection.mockResolvedValue({
      run: { id: 'run_1', promptVersion: 'PROMPT_V1' },
      artifact: artifact(1),
      snapshotId: 'snap_1',
    });
    const deps = fakeDeps({ env: ENV, runtime });
    await runCli(['generate-prompt', '-c', 'conn_1', '--sampling'], { io: fakeIo(), deps });
    expect(runtime.promptService.createRunForConnection).toHaveBeenCalledWith(
      expect.objectContaining({ sampling: { maxValuesPerColumn: SAMPLING_MAX_VALUES } }),
    );
  });

  it('prints the prompt to stdout when there is no --out', async () => {
    const runtime = fakeRuntime();
    runtime.promptService.createRunForConnection.mockResolvedValue({
      run: { id: 'run_1', promptVersion: 'PROMPT_V1' },
      artifact: artifact(1),
      snapshotId: 'snap_1',
    });
    const io = fakeIo();
    await runCli(['generate-prompt', '-c', 'conn_1'], { io, deps: fakeDeps({ env: ENV, runtime }) });
    expect(io.stdout()).toContain('PROMPT BODY 1');
  });

  it('--out writes one file per chunk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adminium-cli-'));
    const runtime = fakeRuntime();
    runtime.promptService.createRunForConnection.mockResolvedValue({
      run: { id: 'run_1', promptVersion: 'PROMPT_V1' },
      artifact: artifact(2),
      snapshotId: 'snap_1',
    });
    const io = fakeIo();
    await runCli(['generate-prompt', '-c', 'conn_1', '--out', join(dir, 'prompt.md')], {
      io,
      deps: fakeDeps({ env: ENV, runtime, cwd: dir }),
    });
    await expect(readFile(join(dir, 'prompt.1.md'), 'utf8')).resolves.toBe('PROMPT BODY 1');
    await expect(readFile(join(dir, 'prompt.2.md'), 'utf8')).resolves.toBe('PROMPT BODY 2');
  });

  it('says how to build the widget registry when the allow-lists are missing', async () => {
    const runtime = fakeRuntime({
      promptService: null,
      allowed: null,
      promptServiceError: new Error('The widget registry build is missing'),
    });
    const io = fakeIo();
    await expect(
      runCli(['generate-prompt', '-c', 'conn_1'], { io, deps: fakeDeps({ env: ENV, runtime }) }),
    ).resolves.toBe(1);
    expect(io.stderr()).toContain('widget registry build is missing');
  });
});

// ── export-zip (delegated to M10-T03) ────────────────────────────────────────

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('%i → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('adminium export-zip', () => {
  it('calls the exportZip service contract with the resolved options', async () => {
    const exportZip = vi.fn(async () =>
      Promise.resolve({
        path: '/tmp/out.zip',
        bytes: 2048,
        entries: ['manifest.json'],
        manifestVersion: 1,
        counts: { pages: 3 },
      }),
    );
    const deps = fakeDeps({ env: ENV, exportZip, cwd: '/tmp' });
    const io = fakeIo();
    await expect(runCli(['export-zip', '-c', 'conn_1', '-o', 'out.zip'], { io, deps })).resolves.toBe(0);
    expect(exportZip).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn_1',
        outPath: '/tmp/out.zip',
        includeSecrets: false,
      }),
    );
    expect(io.stdout()).toContain('2.0 KB');
    expect(io.stdout()).toContain('pages: 3');
  });

  it('defaults to the whole instance with secrets excluded', async () => {
    const exportZip = vi.fn(async () =>
      Promise.resolve({ path: '/tmp/a.zip', bytes: 1, entries: [], manifestVersion: 1, counts: {} }),
    );
    await runCli(['export-zip'], { io: fakeIo(), deps: fakeDeps({ env: ENV, exportZip }) });
    const call = exportZip.mock.calls[0]?.[0] as { connectionId?: string; includeSecrets: boolean };
    expect(call.connectionId).toBeUndefined();
    expect(call.includeSecrets).toBe(false);
  });

  it('warns when --include-secrets is used', async () => {
    const exportZip = vi.fn(async () =>
      Promise.resolve({ path: '/tmp/a.zip', bytes: 1, entries: [], manifestVersion: 1, counts: {} }),
    );
    const io = fakeIo();
    await runCli(['export-zip', '--include-secrets'], { io, deps: fakeDeps({ env: ENV, exportZip }) });
    expect(io.stderr()).toContain('treat it as sensitive');
  });

  it('surfaces a refused plaintext secret as a clean exit 1, not a crash', async () => {
    // The export fails closed when a value that must be ciphertext is not. The
    // CLI must report that as a normal failure — it is a real, reachable state
    // (a broken write path), not an internal error.
    const exportZip = vi.fn(async () =>
      Promise.reject(new PlaintextSecretError('settings.llm.apiKey')),
    );
    const io = fakeIo();
    await expect(runCli(['export-zip'], { io, deps: fakeDeps({ env: ENV, exportZip }) })).resolves.toBe(1);
    expect(io.stderr()).toContain('refusing to export');
  });
});

// ── import-zip ───────────────────────────────────────────────────────────────

describe('adminium import-zip', () => {
  it('requires --in', async () => {
    const io = fakeIo();
    await expect(runCli(['import-zip'], { io, deps: fakeDeps({ env: ENV }) })).resolves.toBe(1);
    expect(io.stderr()).toContain('--in <file> is required');
  });

  it('resolves --in against the cwd and reports the bundle version', async () => {
    const importZip = vi.fn(async () =>
      Promise.resolve({
        manifest: {
          formatVersion: 1,
          appVersion: '0.5.0',
          configVersion: 1,
          metaVersion: '0009_views_kind',
          exportedAt: 0,
          connectionId: null,
          secrets: { policy: 'omitted' as const, encrypted: [], omitted: [] },
          counts: {},
        },
        counts: { pages: 3 },
        migratedDocuments: 0,
        warnings: [],
        dryRun: false,
      }),
    );
    const io = fakeIo();
    await expect(
      runCli(['import-zip', '--in', 'bundle.zip'], { io, deps: fakeDeps({ env: ENV, importZip }) }),
    ).resolves.toBe(0);
    expect(importZip.mock.calls[0]?.[0]).toMatchObject({ inPath: '/tmp/bundle.zip', dryRun: false });
    expect(io.stdout()).toContain('Adminium 0.5.0');
    expect(io.stdout()).toContain('pages: 3');
    expect(io.stdout()).toContain('Import complete.');
  });

  it('passes --dry-run through and says nothing was written', async () => {
    const importZip = vi.fn(async () =>
      Promise.resolve({
        manifest: {
          formatVersion: 1,
          appVersion: '0.5.0',
          configVersion: 1,
          metaVersion: '0009_views_kind',
          exportedAt: 0,
          connectionId: null,
          secrets: { policy: 'omitted' as const, encrypted: [], omitted: [] },
          counts: {},
        },
        counts: {},
        migratedDocuments: 0,
        warnings: [],
        dryRun: true,
      }),
    );
    const io = fakeIo();
    await runCli(['import-zip', '--in', 'b.zip', '--dry-run'], {
      io,
      deps: fakeDeps({ env: ENV, importZip }),
    });
    expect(importZip.mock.calls[0]?.[0]).toMatchObject({ dryRun: true });
    expect(io.stdout()).toContain('Dry run — nothing was written.');
  });

  it('reports a refused bundle as a clean exit 1 with its hint', async () => {
    const importZip = vi.fn(async () =>
      Promise.reject(new ImportZipError('This bundle carries config version 9.', 'Upgrade this instance.')),
    );
    const io = fakeIo();
    await expect(
      runCli(['import-zip', '--in', 'b.zip'], { io, deps: fakeDeps({ env: ENV, importZip }) }),
    ).resolves.toBe(1);
    expect(io.stderr()).toContain('config version 9');
    expect(io.stderr()).toContain('Upgrade this instance.');
  });
});

// ── init wizard pure helpers ─────────────────────────────────────────────────

describe('composeDsn — the wizard fields mode', () => {
  it('composes a DSN from fields', () => {
    expect(
      composeDsn({
        engine: 'postgres',
        host: 'db.acme.io',
        port: 5432,
        user: 'ava',
        password: 'hunter2',
        database: 'prod',
      }),
    ).toBe('postgres://ava:hunter2@db.acme.io:5432/prod');
  });

  it('percent-encodes credentials so a password with @ or / cannot break the DSN', () => {
    expect(
      composeDsn({
        engine: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'a@b',
        password: 'p/w:d',
        database: 'app',
      }),
    ).toBe('mysql://a%40b:p%2Fw%3Ad@localhost:3306/app');
  });

  it('omits the colon when there is no password', () => {
    expect(
      composeDsn({ engine: 'postgres', host: 'h', port: 5432, user: 'u', password: '', database: 'd' }),
    ).toBe('postgres://u@h:5432/d');
  });
});

describe('parseTableSelection — the wizard tables step', () => {
  const available = ['public.orders', 'public.customers', 'public.line_items'];

  it('includes everything on Enter or "all"', () => {
    expect(parseTableSelection('', available)).toEqual(available);
    expect(parseTableSelection('all', available)).toEqual(available);
    expect(parseTableSelection('  ALL ', available)).toEqual(available);
  });

  it('accepts unqualified local names, which is what people type', () => {
    expect(parseTableSelection('orders, customers', available)).toEqual([
      'public.orders',
      'public.customers',
    ]);
  });

  it('accepts fully-qualified ids', () => {
    expect(parseTableSelection('public.orders', available)).toEqual(['public.orders']);
  });

  it('ignores names that do not exist rather than inventing them', () => {
    expect(parseTableSelection('orders, nope', available)).toEqual(['public.orders']);
  });

  it('de-duplicates', () => {
    expect(parseTableSelection('orders, public.orders', available)).toEqual(['public.orders']);
  });
});

describe('adminium init', () => {
  it('refuses to run without a TTY and points at `start`', async () => {
    const io = fakeIo({ interactive: false });
    await expect(runCli([], { io, deps: fakeDeps({ env: ENV }) })).resolves.toBe(1);
    expect(io.stderr()).toContain('needs an interactive terminal');
    expect(io.stderr()).toContain('adminium start');
  });

  it('fails fast on a missing secret before asking a single question', async () => {
    const io = fakeIo({ interactive: true });
    await expect(runCli([], { io, deps: fakeDeps({ env: {} }) })).resolves.toBe(1);
    expect(io.stderr()).toContain('ADMINIUM_SECRET');
    expect(io.questions()).toEqual([]);
  });

  it('bare `adminium` dispatches to the wizard', async () => {
    const io = fakeIo({ interactive: false });
    await runCli([], { io, deps: fakeDeps({ env: ENV }) });
    // Reached init (its TTY guard), rather than the unknown-command path.
    expect(io.stderr()).toContain('setup wizard');
  });
});

// ── writing a file the CLI reads back ────────────────────────────────────────

describe('apply-llm-response file handling', () => {
  it('reports an unreadable --file rather than throwing ENOENT', async () => {
    const io = fakeIo();
    await expect(
      runCli(['apply-llm-response', '--run', 'run_1', '--file', '/nope/missing.json'], {
        io,
        deps: fakeDeps({ env: ENV }),
      }),
    ).resolves.toBe(1);
    expect(io.stderr()).toContain('Could not read');
  });

  it('requires both --run and --file', async () => {
    const io = fakeIo();
    await expect(
      runCli(['apply-llm-response', '--run', 'run_1'], { io, deps: fakeDeps({ env: ENV }) }),
    ).resolves.toBe(1);
    expect(io.stderr()).toContain('--run <runId> and --file <path> are both required');
  });

  it('rejects a --yes-above outside 0..1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adminium-cli-'));
    const file = join(dir, 'r.json');
    await writeFile(file, '{}', 'utf8');
    const io = fakeIo();
    await expect(
      runCli(['apply-llm-response', '--run', 'run_1', '--file', file, '--yes-above', '1.5'], {
        io,
        deps: fakeDeps({ env: ENV, cwd: dir }),
      }),
    ).resolves.toBe(1);
    expect(io.stderr()).toContain('--yes-above must be between 0 and 1');
  });
});
