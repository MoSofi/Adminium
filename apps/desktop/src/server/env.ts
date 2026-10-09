// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DESKTOP ↔ SERVER ENV CONTRACT.
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
 * The shell passes a DESKTOP-FACING env block (`ADMINIUM_HOST`, `ADMINIUM_PORT`,
 * `ADMINIUM_META_DSN`, `ADMINIUM_DISABLE_TELEMETRY`). `@adminium/server`'s actual
 * contract — `config/env.ts`, the Zod schema every front door validates through
 * — names three of those differently and cannot express a fourth:
 *
 *   desktop name                 → `envSchema` name        note
 *   ─────────────────────────────────────────────────────────────────────────
 * ADMINIUM_HOST → HOST ADMINIUM_PORT → PORT 0 is NOT expressible
 *   ADMINIUM_META_DSN → ADMINIUM_META_URL ADMINIUM_DISABLE_TELEMETRY=1 →
 *   ADMINIUM_TELEMETRY=off ADMINIUM_DATA_DIR → ADMINIUM_DATA_DIR (same)
 *   ADMINIUM_SECRET → ADMINIUM_SECRET (same) ADMINIUM_RUNTIME → (not in the
 *   schema; read from `process.env` ADMINIUM_BOOT_TOKEN by the desktop-session
 *   route, which is registered only when runtime is `desktop`) (`singleUser`) →
 *   ADMINIUM_DESKTOP_SINGLE_USER
 *
 * `ADMINIUM_DESKTOP_SINGLE_USER` has no spelling because lists the variables the
 * SERVER needs to boot, and this one is not one of them — asks for
 * `config.singleUser` to be "mirrored into `adminium_settings` … by the server
 * at boot", and the env block is the only channel that reaches the child.
 * `compose.ts` mirrors it and `apps/server/src/config/env.ts` documents it as
 * "Set by apps/desktop's buildServerEnv when it forks the utilityProcess", which
 * is a promise this module has to keep: unset ⇒ no mirror ⇒ the registry default
 * (`false`) stands ⇒ gate 3 of the route 403s every auto-login.
 *
 * `PORT` is `z.coerce.number().int().min(1)`, so `PORT=0` — the requirement —
 * is a VALIDATION ERROR, not a config value. The entry therefore treats the
 * ephemeral port as a listen-time instruction (`app.listen({ port: 0 })`) and
 * keeps it out of the schema entirely; see {@link toServerEnvRecord}. This is
 * the honest resolution while the schema belongs to another package; widening
 * `PORT` to allow 0 for the ephemeral case is the follow-up.
 *
 * The mapping lives on the DESKTOP side of the boundary on purpose: the desktop
 * shell is the wrapper, so the wrapper eats the impedance mismatch rather than
 * pushing a desktop-shaped name into a schema four other deployment modes share.
 */

import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

/** "a per-boot random `bootToken` (32 bytes, hex)". */
export const BOOT_TOKEN_BYTES = 32;
/** Hex doubles it. Pinned so a truncating generator fails at the child, loudly. */
export const BOOT_TOKEN_HEX_LENGTH = BOOT_TOKEN_BYTES * 2;

/** The server binds loopback. Wave 1 has no other legal value. */
export const LOOPBACK_HOST = '127.0.0.1';

/** `ADMINIUM_PORT=0` — the OS picks; the child reports back. */
export const EPHEMERAL_PORT = 0;

/** Mirrors `@adminium/server`'s `LOG_LEVELS`; re-declared to keep this leaf pure. */
export const DESKTOP_LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type DesktopLogLevel = (typeof DESKTOP_LOG_LEVELS)[number];

/** "Meta-store is always local SQLite at `<dataDir>/meta.db`". */
export function metaDsnForDataDir(dataDir: string): string {
  return `sqlite:${join(resolve(dataDir), 'meta.db')}`;
}

/** A fresh per-boot token. Never persisted. */
export function generateBootToken(): string {
  return randomBytes(BOOT_TOKEN_BYTES).toString('hex');
}

