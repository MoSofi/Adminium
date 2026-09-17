// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Project code, piece by piece: loading the built files, the hook runner's
 * rules (order, limits, rejection, loops, imports) and the runtime that swaps
 * code in dev.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import {
  HookFailedError,
  HookRejectedError,
  type WriteContext,
  type WriteTarget,
} from '../src/crud/write-service.js';
import type { HookDefinition, ProjectDb } from '../src/project/code/define.js';
import { defineAction, defineHook } from '../src/project/code/define.js';
import {
  createHookFailureLog,
  createHookRunner,
  hookMatchesTable,
  withTimeLimit,
  type HookRunnerDeps,
} from '../src/project/code/hooks.js';
import {
  EMPTY_PROJECT_CODE,
  loadProjectCode,
  readServerCodeFiles,
  type ImportModule,
  type LoadedHook,
  type ProjectCode,
} from '../src/project/code/load.js';
import { createProjectCodeRuntime } from '../src/project/code/runtime.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-code-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function manifest(files: { kind: 'hooks' | 'actions'; name: string }[], digest = 'd1'): void {
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      server: {
        digest,
        files: files.map(({ kind, name }) => ({
          kind,
          name,
          source: `${kind}/${name}.ts`,
          output: `server/${kind}/${name}.mjs`,
          hash: createHash('sha256').update(`${kind}/${name}:${digest}`).digest('hex'),
        })),
      },
    }),
  );
}

/** An importer that hands back prepared modules by output file name. */
function modules(byName: Record<string, unknown>): ImportModule & { urls: string[] } {
  const urls: string[] = [];
  const importer = (async (url: string) => {
    urls.push(url);
    const name = /server\/(\w+\/[\w-]+)\.mjs/.exec(url)?.[1] ?? '';
    const found = byName[name];
    if (found instanceof Error) throw found;
    return found;
  }) as ImportModule & { urls: string[] };
  importer.urls = urls;
  return importer;
}

describe('the helpers', () => {
  it('return what they are given', () => {
    const hook = { table: 'orders', beforeCreate: () => undefined };
    const action = { table: 'orders', label: 'Refund', run: () => undefined };
    expect(defineHook(hook)).toBe(hook);
    expect(defineAction(action)).toBe(action);
  });
});

