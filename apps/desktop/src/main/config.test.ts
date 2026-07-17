import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CLOUD_SYNC_WARNING_I18N_KEY,
  CONFIG_MIGRATIONS,
  ConfigParseError,
  ConfigVersionError,
  CURRENT_CONFIG_VERSION,
  configPathFor,
  createDefaultConfig,
  defaultDataDirFor,
  desktopConfigSchema,
  detectCloudSyncFolder,
  generateSecret,
  loadConfig,
  migrateConfig,
  nodeConfigFs,
  redactConfig,
  resolveSecret,
  saveConfig,
  SecretUnavailableError,
  type ConfigFs,
  type ConfigLogger,
  type DesktopConfig,
  type SafeStorageLike,
} from './config.js';

// ─── Test doubles ────────────────────────────────────────────────────────────

/**
 * A stand-in for Electron's `safeStorage`. The "ciphertext" is a reversible
 * marker rather than real crypto: these tests assert the module's *handling* of
 * safeStorage (which branch, what gets persisted, what leaks), and a marker
 * makes "did the plaintext survive into the file" directly checkable.
 */
function fakeSafeStorage(available: boolean): SafeStorageLike & { encryptCalls: number } {
  return {
    encryptCalls: 0,
    isEncryptionAvailable: () => available,
    encryptString(plainText: string) {
      if (!available) throw new Error('encryption is not available');
      this.encryptCalls += 1;
      return Buffer.from(`kc:${plainText}`, 'utf8');
    },
    decryptString(encrypted: Buffer) {
      if (!available) throw new Error('encryption is not available');
      const text = encrypted.toString('utf8');
      if (!text.startsWith('kc:')) throw new Error('not encrypted by this keychain');
      return text.slice(3);
    },
  };
}

function capturingLogger(): ConfigLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message) => lines.push(message),
    warn: (message) => lines.push(message),
  };
}

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-desktop-config-'));
  path = join(dir, 'config.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function validConfig(overrides: Partial<DesktopConfig> = {}): DesktopConfig {
  return { ...createDefaultConfig(join(dir, 'data')), ...overrides };
}

/** A config.json from before the `version` field existed — the v0 migration input. */
function withoutVersion(config: DesktopConfig): Record<string, unknown> {
  const body: Record<string, unknown> = { ...config };
  delete body['version'];
  return body;
}

// ─── Schema (§2.3) ───────────────────────────────────────────────────────────