// ─── Parent side: building the child's env ───────────────────────────────────

export interface BuildServerEnvInput {
  /** `dataDir`. Must be absolute — the child resolves paths against it. */
  dataDir: string;
  /** The decrypted `ADMINIUM_SECRET`. */
  secret: string;
  /** {@link generateBootToken}'s output for THIS boot. */
  bootToken: string;
  /**
   * `singleUser` — "Skip login on this computer".
   *
   * REQUIRED, and not optional-with-a-default, because both possible mistakes
   * are silent. `config.json` is the source of truth (the main process
   * owns it, because the settings panel writes it through the preload bridge)
   * and this variable is the only channel that reaches the child, so a caller
   * that forgets it hands the server no answer at all — the mirror does not run,
   * `adminium_settings.desktop.singleUser` keeps the registry default `false`,
   * auto-login 403s on every boot with "Skip login" ticked. A default here would
   * pick an answer on the user's behalf instead. Neither is acceptable for a
   * flag that decides whether a password is required, so the type system asks.
   */
  singleUser: boolean;
  /**
   * Defaults to loopback + ephemeral. LAN share is the ONLY caller that
   * passes anything else, and it passes `0.0.0.0` + a fixed port deliberately
   * — Wave 1 never does.
   */
  host?: string | undefined;
  port?: number | undefined;
  /** Omitted unless the user opted in, in which case the server's own consent
   * setting governs. */
  telemetryOptIn?: boolean | undefined;
  logLevel?: DesktopLogLevel | undefined;
  /** The dashboard build copied into `resources/` at package time. */
  staticRoot?: string | undefined;
  /**
   * The wizard's demo card: `resources/demo/demo-seed.mjs`, which the server imports by
   * path to seed the demo database. Omitted ⇒ the server does not register
   * the demo route and the wizard's fourth card has nothing to call
   * a degradation, not a failure, so this is optional here even though the
   * shipped app always passes it.
   */
  demoSeedScript?: string | undefined;
  /**
   * `resources/add-ons-bundle`, the pre-verified bundled add-on set the
   * desktop-release workflow fetches next to the demo seed — six first-party
   * tarballs + `.integrity` sidecars, pinned by
   * `scripts/release/add-ons-bundle.json`. The server seeds its add-on store
   * from it at boot, copy-if-absent, re-verifying every hash — which is what
   * makes the Add-ons page browsable with zero network.
   *
   * Optional for the reason `demoSeedScript` is: the suites do not pass it, and
   * a dev checkout has no fetched bundle (the directory is .gitignored). Unlike
   * the script, the variable is only EMITTED when the directory actually exists
   * — see the existence check in {@link buildServerEnv}.
   */
  bundledAddOnsDir?: string | undefined;
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
 * (`{...process.env...ours }`) inherits the user's shell. A developer with
 * `HOST=0.0.0.0` exported in their profile — an entirely ordinary thing to have
 * — would then launch a desktop app that binds every interface, silently
 * defeating "the server binds 127.0.0.1 … never 0.0.0.0 in Wave 1". The same
 * reasoning covers the rest: `PORT` would break the handshake, and a stray
 * `ADMINIUM_META_URL` would point the desktop app's meta store at somebody's
 * production Postgres while promises local SQLite.
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
  // password. `config.json` decides that, and this block always states it —
  // but the strip is what makes "always" independent of the order the keys
  // happen to be assigned in below.
  'ADMINIUM_DESKTOP_SINGLE_USER',
  // The server IMPORTS this path. An inherited value would let anything that can
  // set an environment variable choose which module the server process executes
  // — a much larger promotion than the rest of this list prevents. The shell
  // knows where its own resources are; nothing else gets a vote.
  'ADMINIUM_DEMO_SEED_SCRIPT',
  // Same promotion class as the seed script, one step removed: the server
  // SEEDS ITS ADD-ON STORE from every tarball in this directory. The hashes
  // are verified against sidecars in the SAME directory, so pointing it
  // somewhere else is choosing an entire set of packages to install at boot —
  // the shell knows where its bundled set is; nothing else gets a vote.
  'ADMINIUM_BUNDLED_ADD_ONS',
  // LAN share is what makes this one a security control rather than hygiene.
  //
  // `trustProxy` tells Fastify to believe `X-Forwarded-For`, which is correct
  // behind Caddy/nginx and catastrophic here: NOTHING is ever in front of this
  // child. Main forks it directly and LAN peers reach it over the socket it
  // binds — there is no proxy to be behind, so a forwarding header is never
  // legitimate and is only ever an attacker's spelling of `request.ip`.
  //
  // With it on, every LAN peer picks its own address: the audit-log promise
  // ("the audit log records their LAN IPs") records a chosen string, "rate
  // limiting and lockout behave as on self-host" is evaded by rotating the
  // header, and the share panel's session count reads the same forged value.
  // Auto-login survives it — route and the panel's own gate read
  // `socket.remoteAddress`, which is the kernel's and not a header's — and that
  // is precisely the standard the rest of this list is held to.
  'ADMINIUM_TRUST_PROXY',
  // Its list of proxy addresses. Meaningless with the flag forced off, and
  // worse than meaningless inherited: the server refuses to boot on a list
  // while the flag is off, so a stray export would stop the app from starting.
  'ADMINIUM_TRUSTED_PROXIES',
  // Project mode (plan 66). Which folder this child serves, and how, is main's
  // to say after the person answered the trust question: an inherited value
  // would have the app build and run a folder nobody picked.
  'ADMINIUM_DESKTOP_PROJECT',
  'ADMINIUM_DESKTOP_PROJECT_MODE',
  'ADMINIUM_DESKTOP_PROGRAMS',
  'ADMINIUM_PROJECT_DIR',
  'ADMINIUM_PROJECT_MODE',
  // `live` is never the desktop's, and the bundled apps' folder is the app's own.
  'ADMINIUM_DESIGNER',
  'ADMINIUM_BUNDLED_APPS',
];