describe('loading the built files', () => {
  it('loads hooks in file-name order, and actions by id', async () => {
    manifest([
      { kind: 'hooks', name: 'zeta' },
      { kind: 'actions', name: 'refund-order' },
      { kind: 'hooks', name: 'alpha' },
    ]);
    const importer = modules({
      'hooks/zeta': { default: { table: 'orders', afterCreate: () => undefined } },
      'hooks/alpha': { default: { table: 'orders', database: 'billing', beforeCreate: () => undefined, onImport: true } },
      'actions/refund-order': { default: { table: 'orders', label: 'Refund', run: () => undefined } },
    });
    const code = await loadProjectCode(dir, { importer, now: () => 5 });
    expect(code.digest).toBe('d1');
    expect(code.loadedAt).toBe(5);
    expect(code.problems).toEqual([]);
    expect(code.hooks.map((hook) => [hook.source, hook.database, hook.events])).toEqual([
      ['hooks/alpha.ts', 'billing', ['beforeCreate']],
      ['hooks/zeta.ts', 'main', ['afterCreate']],
    ]);
    expect([...code.actions.keys()]).toEqual(['refund-order']);
    expect(code.actions.get('refund-order')?.database).toBe('main');
    expect(importer.urls[0]).toMatch(/^file:.*\/server\/actions\/refund-order\.mjs\?v=[0-9a-f]{16}$/);
  });

  it('skips what does not load or is not valid, saying why', async () => {
    manifest([
      { kind: 'hooks', name: 'throws' },
      { kind: 'hooks', name: 'no-default' },
      { kind: 'hooks', name: 'no-events' },
      { kind: 'hooks', name: 'typo' },
      { kind: 'hooks', name: 'bad-key' },
      { kind: 'actions', name: 'Refund Order' },
      { kind: 'actions', name: 'no-run' },
      { kind: 'actions', name: 'bad-icon' },
      { kind: 'hooks', name: 'fine' },
    ]);
    const importer = modules({
      'hooks/throws': new Error('Cannot find package "left-pad"'),
      'hooks/no-default': { named: 1 },
      'hooks/no-events': { default: { table: 'orders' } },
      'hooks/typo': { default: { table: 'orders', beforeCreated: () => undefined } },
      'hooks/bad-key': { default: { table: 'orders', database: 'Main', afterUpdate: () => undefined } },
      'actions/no-run': { default: { table: 'orders', label: 'Go' } },
      'actions/bad-icon': { default: { table: 'orders', label: 'Go', icon: 'Undo', run: () => undefined } },
      'hooks/fine': { default: { table: 'orders', afterDelete: () => undefined } },
    });
    const code = await loadProjectCode(dir, { importer });
    expect(code.hooks.map((hook) => hook.name)).toEqual(['fine']);
    expect(code.actions.size).toBe(0);
    const bySource = Object.fromEntries(code.problems.map((problem) => [problem.source, problem.message]));
    expect(bySource).toEqual({
      'hooks/throws.ts': 'Could not load it: Cannot find package "left-pad"',
      'hooks/no-default.ts': 'It has no default export. End it with `export default defineHook({ … })`.',
      'hooks/no-events.ts': expect.stringContaining('must define at least one of beforeCreate'),
      'hooks/typo.ts': 'The hook is not valid: unknown option "beforeCreated".',
      'hooks/bad-key.ts': expect.stringContaining('database must be a database key'),
      'actions/Refund Order.ts': expect.stringContaining('An action is named after its file'),
      'actions/no-run.ts': expect.stringContaining('run must be a function'),
      'actions/bad-icon.ts': expect.stringContaining('icon must be a Lucide icon name'),
    });
  });

  it('reads no files from a build without server code, and refuses a manifest it cannot read', async () => {
    expect(readServerCodeFiles(dir)).toEqual({ digest: '', files: [] });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ config: {} }));
    expect(await loadProjectCode(dir)).toMatchObject({ digest: '', hooks: [], problems: [] });
    writeFileSync(join(dir, 'manifest.json'), '{"server": ');
    expect(readServerCodeFiles(dir)).toBeNull();
    await expect(loadProjectCode(dir)).rejects.toThrow(/manifest.json could not be read/);
  });
});

// --- the hook runner -----------------------------------------------------------

const table = { id: 'public.orders', schema: 'public', name: 'orders', columns: new Map([['total', {}], ['qty', {}], ['status', {}]]) } as unknown as ResolvedTable;
const other = { id: 'sales.orders', schema: 'sales', name: 'orders', columns: new Map() } as unknown as ResolvedTable;
const view = {
  table: (name: string) => {
    if (name === 'orders' || name === 'public.orders') return table;
    if (name === 'sales.orders') return other;
    throw new Error(`Unknown table ${name}`);
  },
} as unknown as SnapshotView;
const target = { connectionId: 'conn_main', view, table, db: {} as never, dialect: 'postgres' } as WriteTarget;

const context = (overrides: Partial<WriteContext> = {}): WriteContext => ({
  origin: 'dashboard',
  hops: 0,
  actor: { kind: 'user', id: 'usr_1', label: 'Ada' },
  request: null,
  ...overrides,
});

function hook(name: string, definition: HookDefinition, database = 'main'): LoadedHook {
  return {
    name,
    source: `hooks/${name}.ts`,
    database,
    definition,
    events: (Object.keys(definition) as (keyof HookDefinition)[]).filter((key) => typeof definition[key] === 'function') as never,
  };
}

function runner(hooks: LoadedHook[], overrides: Partial<HookRunnerDeps> = {}) {
  const code: ProjectCode = { ...EMPTY_PROJECT_CODE, hooks };
  const failures = createHookFailureLog();
  const logs: [string, string, Record<string, unknown>][] = [];
  const db = vi.fn(() => ({ table: vi.fn(), raw: {}, rawFor: vi.fn() }) as unknown as ProjectDb);
  const keyOf = vi.fn(async (connectionId: string) => (connectionId === 'conn_main' ? 'main' : null));
  const hooksRunner = createHookRunner({
    code: () => code,
    keyOf,
    db,
    log: (level, message, data) => logs.push([level, message, data]),
    failures,
    now: () => 42,
    ...overrides,
  });
  return { hooks: hooksRunner, failures, logs, db, keyOf };
}

