/**
 * THE DESKTOP ↔ SERVER ENV CONTRACT (11-electron.md §2.2 step 5).
 *
 * One module, both directions: {@link buildServerEnv} is what `ServerManager`
 * (main) hands to `utilityProcess.fork`, {@link parseDesktopServerEnv} is what
 * `src/server/index.ts` (child) reads back out. Declaring the contract once is
 * the point — a fork whose two ends disagree about a variable name fails as a
 * 30 s handshake timeout with no reason attached, which is the worst diagnostic
 * in the whole boot path.
 *
 * ─── Why a mapping layer exists at all ──────────────────────────────────────
 *
 * §2.2 specifies a DESKTOP-FACING env block (`ADMINIUM_HOST`, `ADMINIUM_PORT`,
 * `ADMINIUM_META_DSN`, `ADMINIUM_DISABLE_TELEMETRY`). `@adminium/server`'s actual
 * contract — `config/env.ts`, the Zod schema every front door validates through
 * — names three of those differently and cannot express a fourth:
 *
 *   §2.2 desktop name            → `envSchema` name        note
 *   ─────────────────────────────────────────────────────────────────────────
 *   ADMINIUM_HOST                → HOST
 *   ADMINIUM_PORT                → PORT                    0 is NOT expressible
 *   ADMINIUM_META_DSN            → ADMINIUM_META_URL
 *   ADMINIUM_DISABLE_TELEMETRY=1 → ADMINIUM_TELEMETRY=off
 *   ADMINIUM_DATA_DIR            → ADMINIUM_DATA_DIR       (same)
 *   ADMINIUM_SECRET              → ADMINIUM_SECRET         (same)
 *   ADMINIUM_RUNTIME             → (not in the schema; read from `process.env`
 *   ADMINIUM_BOOT_TOKEN             by the §5 desktop-session route, which is
 *                                   registered only when runtime is `desktop`)
 *   (§2.3 `singleUser`)          → ADMINIUM_DESKTOP_SINGLE_USER
 *
 * `ADMINIUM_DESKTOP_SINGLE_USER` has no §2.2 spelling because §2.2 lists the
 * variables the SERVER needs to boot, and this one is not one of them — §5 asks
 * for `config.singleUser` to be "mirrored into `adminium_settings` … by the
 * server at boot", and the env block is the only channel that reaches the child.
 * `compose.ts` mirrors it and `apps/server/src/config/env.ts` documents it as
 * "Set by apps/desktop's buildServerEnv when it forks the utilityProcess", which
 * is a promise this module has to keep: unset ⇒ no mirror ⇒ the registry default
 * (`false`) stands ⇒ gate 3 of the §5 route 403s every auto-login.
 *
 * `PORT` is `z.coerce.number().int().min(1)`, so `PORT=0` — the §2.1 "listens
 * 127.0.0.1:0 (random free port)" requirement — is a VALIDATION ERROR, not a
 * config value. The entry therefore treats the ephemeral port as a listen-time
 * instruction (`app.listen({ port: 0 })`) and keeps it out of the schema
 * entirely; see {@link toServerEnvRecord}. This is the honest resolution while
 * the schema belongs to another package; widening `PORT` to allow 0 for the
 * ephemeral case is the follow-up.
 *
 * The mapping lives on the DESKTOP side of the boundary on purpose: the desktop
 * shell is the wrapper (01 §4 "only the wrapper differs"), so the wrapper eats
 * the impedance mismatch rather than pushing a desktop-shaped name into a schema
 * four other deployment modes share.
 */

import { randomBytes } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

/** §2.2 step 4: "a per-boot random `bootToken` (32 bytes, hex)". */
export const BOOT_TOKEN_BYTES = 32;
/** Hex doubles it. Pinned so a truncating generator fails at the child, loudly. */
export const BOOT_TOKEN_HEX_LENGTH = BOOT_TOKEN_BYTES * 2;

/** §2.4: the server binds loopback. Wave 1 has no other legal value. */
export const LOOPBACK_HOST = '127.0.0.1';

/** §2.1: `ADMINIUM_PORT=0` — the OS picks; the child reports back (§2.2 step 7). */
export const EPHEMERAL_PORT = 0;