/**
 * The env block, layered over a sanitized inherit.
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

  // The mirror. ALWAYS emitted, including the `off` case: `compose.ts` gates
  // the mirror on this key being defined, so "off" and "absent" are different
  // instructions — absent means "this wrapper has no opinion, leave the stored
  // answer alone", which is the right default for a self-host server and the
  // wrong one for us. The desktop shell always has an opinion; it is in
  // `config.json`. `on`/`off` are `config/env.ts`'s BOOLEANISH spelling.
  env.ADMINIUM_DESKTOP_SINGLE_USER = input.singleUser ? 'on' : 'off';

  // Stated rather than left to the server schema's `default off`, for the
  // reason the strip above exists: this is the value that decides whether
  // `request.ip` is the kernel's answer or a LAN peer's claim, and "off because
  // nobody set it" is a weaker guarantee than "off because we said so". The
  // desktop child is never behind a proxy, so there is no configuration of this
  // app in which the other value is right.
  env.ADMINIUM_TRUST_PROXY = 'off';

  // Opting IN does not mean "report" — it means "let the server's own consent
  // setting decide", which is what leaving both variables unset does
  // (`ADMINIUM_TELEMETRY` is tri-state on purpose; see `config/env.ts`). Opting
  // out is a hard veto, so it is expressed as an explicit `off`.
  if (input.telemetryOptIn !== true) {
    env.ADMINIUM_DISABLE_TELEMETRY = '1';
  }

  if (input.logLevel !== undefined) env.ADMINIUM_LOG_LEVEL = input.logLevel;
  if (input.staticRoot !== undefined) env.ADMINIUM_STATIC_ROOT = resolve(input.staticRoot);
  // Absolute: the child's cwd is not this process's, and `import()` of a relative
  // path would resolve against whatever the utilityProcess happened to start in.
  if (input.demoSeedScript !== undefined) {
    env.ADMINIUM_DEMO_SEED_SCRIPT = resolve(input.demoSeedScript);
  }
  // Absolute for the demo-seed reason (the server resolves a relative value
  // against ITS cwd, compose.ts's BUNDLED_ADD_ONS_DIR), and emitted only when
  // the directory is really there: a dev run ships no bundle, and the honest
  // instruction for "nothing bundled" is silence — the server's own default
  // then no-ops — rather than a path to nowhere dressed up as configuration.
  if (input.bundledAddOnsDir !== undefined && isExistingDirectory(input.bundledAddOnsDir)) {
    env.ADMINIUM_BUNDLED_ADD_ONS = resolve(input.bundledAddOnsDir);
  }

  return env;
}

/** `false` for anything that is not a readable directory — including a file. */
function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// ─── Child side: reading it back ─────────────────────────────────────────────

