// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The §2.2 env contract, both directions.
 *
 * The security-relevant assertions are the inherit-stripping ones. §2.4 is
 * unambiguous — "the server binds `127.0.0.1` … never `0.0.0.0` in Wave 1" — and
 * the ONLY thing that makes that true on a machine whose owner has `HOST` or
 * `PORT` exported in their shell profile is {@link STRIPPED_INHERITED_ENV_KEYS}.
 * That is a rule with no other test in the repo and no visible symptom when it
 * breaks: the app works fine, it is just reachable from the coffee shop's Wi-Fi.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { envSchema } from '@adminium/server';
import { describe, expect, it } from 'vitest';

import {
  BOOT_TOKEN_HEX_LENGTH,
  buildServerEnv,
  DesktopServerEnvError,
  EPHEMERAL_PORT,
  generateBootToken,
  LOOPBACK_HOST,
  metaDsnForDataDir,
  parseDesktopServerEnv,
  toServerEnvRecord,
} from './env.js';

const SECRET = 'a'.repeat(32);
const TOKEN = 'b'.repeat(BOOT_TOKEN_HEX_LENGTH);
const DATA_DIR = '/tmp/adminium-test-data';

const base = {
  dataDir: DATA_DIR,
  secret: SECRET,
  bootToken: TOKEN,
  singleUser: true,
  inherit: {},
} as const;