/** Mirrors `@adminium/server`'s `LOG_LEVELS`; re-declared to keep this leaf pure. */
export const DESKTOP_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type DesktopLogLevel = (typeof DESKTOP_LOG_LEVELS)[number];

/** §2.1: "Meta-store is always local SQLite at `<dataDir>/meta.db`". */
export function metaDsnForDataDir(dataDir: string): string {
  return `sqlite:${join(resolve(dataDir), 'meta.db')}`;
}

/** A fresh per-boot token. Never persisted (§2.2 step 4). */
export function generateBootToken(): string {
  return randomBytes(BOOT_TOKEN_BYTES).toString('hex');
}

// ─── Parent side: building the child's env ───────────────────────────────────

export interface BuildServerEnvInput {
  /** §2.3 `dataDir`. Must be absolute — the child resolves paths against it. */
  dataDir: string;
  /** The decrypted `ADMINIUM_SECRET` (§2.2 step 3). */
  secret: string;
  /** {@link generateBootToken}'s output for THIS boot (§2.2 step 4). */
  bootToken: string;
  /**
   * §2.3 `singleUser` — "Skip login on this computer".
   *
   * REQUIRED, and not optional-with-a-default, because both possible mistakes
   * are silent. `config.json` is the source of truth (§2.3: the main process
   * owns it, because the settings panel writes it through the preload bridge)
   * and this variable is the only channel that reaches the child, so a caller
   * that forgets it hands the server no answer at all — the mirror does not run,
   * `adminium_settings.desktop.singleUser` keeps the registry default `false`,
   * and §5's auto-login 403s on every boot with "Skip login" ticked. A default
   * here would pick an answer on the user's behalf instead. Neither is
   * acceptable for a flag that decides whether a password is required, so the
   * type system asks.
   */
  singleUser: boolean;
  /**
   * §2.2/§8.3. Defaults to loopback + ephemeral. LAN share is the ONLY caller
   * that passes anything else, and it passes `0.0.0.0` + a fixed port
   * deliberately — Wave 1 never does.
   */
  host?: string | undefined;
  port?: number | undefined;
  /** §7: omitted unless the user opted in, in which case the server's own consent setting governs. */
  telemetryOptIn?: boolean | undefined;
  logLevel?: DesktopLogLevel | undefined;
  /** §3: the dashboard build copied into `resources/` at package time. */
  staticRoot?: string | undefined;
  /**
   * The environment the child inherits before Adminium's own keys are layered
   * on. Defaults to `process.env`. Injected by the suites.
   */
  inherit?: NodeJS.ProcessEnv | undefined;
}

/**
 * Keys that are STRIPPED from the inherited environment before the Adminium
 * block is layered on.
 *
 * This is a security control, not tidiness. `utilityProcess.fork`'s `env`
 * replaces the child's environment wholesale, and the natural implementation
 * (`{ ...process.env, ...ours }`) inherits the user's shell. A developer with
 * `HOST=0.0.0.0` exported in their profile — an entirely ordinary thing to have
 * — would then launch a desktop app that binds every interface, silently
 * defeating §2.4's "the server binds 127.0.0.1 … never 0.0.0.0 in Wave 1". The
 * same reasoning covers the rest: `PORT` would break the handshake, and a stray
 * `ADMINIUM_META_URL` would point the desktop app's meta store at somebody's
 * production Postgres while §2.1 promises local SQLite.
 *
 * The desktop-facing aliases are stripped too: the child reads THIS block, so an
 * inherited `ADMINIUM_PORT` must not reach it.
 */
export const STRIPPED_INHERITED_ENV_KEYS: readonly string[] = [
  'HOST',
  'PORT',
  'ADMINIUM_HOST',
  'ADMINIUM_PORT',
  'ADMINIUM_META_URL',
  'ADMINIUM_META_DSN',
  'ADMINIUM_DATA_DIR',
  'ADMINIUM_SECRET',
  'ADMINIUM_BOOT_TOKEN',
  'ADMINIUM_RUNTIME',
  'ADMINIUM_TELEMETRY',
  'ADMINIUM_DISABLE_TELEMETRY',
  'ADMINIUM_STATIC_ROOT',
  // An inherited value here would decide whether the local user needs a
  // password. `config.json` decides that (§2.3/§5), and this block always
  // states it — but the strip is what makes "always" independent of the order
  // the keys happen to be assigned in below.
  'ADMINIUM_DESKTOP_SINGLE_USER',
];