/** Empty string ⇒ unset, matching `config/env.ts`'s `emptyToUndefined`. */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

export const desktopServerEnvSchema = z.object({
  // Not merely informational: the shell registers `POST /api/v1/auth/desktop-session`
  // only when this is `desktop`, makes that route's existence a
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
  /** 0 ⇒ ask the OS. Never reaches `envSchema`; see the module header. */
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
    // The rule is unconditional — local SQLite even when the SOURCE db is remote —
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
 * The -name → `envSchema`-name translation, as a plain record ready for
 * `loadCliEnv`.
 *
 * `PORT` is DELIBERATELY ABSENT when the port is ephemeral: the server's schema
 * rejects 0 (`min(1)`), and the entry passes the real 0 to `app.listen` itself.
 * Emitting `PORT=0` here would fail the boot at `stage: "env"` with a message
 * about a port the user never chose. A fixed port (LAN share) IS emitted, so
 * `env.PORT` and the listening socket agree wherever they can.
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
    // setting, which is exactly what "None unless telemetryOptIn" means.
    record.ADMINIUM_TELEMETRY = 'off';
  } else {
    delete record.ADMINIUM_TELEMETRY;
  }
  return record;
}

// ─── Project mode ────────────────────────────────────────────────────────────

/** How a project is served: built on this machine only, or shared as `adminium start` serves it. */
export type DesktopProjectMode = 'design' | 'serve';

export interface BuildProjectServerEnvInput {
  /** The project's folder, by its real path. */
  root: string;
  mode: DesktopProjectMode;
  /** Picked by main before every fork: design mode must know it before it listens. */
  port: number;
  /** `serve` only; design mode is this machine only whatever is given. */
  host?: string | undefined;
  /** Signs the project's owner in once (design mode's one-use link). */
  bootToken: string;
  logLevel?: DesktopLogLevel | undefined;
  staticRoot?: string | undefined;
  bundledAddOnsDir?: string | undefined;
  bundledAppsDir?: string | undefined;
  /**
   * Where the app's own programs are, as JSON (`main/programs.ts` makes it): the
   * server starts Node, npm and git by this and by nothing on the PATH.
   */
  programs?: string | undefined;
  inherit?: NodeJS.ProcessEnv | undefined;
}

/**
 * The environment of a child that serves a project folder.
 *
 * What it does NOT set is the point: `ADMINIUM_SECRET`, `ADMINIUM_DATA_DIR`
 * and `ADMINIUM_META_URL` are the project's own (its `.env`, its `data/`),
 * never the classic workspace's. Every name that decides where the server
 * listens, what it trusts and where the app's own files are is stated here or
 * left out on purpose, and the child refuses those names from the folder's
 * `.env` (`HOST_DECIDED_ENV` in the server package).
 */
