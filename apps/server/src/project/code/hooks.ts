// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Running a project's hooks around a record write.
 *
 * The write service (`crud/write-service.ts`) asks this runner before and
 * after every write to a source database. The runner finds the hooks for that
 * database and table and runs them in file-name order:
 *
 * - A before hook may change `values`, or call `reject(message)`, which fails
 *   the write with 422 and the hook's message. A before hook that throws or
 *   runs past its limit (5 s by default) fails the write too, with a message
 *   that names the file and not the error.
 * - An after hook runs once the write is saved. Its failure is logged and
 *   kept for Studio → Settings → Project; it never undoes the write.
 * - After hooks skip CSV imports unless the hook sets `onImport`.
 *
 * A write a hook makes through `db` carries `origin: 'hook'` and one more hop,
 * the counter automations use (`crud/after-record-write.ts`); past the same
 * ceiling the write is refused, which stops a hook that triggers itself.
 */

import { MAX_AUTOMATION_HOPS } from '../../automations/matcher.js';
import type { Row } from '../../crud/mask.js';
import {
  HookFailedError,
  HookRejectedError,
  unknownColumn,
  type AfterWriteEvent,
  type BeforeWriteEvent,
  type HookTiming,
  type RecordHooks,
  type WriteAction,
  type WriteContext,
  type WriteTarget,
} from '../../crud/write-service.js';
import type { HookEvent, ProjectDb, ProjectLogger, ProjectUser } from './define.js';
import type { LoadedHook, ProjectCode } from './load.js';

export const BEFORE_HOOK_TIMEOUT_MS = 5_000;
export const AFTER_HOOK_TIMEOUT_MS = 30_000;
/** A rejection message longer than this is cut. */
const MAX_MESSAGE = 500;
/** How many hook failures Studio keeps. */
const ERROR_LOG_SIZE = 50;

const EVENTS: Record<HookTiming, Record<WriteAction, HookEvent>> = {
  before: { create: 'beforeCreate', update: 'beforeUpdate', delete: 'beforeDelete' },
  after: { create: 'afterCreate', update: 'afterUpdate', delete: 'afterDelete' },
};

export interface HookFailure {
  at: number;
  source: string;
  event: HookEvent;
  database: string;
  table: string;
  message: string;
}

/** The last hook failures, newest first. */
export interface HookFailureLog {
  add(failure: HookFailure): void;
  list(): HookFailure[];
}

export function createHookFailureLog(size = ERROR_LOG_SIZE): HookFailureLog {
  const entries: HookFailure[] = [];
  return {
    add(failure) {
      entries.unshift(failure);
      entries.length = Math.min(entries.length, size);
    },
    list: () => [...entries],
  };
}

export type ProjectLogFn = (level: 'info' | 'warn' | 'error', message: string, data: Record<string, unknown>) => void;

/** What a hook's `db` is built from. */
export interface HookDbScope {
  database: string;
  target: WriteTarget;
  /** The context the hook's own writes carry. */
  context: WriteContext;
}

export interface HookRunnerDeps {
  code: () => ProjectCode;
  /** The project key of a connection; null for one the config does not list. */
  keyOf: (connectionId: string) => Promise<string | null>;
  db: (scope: HookDbScope) => ProjectDb;
  log: ProjectLogFn;
  failures: HookFailureLog;
  now?: () => number;
}

/** Thrown by `reject()`, so the hook stops where it called it. */
class Rejection extends Error {
  override readonly name = 'Rejection';
}

class HookTimeout extends Error {
  override readonly name = 'HookTimeout';
}

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Run `task` with a time limit. The task keeps running if it ignores `signal`, but nobody waits for it. */
export async function withTimeLimit<T>(ms: number, task: (signal: AbortSignal) => Promise<T> | T, what: string): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HookTimeout(`${what} ran past its ${String(ms / 1000)} s limit.`));
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => task(controller.signal)), expired]);
  } finally {
    clearTimeout(timer);
  }
}

export function projectUser(context: WriteContext): ProjectUser | null {
  const actor = context.actor;
  return actor === null ? null : { kind: actor.kind, id: actor.id, name: actor.label };
}

export function projectLogger(log: ProjectLogFn, source: string): ProjectLogger {
  const at =
    (level: 'info' | 'warn' | 'error') =>
    (message: string, data?: Record<string, unknown>): void => {
      log(level, String(message), { ...data, file: source });
    };
  return { info: at('info'), warn: at('warn'), error: at('error') };
}

/** Does the hook's `table` name this write's table? `orders` and `public.orders` both do. */
export function hookMatchesTable(hookTable: string, target: WriteTarget): boolean {
  if (hookTable === target.table.id) return true;
  try {
    return target.view.table(hookTable).id === target.table.id;
  } catch {
    return false;
  }
}

