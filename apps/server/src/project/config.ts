// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium.config.ts` — the settings a project folder commits.
 *
 * Everything here maps onto the environment variables the server already
 * reads, so a project and a plain `adminium start` go through one validation
 * path. The environment always wins over the file, and secrets never belong in
 * it: `ADMINIUM_SECRET` and passwords stay in `.env` or the host's environment,
 * and the file reads them from `process.env`.
 */

import { resolve } from 'node:path';

import { z } from 'zod';

/** A database key, as files will refer to it: `main`, `billing-archive`. */
export const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;

const databaseSchema = z
  .object({
    /**
     * The connection string, usually `process.env.DATABASE_URL`. Missing or
     * empty means "not set yet": the project still starts, without it.
     */
    url: z.string().optional(),
  })
  .strict();

export const projectConfigSchema = z
  .object({
    /** The databases the admin is built from, by key. */
    databases: z
      .record(
        z
          .string()
          .regex(
            PROJECT_KEY_PATTERN,
            'must start with a lowercase letter and use only a-z, 0-9 and "-" (48 characters at most)',
          ),
        databaseSchema,
      )
      .optional(),
    server: z
      .object({
        port: z.number().int().min(1).max(65535).optional(),
        host: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /** Adminium's own database. Unset means a SQLite file in the data directory. */
    metaStore: z.object({ url: z.string().min(1).optional() }).strict().optional(),
    /** Where Adminium keeps its own files, relative to the project. Default `data`. */
    dataDir: z.string().min(1).optional(),
    /** Where uploads and exports go. Unset means the data directory. */
    storage: z.object({ url: z.string().min(1).optional() }).strict().optional(),
  })
  .strict();

/** What a project's `adminium.config.ts` exports. */
export type AdminiumConfig = z.input<typeof projectConfigSchema>;
export type ProjectConfig = z.output<typeof projectConfigSchema>;

/** Types the config object; returns it unchanged. */
export function defineConfig(config: AdminiumConfig): AdminiumConfig {
  return config;
}

/**
 * An environment variable, read when the config loads; `fallback` when it is
 * unset or empty. Lets a config read `.env` without Node's type definitions.
 */
export function env(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

/** Parse what a config module exported, or explain what is wrong with it. */
export function parseProjectConfig(
  value: unknown,
): { ok: true; config: ProjectConfig } | { ok: false; problems: string[] } {
  const result = projectConfigSchema.safeParse(value);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    problems: result.error.issues.map((issue) => {
      const where = issue.path.length === 0 ? '(the exported object)' : issue.path.join('.');
      return `${where}: ${issue.message}`;
    }),
  };
}

/** The databases that have a URL, by key. Empty URLs are "not set yet". */
export function configuredDatabases(config: ProjectConfig): {
  ready: Map<string, string>;
  missing: string[];
} {
  const ready = new Map<string, string>();
  const missing: string[] = [];
  for (const [key, database] of Object.entries(config.databases ?? {})) {
    const url = database.url?.trim() ?? '';
    if (url === '') missing.push(key);
    else ready.set(key, url);
  }
  return { ready, missing };
}

/** The variable each config field stands for, and how to read the field. */
const CONFIG_VARIABLES: ReadonlyArray<
  readonly [variable: string, field: string, read: (config: ProjectConfig) => string | number | undefined]
> = [
  ['PORT', 'server.port', (config) => config.server?.port],
  ['HOST', 'server.host', (config) => config.server?.host],
  ['ADMINIUM_META_URL', 'metaStore.url', (config) => config.metaStore?.url],
  ['ADMINIUM_STORAGE_URL', 'storage.url', (config) => config.storage?.url],
];

/**
 * The environment variables the config stands for. The data directory is
 * always set, resolved against the project, so a project never falls back to
 * `~/.adminium`.
 */
export function projectEnvironment(config: ProjectConfig, root: string): Record<string, string> {
  const values: Record<string, string> = {
    ADMINIUM_DATA_DIR: resolve(root, config.dataDir ?? 'data'),
  };
  for (const [variable, , read] of CONFIG_VARIABLES) {
    const value = read(config);
    if (value !== undefined) values[variable] = String(value);
  }
  return values;
}

/** The config field behind each variable, for the fields this config sets. */
export function configFields(config: ProjectConfig): Record<string, string> {
  const fields: Record<string, string> = {};
  if (config.dataDir !== undefined) fields.ADMINIUM_DATA_DIR = 'dataDir';
  for (const [variable, field, read] of CONFIG_VARIABLES) {
    if (read(config) !== undefined) fields[variable] = field;
  }
  return fields;
}

/** `env` with `values` filled in wherever `env` leaves a variable unset or empty. */
export function withDefaults(
  env: Readonly<Record<string, string | undefined>>,
  values: Readonly<Record<string, string>>,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...env };
  for (const [key, value] of Object.entries(values)) {
    if (merged[key] === undefined || merged[key] === '') merged[key] = value;
  }
  return merged;
}
