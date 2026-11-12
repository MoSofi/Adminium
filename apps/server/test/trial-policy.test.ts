// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `trialPolicy`: every question a trial and a hosted installation answer, answered for an ordinary server, a trial and a hosted
 * installation. The table below IS the plan's: a change to an answer is a
 * change to this table, made on purpose.
 */
import { describe, expect, it } from 'vitest';

import { allowsIn, POLICY_QUESTIONS, POLICY_REASONS, profileOf, rawProfile, trialPolicy, type PolicyQuestion, type PolicyReason } from '../src/trial/policy.js';
import { makeEnv } from './helpers.js';

const TRIAL = {
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2026-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com',
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
  ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token',
};
const HOSTED = { ADMINIUM_HOSTED_MODE: 'on', ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.example.com', ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432' };

const BEFORE_END = Date.parse('2026-11-20T12:00:00Z');
const AFTER_END = Date.parse('2026-12-01T00:00:00Z');

/** `true` allowed; a reason when not. Columns: an ordinary server, a trial (before its end), the hosted profile. */
const EXPECTED: Record<PolicyQuestion, [true | PolicyReason, true | PolicyReason, true | PolicyReason]> = {
  // A1
  localDatabases: [true, 'trial-mode', 'hosted-mode'],
  sqliteSources: [true, 'trial-mode', 'hosted-mode'],
  privateNetwork: [true, 'trial-mode', 'hosted-mode'],
  anyDatabaseLogin: [true, 'trial-mode', 'hosted-mode'],
  unlimitedConnectionTests: [true, 'trial-mode', 'hosted-mode'],
  metaStoreRoutes: [true, 'trial-mode', 'hosted-mode'],
  unlistedDatabaseHosts: [true, 'trial-mode', 'hosted-mode'],
  // A1b
  storageDestinations: [true, 'trial-mode', 'hosted-mode'],
  // A2: off in a trial, allowed again once paid
  webhooks: [true, 'trial-mode', true],
  addOnHttp: [true, 'trial-mode', true],
  paymentProviders: [true, 'trial-mode', true],
  geoServers: [true, 'trial-mode', true],
  designerNetwork: [true, 'trial-mode', true],
  updateCheck: [true, 'trial-mode', true],
  telemetry: [true, 'trial-mode', true],
  ownSmtp: [true, 'trial-mode', true],
  marketingCampaigns: [true, 'trial-mode', true],
  aiBaseUrl: [true, 'trial-mode', true],
  customAiProviders: [true, 'trial-mode', true],
  // A3: kept by the hosted profile (S2)
  packageUploads: [true, 'trial-mode', 'hosted-mode'],
  designerUploads: [true, 'trial-mode', 'hosted-mode'],
  designerCode: [true, 'trial-mode', 'hosted-mode'],
  ownBuilds: [true, 'trial-mode', 'hosted-mode'],
  requestPackage: [true, 'trial-mode', 'hosted-mode'],
  projectDotEnv: [true, 'trial-mode', 'hosted-mode'],
  // A4: the origin lock kept, `noindex` dropped
  searchIndexing: [true, 'trial-mode', true],
  publicOriginSetting: [true, 'trial-mode', 'hosted-mode'],
  anyHost: [true, 'trial-mode', 'hosted-mode'],
  mappedDomains: [true, 'trial-mode', 'hosted-mode'],
  payPages: [true, 'trial-mode', true],
  paymentWebhooks: [true, 'trial-mode', true],
  // A5: allowed until the end date (the next test reads the clock)
  writes: [true, true, true],
  publicPages: [true, true, true],
  userMail: [true, true, true],
  // Operator AI: only with its own variable
  customerScreensOnOperatorAi: [true, true, true],
};

const answer = (value: true | PolicyReason) => (value === true ? { allowed: true, reason: null } : { allowed: false, reason: value });

describe('every question, for every profile', () => {
  const off = trialPolicy(makeEnv(), () => BEFORE_END);
  const trial = trialPolicy(makeEnv(TRIAL), () => BEFORE_END);
  const hosted = trialPolicy(makeEnv(HOSTED), () => BEFORE_END);

  it('the table covers every question the policy answers, and no other', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...POLICY_QUESTIONS].sort());
  });

  for (const question of POLICY_QUESTIONS) {
    it(question, () => {
      const [onOff, onTrial, onHosted] = EXPECTED[question];
      expect(off.allows(question), 'an ordinary server').toEqual(answer(onOff));
      expect(trial.allows(question), 'a trial').toEqual(answer(onTrial));
      expect(hosted.allows(question), 'the hosted profile').toEqual(answer(onHosted));
    });
  }

  it('names its profile', () => {
    expect([off.profile, trial.profile, hosted.profile]).toEqual(['off', 'trial', 'hosted']);
    expect(profileOf({ ADMINIUM_TRIAL_MODE: true, ADMINIUM_HOSTED_MODE: true })).toBe('trial');
  });

  it('every reason it gives is one the dashboard knows', () => {
    for (const policy of [off, trial, hosted]) {
      for (const question of POLICY_QUESTIONS) {
        const { reason } = policy.allows(question, AFTER_END);
        if (reason !== null) expect(POLICY_REASONS).toContain(reason);
      }
    }
  });
});