export function buildProjectServerEnv(input: BuildProjectServerEnvInput): Record<string, string> {
  if (!isAbsolute(input.root)) throw new Error(`the project folder must be an absolute path, got "${input.root}"`);
  if (input.bootToken.length !== BOOT_TOKEN_HEX_LENGTH) {
    throw new Error(`bootToken must be ${String(BOOT_TOKEN_HEX_LENGTH)} hex characters, got ${String(input.bootToken.length)}`);
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error(`a project's port is picked before the fork, got ${String(input.port)}`);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.inherit ?? {})) {
    if (value === undefined) continue;
    if (STRIPPED_INHERITED_ENV_KEYS.includes(key)) continue;
    env[key] = value;
  }
  const host = input.mode === 'serve' ? (input.host ?? LOOPBACK_HOST) : LOOPBACK_HOST;
  env.ADMINIUM_RUNTIME = 'desktop';
  env.ADMINIUM_DESKTOP_PROJECT = input.root;
  env.ADMINIUM_DESKTOP_PROJECT_MODE = input.mode;
  env.ADMINIUM_HOST = host;
  env.HOST = host;
  env.ADMINIUM_PORT = String(input.port);
  env.PORT = String(input.port);
  env.ADMINIUM_BOOT_TOKEN = input.bootToken;
  if (input.logLevel !== undefined) env.ADMINIUM_LOG_LEVEL = input.logLevel;
  if (input.staticRoot !== undefined) env.ADMINIUM_STATIC_ROOT = input.staticRoot;
  if (input.bundledAddOnsDir !== undefined) env.ADMINIUM_BUNDLED_ADD_ONS = input.bundledAddOnsDir;
  // Absolute, always: the server's default is `./apps-bundle`, which in this child would be looked for inside the opened folder.
  if (input.bundledAppsDir !== undefined) env.ADMINIUM_BUNDLED_APPS = input.bundledAppsDir;
  if (input.programs !== undefined) env.ADMINIUM_DESKTOP_PROGRAMS = input.programs;
  return env;
}

export interface DesktopProjectEnv {
  root: string;
  mode: DesktopProjectMode;
  host: string;
  port: number;
  bootToken: string;
  logLevel: DesktopLogLevel | undefined;
}

/** Whether main started this child for a project folder. */
export function isProjectEnv(env: NodeJS.ProcessEnv): boolean {
  return (env.ADMINIUM_DESKTOP_PROJECT ?? '') !== '';
}

/** Reads back what {@link buildProjectServerEnv} wrote. Anything missing or odd is a refusal, not a default. */
export function parseDesktopProjectEnv(env: NodeJS.ProcessEnv): DesktopProjectEnv {
  const problems: string[] = [];
  const root = env.ADMINIUM_DESKTOP_PROJECT ?? '';
  if (root === '' || !isAbsolute(root)) problems.push('ADMINIUM_DESKTOP_PROJECT must be an absolute path');
  const mode = env.ADMINIUM_DESKTOP_PROJECT_MODE;
  if (mode !== 'design' && mode !== 'serve') problems.push('ADMINIUM_DESKTOP_PROJECT_MODE must be design or serve');
  const port = Number(env.ADMINIUM_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('ADMINIUM_PORT must be a port main picked');
  const host = env.ADMINIUM_HOST ?? '';
  if (host === '') problems.push('ADMINIUM_HOST must be set');
  if (mode === 'design' && host !== LOOPBACK_HOST) problems.push(`ADMINIUM_HOST must be ${LOOPBACK_HOST} while a project is built`);
  const bootToken = env.ADMINIUM_BOOT_TOKEN ?? '';
  if (!/^[0-9a-f]+$/.test(bootToken) || bootToken.length !== BOOT_TOKEN_HEX_LENGTH) problems.push('ADMINIUM_BOOT_TOKEN must be the token main minted');
  if (env.ADMINIUM_RUNTIME !== 'desktop') problems.push('ADMINIUM_RUNTIME must be desktop');
  const level = env.ADMINIUM_LOG_LEVEL;
  if (problems.length > 0) throw new DesktopServerEnvError(problems);
  return {
    root,
    mode: mode as DesktopProjectMode,
    host,
    port,
    bootToken,
    logLevel: (DESKTOP_LOG_LEVELS as readonly string[]).includes(level ?? '') ? (level as DesktopLogLevel) : undefined,
  };
}