describe('generateBootToken', () => {
  it('produces 32 bytes of hex (§2.2 step 4)', () => {
    const token = generateBootToken();
    expect(token).toHaveLength(BOOT_TOKEN_HEX_LENGTH);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('is different every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateBootToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('buildServerEnv', () => {
  it('emits the §2.2 step 5 block with loopback + an ephemeral port by default', () => {
    const env = buildServerEnv({ ...base });

    expect(env).toEqual({
      ADMINIUM_RUNTIME: 'desktop',
      ADMINIUM_HOST: LOOPBACK_HOST,
      ADMINIUM_PORT: String(EPHEMERAL_PORT),
      ADMINIUM_DATA_DIR: DATA_DIR,
      ADMINIUM_META_DSN: metaDsnForDataDir(DATA_DIR),
      ADMINIUM_SECRET: SECRET,
      ADMINIUM_BOOT_TOKEN: TOKEN,
      ADMINIUM_DESKTOP_SINGLE_USER: 'on',
      ADMINIUM_TRUST_PROXY: 'off',
      ADMINIUM_DISABLE_TELEMETRY: '1',
    });
  });

  it('points the meta DSN at <dataDir>/meta.db — always SQLite (§2.1)', () => {
    const env = buildServerEnv({ ...base });
    expect(env.ADMINIUM_META_DSN).toBe(`sqlite:${DATA_DIR}/meta.db`);
  });

  it('never emits 0.0.0.0 unless a caller explicitly asks (§2.4 / §8.3)', () => {
    expect(buildServerEnv({ ...base }).ADMINIUM_HOST).toBe('127.0.0.1');
    // §8.3's LAN toggle is the one caller allowed to do this, and it also fixes
    // the port so other devices get a stable URL.
    const lan = buildServerEnv({ ...base, host: '0.0.0.0', port: 4600 });
    expect(lan.ADMINIUM_HOST).toBe('0.0.0.0');
    expect(lan.ADMINIUM_PORT).toBe('4600');
  });

  describe('inherited environment', () => {
    it('strips HOST so a developer profile cannot make the app bind every interface', () => {
      const env = buildServerEnv({
        ...base,
        inherit: { HOST: '0.0.0.0', PORT: '3000', PATH: '/usr/bin' },
      });

      expect(env.HOST).toBeUndefined();
      expect(env.PORT).toBeUndefined();
      expect(env.ADMINIUM_HOST).toBe('127.0.0.1');
      // Unrelated keys are inherited — the child still needs a working process.
      expect(env.PATH).toBe('/usr/bin');
    });

    it('strips an inherited ADMINIUM_META_URL / _DSN (§2.1: always local SQLite)', () => {
      const env = buildServerEnv({
        ...base,
        inherit: {
          ADMINIUM_META_URL: 'postgres://prod.example.com/adminium',
          ADMINIUM_META_DSN: 'postgres://prod.example.com/adminium',
        },
      });

      expect(env.ADMINIUM_META_URL).toBeUndefined();
      expect(env.ADMINIUM_META_DSN).toBe(metaDsnForDataDir(DATA_DIR));
    });

    it('strips inherited secrets and tokens rather than letting them win', () => {
      const env = buildServerEnv({
        ...base,
        inherit: { ADMINIUM_SECRET: 'from-the-shell', ADMINIUM_BOOT_TOKEN: 'stale' },
      });

      expect(env.ADMINIUM_SECRET).toBe(SECRET);
      expect(env.ADMINIUM_BOOT_TOKEN).toBe(TOKEN);
    });

    it('forces ADMINIUM_TRUST_PROXY off, whatever the shell says (§8.3)', () => {
      // Nothing is ever in front of this child, so a forwarding header is never
      // legitimate — it is only ever a LAN peer's spelling of `request.ip`. With
      // it on, §8.3's "the audit log records their LAN IPs" records whatever the
      // peer typed, and its rate limiting is evaded by rotating the header.
      const env = buildServerEnv({
        ...base,
        host: '0.0.0.0',
        port: 4600,
        inherit: { ADMINIUM_TRUST_PROXY: '1' },
      });

      expect(env.ADMINIUM_TRUST_PROXY).toBe('off');
    });

    it('drops undefined values instead of stringifying them', () => {
      // `{ FOO: undefined }` reaching the child as the STRING "undefined" is a
      // classic way to make a Zod default silently not apply.
      const env = buildServerEnv({ ...base, inherit: { FOO: undefined } });
      expect('FOO' in env).toBe(false);
    });
  });

  describe('telemetry (§7)', () => {
    it('vetoes telemetry when the user has not opted in', () => {
      expect(buildServerEnv({ ...base }).ADMINIUM_DISABLE_TELEMETRY).toBe('1');
      expect(buildServerEnv({ ...base, telemetryOptIn: false }).ADMINIUM_DISABLE_TELEMETRY).toBe(
        '1',
      );
    });

    it('stays silent when the user HAS opted in, leaving the consent setting in charge', () => {
      // Opting in does not mean "report" — it means "let the server's own
      // consent answer decide". `ADMINIUM_TELEMETRY` is tri-state for this.
      const env = buildServerEnv({ ...base, telemetryOptIn: true });
      expect(env.ADMINIUM_DISABLE_TELEMETRY).toBeUndefined();
      expect(env.ADMINIUM_TELEMETRY).toBeUndefined();
    });
  });

  it('passes the log level and static root through when set', () => {
    const env = buildServerEnv({ ...base, logLevel: 'debug', staticRoot: '/app/resources/dash' });
    expect(env.ADMINIUM_LOG_LEVEL).toBe('debug');
    expect(env.ADMINIUM_STATIC_ROOT).toBe('/app/resources/dash');
  });

  describe('the demo seed script (§6 step 2 card 4, 11-T08)', () => {
    it('passes an absolute path through, and resolves a relative one', () => {
      // Absolute because the server `import()`s it: the child's cwd is not this
      // process's, so a relative specifier would resolve somewhere else entirely.
      const env = buildServerEnv({
        ...base,
        demoSeedScript: '/app/resources/demo/demo-seed.mjs',
      });
      expect(env.ADMINIUM_DEMO_SEED_SCRIPT).toBe('/app/resources/demo/demo-seed.mjs');
      expect(buildServerEnv({ ...base, demoSeedScript: 'resources/demo/demo-seed.mjs' })
        .ADMINIUM_DEMO_SEED_SCRIPT).toBe(resolve('resources/demo/demo-seed.mjs'));
    });

    it('omits the key entirely when no script is given', () => {
      // `compose.ts` gates the route on this key being present, so "absent" must
      // stay absent rather than arriving as the string "undefined".
      expect('ADMINIUM_DEMO_SEED_SCRIPT' in buildServerEnv({ ...base })).toBe(false);
    });

    it('strips an inherited value — the shell chooses which module the server imports', () => {
      // This variable names a file the server process EXECUTES. An inherited
      // value would let anything that can set an environment variable pick it.
      const env = buildServerEnv({
        ...base,
        inherit: { ADMINIUM_DEMO_SEED_SCRIPT: '/tmp/evil.mjs' },
      });
      expect('ADMINIUM_DEMO_SEED_SCRIPT' in env).toBe(false);
    });
  });

  describe('the bundled add-on set (32-T11)', () => {
    const withTempDir = (run: (dir: string) => void): void => {
      const dir = mkdtempSync(join(tmpdir(), 'adminium-add-ons-bundle-'));
      try {
        run(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    it('points ADMINIUM_BUNDLED_ADD_ONS at the bundle when the directory exists', () => {
      withTempDir((dir) => {
        const env = buildServerEnv({ ...base, bundledAddOnsDir: dir });
        expect(env.ADMINIUM_BUNDLED_ADD_ONS).toBe(resolve(dir));
      });
    });

    it('emits nothing when the directory does not exist — dev runs ship no bundle', () => {
      // The shipped app passes the path unconditionally (like the demo seed);
      // dev checkouts have never run the release fetch, so the honest env block
      // simply has no opinion and the server's own CWD default stands.
      withTempDir((dir) => {
        const env = buildServerEnv({ ...base, bundledAddOnsDir: join(dir, 'never-fetched') });
        expect('ADMINIUM_BUNDLED_ADD_ONS' in env).toBe(false);
      });
    });

    it('emits nothing when a FILE sits where the directory should be', () => {
      withTempDir((dir) => {
        const file = join(dir, 'add-ons-bundle');
        writeFileSync(file, 'not a directory');
        const env = buildServerEnv({ ...base, bundledAddOnsDir: file });
        expect('ADMINIUM_BUNDLED_ADD_ONS' in env).toBe(false);
      });
    });

    it('omits the key entirely when no bundle dir is given', () => {
      expect('ADMINIUM_BUNDLED_ADD_ONS' in buildServerEnv({ ...base })).toBe(false);
    });

    it('strips an inherited value — the shell chooses which packages seed the store', () => {
      // The server seeds its add-on store from every tarball in this directory,
      // verified against sidecars in the SAME directory — so an inherited value
      // is an attacker choosing a whole set of packages to install at boot.
      const env = buildServerEnv({
        ...base,
        inherit: { ADMINIUM_BUNDLED_ADD_ONS: '/tmp/evil-bundle' },
      });
      expect('ADMINIUM_BUNDLED_ADD_ONS' in env).toBe(false);
    });

    it('lets a real bundle dir survive the whole chain to the child process env', () => {
      // Same seam the demo-seed chain test guards: compose.ts reads
      // process.env.ADMINIUM_BUNDLED_ADD_ONS directly, and the child's
      // process.env IS the built block, carried through toServerEnvRecord by
      // inheritance. A dropped key here costs the packaged app its bundled set
      // while both ends' suites stay green.
      withTempDir((dir) => {
        const built = buildServerEnv({ ...base, bundledAddOnsDir: dir });
        const record = toServerEnvRecord(parseDesktopServerEnv(built), built);
        expect(record.ADMINIUM_BUNDLED_ADD_ONS).toBe(resolve(dir));
      });
    });
  });

  it('rejects a relative dataDir', () => {
    expect(() => buildServerEnv({ ...base, dataDir: './data' })).toThrow(/absolute/);
  });

  it('rejects a truncated boot token before the child ever sees it', () => {
    expect(() => buildServerEnv({ ...base, bootToken: 'abc' })).toThrow(/hex characters/);
  });

  describe('the §5 singleUser mirror', () => {
    it('always states an answer, because "off" and "absent" are different instructions', () => {
      expect(buildServerEnv({ ...base, singleUser: true }).ADMINIUM_DESKTOP_SINGLE_USER).toBe('on');
      // NOT undefined: `compose.ts` gates the mirror on the key being DEFINED,
      // so an omitted "off" would leave the stored setting standing rather than
      // turning auto-login off.
      expect(buildServerEnv({ ...base, singleUser: false }).ADMINIUM_DESKTOP_SINGLE_USER).toBe(
        'off',
      );
    });

    it('does not let an inherited value decide whether a password is required', () => {
      const env = buildServerEnv({
        ...base,
        singleUser: false,
        inherit: { ADMINIUM_DESKTOP_SINGLE_USER: 'on' },
      });
      expect(env.ADMINIUM_DESKTOP_SINGLE_USER).toBe('off');
    });
  });
});

/**
 * THE SEAM. Everything above asserts what this side of the fork emits; the
 * server's suite asserts what the route does with a hand-written env. Neither
 * crosses, and the gap between them is where §5 died once already: the shell
 * emitted no `ADMINIUM_DESKTOP_SINGLE_USER` at all, `compose.ts`'s
 * `!== undefined` guard was therefore never true, the mirror never ran,
 * `adminium_settings.desktop.singleUser` kept the registry default `false`, and
 * every desktop launch with "Skip login on this computer" ticked landed on the
 * login form via a 403 `DESKTOP_AUTOLOGIN_DISABLED`. Both suites stayed green.
 *
 * So this one runs the REAL chain — `buildServerEnv` (parent) →
 * `parseDesktopServerEnv` + `toServerEnvRecord` (child, `src/server/index.ts`)
 * → `@adminium/server`'s own `envSchema` (what `compose.ts` reads) — and asserts
 * the value that arrives at the far end. A rename, a dropped key or a spelling
 * the server's BOOLEANISH enum does not accept fails HERE, in the package that
 * made the promise.
 */
describe('the desktop → server env chain, end to end', () => {
  const throughTheChain = (singleUser: boolean): unknown => {
    // Exactly what `bootDesktopServer` does, in the order it does it: the built
    // block IS the child's `process.env`, so it is also the `inherit` argument.
    const built = buildServerEnv({ ...base, singleUser });
    const desktop = parseDesktopServerEnv(built);
    return envSchema.parse(toServerEnvRecord(desktop, built)).ADMINIUM_DESKTOP_SINGLE_USER;
  };

  it('delivers singleUser: true to compose.ts as the boolean the mirror writes', () => {
    // `!== undefined` is compose.ts's gate; `true` is what it mirrors into
    // `adminium_settings.desktop.singleUser`, which is gate 3 of the §5 route.
    expect(throughTheChain(true)).toBe(true);
  });

  it('delivers singleUser: false — a mirror that runs and writes "off"', () => {
    // The distinction that matters: `false`, not `undefined`. Turning
    // "Require login on this device" ON must actively write the setting, or a
    // previously-true mirror would stand and the toggle would do nothing.
    expect(throughTheChain(false)).toBe(false);
  });

  it('delivers the demo seed script path to compose.ts (11-T08)', () => {
    // The same failure mode this describe block exists for: `compose.ts` gates
    // the demo route on `ADMINIUM_DEMO_SEED_SCRIPT !== undefined`, so a key that
    // is dropped anywhere along the chain costs §6's fourth card its route while
    // both ends' own suites stay green. `toServerEnvRecord` carries it through
    // by inheritance rather than naming it — which is exactly the kind of thing
    // that works until someone stops spreading `inherit`.
    const script = '/app/resources/demo/demo-seed.mjs';
    const built = buildServerEnv({ ...base, demoSeedScript: script });
    const desktop = parseDesktopServerEnv(built);
    const parsed = envSchema.parse(toServerEnvRecord(desktop, built));

    expect(parsed.ADMINIUM_DEMO_SEED_SCRIPT).toBe(script);
    // Both halves of compose's AND, at the far end of the real chain.
    expect(parsed.ADMINIUM_RUNTIME).toBe('desktop');
  });

  it('leaves compose.ts with no demo route when the shell names no script', () => {
    const built = buildServerEnv({ ...base });
    const parsed = envSchema.parse(toServerEnvRecord(parseDesktopServerEnv(built), built));
    expect(parsed.ADMINIUM_DEMO_SEED_SCRIPT).toBeUndefined();
  });

  it('delivers trustProxy: false to the real server schema while sharing on the LAN (§8.3)', () => {
    // THE POINT OF THIS TEST is the far end. `buildServerEnv` setting the key
    // proves nothing on its own — `toServerEnvRecord` carries it by SPREADING
    // `inherit` rather than naming it, so the value only survives as long as
    // nobody stops doing that. What §8.3's audit-log promise actually rests on
    // is `Env.ADMINIUM_TRUST_PROXY` being `false` at the end of the real chain,
    // because that is what makes Fastify's `request.ip` the kernel's answer
    // instead of a LAN peer's `X-Forwarded-For`.
    const built = buildServerEnv({
      ...base,
      host: '0.0.0.0',
      port: 4600,
      inherit: { ADMINIUM_TRUST_PROXY: '1' },
    });
    const parsed = envSchema.parse(toServerEnvRecord(parseDesktopServerEnv(built), built));

    expect(parsed.ADMINIUM_TRUST_PROXY).toBe(false);
    expect(parsed.HOST).toBe('0.0.0.0');
  });
});

describe('parseDesktopServerEnv', () => {
  it('round-trips what buildServerEnv produced', () => {
    const parsed = parseDesktopServerEnv(buildServerEnv({ ...base }));

    expect(parsed).toEqual({
      host: LOOPBACK_HOST,
      port: 0,
      dataDir: DATA_DIR,
      metaDsn: metaDsnForDataDir(DATA_DIR),
      secret: SECRET,
      bootToken: TOKEN,
      telemetryDisabled: true,
      logLevel: 'info',
      staticRoot: undefined,
    });
  });

  it('accepts port 0 — the whole reason this schema is not the server schema', () => {
    // `@adminium/server`'s own PORT is `min(1)`; §2.1 requires 0.
    expect(parseDesktopServerEnv(buildServerEnv({ ...base })).port).toBe(0);
  });

  it('defaults the meta DSN to <dataDir>/meta.db when absent (§2.1 is unconditional)', () => {
    const env = buildServerEnv({ ...base });
    delete env.ADMINIUM_META_DSN;
    expect(parseDesktopServerEnv(env).metaDsn).toBe(metaDsnForDataDir(DATA_DIR));
  });

  it.each([
    ['a non-desktop runtime', { ADMINIUM_RUNTIME: 'self-host' }],
    ['a short secret', { ADMINIUM_SECRET: 'tiny' }],
    ['a non-hex boot token', { ADMINIUM_BOOT_TOKEN: 'z'.repeat(BOOT_TOKEN_HEX_LENGTH) }],
    ['a truncated boot token', { ADMINIUM_BOOT_TOKEN: 'ab' }],
    ['a port above 65535', { ADMINIUM_PORT: '70000' }],
    ['a negative port', { ADMINIUM_PORT: '-1' }],
    ['an unknown log level', { ADMINIUM_LOG_LEVEL: 'chatty' }],
  ])('rejects %s', (_label, patch) => {
    const env = { ...buildServerEnv({ ...base }), ...patch };
    expect(() => parseDesktopServerEnv(env)).toThrow(DesktopServerEnvError);
  });

  it('rejects a missing data dir', () => {
    const env = buildServerEnv({ ...base });
    delete env.ADMINIUM_DATA_DIR;
    expect(() => parseDesktopServerEnv(env)).toThrow(DesktopServerEnvError);
  });

  it('lists every problem at once, naming the variables', () => {
    let caught: DesktopServerEnvError | null = null;
    try {
      parseDesktopServerEnv({ ADMINIUM_RUNTIME: 'desktop', ADMINIUM_DATA_DIR: DATA_DIR });
    } catch (error) {
      caught = error as DesktopServerEnvError;
    }

    expect(caught).toBeInstanceOf(DesktopServerEnvError);
    expect(caught?.issues.join('\n')).toContain('ADMINIUM_SECRET');
    expect(caught?.issues.join('\n')).toContain('ADMINIUM_BOOT_TOKEN');
  });
});

describe('toServerEnvRecord', () => {
  const desktop = () => parseDesktopServerEnv(buildServerEnv({ ...base }));

  it('translates the §2.2 names onto the server schema names', () => {
    const record = toServerEnvRecord(desktop(), {});

    expect(record.HOST).toBe('127.0.0.1');
    expect(record.ADMINIUM_META_URL).toBe(metaDsnForDataDir(DATA_DIR));
    expect(record.ADMINIUM_DATA_DIR).toBe(DATA_DIR);
    expect(record.ADMINIUM_SECRET).toBe(SECRET);
  });

  it('OMITS PORT when the port is ephemeral', () => {
    // The server's schema is `min(1)`; emitting PORT=0 would fail the boot at
    // stage "env" complaining about a port the user never chose. The entry hands
    // the real 0 to `app.listen` instead.
    const record = toServerEnvRecord(desktop(), { PORT: '9999' });
    expect(record.PORT).toBeUndefined();
  });

  it('emits PORT when the port is fixed, so env and socket agree (§8.3)', () => {
    const lan = parseDesktopServerEnv(buildServerEnv({ ...base, host: '0.0.0.0', port: 4600 }));
    const record = toServerEnvRecord(lan, {});

    expect(record.PORT).toBe('4600');
    expect(record.HOST).toBe('0.0.0.0');
  });

  it('turns the desktop telemetry veto into the server tri-state OFF', () => {
    expect(toServerEnvRecord(desktop(), {}).ADMINIUM_TELEMETRY).toBe('off');
  });

  it('deletes an inherited ADMINIUM_TELEMETRY when the user opted in', () => {
    // Opted in ⇒ the in-app consent setting governs, so `undefined` must survive
    // — a stale `on`/`off` here would silently override the user's answer.
    const optedIn = parseDesktopServerEnv(buildServerEnv({ ...base, telemetryOptIn: true }));
    const record = toServerEnvRecord(optedIn, { ADMINIUM_TELEMETRY: 'on' });

    expect(record.ADMINIUM_TELEMETRY).toBeUndefined();
  });
});
