// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DEVELOPER'S ADD-ON LIST (`ADMINIUM_ADD_ON_DEV_TRUST`) is read on a test
 * or development server only:
 *
 *  - both boots (`loadEnv`, and the CLI's `loadCliEnv` an npm install runs)
 *    refuse it when `NODE_ENV` is unset or says neither, naming the variable
 *    and the fix; production boots and leaves it unread; a trial or a hosted
 *    server refuses it whatever `NODE_ENV` says;
 *  - read at a call, it trusts nothing anywhere but a test or development
 *    server, even on a server composed without those boot checks;
 *  - `adminium app try` trusts the packages it runs for its own run, in
 *    process, never in production, and puts it back when the run ends;
 *  - the lead demo seam is refused by the CLI's boot too, as its docs say.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deciderTrusted, type TrustSources } from '../src/add-ons/decide.js';
import { DEV_TRUST_ENV, devTrustIgnoredKeys, devTrustProblem, runTrustedKeys, trustForThisRun } from '../src/add-ons/dev-trust.js';
import { CliError } from '../src/cli/exit.js';
import { loadCliEnv } from '../src/cli/runtime.js';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { LEAD_SOURCE_DEMO_ENV } from '../src/lead-sources/demo-seam.js';
import { TEST_SECRET } from './helpers.js';

const KEY = 'stock-kit';
const PKG = { key: KEY, version: '1.0.0', integrity: 'sha512-AAAA' };
const NOBODY: TrustSources = { bundled: [], recorded: {} };
const silent = { write: () => true };

/** The variables `loadEnv` refuses, or none. */
function refused(raw: Record<string, string>): string[] {
  try {
    loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ...raw }, silent);
    return [];
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    return error.issues.map((issue) => String(issue.path[0] ?? '(env)'));
  }
}

const dirs: string[] = [];
/** What the CLI's boot says of an environment: null when it boots, else its message. */
function cliRefusal(raw: Record<string, string>): string | null {
  const dataDir = mkdtempSync(join(tmpdir(), 'dev-trust-cli-'));
  dirs.push(dataDir);
  try {
    loadCliEnv({ ADMINIUM_SECRET: TEST_SECRET, ...raw }, { dataDir, host: '127.0.0.1' });
    return null;
  } catch (error) {
    // The table of refused variables is the error's hint.
    return error instanceof CliError ? `${error.message}\n${error.hint ?? ''}` : String(error);
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the developer’s add-on list at boot', () => {
  it('boots with it on a test or development server, and with it unset or empty anywhere', () => {
    expect(refused({ NODE_ENV: 'test', [DEV_TRUST_ENV]: KEY })).toEqual([]);
    expect(refused({ NODE_ENV: ' Development ', [DEV_TRUST_ENV]: KEY })).toEqual([]);
    expect(refused({})).toEqual([]);
    expect(refused({ [DEV_TRUST_ENV]: ' , ' })).toEqual([]);
  });

  it('refuses it with no NODE_ENV (an npm install run as a service, the desktop app) or another one, naming the fix', () => {
    expect(refused({ [DEV_TRUST_ENV]: KEY })).toEqual([DEV_TRUST_ENV]);
    expect(refused({ NODE_ENV: 'staging', [DEV_TRUST_ENV]: KEY })).toEqual([DEV_TRUST_ENV]);
    expect(devTrustProblem({ [DEV_TRUST_ENV]: KEY })).toMatch(/NODE_ENV is not set\. .*set NODE_ENV=development/);
    expect(devTrustProblem({ NODE_ENV: 'staging', [DEV_TRUST_ENV]: KEY })).toMatch(/NODE_ENV is staging/);
  });

  it('boots in production and leaves it unread, saying which keys it ignores', () => {
    expect(refused({ NODE_ENV: 'production', [DEV_TRUST_ENV]: KEY })).toEqual([]);
    expect(devTrustIgnoredKeys({ NODE_ENV: 'production', [DEV_TRUST_ENV]: `${KEY}, other` })).toEqual([KEY, 'other']);
    expect(devTrustIgnoredKeys({ NODE_ENV: 'test', [DEV_TRUST_ENV]: KEY })).toEqual([]);
  });

  it('is still refused on a trial or a hosted server whatever NODE_ENV says', () => {
    const trial = { NODE_ENV: 'test', ADMINIUM_TRIAL_MODE: 'on', ADMINIUM_TRIAL_ENDS_AT: '2026-12-01T00:00:00Z', ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com', ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432', ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token' };
    expect(refused({ ...trial, [DEV_TRUST_ENV]: KEY })).toContain(DEV_TRUST_ENV);
  });

  it('the CLI’s boot refuses it too, and the lead demo seam with it', () => {
    expect(cliRefusal({ NODE_ENV: 'test', [DEV_TRUST_ENV]: KEY })).toBeNull();
    expect(cliRefusal({ [DEV_TRUST_ENV]: KEY })).toContain(DEV_TRUST_ENV);
    expect(cliRefusal({ NODE_ENV: 'production', [DEV_TRUST_ENV]: KEY })).toBeNull();
    expect(cliRefusal({ [LEAD_SOURCE_DEMO_ENV]: 'company-finder' })).toContain(LEAD_SOURCE_DEMO_ENV);
    expect(cliRefusal({ NODE_ENV: 'test', [LEAD_SOURCE_DEMO_ENV]: 'company-finder' })).toBeNull();
  });
});

describe('the developer’s add-on list at a call', () => {
  it('trusts a key it names on a test or development server only', () => {
    expect(deciderTrusted(PKG, { ...NOBODY, devKeys: KEY, nodeEnv: 'test' })).toBe(true);
    expect(deciderTrusted(PKG, { ...NOBODY, devKeys: KEY, nodeEnv: 'development' })).toBe(true);
    for (const nodeEnv of [undefined, '', 'staging', 'production']) {
      expect(deciderTrusted(PKG, { ...NOBODY, devKeys: KEY, nodeEnv })).toBe(false);
    }
  });
});

describe('a try run’s own trust', () => {
  it('trusts what the run names, outside production, until the run puts it back', () => {
    expect(runTrustedKeys()).toEqual([]);
    const untrust = trustForThisRun([KEY, ' ', KEY]);
    expect(runTrustedKeys()).toEqual([KEY]);
    // No NODE_ENV, as `adminium app try` is run from a shell: trusted.
    expect(deciderTrusted(PKG, { ...NOBODY, runKeys: runTrustedKeys() })).toBe(true);
    expect(deciderTrusted(PKG, { ...NOBODY, runKeys: runTrustedKeys(), nodeEnv: 'production' })).toBe(false);
    expect(deciderTrusted({ ...PKG, key: 'other' }, { ...NOBODY, runKeys: runTrustedKeys() })).toBe(false);
    untrust();
    untrust();
    expect(runTrustedKeys()).toEqual([]);
  });

  it('two runs that overlap each put back only their own', () => {
    const one = trustForThisRun([KEY]);
    const two = trustForThisRun([KEY, 'other']);
    one();
    expect(runTrustedKeys().sort()).toEqual(['other', KEY].sort());
    two();
    expect(runTrustedKeys()).toEqual([]);
  });
});
