// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every question `trialPolicy` answers has a test that shows it both ways: refused where the trial or hosted profile
 * turns it off, and allowed on a server where it is on.
 *
 * The table names, for each question, the test file and the test's own title that prove each way. It is checked
 * against the real question list, so a question added to `trial/policy.ts` without a row here fails, and against the
 * test files, so a cited test that is renamed, removed or skipped fails too. A row is a claim a reader can open and
 * check: it is not a count of mentions.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { POLICY_QUESTIONS, type PolicyQuestion } from '../src/trial/policy.js';

/** A test by its file (in this folder) and a piece of its title as the source writes it (template titles: a literal piece). */
interface Proof {
  file: string;
  title: string;
}

interface BothWays {
  /** Refused: in trial mode, the hosted profile, past the end date, past a cap, or under an operator AI variable. */
  refused: Proof;
  /** Allowed: on an ordinary server (or the profile that keeps it). */
  allowed: Proof;
}

const p = (file: string, title: string): Proof => ({ file, title });

const SWEEP: Record<PolicyQuestion, BothWays> = {
  // ── connections ──
  localDatabases: {
    refused: p('operator-lock.test.ts', ": locked off with the profile's reason, a switch-on refused as SET_BY_OPERATOR"),
    allowed: p('hosted-mode.test.ts', 'every way open, as before'),
  },
  sqliteSources: {
    refused: p('trial-mode.test.ts', 'a SQLite source: refused in trial mode and the hosted profile, opened as before on an ordinary server'),
    allowed: p('trial-mode.test.ts', 'a SQLite source: refused in trial mode and the hosted profile, opened as before on an ordinary server'),
  },
  // Enforced as `ADMINIUM_NETWORK_POLICY=strict` in the parsed environment: the hosted webhook run shows what strict does.
  privateNetwork: {
    refused: p('hosted-mode.test.ts', 'the webhook step: saved and sent by the hosted profile to a public address, never to its own network; refused by a trial'),
    allowed: p('hosted-mode.test.ts', 'the webhook step: saved and sent by the hosted profile to a public address, never to its own network; refused by a trial'),
  },
  anyDatabaseLogin: {
    refused: p('trial-mode.test.ts', "on an operator host only the operator\\'s login: another refused in trial mode, the person\\'s own Supabase project left alone"),
    allowed: p('hosted-mode.test.ts', 'every way open, as before'),
  },
  unlimitedConnectionTests: {
    refused: p('trial-mode.test.ts', 'connection tests: one budget for the whole installation in trial mode, none on an ordinary server'),
    allowed: p('trial-mode.test.ts', 'connection tests: one budget for the whole installation in trial mode, none on an ordinary server'),
  },
  metaStoreRoutes: {
    refused: p('trial-mode.test.ts', 'the meta store is fixed: relocate, probe and adopt answer 403 in trial mode, the setup token opening none of them'),
    allowed: p('trial-mode.test.ts', 'the meta store is fixed: relocate, probe and adopt answer 403 in trial mode, the setup token opening none of them'),
  },
  unlistedDatabaseHosts: {
    refused: p('trial-mode.test.ts', 'a host not on the list: refused in trial mode before any lookup; an ordinary server looks it up'),
    allowed: p('trial-mode.test.ts', 'a host not on the list: refused in trial mode before any lookup; an ordinary server looks it up'),
  },
  // ── storage ──
  storageDestinations: {
    refused: p('trial-mode.test.ts', 'in trial mode and the hosted profile: no destination made, tested or picked; only local'),
    allowed: p('trial-mode.test.ts', 'on an ordinary server: the same calls reach the destination code'),
  },
  // ── outgoing traffic ──
  webhooks: {
    refused: p('trial-mode.test.ts', 'is refused at the run in trial mode, before anything is sent; sent otherwise'),
    allowed: p('trial-mode.test.ts', 'is refused at the save in trial mode, kept by the hosted profile and an ordinary server'),
  },
  addOnHttp: {
    refused: p('trial-mode.test.ts', 'every add-on is refused in trial mode, a declared host included; the hosted profile and an ordinary server call it'),
    allowed: p('trial-mode.test.ts', 'every add-on is refused in trial mode, a declared host included; the hosted profile and an ordinary server call it'),
  },
  paymentProviders: {
    refused: p('trial-mode.test.ts', 'in trial mode: payments say the operator switched them off and refuse a key'),
    allowed: p('trial-mode.test.ts', 'on an ordinary server and a hosted one: payments reach the service code, maps keep their servers'),
  },
  geoServers: {
    refused: p('trial-mode.test.ts', 'in trial mode: payments say the operator switched them off and refuse a key; maps and routing are off'),
    allowed: p('trial-mode.test.ts', 'on an ordinary server and a hosted one: payments reach the service code, maps keep their servers'),
  },
  designerNetwork: {
    refused: p('trial-mode.test.ts', 'call out only where the server does, and never in trial mode'),
    allowed: p('trial-mode.test.ts', 'call out only where the server does, and never in trial mode'),
  },
  updateCheck: {
    refused: p('operator-lock.test.ts', 'in trial mode: locked off, read as off, a change refused, nothing written'),
    allowed: p('operator-lock.test.ts', 'on an ordinary server and a hosted one: open, as before'),
  },
  telemetry: {
    refused: p('operator-lock.test.ts', 'in trial mode a value stored before the lock is not obeyed'),
    allowed: p('operator-lock.test.ts', 'on an ordinary server and a hosted one: open, as before'),
  },
  ownSmtp: {
    refused: p('trial-email.test.ts', 'on a trial: the user’s own mail server is refused, the relay is shown read-only, and campaigns are off'),
    allowed: p('trial-email.test.ts', 'on an ordinary server: the mail server is saved, nothing is locked'),
  },
  marketingCampaigns: {
    refused: p('trial-email.test.ts', 'on a trial: not queued'),
    allowed: p('trial-email.test.ts', 'on an ordinary server: queued'),
  },
  liftMailHold: {
    refused: p('trial-email.test.ts', 'on a trial: today’s bounce and spam reports stay on the list, so the mail hold cannot be lifted'),
    allowed: p('trial-email.test.ts', 'on an ordinary server: today’s spam report can be taken off'),
  },
  aiBaseUrl: {
    refused: p('trial-mode.test.ts', 'a model connection: a typed address refused in a test and a save, a saved one never dialled, in trial mode only'),
    allowed: p('trial-mode.test.ts', "on an ordinary server: an address of one\\'s own is saved as before"),
  },
  customAiProviders: {
    refused: p('hosted-mode.test.ts', 'trial: no AI address of the person’s own'),
    allowed: p('hosted-mode.test.ts', 'hosted: an AI address of the person’s own is saved, as on an ordinary server'),
  },
  // ── own code ──
  packageUploads: {
    refused: p('trial-own-code-routes.test.ts', 'are refused with OFF_BY_OPERATOR before the body is read, and /system/info says why'),
    allowed: p('trial-own-code-routes.test.ts', 'reach the upload itself, and /system/info says they are taken'),
  },
  designerUploads: {
    refused: p('trial-own-code-routes.test.ts', 'refuses a site’s zip, a style of one’s own, a hand save and "Start with an app", each with its code'),
    allowed: p('trial-own-code-routes.test.ts', 'takes the uploads past the operator’s word, and tells the model nothing of it'),
  },
  designerCode: {
    refused: p('trial-own-code.test.ts', 'refuses hooks/ and actions/ with fixed words and no card, and writes nothing'),
    allowed: p('trial-own-code.test.ts', 'asks before server code and tests, as it always has'),
  },
  ownBuilds: {
    refused: p('trial-own-code.test.ts', 'an app’s own build command never runs, though a person approved it'),
    allowed: p('own-build.test.ts', 'runs the install once, and the build again only when something of the app changed'),
  },
  requestPackage: {
    refused: p('trial-own-code.test.ts', 'refuses run_tests, request_package and a phone app with no card and nothing run or installed'),
    allowed: p('designer-tools.test.ts', 'install nothing a person did not tick'),
  },
  projectDotEnv: {
    refused: p('project-config.test.ts', ': the .env is not read at all, and the config sets no operator variable'),
    allowed: p('project-config.test.ts', 'an ordinary server still reads it'),
  },
  // ── public pages ──
  searchIndexing: {
    refused: p('trial-mode.test.ts', 'in trial mode: X-Robots-Tag on every response, the robots meta tag on every page, robots.txt disallows all'),
    allowed: p('trial-mode.test.ts', "server: no noindex, and the app's own robots.txt"),
  },
  publicOriginSetting: {
    refused: p('trial-mode.test.ts', ': ADMINIUM_PUBLIC_ORIGIN, held over what was stored, read-only, a change refused'),
    allowed: p('trial-mode.test.ts', 'an ordinary server: the Super Admin sets it, and setup learns it'),
  },
  anyHost: {
    refused: p('trial-mode.test.ts', ': any other Host is a 421, the health checks answer everywhere'),
    allowed: p('trial-mode.test.ts', 'an ordinary server answers any Host, as before'),
  },
  mappedDomains: {
    refused: p('trial-mode.test.ts', ': a listed domain maps, any other is refused'),
    allowed: p('trial-mode.test.ts', 'an ordinary server maps and lists any domain, as before'),
  },
  payPages: {
    refused: p('trial-mode.test.ts', 'trial: both refused'),
    allowed: p('trial-mode.test.ts', ': both reach their routes'),
  },
  paymentWebhooks: {
    refused: p('trial-mode.test.ts', 'trial: both refused'),
    allowed: p('trial-mode.test.ts', ': both reach their routes'),
  },
  // ── past the end date ──
  writes: {
    refused: p('trial-ended.test.ts', 'refuses every write with OFF_BY_OPERATOR and the trial-ended reason'),
    allowed: p('trial-ended.test.ts', 'takes the same writes on '),
  },
  publicPages: {
    refused: p('trial-ended.test.ts', 'answers 404 at every public door, on every host, and keeps the staff pages'),
    allowed: p('trial-ended.test.ts', 'shows them on a running trial'),
  },
  userMail: {
    refused: p('trial-ended.test.ts', 'queues the server’s own mail and nothing else'),
    allowed: p('trial-ended.test.ts', 'queues the server’s own mail and nothing else'),
  },
  // ── size caps ──
  dataOverCap: {
    refused: p('trial-size-cap.test.ts', 'holds a database past its limit: inserts, updates and DDL that adds refused'),
    allowed: p('hosted-mode.test.ts', "'no cap, no watch, its own pools'"),
  },
  storageOverCap: {
    refused: p('trial-size-cap.test.ts', "%s: past the data folder’s limit, uploads refused, everything still exported"),
    allowed: p('trial-size-cap.test.ts', "%s: past the data folder’s limit, uploads refused, everything still exported"),
  },
  extraSourceConnections: {
    refused: p('trial-size-cap.test.ts', '%s: a fourth source connection'),
    allowed: p('trial-size-cap.test.ts', '%s: a fourth source connection'),
  },
  // ── operator AI ──
  customerScreensOnOperatorAi: {
    refused: p('operator-ai.test.ts', 'writes no customer side by hand, and ends with the card, never the model’s words; on the person’s own key it is written'),
    allowed: p('operator-ai.test.ts', 'without the variable, a turn on the operator’s connection writes a customer side as any turn does'),
  },
};

