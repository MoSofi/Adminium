// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loading a project's hooks and actions from its build.
 *
 * `adminium build` bundles `hooks/*.ts` and `actions/*.ts` into
 * `.adminium/build/server/` and lists them in the build manifest. This module
 * imports each one and checks what it exports. A file that fails to import or
 * exports the wrong thing is recorded and skipped, and the rest load: one
 * broken file costs its own hook or action, never the server.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import type { BuiltServerFile } from '../build.js';
import { PROJECT_KEY_PATTERN } from '../config.js';
import {
  HOOK_EVENTS,
  type ActionDefinition,
  type HookDefinition,
  type HookEvent,
} from './define.js';

/** The database a hook or action uses when it names none. */
export const DEFAULT_DATABASE = 'main';

/** An action's id is its file name, and it travels in a URL. */
export const ACTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** One bundled file, as the build manifest lists it. */
export type ServerCodeFile = BuiltServerFile;

export interface LoadedHook {
  name: string;
  source: string;
  database: string;
  definition: HookDefinition;
  events: HookEvent[];
}

export interface LoadedAction {
  id: string;
  source: string;
  database: string;
  definition: ActionDefinition;
}

export interface CodeProblem {
  source: string;
  message: string;
  at: number;
}

export interface ProjectCode {
  /** Changes whenever the bundled files change; '' when there are none. */
  digest: string;
  /** In file-name order, which is the order they run in. */
  hooks: LoadedHook[];
  actions: ReadonlyMap<string, LoadedAction>;
  problems: CodeProblem[];
  loadedAt: number;
}

export const EMPTY_PROJECT_CODE: ProjectCode = {
  digest: '',
  hooks: [],
  actions: new Map(),
  problems: [],
  loadedAt: 0,
};

const fn = z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function', {
  message: 'must be a function',
});

const database = z
  .string()
  .regex(PROJECT_KEY_PATTERN, 'must be a database key from adminium.config.ts, such as "main"')
  .optional();

const limit = (max: number) => z.number().int().min(100).max(max).optional();

const hookSchema = z
  .object({
    table: z.string().min(1).max(128),
    database,
    onImport: z.boolean().optional(),
    timeout: z.object({ before: limit(60_000), after: limit(300_000) }).strict().optional(),
    ...Object.fromEntries(HOOK_EVENTS.map((event) => [event, fn.optional()])),
  })
  .strict()
  .refine((value) => HOOK_EVENTS.some((event) => (value as Record<string, unknown>)[event] !== undefined), {
    message: `must define at least one of ${HOOK_EVENTS.join(', ')}`,
  });

const actionSchema = z
  .object({
    table: z.string().min(1).max(128),
    database,
    label: z.string().trim().min(1).max(60),
    icon: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a Lucide icon name, such as "undo-2"')
      .max(60)
      .optional(),
    confirm: z.string().trim().min(1).max(300).optional(),
    permission: z.enum(['read', 'create', 'update', 'delete']).optional(),
    bulk: z.boolean().optional(),
    timeout: z.number().int().min(100).max(600_000).optional(),
    run: fn,
  })
  .strict();

/** What is wrong with a default export, as short lines. */
function problemsOf(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      if (issue.code === 'unrecognized_keys') return `unknown option ${issue.keys.map((k) => `"${k}"`).join(', ')}`;
      return path === '' ? issue.message : `${path} ${issue.message}`;
    })
    .join('; ');
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export type ImportModule = (url: string) => Promise<unknown>;

const importModule: ImportModule = (url) => import(url);

/**
 * The server files a build manifest lists: none when there is no manifest or
 * it lists none, and null when the manifest cannot be read. The build writes
 * the manifest last and in one step, so a reader never sees half of it.
 */
export function readServerCodeFiles(buildDir: string): { digest: string; files: ServerCodeFile[] } | null {
  const file = join(buildDir, 'manifest.json');
  if (!existsSync(file)) return { digest: '', files: [] };
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
      server?: { digest?: unknown; files?: unknown };
    };
    const server = manifest.server;
    if (server === undefined || typeof server.digest !== 'string' || !Array.isArray(server.files)) {
      return { digest: '', files: [] };
    }
    return { digest: server.digest, files: server.files as ServerCodeFile[] };
  } catch {
    return null;
  }
}

/**
 * Import every listed file and check its default export. The `?v=` query
 * makes Node import a changed bundle again instead of returning its cached
 * module, which is how `dev` swaps code without a restart.
 */
export async function loadProjectCode(
  buildDir: string,
  opts: { now?: () => number; importer?: ImportModule } = {},
): Promise<ProjectCode> {
  const now = opts.now ?? Date.now;
  const importer = opts.importer ?? importModule;
  const listed = readServerCodeFiles(buildDir);
  if (listed === null) throw new Error(`${join(buildDir, 'manifest.json')} could not be read.`);
  const { digest, files } = listed;
  const hooks: LoadedHook[] = [];
  const actions = new Map<string, LoadedAction>();
  const problems: CodeProblem[] = [];
  const problem = (source: string, message: string): void => {
    problems.push({ source, message, at: now() });
  };

  const sorted = [...files].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  for (const file of sorted) {
    if (file.kind === 'actions' && !ACTION_ID_PATTERN.test(file.name)) {
      problem(
        file.source,
        'An action is named after its file. Use lowercase letters, digits and dashes, such as refund-order.ts.',
      );
      continue;
    }
    let mod: unknown;
    try {
      mod = await importer(`${pathToFileURL(join(buildDir, file.output)).href}?v=${file.hash.slice(0, 16)}`);
    } catch (error) {
      problem(file.source, `Could not load it: ${reason(error)}`);
      continue;
    }
    const exported = (mod as { default?: unknown } | null)?.default;
    if (exported === undefined) {
      problem(
        file.source,
        `It has no default export. End it with \`export default ${file.kind === 'hooks' ? 'defineHook' : 'defineAction'}({ … })\`.`,
      );
      continue;
    }
    if (file.kind === 'hooks') {
      const parsed = hookSchema.safeParse(exported);
      if (!parsed.success) {
        problem(file.source, `The hook is not valid: ${problemsOf(parsed.error)}.`);
        continue;
      }
      const definition = exported as HookDefinition;
      hooks.push({
        name: file.name,
        source: file.source,
        database: definition.database ?? DEFAULT_DATABASE,
        definition,
        events: HOOK_EVENTS.filter((event) => definition[event] !== undefined),
      });
    } else {
      const parsed = actionSchema.safeParse(exported);
      if (!parsed.success) {
        problem(file.source, `The action is not valid: ${problemsOf(parsed.error)}.`);
        continue;
      }
      const definition = exported as ActionDefinition;
      actions.set(file.name, {
        id: file.name,
        source: file.source,
        database: definition.database ?? DEFAULT_DATABASE,
        definition,
      });
    }
  }
  return { digest, hooks, actions, problems, loadedAt: now() };
}