describe('the hook runner', () => {
  it('runs before hooks in file-name order, each seeing what the last one changed', async () => {
    const seen: string[] = [];
    const { hooks, db } = runner([
      hook('a-total', {
        table: 'orders',
        beforeCreate: ({ values, user, origin, database, table: name }) => {
          seen.push(`a:${String(values.qty)}:${user?.name ?? ''}:${origin}:${database}:${name}`);
          values.total = (values.qty as number) * 2;
        },
      }),
      hook('b-status', {
        table: 'public.orders',
        beforeCreate: ({ values }) => {
          seen.push(`b:${String(values.total)}`);
          values.status = 'new';
        },
      }),
    ]);
    const values: Record<string, unknown> = { qty: 3 };
    expect(await hooks.wants('before', 'create', target, context())).toBe(true);
    await hooks.before({ action: 'create', target, values, record: null, context: context() });
    expect(values).toEqual({ qty: 3, total: 6, status: 'new' });
    expect(seen).toEqual(['a:3:Ada:dashboard:main:public.orders', 'b:6']);
    // `db` is built only for a hook that reads it.
    expect(db).not.toHaveBeenCalled();
  });

  it("ignores hooks for another database, another table, or another event", async () => {
    const { hooks } = runner([
      hook('billing', { table: 'orders', beforeCreate: () => undefined }, 'billing'),
      hook('sales', { table: 'sales.orders', beforeCreate: () => undefined }),
      hook('updates', { table: 'orders', beforeUpdate: () => undefined }),
    ]);
    expect(await hooks.wants('before', 'create', target, context())).toBe(false);
    expect(await hooks.wants('before', 'update', target, context())).toBe(true);
    // A connection the project does not list has no hooks at all.
    expect(await hooks.wants('before', 'update', { ...target, connectionId: 'conn_other' }, context())).toBe(false);
    expect(hookMatchesTable('orders', target)).toBe(true);
    expect(hookMatchesTable('sales.orders', target)).toBe(false);
    expect(hookMatchesTable('missing', target)).toBe(false);
  });

  it("turns reject() into the hook's own message, even when the hook swallows it", async () => {
    const { hooks } = runner([
      hook('guard', {
        table: 'orders',
        beforeDelete: ({ record, reject }) => {
          try {
            if (record.status === 'shipped') reject(`Order ${String(record.id)} has shipped.${' x'.repeat(400)}`);
          } catch {
            // A hook that catches everything still cannot un-reject.
          }
        },
      }),
    ]);
    const error = await hooks
      .before({ action: 'delete', target, values: {}, record: { id: 7, status: 'shipped' }, context: context() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HookRejectedError);
    expect((error as HookRejectedError).message.startsWith('Order 7 has shipped.')).toBe(true);
    expect((error as HookRejectedError).message).toHaveLength(500);
    expect((error as HookRejectedError).hook).toBe('hooks/guard.ts');
  });

  it('fails the write, and records why, when a before hook throws or runs too long', async () => {
    const { hooks, failures, logs } = runner([
      hook('throws', { table: 'orders', beforeUpdate: () => { throw new Error('undefined is not a function'); } }),
    ]);
    const error = await hooks
      .before({ action: 'update', target, values: { qty: 1 }, record: { qty: 0 }, context: context() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HookFailedError);
    expect(error).toMatchObject({ statusCode: 500, code: 'HOOK_FAILED', hook: 'hooks/throws.ts' });
    expect((error as Error).message).not.toContain('undefined is not a function');
    expect(failures.list()).toEqual([
      {
        at: 42,
        source: 'hooks/throws.ts',
        event: 'beforeUpdate',
        database: 'main',
        table: 'public.orders',
        message: 'undefined is not a function',
      },
    ]);
    expect(logs[0]?.[0]).toBe('error');

    let aborted = false;
    const slow = runner([
      hook('slow', {
        table: 'orders',
        timeout: { before: 100 },
        beforeCreate: ({ signal }) =>
          new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve();
            });
          }),
      }),
    ]);
    await expect(
      slow.hooks.before({ action: 'create', target, values: {}, record: null, context: context() }),
    ).rejects.toBeInstanceOf(HookFailedError);
    expect(aborted).toBe(true);
    expect(slow.failures.list()[0]?.message).toBe('hooks/slow.ts ran past its 0.1 s limit.');
  });

  it('refuses a value for a column the table does not have, naming the hook', async () => {
    const { hooks } = runner([
      hook('typo', {
        table: 'orders',
        beforeCreate: ({ values }) => {
          values.totl = 1;
        },
      }),
    ]);
    await expect(
      hooks.before({ action: 'create', target, values: {}, record: null, context: context() }),
    ).rejects.toMatchObject({ hook: 'hooks/typo.ts', reason: 'It set "totl", which is not a column of public.orders.' });
  });

  it('logs after-hook failures and carries on with the next hook', async () => {
    const ran: string[] = [];
    const { hooks, failures } = runner([
      hook('a', { table: 'orders', afterUpdate: () => { throw new Error('mail server down'); } }),
      hook('b', {
        table: 'orders',
        afterUpdate: ({ record, before }) => {
          ran.push(`${String(before.status)}→${String(record.status)}`);
        },
      }),
    ]);
    await expect(
      hooks.after({ action: 'update', target, record: { status: 'paid' }, before: { status: 'new' }, context: context() }),
    ).resolves.toBeUndefined();
    expect(ran).toEqual(['new→paid']);
    expect(failures.list().map((failure) => failure.message)).toEqual(['mail server down']);
  });

  it('runs after hooks for an import only when a hook asks for it', async () => {
    const { hooks } = runner([
      hook('plain', { table: 'orders', afterCreate: () => undefined, beforeCreate: () => undefined }),
    ]);
    const importing = context({ origin: 'import' });
    expect(await hooks.wants('before', 'create', target, importing)).toBe(true);
    expect(await hooks.wants('after', 'create', target, importing)).toBe(false);
    const asked = runner([hook('asks', { table: 'orders', onImport: true, afterCreate: () => undefined })]);
    expect(await asked.hooks.wants('after', 'create', target, importing)).toBe(true);
  });

  it("gives a hook a db whose writes are one hop deeper, and stops hooks that write to each other", async () => {
    const scopes: unknown[] = [];
    const { hooks } = runner(
      [
        hook('writer', {
          table: 'orders',
          afterCreate: ({ db }) => {
            void db.table('orders');
          },
        }),
      ],
      {
        db: (scope) => {
          scopes.push(scope.context);
          return { table: vi.fn(), raw: {}, rawFor: vi.fn() } as unknown as ProjectDb;
        },
      },
    );
    await hooks.after({ action: 'create', target, record: {}, before: null, context: context({ hops: 2 }) });
    expect(scopes).toEqual([expect.objectContaining({ origin: 'hook', hops: 3, actor: context().actor })]);

    // A fourth nested hook write is refused, whatever hooks there are.
    const deep = context({ origin: 'hook', hops: 4 });
    expect(await hooks.wants('before', 'update', target, deep)).toBe(true);
    await expect(
      hooks.before({ action: 'update', target, values: {}, record: {}, context: deep }),
    ).rejects.toMatchObject({ reason: expect.stringContaining('stopped a possible loop') });
    // An automation that deep is the automations' own business, not a hook loop.
    await expect(
      hooks.before({ action: 'update', target, values: {}, record: {}, context: context({ origin: 'automation', hops: 4 }) }),
    ).resolves.toBeUndefined();
  });

  it('asks for the connection key only when some hook could run', async () => {
    const { hooks, keyOf } = runner([]);
    expect(await hooks.wants('before', 'create', target, context())).toBe(false);
    expect(keyOf).not.toHaveBeenCalled();
  });
});