describe('past the end date (A5)', () => {
  it('a trial turns read-only, hides its public pages and stops user mail; nothing else changes', () => {
    const policy = trialPolicy(makeEnv(TRIAL));
    for (const question of ['writes', 'publicPages', 'userMail'] as const) {
      expect(policy.allows(question, BEFORE_END)).toEqual({ allowed: true, reason: null });
      expect(policy.allows(question, AFTER_END)).toEqual({ allowed: false, reason: 'trial-ended' });
      expect(policy.allows(question, AFTER_END - 1)).toEqual({ allowed: true, reason: null });
    }
    expect(policy.allows('webhooks', AFTER_END)).toEqual({ allowed: false, reason: 'trial-mode' });
  });

  it('a hosted or ordinary server has no end', () => {
    for (const env of [makeEnv(), makeEnv(HOSTED)]) {
      expect(trialPolicy(env).allows('writes', AFTER_END + 365 * 86_400_000)).toEqual({ allowed: true, reason: null });
    }
  });
});

describe('the trial clock', () => {
  const policy = trialPolicy(makeEnv(TRIAL));

  it('counts a part day as a day, so the last day reads 1', () => {
    expect(policy.trial(BEFORE_END)).toEqual({ on: true, endsAt: '2026-12-01T00:00:00.000Z', daysLeft: 11, ended: false });
    expect(policy.trial(AFTER_END - 1).daysLeft).toBe(1);
    expect(policy.trial(AFTER_END - 86_400_000).daysLeft).toBe(1);
    expect(policy.trial(AFTER_END - 86_400_001).daysLeft).toBe(2);
  });

  it('past the end is a state, not a count of 0', () => {
    expect(policy.trial(AFTER_END)).toEqual({ on: true, endsAt: '2026-12-01T00:00:00.000Z', daysLeft: null, ended: true });
  });

  it('is off without trial mode, hosted included', () => {
    for (const env of [makeEnv(), makeEnv(HOSTED)]) expect(trialPolicy(env).trial(BEFORE_END)).toEqual({ on: false, endsAt: null, daysLeft: null, ended: false });
  });
});

describe('the Upgrade address and the caps', () => {
  it('opens the operator’s page told which instance, only in trial mode with the address set', () => {
    expect(trialPolicy(makeEnv(TRIAL)).upgradeUrl).toBeNull();
    expect(trialPolicy(makeEnv({ ...TRIAL, ADMINIUM_TRIAL_UPGRADE_URL: 'https://example.com/upgrade?plan=a' })).upgradeUrl).toBe(
      'https://example.com/upgrade?plan=a&instance=https%3A%2F%2Fhollis.try.example.com',
    );
    expect(trialPolicy(makeEnv(HOSTED)).upgradeUrl).toBeNull();
  });

  it('holds A6’s caps in trial mode only', () => {
    expect(trialPolicy(makeEnv({ ...TRIAL, ADMINIUM_TRIAL_UPLOAD_MAX_MB: '5' })).limits).toEqual({
      dataMaxBytes: 500 * 1024 * 1024,
      uploadMaxBytes: 5 * 1024 * 1024,
      storageMaxBytes: 1000 * 1024 * 1024,
      emailsPerDay: 50,
      emailsPerHour: 20,
      sourceConnections: 3,
    });
    expect(trialPolicy(makeEnv(HOSTED)).limits).toBeNull();
    expect(trialPolicy(makeEnv()).limits).toBeNull();
  });
});

describe('operator AI answers to its own variables, in any profile', () => {
  it('ADMINIUM_AI_OPERATOR_ONLY refuses a typed base URL and custom providers', () => {
    const policy = trialPolicy(makeEnv({ ADMINIUM_AI_OPERATOR_ONLY: 'on' }));
    expect(policy.allows('aiBaseUrl')).toEqual({ allowed: false, reason: 'operator-ai-only' });
    expect(policy.allows('customAiProviders')).toEqual({ allowed: false, reason: 'operator-ai-only' });
    // A trial says why first: trial mode would refuse it anyway.
    expect(trialPolicy(makeEnv({ ...TRIAL, ADMINIUM_AI_OPERATOR_ONLY: 'on' })).allows('aiBaseUrl').reason).toBe('trial-mode');
  });

  it('ADMINIUM_AI_OPERATOR_SCOPE=dashboard keeps operator AI off customer screens', () => {
    expect(trialPolicy(makeEnv({ ADMINIUM_AI_OPERATOR_SCOPE: 'dashboard' })).allows('customerScreensOnOperatorAi')).toEqual({ allowed: false, reason: 'operator-ai-scope' });
    expect(trialPolicy(makeEnv({ ...TRIAL, ADMINIUM_AI_OPERATOR_SCOPE: 'dashboard' })).allows('customerScreensOnOperatorAi').reason).toBe('operator-ai-scope');
  });
});

describe('before the environment is parsed', () => {
  it('reads the profile off the raw variables, as the schema reads on', () => {
    expect(rawProfile({})).toBe('off');
    expect(rawProfile({ ADMINIUM_TRIAL_MODE: 'on' })).toBe('trial');
    expect(rawProfile({ ADMINIUM_TRIAL_MODE: 'true', ADMINIUM_HOSTED_MODE: '1' })).toBe('trial');
    expect(rawProfile({ ADMINIUM_HOSTED_MODE: '1' })).toBe('hosted');
    expect(rawProfile({ ADMINIUM_TRIAL_MODE: 'off', ADMINIUM_HOSTED_MODE: 'ON' })).toBe('off');
  });

  it('answers a profile-only question as the full policy does', () => {
    for (const [profile, env] of [['off', makeEnv()], ['trial', makeEnv(TRIAL)], ['hosted', makeEnv(HOSTED)]] as const) {
      expect(allowsIn(profile, 'projectDotEnv')).toEqual(trialPolicy(env, () => BEFORE_END).allows('projectDotEnv'));
    }
  });
});