/**
 * The §2.2 step 5 env block, layered over a sanitized inherit.
 *
 * Returns `Record<string, string>` — `utilityProcess.fork`'s `env` option takes
 * strings, and an `undefined` value smuggled in as the string `"undefined"` is a
 * classic way to make a Zod default silently not apply.
 */
export function buildServerEnv(input: BuildServerEnvInput): Record<string, string> {
  if (!isAbsolute(input.dataDir)) {
    throw new Error(`dataDir must be an absolute path, got "${input.dataDir}"`);
  }
  if (input.bootToken.length !== BOOT_TOKEN_HEX_LENGTH) {
    throw new Error(
      `bootToken must be ${String(BOOT_TOKEN_HEX_LENGTH)} hex characters ` +
        `(${String(BOOT_TOKEN_BYTES)} bytes), got ${String(input.bootToken.length)}`,
    );
  }

  const inherited = input.inherit ?? process.env;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined) continue;
    if (STRIPPED_INHERITED_ENV_KEYS.includes(key)) continue;
    env[key] = value;
  }

  const dataDir = resolve(input.dataDir);

  env.ADMINIUM_RUNTIME = 'desktop';
  env.ADMINIUM_HOST = input.host ?? LOOPBACK_HOST;
  env.ADMINIUM_PORT = String(input.port ?? EPHEMERAL_PORT);
  env.ADMINIUM_DATA_DIR = dataDir;
  env.ADMINIUM_META_DSN = metaDsnForDataDir(dataDir);
  env.ADMINIUM_SECRET = input.secret;
  env.ADMINIUM_BOOT_TOKEN = input.bootToken;

  // §5's mirror. ALWAYS emitted, including the `off` case: `compose.ts` gates
  // the mirror on this key being defined, so "off" and "absent" are different
  // instructions — absent means "this wrapper has no opinion, leave the stored
  // answer alone", which is the right default for a self-host server and the
  // wrong one for us. The desktop shell always has an opinion; it is in
  // `config.json`. `on`/`off` are `config/env.ts`'s BOOLEANISH spelling.
  env.ADMINIUM_DESKTOP_SINGLE_USER = input.singleUser ? 'on' : 'off';

  // §7: opting IN does not mean "report" — it means "let the server's own
  // consent setting decide", which is what leaving both variables unset does
  // (`ADMINIUM_TELEMETRY` is tri-state on purpose; see `config/env.ts`). Opting
  // out is a hard veto, so it is expressed as an explicit `off`.
  if (input.telemetryOptIn !== true) {
    env.ADMINIUM_DISABLE_TELEMETRY = '1';
  }

  if (input.logLevel !== undefined) env.ADMINIUM_LOG_LEVEL = input.logLevel;
  if (input.staticRoot !== undefined) env.ADMINIUM_STATIC_ROOT = resolve(input.staticRoot);

  return env;
}

// ─── Child side: reading it back ─────────────────────────────────────────────

/** Empty string ⇒ unset, matching `config/env.ts`'s `emptyToUndefined`. */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

export const desktopServerEnvSchema = z.object({
  // Not merely informational: §5 registers `POST /api/v1/auth/desktop-session`
  // only when this is `desktop`, and §2.4 makes that route's existence a
  // security-relevant fact. A typo must fail the boot, not quietly ship a
  // server with no auto-login.
  ADMINIUM_RUNTIME: z.literal('desktop', { error: 'must be "desktop" for the embedded server' }),
  ADMINIUM_HOST: z.preprocess(emptyToUndefined, z.string().min(1).default(LOOPBACK_HOST)),
  ADMINIUM_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: 'must be a number' })
      .int('must be an integer')
      // 0 IS legal here — unlike the server's own schema. That is the whole
      // reason this schema exists (see the module header).
      .min(0, 'must be between 0 and 65535')
      .max(65535, 'must be between 0 and 65535')
      .default(EPHEMERAL_PORT),
  ),
  ADMINIUM_DATA_DIR: z.string({ error: 'is required' }).min(1, 'is required'),
  ADMINIUM_META_DSN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ADMINIUM_SECRET: z.string({ error: 'is required' }).min(16, 'must be at least 16 characters'),
  ADMINIUM_BOOT_TOKEN: z
    .string({ error: 'is required' })
    .regex(
      new RegExp(`^[0-9a-fA-F]{${String(BOOT_TOKEN_HEX_LENGTH)}}$`),
      `must be ${String(BOOT_TOKEN_HEX_LENGTH)} hex characters`,
    ),
  ADMINIUM_DISABLE_TELEMETRY: z.preprocess(emptyToUndefined, z.string().optional()),
  ADMINIUM_LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(DESKTOP_LOG_LEVELS).default('info')),
  ADMINIUM_STATIC_ROOT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export interface DesktopServerEnv {
  host: string;
  /** 0 ⇒ ask the OS (§2.1). Never reaches `envSchema`; see the module header. */
  port: number;
  dataDir: string;
  metaDsn: string;
  secret: string;
  bootToken: string;
  telemetryDisabled: boolean;
  logLevel: DesktopLogLevel;
  staticRoot: string | undefined;
}