describe('time limits', () => {
  it('pass a task through when it finishes in time', async () => {
    await expect(withTimeLimit(1000, async () => 'done', 'x')).resolves.toBe('done');
    await expect(withTimeLimit(1000, () => { throw new Error('sync'); }, 'x')).rejects.toThrow('sync');
  });
});

describe('the runtime', () => {
  it('loads the build, reports each problem once, and swaps in a new build in dev', async () => {
    const build = join(dir, '.adminium', 'build');
    mkdirSync(build, { recursive: true });
    const write = (digest: string, files: { kind: 'hooks' | 'actions'; name: string }[]): void => {
      writeFileSync(
        join(build, 'manifest.json'),
        JSON.stringify({
          server: {
            digest,
            files: files.map(({ kind, name }) => ({
              kind,
              name,
              source: `${kind}/${name}.ts`,
              output: `server/${kind}/${name}.mjs`,
              hash: digest.padEnd(64, '0'),
            })),
          },
        }),
      );
    };
    write('one', [{ kind: 'hooks', name: 'orders' }, { kind: 'hooks', name: 'broken' }]);
    const importer = modules({
      'hooks/orders': { default: { table: 'orders', beforeCreate: () => undefined } },
      'hooks/broken': new Error('SyntaxError'),
      'actions/refund': { default: { table: 'orders', label: 'Refund', run: () => undefined } },
    });
    const log = vi.fn();
    const warn = vi.fn();
    const runtime = createProjectCodeRuntime({ root: dir, mode: 'dev', log, warn, importer, pollMs: 20 });
    expect(runtime.current()).toBe(EMPTY_PROJECT_CODE);
    await runtime.load();
    expect(runtime.current().hooks.map((hook) => hook.name)).toEqual(['orders']);
    expect(log).toHaveBeenCalledWith('Project code: 1 hook and 0 actions loaded.');
    expect(warn).toHaveBeenCalledWith('hooks/broken.ts was not loaded. Could not load it: SyntaxError');
    await runtime.load();
    expect(warn).toHaveBeenCalledTimes(1);

    runtime.start();
    write('two', [{ kind: 'actions', name: 'refund' }]);
    await vi.waitFor(() => {
      expect(runtime.current().digest).toBe('two');
    });
    expect(runtime.current().hooks).toEqual([]);
    expect([...runtime.current().actions.keys()]).toEqual(['refund']);

    // A manifest caught half-written is ignored until it can be read.
    writeFileSync(join(build, 'manifest.json'), '{"server"');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(runtime.current().digest).toBe('two');
    runtime.close();
  });

  it('does not watch outside dev', async () => {
    const runtime = createProjectCodeRuntime({ root: dir, mode: 'server', log: vi.fn(), warn: vi.fn(), pollMs: 5 });
    runtime.start();
    await runtime.load();
    expect(runtime.current().digest).toBe('');
    runtime.close();
  });

  it('reads the pages and widgets, and hands a rebuilt set over in dev', async () => {
    const build = join(dir, '.adminium', 'build');
    mkdirSync(build, { recursive: true });
    const write = (digest: string, name: string): void => {
      const page = { name, source: `pages/${name}.tsx`, module: `pages/${name}-X.js`, imports: [], styles: [] };
      writeFileSync(
        join(build, 'manifest.json'),
        JSON.stringify({
          client: { digest, pages: [{ ...page, title: name, icon: 'file', nav: {} }], widgets: [], files: [], inputs: {} },
        }),
      );
    };
    const warn = vi.fn();
    const changed = vi.fn(async (): Promise<void> => {
      throw new Error('the database is gone');
    });
    const runtime = createProjectCodeRuntime({
      root: dir,
      mode: 'dev',
      log: vi.fn(),
      warn,
      pollMs: 10,
      onClientChanged: changed,
    });
    expect(runtime.client().digest).toBe('');
    expect(runtime.buildDir).toBe(build);
    write('one', 'revenue');
    expect(runtime.loadClient().pages.map((page) => page.name)).toEqual(['revenue']);

    runtime.start();
    write('two', 'margins');
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalledTimes(1);
    });
    expect(runtime.client().digest).toBe('two');
    expect(warn).toHaveBeenCalledWith('Could not apply the rebuilt pages and widgets: the database is gone');

    // A half-written manifest changes nothing, and neither does the same build again.
    writeFileSync(join(build, 'manifest.json'), '{"client"');
    expect(runtime.loadClient().digest).toBe('two');
    expect(warn).toHaveBeenLastCalledWith(`${join(build, 'manifest.json')} could not be read, so no pages or widgets were loaded.`);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(changed).toHaveBeenCalledTimes(1);
    runtime.close();
  });
});