export function createHookRunner(deps: HookRunnerDeps): RecordHooks {
  const now = deps.now ?? Date.now;

  async function hooksFor(
    timing: HookTiming,
    action: WriteAction,
    target: WriteTarget,
    context: WriteContext,
  ): Promise<{ key: string; hooks: LoadedHook[] }> {
    const code = deps.code();
    const event = EVENTS[timing][action];
    const candidates = code.hooks.filter(
      (hook) =>
        hook.definition[event] !== undefined &&
        !(timing === 'after' && context.origin === 'import' && hook.definition.onImport !== true),
    );
    if (candidates.length === 0) return { key: '', hooks: [] };
    const key = await deps.keyOf(target.connectionId);
    if (key === null) return { key: '', hooks: [] };
    return {
      key,
      hooks: candidates.filter((hook) => hook.database === key && hookMatchesTable(hook.definition.table, target)),
    };
  }

  function childContext(context: WriteContext): WriteContext {
    return { ...context, origin: 'hook', hops: context.hops + 1 };
  }

  function recordFailure(hook: LoadedHook, event: HookEvent, key: string, target: WriteTarget, message: string): void {
    deps.failures.add({ at: now(), source: hook.source, event, database: key, table: target.table.id, message });
    deps.log('error', `The project hook ${hook.source} failed in ${event} on ${target.table.id}: ${message}`, {
      file: hook.source,
      event,
      table: target.table.id,
    });
  }

  /** A hook's arguments. `db` is built the first time the hook reads it. */
  function argsFor(
    hook: LoadedHook,
    key: string,
    target: WriteTarget,
    context: WriteContext,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    let db: ProjectDb | null = null;
    const args: Record<string, unknown> = {
      database: key,
      table: target.table.id,
      user: projectUser(context),
      origin: context.origin,
      log: projectLogger(deps.log, hook.source),
      ...extra,
    };
    Object.defineProperty(args, 'db', {
      enumerable: true,
      get: () => (db ??= deps.db({ database: key, target, context: childContext(context) })),
    });
    return args;
  }

  /** A write a hook made, nested too deep to be anything but a loop. */
  const tooDeep = (context: WriteContext): boolean =>
    context.origin === 'hook' && context.hops > MAX_AUTOMATION_HOPS;

  return {
    async wants(timing, action, target, context) {
      if (timing === 'before' && tooDeep(context)) return true;
      return (await hooksFor(timing, action, target, context)).hooks.length > 0;
    },

    async before(event: BeforeWriteEvent) {
      const { action, target, context } = event;
      if (tooDeep(context)) {
        throw new HookFailedError(
          'a project hook',
          `Hooks wrote to each other more than ${String(MAX_AUTOMATION_HOPS)} times in a row, so Adminium stopped a possible loop.`,
        );
      }
      const name = EVENTS.before[action];
      const { key, hooks } = await hooksFor('before', action, target, context);
      for (const hook of hooks) {
        const handler = hook.definition[name] as ((args: unknown) => unknown) | undefined;
        if (handler === undefined) continue;
        let rejected: string | null = null;
        const reject = (message: string): never => {
          rejected = String(message).slice(0, MAX_MESSAGE);
          throw new Rejection(rejected);
        };
        const limit = hook.definition.timeout?.before ?? BEFORE_HOOK_TIMEOUT_MS;
        try {
          await withTimeLimit(
            limit,
            (signal) =>
              handler.call(
                hook.definition,
                argsFor(hook, key, target, context, {
                  values: event.values,
                  ...(action === 'create' ? {} : { record: event.record as Row }),
                  reject,
                  signal,
                }),
              ),
            hook.source,
          );
        } catch (error) {
          if (!(error instanceof Rejection) && rejected === null) {
            recordFailure(hook, name, key, target, text(error));
            throw new HookFailedError(hook.source, text(error));
          }
        }
        if (rejected !== null) throw new HookRejectedError(rejected, hook.source);
        const unknown = unknownColumn(target.table, event.values);
        if (unknown !== null) {
          const message = `It set ${JSON.stringify(unknown)}, which is not a column of ${target.table.id}.`;
          recordFailure(hook, name, key, target, message);
          throw new HookFailedError(hook.source, message);
        }
      }
    },

    async after(event: AfterWriteEvent) {
      const { action, target, context } = event;
      const name = EVENTS.after[action];
      let found: { key: string; hooks: LoadedHook[] };
      try {
        found = await hooksFor('after', action, target, context);
      } catch (error) {
        deps.log('error', `Could not find the after hooks for ${target.table.id}: ${text(error)}`, {});
        return;
      }
      for (const hook of found.hooks) {
        const handler = hook.definition[name] as ((args: unknown) => unknown) | undefined;
        if (handler === undefined) continue;
        const limit = hook.definition.timeout?.after ?? AFTER_HOOK_TIMEOUT_MS;
        try {
          await withTimeLimit(
            limit,
            (signal) =>
              handler.call(
                hook.definition,
                argsFor(hook, found.key, target, context, {
                  record: event.record,
                  ...(action === 'update' ? { before: event.before ?? {} } : {}),
                  signal,
                }),
              ),
            hook.source,
          );
        } catch (error) {
          recordFailure(hook, name, found.key, target, text(error));
        }
      }
    },
  };
}
