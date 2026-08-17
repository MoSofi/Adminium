// SPDX-License-Identifier: AGPL-3.0-only
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
  /*
   * NO `DATABASE_URL`. It was validated here, passed through docker-compose.yml,
   * and documented on two self-hosting pages as "imported as the first source
   * connection on the first boot only" — and read by ZERO lines of product code.
   * A Docker user who followed our own quickstart set it, saw no connection, and
   * had nothing to debug, because there was nothing there to fail.
   *
   * Removed rather than implemented: a first-boot connection seed is a real
   * feature (validate + probe the DSN, decide what a bad one does to the boot,
   * stay idempotent across restarts, and say what happens when the row is later
   * deleted), and it belongs behind a decision about that behavior — not
   * retrofitted to make an already-documented variable true. The wizard and
   * `POST /connections` create connections today. If the seed is wanted later it
   * arrives with those answers, and this comment is the note that its NAME was
   * once taken.
   */
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
   * Absolute path to `demo-seed.mjs` — the §6 step 2 "Explore the demo database"
   * seed script, which ships in `apps/desktop/resources/` (11-T08).
   *
   * The server cannot find this itself and must not try: the script's location is
   * a fact about the SHELL's layout (`resources/demo/` in the repo, inside the
   * app bundle once §10 packages it), and `@adminium/server` may not import
   * `@adminium/desktop` to ask. So the shell states it, the same way it states
   * the boot token — and, like the boot token, this being absent is a
   * DEGRADATION rather than an error: `compose.ts` skips the route and the
   * wizard's demo card has nothing to call, while every other first-run path
   * still works. A missing demo must not cost you your app.
   *
   * Only meaningful when {@link Runtime} is `desktop`; compose requires both.
   */
  ADMINIUM_DEMO_SEED_SCRIPT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
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
  /**
   * May this deployment use network-dependent features at all
   * (11-electron.md §8.2 `networkFeaturesAllowed`)?
   *
   * READ THIS BEFORE USING IT: THIS IS A POLICY ANSWER, NOT A REACHABILITY
   * ANSWER. It does not mean "the internet is up" and must never be rendered as
   * if it did. The server cannot know whether the network is reachable without
   * making an outbound call, and 11-electron.md §7 ("Offline is the default,
   * network is the exception. Every network touchpoint … is explicit,
   * user-visible, and individually disableable") is precisely the promise an
   * unprompted reachability probe would break — the desktop offline smoke test
   * fails the build over exactly that request. So the honest thing the server
   * CAN report is the one it owns: whether the operator has permitted outbound
   * features here. §8.2's webhooks row is written to match — those rows carry a
   * "Requires internet" HINT rather than a claim, because nothing in this
   * process is entitled to make the claim.
   *
   * Default `on`, because a self-host behind a normal internet connection is the
   * common case and webhooks/OAuth are ordinary features there. `off` is the
   * air-gap switch for the fleet admin who already reaches for
   * `ADMINIUM_DISABLE_UPDATES=1` (§11) and `ADMINIUM_TELEMETRY=off`: it tells the
   * SPA to stop offering what this network cannot do, instead of letting users
   * discover it one timeout at a time.
   *
   * NOT tri-state, unlike `ADMINIUM_TELEMETRY`: there is no stored setting
   * underneath for an unset value to defer to, so "unset" has exactly one
   * possible meaning and a boolean says it without pretending otherwise.
   */
  ADMINIUM_NETWORK_FEATURES: z.preprocess(
    emptyToUndefined,
    z
      .enum(BOOLEANISH)
      .optional()
      .transform((value) => (value === undefined ? true : TRUTHY.has(value))),
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
  /**
   * Exact origins allowed to hand a connection string to this instance
   * (`routes/bridge`). Unset ⇒ the bridge routes are not registered at all,
   * which is the default: `adminium --bridge` is the only thing that sets it.
   *
   * Wildcard is refused for a sharper reason than the CORS list above: this
   * resource accepts a credential-bearing string from a cross-origin page, so
   * "any site may hand my admin panel a database" is never a coherent setting.
   */
  ADMINIUM_BRIDGE_ORIGINS: z.preprocess(
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
        for (const origin of origins) {
          if (origin === '*') {
            ctx.addIssue({
              code: 'custom',
              message: 'wildcard origin is not allowed for the local bridge',
            });
            return z.NEVER;
          }
          // An exact origin, i.e. scheme + host + optional port and nothing
          // else. A value carrying a path would silently never match the
          // browser's `Origin` header, which fails as "pairing is broken".
          try {
            if (new URL(origin).origin !== origin) {
              ctx.addIssue({
                code: 'custom',
                message: `"${origin}" must be an exact origin, e.g. https://adminium.dev`,
              });
              return z.NEVER;
            }
          } catch {
            ctx.addIssue({ code: 'custom', message: `"${origin}" is not a valid origin` });
            return z.NEVER;
          }
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
  ADMINIUM_META_URL: 'optional meta-store DSN: postgres://, mysql://, or sqlite:<path>',
  ADMINIUM_DATA_DIR: 'writable directory for files, exports, and backups (default ./data)',
  ADMINIUM_LOG_LEVEL: `one of ${LOG_LEVELS.join(', ')} (default info)`,
  ADMINIUM_RUNTIME: `one of ${RUNTIMES.join(', ')} (default self-host; set to desktop only by the Electron shell)`,
  ADMINIUM_BOOT_TOKEN: `${String(BOOT_TOKEN_HEX_LENGTH)} hex characters, generated per boot by the desktop shell`,
  ADMINIUM_DESKTOP_SINGLE_USER: `one of ${BOOLEANISH.join(', ')} (desktop only; mirrors config.json's singleUser)`,
  ADMINIUM_DEMO_SEED_SCRIPT:
    'absolute path to the desktop shell’s demo-seed.mjs (desktop only; enables the first-run demo card)',
  ADMINIUM_TELEMETRY: `one of ${BOOLEANISH.join(', ')} (default off)`,
  ADMINIUM_NETWORK_FEATURES: `one of ${BOOLEANISH.join(', ')} (default on; set off on air-gapped installs so the UI stops offering webhooks/OAuth)`,
  ADMINIUM_TRUST_PROXY: `one of ${BOOLEANISH.join(', ')} (default off; enable behind Caddy/TLS)`,
  ADMINIUM_CORS_ORIGINS:
    'CSV of exact origins for split deployments, e.g. https://admin.acme.io — no wildcard',
  ADMINIUM_BRIDGE_ORIGINS:
    'CSV of exact origins allowed to hand this instance a connection string, e.g. https://adminium.dev — unset disables the bridge entirely',
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