export class DesktopServerEnvError extends Error {
  override readonly name = 'DesktopServerEnvError';
  constructor(readonly issues: readonly string[]) {
    super(`invalid desktop server environment:\n  ${issues.join('\n  ')}`);
  }
}

/**
 * Validate the child's environment. Throws {@link DesktopServerEnvError} with
 * every problem listed — the entry catches it and reports `stage: "env"` over
 * the handshake, so the crash page names the variable instead of showing a
 * silent 30 s timeout.
 */
export function parseDesktopServerEnv(env: NodeJS.ProcessEnv): DesktopServerEnv {
  const result = desktopServerEnvSchema.safeParse(env);
  if (!result.success) {
    throw new DesktopServerEnvError(
      result.error.issues.map((issue) => {
        const variable = issue.path.length > 0 ? issue.path.map(String).join('.') : '(env)';
        return `${variable} ${issue.message}`;
      }),
    );
  }
  const parsed = result.data;
  const dataDir = resolve(parsed.ADMINIUM_DATA_DIR);
  return {
    host: parsed.ADMINIUM_HOST,
    port: parsed.ADMINIUM_PORT,
    dataDir,
    // §2.1 is unconditional — local SQLite even when the SOURCE db is remote —
    // so an absent DSN is a default, not an error.
    metaDsn: parsed.ADMINIUM_META_DSN ?? metaDsnForDataDir(dataDir),
    secret: parsed.ADMINIUM_SECRET,
    bootToken: parsed.ADMINIUM_BOOT_TOKEN,
    telemetryDisabled: parsed.ADMINIUM_DISABLE_TELEMETRY === '1',
    logLevel: parsed.ADMINIUM_LOG_LEVEL,
    staticRoot: parsed.ADMINIUM_STATIC_ROOT,
  };
}

/**
 * The §2.2-name → `envSchema`-name translation, as a plain record ready for
 * `loadCliEnv`.
 *
 * `PORT` is DELIBERATELY ABSENT when the port is ephemeral: the server's schema
 * rejects 0 (`min(1)`), and the entry passes the real 0 to `app.listen` itself.
 * Emitting `PORT=0` here would fail the boot at `stage: "env"` with a message
 * about a port the user never chose. A fixed port (LAN share, §8.3) IS emitted,
 * so `env.PORT` and the listening socket agree wherever they can.
 */
export function toServerEnvRecord(
  desktop: DesktopServerEnv,
  inherit: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const record: NodeJS.ProcessEnv = { ...inherit };
  record.HOST = desktop.host;
  if (desktop.port === EPHEMERAL_PORT) {
    delete record.PORT;
  } else {
    record.PORT = String(desktop.port);
  }
  record.ADMINIUM_DATA_DIR = desktop.dataDir;
  record.ADMINIUM_META_URL = desktop.metaDsn;
  record.ADMINIUM_SECRET = desktop.secret;
  record.ADMINIUM_LOG_LEVEL = desktop.logLevel;
  if (desktop.telemetryDisabled) {
    // Tri-state (`config/env.ts`): an explicit `off` vetoes the in-app consent
    // setting, which is exactly what §7's "None unless telemetryOptIn" means.
    record.ADMINIUM_TELEMETRY = 'off';
  } else {
    delete record.ADMINIUM_TELEMETRY;
  }
  return record;
}