const HERE = import.meta.dirname;
const sources = new Map<string, string>();
const source = (file: string): string | null => {
  if (!sources.has(file)) sources.set(file, existsSync(join(HERE, file)) ? readFileSync(join(HERE, file), 'utf8') : '');
  return sources.get(file) || null;
};

/** The line of `file` that opens a test (`it(`, `test(`, `it.each(…)(`) and carries `title`; skipped or to-do tests do not count. */
function testLine(file: string, title: string): string | null {
  const text = source(file);
  if (text === null) return null;
  return text.split('\n').find((line) => line.includes(title) && /^\s*(?:it|test)(?:\.each\(.*\))?\(\s*['"`]/.test(line)) ?? null;
}

describe('every question the trial policy answers is tested both ways', () => {
  it('the sweep names exactly the questions trial/policy.ts answers', () => {
    expect(Object.keys(SWEEP).sort()).toEqual([...POLICY_QUESTIONS].sort());
  });

  for (const question of POLICY_QUESTIONS) {
    it(question, () => {
      const row = SWEEP[question];
      expect(row, `${question} has no test showing it both ways: add one, then a row here`).toBeDefined();
      for (const [way, proof] of Object.entries(row)) {
        expect(source(proof.file), `${question} (${way}): ${proof.file} does not exist`).not.toBeNull();
        expect(testLine(proof.file, proof.title), `${question} (${way}): no test in ${proof.file} titled "…${proof.title}…"`).not.toBeNull();
      }
    });
  }
});
