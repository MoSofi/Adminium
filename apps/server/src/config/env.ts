import { z } from 'zod';

/**
 * Environment validation (01-architecture.md §7.1). `loadEnv()` is called
 * first in the boot sequence; on invalid input it prints a fail-fast table
 * (variable | problem | hint) to stderr and throws — it never calls
 * `process.exit` so callers (CLI, tests, Electron) decide how to die.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

const TRUTHY = new Set(['on', 'true', '1']);
const BOOLEANISH = ['on', 'off', 'true', 'false', '1', '0'] as const;

/** Treat empty strings as unset so `FOO= adminium start` behaves like unset FOO. */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

export const envSchema = z.object({
  ADMINIUM_SECRET: z
    .string({ error: 'is required' })
    .min(16, 'must be at least 16 characters'),
  PORT: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: 'must be a number' })
      .int('must be an integer')
      .min(1, 'must be between 1 and 65535')
      .max(65535, 'must be between 1 and 65535')
      .default(4600),
  ),
  HOST: z.preprocess(emptyToUndefined, z.string().default('0.0.0.0')),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ADMINIUM_META_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ADMINIUM_DATA_DIR: z.preprocess(emptyToUndefined, z.string().default('./data')),
  ADMINIUM_LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(LOG_LEVELS).default('info')),
  ADMINIUM_TELEMETRY: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? false : TRUTHY.has(value))),
  ),
});

export type Env = z.infer<typeof envSchema>;

const ENV_HINTS: Record<string, string> = {
  ADMINIUM_SECRET: 'set a random string of at least 16 characters, e.g. `openssl rand -hex 32`',
  PORT: 'integer between 1 and 65535 (default 4600)',
  HOST: 'bind address, e.g. 0.0.0.0 or 127.0.0.1',
  DATABASE_URL: 'optional seed source-DB DSN, e.g. postgres://user:pass@host:5432/db',
  ADMINIUM_META_URL: 'optional meta-store DSN: postgres://, mysql://, or sqlite:<path>',
  ADMINIUM_DATA_DIR: 'writable directory for files, exports, and backups (default ./data)',
  ADMINIUM_LOG_LEVEL: `one of ${LOG_LEVELS.join(', ')} (default info)`,
  ADMINIUM_TELEMETRY: `one of ${BOOLEANISH.join(', ')} (default off)`,
};

export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';
  readonly issues: readonly z.core.$ZodIssue[];
  readonly table: string;

  constructor(issues: readonly z.core.$ZodIssue[], table: string) {
    super(`invalid environment configuration (${String(issues.length)} problem(s)):\n${table}`);
    this.issues = issues;
    this.table = table;
  }
}

/** Renders the fail-fast `variable | problem | hint` table. */
export function formatEnvErrorTable(issues: readonly z.core.$ZodIssue[]): string {
  const header = ['variable', 'problem', 'hint'];
  const rows = issues.map((issue) => {
    const variable = issue.path.length > 0 ? issue.path.map(String).join('.') : '(env)';
    return [variable, issue.message, ENV_HINTS[variable] ?? '—'];
  });
  const all = [header, ...rows];
  const widths = header.map((_, col) => Math.max(...all.map((row) => (row[col] ?? '').length)));
  const line = (row: string[]): string =>
    `| ${row.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join(' | ')} |`;
  const separator = `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`;
  return [line(header), separator, ...rows.map(line)].join('\n');
}

export interface EnvWriter {
  write(chunk: string): unknown;
}

/**
 * Parses and validates the process environment. On failure, prints the
 * problem table to stderr and throws `EnvValidationError`.
 */
export function loadEnv(
  env: Record<string, string | undefined> = process.env,
  stderr: EnvWriter = process.stderr,
): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const table = formatEnvErrorTable(result.error.issues);
    stderr.write(`Adminium failed to start — invalid environment configuration:\n\n${table}\n`);
    throw new EnvValidationError(result.error.issues, table);
  }
  return result.data;
}