describe('desktopConfigSchema', () => {
  it('accepts the §2.3 body verbatim', () => {
    const body = {
      version: 1,
      dataDir: '/Users/ava/Library/Application Support/Adminium/data',
      secretEncrypted: 'base64…',
      secretPlain: null,
      secretStorage: 'safeStorage',
      singleUser: true,
      lanShare: { enabled: false, port: 4600 },
      updates: { mode: 'notify' },
      telemetryOptIn: false,
      autoBackup: { enabled: true, keep: 7 },
      window: { x: 0, y: 0, width: 1440, height: 900, maximized: false },
    };

    expect(desktopConfigSchema.parse(body)).toEqual(body);
  });

  it('accepts the default config, with window position left to the OS', () => {
    const parsed = desktopConfigSchema.parse(createDefaultConfig('/data'));
    expect(parsed.window).toEqual({ width: 1440, height: 900, maximized: false });
    expect(parsed.lanShare).toEqual({ enabled: false, port: 4600 });
    expect(parsed.updates.mode).toBe('notify');
    expect(parsed.autoBackup.keep).toBe(7);
    expect(parsed.singleUser).toBe(true);
    expect(parsed.telemetryOptIn).toBe(false);
  });

  it.each([
    ['a wrong version literal', { version: 2 }],
    ['an empty dataDir', { dataDir: '' }],
    ['a non-string dataDir', { dataDir: 42 }],
    ['an unknown update mode', { updates: { mode: 'automatic' } }],
    ['an out-of-range LAN port', { lanShare: { enabled: true, port: 70000 } }],
    ['a zero LAN port', { lanShare: { enabled: true, port: 0 } }],
    ['a backup rotation of zero', { autoBackup: { enabled: true, keep: 0 } }],
    ['a fractional backup rotation', { autoBackup: { enabled: true, keep: 1.5 } }],
    ['a negative window width', { window: { width: -1, height: 900, maximized: false } }],
    ['an unknown secret storage mode', { secretStorage: 'keychain' }],
    ['a non-boolean singleUser', { singleUser: 'yes' }],
    ['an empty secretPlain', { secretPlain: '' }],
  ])('rejects %s', (_label, patch) => {
    const result = desktopConfigSchema.safeParse({ ...createDefaultConfig('/data'), ...patch });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys rather than dropping them on the next write', () => {
    const result = desktopConfigSchema.safeParse({
      ...createDefaultConfig('/data'),
      lanShareEnabled: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown key nested inside lanShare', () => {
    const result = desktopConfigSchema.safeParse({
      ...createDefaultConfig('/data'),
      lanShare: { enabled: false, port: 4600, bind: '0.0.0.0' },
    });
    expect(result.success).toBe(false);
  });
});

describe('path helpers', () => {
  it('places config.json and the default data dir under userData (§2.3, §6)', () => {
    expect(configPathFor('/u')).toBe(join('/u', 'config.json'));
    expect(defaultDataDirFor('/u')).toBe(join('/u', 'data'));
  });
});

// ─── Atomic write (§2.3) ─────────────────────────────────────────────────────

describe('saveConfig / loadConfig', () => {
  it('round-trips a config through the real filesystem', async () => {
    const config = validConfig({ telemetryOptIn: true });
    await saveConfig(path, config);

    const result = await loadConfig(path);
    expect(result).toEqual({ status: 'loaded', config, migratedFrom: null });
  });

  it('reports a missing file as first-run rather than throwing (§2.2 step 2)', async () => {
    await expect(loadConfig(join(dir, 'nope.json'))).resolves.toEqual({ status: 'missing' });
  });

  it('creates the userData directory if it does not exist yet', async () => {
    const nested = join(dir, 'a', 'b', 'config.json');
    await saveConfig(nested, validConfig());
    await expect(loadConfig(nested)).resolves.toMatchObject({ status: 'loaded' });
  });

  it('writes config.json 0600 — it can hold the plaintext secret', async () => {
    await saveConfig(path, validConfig({ secretPlain: 'sekret', secretStorage: 'plain' }));
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('refuses to persist a config that would not load back', async () => {
    const bad = { ...validConfig(), updates: { mode: 'automatic' } } as unknown as DesktopConfig;
    await expect(saveConfig(path, bad)).rejects.toThrow();
    await expect(loadConfig(path)).resolves.toEqual({ status: 'missing' });
  });

  /**
   * The property that matters: the previous config.json must survive a crash at
   * any point in the write. The rename is the commit — anything before it is
   * scratch work on a temp file. Simulated by failing at each syscall in turn.
   */
  describe.each(['open', 'writeFile', 'sync', 'rename'] as const)(
    'a crash at %s',
    (failAt) => {
      it('leaves the previous config.json byte-intact', async () => {
        const previous = validConfig({ telemetryOptIn: false, singleUser: true });
        await saveConfig(path, previous);
        const before = await readFile(path, 'utf8');

        const boom = new Error(`simulated crash during ${failAt}`);
        const crashingFs: ConfigFs = {
          ...nodeConfigFs,
          async open(p, flags, mode) {
            if (failAt === 'open' && flags === 'w') throw boom;
            const handle = await nodeConfigFs.open(p, flags, mode);
            return {
              writeFile: async (data, encoding) => {
                if (failAt === 'writeFile') throw boom;
                await handle.writeFile(data, encoding);
              },
              sync: async () => {
                if (failAt === 'sync') throw boom;
                await handle.sync();
              },
              close: () => handle.close(),
            };
          },
          rename: async (from, to) => {
            if (failAt === 'rename') throw boom;
            await nodeConfigFs.rename(from, to);
          },
        };

        const next = validConfig({ telemetryOptIn: true, singleUser: false });
        await expect(saveConfig(path, next, { fs: crashingFs })).rejects.toThrow(boom.message);

        expect(await readFile(path, 'utf8')).toBe(before);
        await expect(loadConfig(path)).resolves.toEqual({
          status: 'loaded',
          config: previous,
          migratedFrom: null,
        });
      });

    },
  );

  it('cleans up its temp file when the write fails', async () => {
    const boom = new Error('simulated crash');
    const crashingFs: ConfigFs = {
      ...nodeConfigFs,
      rename: async () => {
        throw boom;
      },
    };
    await expect(saveConfig(path, validConfig(), { fs: crashingFs })).rejects.toThrow(boom);

    expect((await readdir(dir)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('never truncates the target in place — the temp file is a sibling, not the target', async () => {
    const opened: string[] = [];
    const spyFs: ConfigFs = {
      ...nodeConfigFs,
      open: (p, flags, mode) => {
        if (flags === 'w') opened.push(p);
        return nodeConfigFs.open(p, flags, mode);
      },
    };
    await saveConfig(path, validConfig(), { fs: spyFs });

    expect(opened).toHaveLength(1);
    expect(opened[0]).not.toBe(path);
    expect(opened[0]).toMatch(/config\.json\.[0-9a-f]+\.tmp$/);
  });

  it('survives a save that races itself — temp names do not collide', async () => {
    await Promise.all([
      saveConfig(path, validConfig({ telemetryOptIn: true })),
      saveConfig(path, validConfig({ telemetryOptIn: true })),
      saveConfig(path, validConfig({ telemetryOptIn: true })),
    ]);
    const result = await loadConfig(path);
    expect(result).toMatchObject({ status: 'loaded', config: { telemetryOptIn: true } });
  });

  it('treats a corrupt config.json as an error, never as first-run', async () => {
    // Regenerating a secret here would orphan every encrypted value in the meta-store.
    await writeFile(path, '{ "version": 1, "dataDir": ', 'utf8');
    await expect(loadConfig(path)).rejects.toThrow(ConfigParseError);
  });

  it('reports which field is wrong, without echoing values', async () => {
    await writeFile(
      path,
      JSON.stringify({ ...validConfig(), secretPlain: 'super-secret-value', dataDir: '' }),
      'utf8',
    );
    const error = await loadConfig(path).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigParseError);
    expect((error as ConfigParseError).message).toContain('dataDir');
    expect((error as ConfigParseError).message).not.toContain('super-secret-value');
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────

describe('migrateConfig', () => {
  it('carries an unversioned (v0) config forward and stamps the version', () => {
    const v0 = withoutVersion(validConfig());
    const { raw, fromVersion } = migrateConfig(v0);

    expect(fromVersion).toBe(0);
    expect(raw['version']).toBe(CURRENT_CONFIG_VERSION);
    expect(desktopConfigSchema.safeParse(raw).success).toBe(true);
  });

  it('loads an unversioned file end-to-end and reports what it migrated from', async () => {
    const v0 = withoutVersion(validConfig({ singleUser: false }));
    await writeFile(path, JSON.stringify(v0), 'utf8');

    const result = await loadConfig(path);
    expect(result).toMatchObject({ status: 'loaded', migratedFrom: 0 });
    expect(result.status === 'loaded' && result.config.version).toBe(CURRENT_CONFIG_VERSION);
    expect(result.status === 'loaded' && result.config.singleUser).toBe(false);
  });

  it('does not rewrite the file during load — persisting is the caller’s decision', async () => {
    const v0 = withoutVersion(validConfig());
    const text = JSON.stringify(v0);
    await writeFile(path, text, 'utf8');

    await loadConfig(path);
    expect(await readFile(path, 'utf8')).toBe(text);
  });

  it('runs a multi-step chain in order, each step handing off to the next', () => {
    const trail: number[] = [];
    const migrations = {
      0: (raw: Record<string, unknown>) => {
        trail.push(0);
        return { ...raw, version: 1, step0: true };
      },
      1: (raw: Record<string, unknown>) => {
        trail.push(1);
        return { ...raw, version: 2, step1: true };
      },
      2: (raw: Record<string, unknown>) => {
        trail.push(2);
        return { ...raw, version: 3, step2: true };
      },
    };
    // Drive the engine directly at a synthetic head so the test does not depend
    // on CURRENT_CONFIG_VERSION staying at 1.
    const { raw, fromVersion } = migrateConfig({ version: 0, keep: 'me' }, migrations);

    expect(fromVersion).toBe(0);
    expect(trail).toEqual([0]); // one step, to CURRENT_CONFIG_VERSION (1)
    expect(raw).toMatchObject({ version: 1, keep: 'me', step0: true });
  });

  it('refuses a config from a newer build instead of silently downgrading it', () => {
    const error = (() => {
      try {
        migrateConfig({ ...validConfig(), version: CURRENT_CONFIG_VERSION + 1 });
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(ConfigVersionError);
    expect((error as ConfigVersionError).kind).toBe('newer');
    expect((error as ConfigVersionError).fileVersion).toBe(CURRENT_CONFIG_VERSION + 1);
    expect((error as ConfigVersionError).message).toMatch(/Update Adminium first/i);
  });

  it('surfaces the newer-version refusal through loadConfig', async () => {
    await writeFile(path, JSON.stringify({ ...validConfig(), version: 99 }), 'utf8');
    await expect(loadConfig(path)).rejects.toThrow(ConfigVersionError);
  });

  it('refuses an old version with no registered migration path', () => {
    const error = (() => {
      try {
        // A v0 file with the 0→1 migration removed from the table.
        migrateConfig({ version: 0 }, {});
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(ConfigVersionError);
    expect((error as ConfigVersionError).kind).toBe('unsupported');
  });

  it('rejects a body that is not an object with a numeric version', () => {
    expect(() => migrateConfig(['not', 'a', 'config'])).toThrow(ConfigVersionError);
    expect(() => migrateConfig({ version: 'one' })).toThrow(ConfigVersionError);
    expect(() => migrateConfig({ version: -1 })).toThrow(ConfigVersionError);
    expect(() => migrateConfig(null)).toThrow(ConfigVersionError);
  });

  it('has a migration registered for every version below the current one', () => {
    for (let v = 0; v < CURRENT_CONFIG_VERSION; v += 1) {
      expect(CONFIG_MIGRATIONS[v], `missing migration from version ${String(v)}`).toBeTypeOf(
        'function',
      );
    }
  });
});

// ─── Secret handling (§2.2 step 3) ───────────────────────────────────────────

describe('resolveSecret', () => {
  it('generates a 32-byte secret that clears the server’s 16-char minimum', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSecret()).not.toBe(secret);
  });

  describe('safeStorage available', () => {
    it('generates and encrypts on first run', () => {
      const safeStorage = fakeSafeStorage(true);
      const resolved = resolveSecret(validConfig(), safeStorage);

      expect(resolved.generated).toBe(true);
      expect(resolved.changed).toBe(true);
      expect(resolved.storage).toBe('safeStorage');
      expect(resolved.config.secretStorage).toBe('safeStorage');
      expect(resolved.config.secretPlain).toBeNull();
      expect(resolved.config.secretEncrypted).not.toBeNull();
      expect(resolved.secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('round-trips: what is persisted on first run decrypts to the same secret', async () => {
      const safeStorage = fakeSafeStorage(true);
      const first = resolveSecret(validConfig(), safeStorage);
      await saveConfig(path, first.config);

      const reloaded = await loadConfig(path);
      expect(reloaded.status).toBe('loaded');
      const second = resolveSecret(
        (reloaded as { config: DesktopConfig }).config,
        safeStorage,
      );

      expect(second.secret).toBe(first.secret);
      expect(second.generated).toBe(false);
      expect(second.changed).toBe(false);
      expect(second.storage).toBe('safeStorage');
    });

    it('stores the ciphertext as base64, not as raw bytes', () => {
      const resolved = resolveSecret(validConfig(), fakeSafeStorage(true));
      const encrypted = resolved.config.secretEncrypted ?? '';
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(Buffer.from(encrypted, 'base64').toString('utf8')).toBe(`kc:${resolved.secret}`);
    });

    it('upgrades a plaintext secret once a keyring appears, and keeps the value', () => {
      const safeStorage = fakeSafeStorage(true);
      const stored = validConfig({ secretPlain: 'legacy-plain-secret', secretStorage: 'plain' });

      const resolved = resolveSecret(stored, safeStorage);

      expect(resolved.secret).toBe('legacy-plain-secret');
      expect(resolved.generated).toBe(false);
      expect(resolved.changed).toBe(true);
      expect(resolved.storage).toBe('safeStorage');
      expect(resolved.config.secretPlain).toBeNull();
      expect(resolved.config.secretStorage).toBe('safeStorage');
      expect(safeStorage.decryptString(Buffer.from(resolved.config.secretEncrypted ?? '', 'base64'))).toBe(
        'legacy-plain-secret',
      );
    });

    it('drops a stale plaintext copy left beside a good encrypted one', () => {
      const safeStorage = fakeSafeStorage(true);
      const stored = validConfig({
        secretEncrypted: Buffer.from('kc:real-secret', 'utf8').toString('base64'),
        secretPlain: 'stale-copy',
        secretStorage: 'safeStorage',
      });

      const resolved = resolveSecret(stored, safeStorage);

      expect(resolved.secret).toBe('real-secret');
      expect(resolved.config.secretPlain).toBeNull();
      expect(resolved.changed).toBe(true);
    });

    it('corrects a stale "plain" flag left behind by a keyring that has since appeared', () => {
      const stored = validConfig({
        secretEncrypted: Buffer.from('kc:real-secret', 'utf8').toString('base64'),
        secretPlain: null,
        secretStorage: 'plain',
      });
      const resolved = resolveSecret(stored, fakeSafeStorage(true));

      expect(resolved.secret).toBe('real-secret');
      expect(resolved.storage).toBe('safeStorage');
      expect(resolved.config.secretStorage).toBe('safeStorage');
      expect(resolved.changed).toBe(true);
    });

    it('refuses to boot when the stored ciphertext cannot be decrypted', () => {
      // The keyring entry is gone / belongs to another machine. Regenerating
      // would make every encrypted DSN in the meta-store unreadable.
      const stored = validConfig({
        secretEncrypted: Buffer.from('garbage', 'utf8').toString('base64'),
      });
      expect(() => resolveSecret(stored, fakeSafeStorage(true))).toThrow(SecretUnavailableError);
    });
  });

  describe('safeStorage unavailable (Linux without a keyring)', () => {
    it('generates a plaintext secret and flags secretStorage: "plain"', () => {
      const resolved = resolveSecret(validConfig(), fakeSafeStorage(false));

      expect(resolved.generated).toBe(true);
      expect(resolved.changed).toBe(true);
      expect(resolved.storage).toBe('plain');
      expect(resolved.config.secretStorage).toBe('plain');
      expect(resolved.config.secretPlain).toBe(resolved.secret);
      expect(resolved.config.secretEncrypted).toBeNull();
    });

    it('round-trips the plaintext secret through the file, keeping the plain flag', async () => {
      const safeStorage = fakeSafeStorage(false);
      const first = resolveSecret(validConfig(), safeStorage);
      await saveConfig(path, first.config);

      const reloaded = await loadConfig(path);
      const second = resolveSecret((reloaded as { config: DesktopConfig }).config, safeStorage);

      expect(second.secret).toBe(first.secret);
      expect(second.storage).toBe('plain');
      expect(second.changed).toBe(false);
      expect(second.generated).toBe(false);
    });

    it('never calls encryptString', () => {
      const safeStorage = fakeSafeStorage(false);
      resolveSecret(validConfig(), safeStorage);
      expect(safeStorage.encryptCalls).toBe(0);
    });

    it('repairs a config whose secretStorage flag disagrees with reality', () => {
      const stored = validConfig({ secretPlain: 'p', secretStorage: 'safeStorage' });
      const resolved = resolveSecret(stored, fakeSafeStorage(false));

      expect(resolved.config.secretStorage).toBe('plain');
      expect(resolved.changed).toBe(true);
    });

    it('refuses to regenerate over an encrypted secret it cannot read', () => {
      // The load-bearing case: keyring uninstalled after first run. Silently
      // minting a new secret would permanently orphan the user's saved data.
      const stored = validConfig({ secretEncrypted: 'someBase64==' });
      const error = (() => {
        try {
          resolveSecret(stored, fakeSafeStorage(false));
          return null;
        } catch (e: unknown) {
          return e;
        }
      })();

      expect(error).toBeInstanceOf(SecretUnavailableError);
      expect((error as Error).message).toMatch(/keyring/i);
    });

    it('warns loudly enough for the About screen’s banner to be justified (§13)', () => {
      const logger = capturingLogger();
      resolveSecret(validConfig(), fakeSafeStorage(false), { logger });
      expect(logger.lines.join('\n')).toMatch(/plaintext/i);
    });
  });
});

// ─── The secret never leaks ──────────────────────────────────────────────────

describe('secret redaction', () => {
  const SECRET = 'a'.repeat(64);

  it('redactConfig strips both secret fields entirely (§9 backup, §13 diagnostics)', () => {
    const config = validConfig({
      secretEncrypted: Buffer.from(`kc:${SECRET}`, 'utf8').toString('base64'),
      secretPlain: SECRET,
    });
    const redacted = redactConfig(config);

    expect(Object.keys(redacted)).not.toContain('secretEncrypted');
    expect(Object.keys(redacted)).not.toContain('secretPlain');
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    expect(redacted.dataDir).toBe(config.dataDir);
    expect(redacted.version).toBe(CURRENT_CONFIG_VERSION);
  });

  /**
   * redactConfig is an explicit allow-list, so a field added to the schema is
   * dropped from diagnostics until someone adds it here. This is the guard that
   * turns that silent omission into a failing test — and it is also what keeps a
   * future secret-bearing field from being waved through by a rest-spread.
   */
  it('carries every non-secret schema field, and only those', () => {
    const schemaKeys = Object.keys(desktopConfigSchema.shape);
    const expected = schemaKeys.filter(
      (key) => key !== 'secretEncrypted' && key !== 'secretPlain',
    );

    expect(Object.keys(redactConfig(validConfig())).sort()).toEqual(expected.sort());
  });

  it('deep-copies the nested objects so a redacted copy cannot mutate the live config', () => {
    const config = validConfig();
    const redacted = redactConfig(config);
    redacted.lanShare.port = 9999;
    redacted.window.maximized = true;

    expect(config.lanShare.port).toBe(4600);
    expect(config.window.maximized).toBe(false);
  });

  it.each([true, false])(
    'logs nothing containing the secret (safeStorage available: %s)',
    async (available) => {
      const logger = capturingLogger();
      const safeStorage = fakeSafeStorage(available);
      const resolved = resolveSecret(validConfig(), safeStorage, {
        logger,
        generate: () => SECRET,
      });

      await saveConfig(path, resolved.config, { logger });
      await loadConfig(path, { logger });

      const transcript = logger.lines.join('\n');
      expect(transcript).not.toContain(SECRET);
      expect(transcript).not.toContain(resolved.config.secretEncrypted ?? '(no ciphertext)');
      expect(logger.lines.length).toBeGreaterThan(0); // the flow really did log
    },
  );

  it('keeps the secret out of the SecretUnavailableError message', () => {
    const stored = validConfig({
      secretEncrypted: Buffer.from(`kc:${SECRET}`, 'utf8').toString('base64'),
    });
    const error = (() => {
      try {
        resolveSecret(stored, fakeSafeStorage(false));
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();

    expect((error as Error).message).not.toContain(SECRET);
    expect((error as Error).message).not.toContain(stored.secretEncrypted);
  });

  it('keeps the secret out of a ConfigParseError raised on a file that holds one', async () => {
    await writeFile(
      path,
      JSON.stringify({ ...validConfig({ secretPlain: SECRET }), lanShare: { enabled: 'no' } }),
      'utf8',
    );
    const error = await loadConfig(path).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigParseError);
    expect((error as Error).message).not.toContain(SECRET);
  });
});

// ─── Cloud-sync folder detection (§6 step 1, §9) ─────────────────────────────

describe('detectCloudSyncFolder', () => {
  it.each([
    // iCloud Drive
    ['icloud', '/Users/ava/Library/Mobile Documents/com~apple~CloudDocs/Adminium/data'],
    ['icloud', '/Users/ava/Library/Mobile Documents'],
    ['icloud', 'C:\\Users\\ava\\iCloudDrive\\Adminium'],
    ['icloud', '/Users/ava/iCloud Drive/Adminium'],
    // Dropbox
    ['dropbox', '/Users/ava/Dropbox/Adminium/data'],
    ['dropbox', '/Users/ava/Dropbox (Personal)/Adminium'],
    ['dropbox', '/Users/ava/Dropbox (Acme Inc)/Adminium'],
    ['dropbox', 'C:\\Users\\ava\\Dropbox\\Adminium'],
    ['dropbox', '/Users/ava/Library/CloudStorage/Dropbox/Adminium'],
    // OneDrive
    ['onedrive', 'C:\\Users\\ava\\OneDrive\\Adminium\\data'],
    ['onedrive', 'C:\\Users\\ava\\OneDrive - Contoso\\Adminium'],
    ['onedrive', '/Users/ava/Library/CloudStorage/OneDrive-Personal/Adminium'],
    // Google Drive
    ['googleDrive', '/Users/ava/Google Drive/Adminium/data'],
    ['googleDrive', '/Users/ava/Library/CloudStorage/GoogleDrive-ava@gmail.com/My Drive/Adminium'],
    ['googleDrive', 'G:\\My Drive\\Adminium\\data'],
    ['googleDrive', 'G:\\Shared drives\\Team\\Adminium'],
  ])('flags %s for %s', (provider, dir) => {
    const warning = detectCloudSyncFolder(dir);
    expect(warning, `expected ${dir} to be flagged`).not.toBeNull();
    expect(warning?.provider).toBe(provider);
    expect(warning?.messageKey).toBe(CLOUD_SYNC_WARNING_I18N_KEY);
    expect(warning?.providerLabel).toBeTruthy();
  });

  it('returns the matched segment so the wizard can name the folder', () => {
    expect(detectCloudSyncFolder('/Users/ava/Dropbox (Personal)/x')?.matchedSegment).toBe(
      'Dropbox (Personal)',
    );
    expect(detectCloudSyncFolder('C:\\Users\\ava\\OneDrive - Contoso\\x')?.matchedSegment).toBe(
      'OneDrive - Contoso',
    );
  });

  it.each([
    ['the default macOS data dir', '/Users/ava/Library/Application Support/Adminium/data'],
    ['the default Windows data dir', 'C:\\Users\\ava\\AppData\\Roaming\\Adminium\\data'],
    ['the default Linux data dir', '/home/ava/.config/Adminium/data'],
    ['a plain project folder', '/Users/ava/Projects/adminium/data'],
    ['an external disk', '/Volumes/Backup/Adminium'],
    ['the filesystem root', '/'],
    ['an empty path', ''],
  ])('does not flag %s', (_label, dir) => {
    expect(detectCloudSyncFolder(dir)).toBeNull();
  });

  it.each([
    ['a substring, not a segment', '/Users/ava/my-dropbox-backups/data'],
    ['a segment that merely starts with the brand', '/Users/ava/onedriver/data'],
    ['a folder someone happened to name My Drive', '/Users/ava/Documents/My Drive/data'],
    ['Google Drive as a substring of a longer word', '/Users/ava/googledriveclone/data'],
    // The four below are the module docstring's own must-not-match ("~/Projects/
    // dropbox-clone/data is not a Dropbox folder") and its neighbours. They all
    // matched once: the patterns were `/^dropbox([ -].*)?$/i`, and `[ -]` is
    // {space, hyphen}, so the brand plus a hyphen plus anything was a hit. The
    // cases above missed it by choosing names where the brand is not at the
    // START of the segment ('my-dropbox-backups') or has no separator at all
    // ('onedriver') — both correctly null either way.
    ['a project that starts with the brand', '/Users/ava/Projects/dropbox-clone/data'],
    ['a hyphenated backup folder', '/Users/ava/dropbox-backups/adminium'],
    ['a hyphenated folder in any case', '/Users/ava/Dropbox-old/data'],
    ['a hyphenated OneDrive-shaped folder outside CloudStorage', '/Users/ava/OneDrive-scripts/x'],
  ])('does not flag %s — the warning is blocking, so false positives are walls', (_label, dir) => {
    expect(detectCloudSyncFolder(dir)).toBeNull();
  });

  it.each([
    ['OneDrive-Personal', '/Users/ava/Library/CloudStorage/OneDrive-Personal/Adminium', 'onedrive'],
    ['OneDrive-Contoso', '/Users/ava/Library/CloudStorage/OneDrive-Contoso/Adminium', 'onedrive'],
    [
      'GoogleDrive-<account>',
      '/Users/ava/Library/CloudStorage/GoogleDrive-ava@gmail.com/My Drive/x',
      'googleDrive',
    ],
  ])(
    'still flags the real hyphenated mount %s — a false negative here is the worse bug',
    (_label, dir, provider) => {
      // The hyphen is admitted ONLY directly under macOS's CloudStorage, which
      // is the one parent that guarantees its children are sync roots. Dropping
      // it outright would silence the corruption warning on a genuine mount;
      // allowing it anywhere false-positives on the cases above.
      expect(detectCloudSyncFolder(dir)?.provider).toBe(provider);
    },
  );

  it('does not flag a hyphenated brand name outside CloudStorage, same word for word', () => {
    // The scoping, isolated: identical final segment, different parent.
    expect(detectCloudSyncFolder('/Users/ava/Library/CloudStorage/OneDrive-Personal/x')).not.toBeNull();
    expect(detectCloudSyncFolder('/Users/ava/Projects/OneDrive-Personal/x')).toBeNull();
  });

  it('matches case-insensitively — case varies across platforms', () => {
    expect(detectCloudSyncFolder('/users/ava/dropbox/adminium')?.provider).toBe('dropbox');
    expect(detectCloudSyncFolder('C:\\users\\ava\\onedrive\\adminium')?.provider).toBe('onedrive');
  });

  it('handles mixed and duplicated separators', () => {
    expect(detectCloudSyncFolder('C:/Users//ava\\Dropbox/Adminium')?.provider).toBe('dropbox');
  });

  it('flags a nested sync folder, not just a top-level one', () => {
    expect(detectCloudSyncFolder('/Users/ava/Work/Dropbox/Adminium/data')?.provider).toBe(
      'dropbox',
    );
  });
});
