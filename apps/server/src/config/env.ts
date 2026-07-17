import { z } from 'zod';

/**
 * Environment validation (01-architecture.md §7.1). `loadEnv()` is called
 * first in the boot sequence; on invalid input it prints a fail-fast table
 * (variable | problem | hint) to stderr and throws — it never calls
 * `process.exit` so callers (CLI, tests, Electron) decide how to die.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

/**
 * The DEPLOYMENT WRAPPER this process is running under (01-architecture.md §4:
 * "All four deployment modes run the identical `@adminium/server` process; only
 * the wrapper differs"). Only the wrapper sets it, and only `desktop` means
 * anything today: 11-electron.md §5 registers `POST /api/v1/auth/desktop-session`
 * ONLY under that value, so a self-host or Docker instance does not expose the
 * boot-token exchange at all — it has no route to attack, not merely a guarded
 * one. Everything that is not the Electron shell is `self-host` (Docker and npx
 * included); `cloud` joins when 12-cloud-platform.md lands.
 */
export const RUNTIMES = ['self-host', 'desktop'] as const;
export type Runtime = (typeof RUNTIMES)[number];

/** 11-electron.md §2.2 step 4: the per-boot token is 32 random bytes, hex. */
export const BOOT_TOKEN_HEX_LENGTH = 64;

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
  /**
   * ─── The desktop block (11-electron.md §2.2 step 5) ───────────────────────
   *
   * Set by `apps/desktop`'s `buildServerEnv` when it forks the utilityProcess,
   * and by nothing else. They live HERE, in the schema every front door
   * validates through, rather than being read off `process.env` at the point of
   * use, because {@link Runtime} decides whether a route EXISTS: a value that
   * changes the server's attack surface has to be parsed once, at the boot
   * everything else already fails fast in, not sampled from ambient state deep
   * inside a request handler where a typo reads as "not desktop" and silently
   * ships a server with no auto-login (or, worse, the reverse).
   */
  ADMINIUM_RUNTIME: z.preprocess(emptyToUndefined, z.enum(RUNTIMES).default('self-host')),
  /**
   * The per-boot token the desktop main process generated this launch (§2.2
   * step 4), which `POST /api/v1/auth/desktop-session` exchanges for a session.
   * NEVER persisted anywhere — it exists in the main process's memory, in this
   * child's environment, and in the one URL that opens the window.
   *
   * Optional even under `ADMINIUM_RUNTIME=desktop`: absent ⇒ the route is not
   * registered and the app lands on the normal login screen. That is a
   * degradation, not a failure, so it must not be a boot error — the desktop
   * shell's own schema (`apps/desktop/src/server/env.ts`) already requires the
   * variable, which is the right place to fail a desktop boot over it.
   */
  ADMINIUM_BOOT_TOKEN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(
        new RegExp(`^[0-9a-fA-F]{${String(BOOT_TOKEN_HEX_LENGTH)}}$`),
        `must be ${String(BOOT_TOKEN_HEX_LENGTH)} hex characters (32 bytes)`,
      )
      .optional(),
  ),
  /**
   * The §5 "Skip login on this computer" answer, mirrored out of the desktop's
   * `config.json` (§2.3 `singleUser`) on every boot.
   *
   * Tri-state, for the same reason `ADMINIUM_TELEMETRY` is: `config.json` is the
   * source of truth for this value (§2.3 — the main process owns it, because the
   * settings panel writes it through the preload bridge), and the env var is the
   * only channel that reaches the child at boot. Set ⇒ compose mirrors it into
   * `adminium_settings.desktop.singleUser`, which is what the route reads (§5).
   * Unset ⇒ NOTHING is written and the stored value stands, so a wrapper that
   * has not wired the mirror cannot silently flip a user's answer.
   */
  ADMINIUM_DESKTOP_SINGLE_USER: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? undefined : TRUTHY.has(value))),
  ),
  /**
   * The telemetry OVERRIDE, and — unlike its siblings — deliberately tri-state:
   * `true` / `false` / `undefined` (unset).
   *
   * `undefined` MUST survive parsing. The real gate is the `telemetry.enabled`
   * setting, written by the first-run consent screen; an env var that collapsed
   * "unset" to `false` could not be layered over it without silently vetoing
   * every consenting instance. So: set ⇒ the environment wins outright (01 §7.2
   * "environment always wins"); unset ⇒ the consent answer stands.
   *
   * It is layered at all because it was documented as the kill-switch
   * (`self-hosting/telemetry.md`, `env-vars.md`) while being read by NOTHING —
   * an org that put `ADMINIUM_TELEMETRY=off` in its compose file to enforce a
   * no-phone-home policy had exactly no protection if any user later clicked
   * "yes" on the consent screen. A documented control has to be a control.
   */
  ADMINIUM_TELEMETRY: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? undefined : TRUTHY.has(value))),
  ),
  ADMINIUM_TRUST_PROXY: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? false : TRUTHY.has(value))),
  ),
  // CORS is off by default — the SPA is same-origin (08-server-api.md §7 item 4).
  // A CSV of exact origins opts split deployments in; wildcard is rejected here
  // because responses are credentialed (cookies).
  ADMINIUM_CORS_ORIGINS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const origins = value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);
        if (origins.length === 0) return undefined;
        if (origins.includes('*')) {
          ctx.addIssue({
            code: 'custom',
            message: 'wildcard origin is not allowed with credentialed requests',
          });
          return z.NEVER;
        }
        return origins;
      }),
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
  ADMINIUM_RUNTIME: `one of ${RUNTIMES.join(', ')} (default self-host; set to desktop only by the Electron shell)`,
  ADMINIUM_BOOT_TOKEN: `${String(BOOT_TOKEN_HEX_LENGTH)} hex characters, generated per boot by the desktop shell`,
  ADMINIUM_DESKTOP_SINGLE_USER: `one of ${BOOLEANISH.join(', ')} (desktop only; mirrors config.json's singleUser)`,
  ADMINIUM_TELEMETRY: `one of ${BOOLEANISH.join(', ')} (default off)`,
  ADMINIUM_TRUST_PROXY: `one of ${BOOLEANISH.join(', ')} (default off; enable behind Caddy/TLS)`,
  ADMINIUM_CORS_ORIGINS:
    'CSV of exact origins for split deployments, e.g. https://admin.acme.io — no wildcard',
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
