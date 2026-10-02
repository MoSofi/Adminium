// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trying a packed app on a throwaway Adminium.
 *
 * `adminium app pack` proves an app is well formed. This proves the package
 * INSTALLS and is SERVED, by doing what a person would do in Studio — on a
 * fresh Adminium in a temp folder, with an empty SQLite database, through the
 * same routes: upload the file with its fingerprint, check the tables,
 * install, add the sample data, open each side, and ask the public API for
 * what the manifest grants and for what it does not.
 *
 * Nothing listens on a port: every request is injected into the server in
 * this process. The owner it signs in as is made here with a random password
 * that is never shown, and is gone with the folder.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { isManifestOnly, type AppManifest } from '@adminium/manifest';
import { createFirstSuperAdmin, firstRun, settingsRepo } from '@adminium/meta';

import { hashPassword } from '../../auth/passwords.js';
import { loadCliEnv, openRuntime as defaultOpenRuntime, type CliDeps } from '../../cli/runtime.js';
import { composeServer } from '../../compose.js';
import type { PackedApp } from './pack-app.js';
import type { AppSide } from './read-app.js';

export interface TryStep {
  ok: boolean;
  /** What was tried, as a sentence. */
  text: string;
  /** Why it failed: the server's own words where it gave any. */
  detail?: string;
  /** Passed, with something the author should read: printed as advice, never a failure. */
  warn?: boolean;
}

export interface TryResult {
  ok: boolean;
  steps: TryStep[];
  /** The temp folder, when it was kept. */
  kept: string | null;
}

export interface TryOptions {
  packed: PackedApp;
  manifest: AppManifest;
  /** The sides the package carries. */
  sides: readonly AppSide[];
  /** A folder of add-on packages (`<key>-<version>.tgz` + `.tgz.integrity`) the app may need. */
  addOnsDir?: string;
  /** Keep the temp folder instead of removing it. */
  keep?: boolean;
  openRuntime?: CliDeps['openRuntime'];
  /** Called as each step finishes, so a terminal shows progress. */
  onStep?: (step: TryStep) => void;
}

interface Reply {
  status: number;
  json: unknown;
  text: string;
  headers: Record<string, unknown>;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The server's refusal in its own words: the message, and each problem or issue it listed. */
function refusal(reply: Reply): string {
  const error = record(record(reply.json)['error']);
  const details = record(error['details']);
  const listed = [details['issues'], details['problems']]
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .map((item) => {
      const entry = record(item);
      return [entry['path'], entry['table'], entry['message']].filter((part) => typeof part === 'string' && part !== '').join(': ');
    })
    .filter((line) => line !== '');
  const reason = typeof details['reason'] === 'string' ? ` (${details['reason']})` : '';
  const message = typeof error['message'] === 'string' ? error['message'] : `HTTP ${String(reply.status)}`;
  return [`${message}${reason}`, ...listed.map((line) => `  ${line}`)].join('\n');
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Install the package on a fresh Adminium and report what worked. */
export async function tryApp(opts: TryOptions): Promise<TryResult> {
  const { packed, manifest } = opts;
  const { key, version } = packed;
  const steps: TryStep[] = [];
  const step = (ok: boolean, text: string, detail?: string): boolean => {
    const entry: TryStep = { ok, text, ...(detail === undefined || ok ? {} : { detail }) };
    steps.push(entry);
    opts.onStep?.(entry);
    return ok;
  };
  const done = (kept: string | null): TryResult => ({ ok: steps.every((entry) => entry.ok), steps, kept });

  const dir = mkdtempSync(join(tmpdir(), `adminium-app-try-${key}-`));
  // An empty database of its own for the app's tables, apart from Adminium's.
  const sourceFile = join(dir, 'app.sqlite');
  new BetterSqlite3(sourceFile).close();

  const env = loadCliEnv(
    {
      ADMINIUM_SECRET: randomBytes(32).toString('hex'),
      // The public API answers this server's own pages, which is what a hosted customer side is.
      ADMINIUM_PUBLIC_API_ORIGINS: 'self',
      ADMINIUM_LOG_LEVEL: 'fatal',
    },
    { host: '127.0.0.1', dataDir: join(dir, 'data') },
  );
  let runtime: Awaited<ReturnType<typeof defaultOpenRuntime>> | null = null;
  let app: Awaited<ReturnType<typeof composeServer>>['app'] | null = null;
  const kept = opts.keep === true ? dir : null;

  try {
    runtime = await (opts.openRuntime ?? defaultOpenRuntime)(env, { blockLoopback: false });
    const meta = runtime.metaStore.meta;
    await firstRun(meta);
    const password = randomBytes(24).toString('base64url');
    const email = 'owner@try.adminium.invalid';
    await createFirstSuperAdmin(meta, { email, name: 'Try', passwordHash: await hashPassword(password) });
    await settingsRepo(meta).set('publicApi.enabled', true, { updatedBy: null, at: Date.now() });

    app = (
      await composeServer({
        env,
        metaStore: runtime.metaStore,
        manager: runtime.manager,
        runService: runtime.runService,
        applyService: runtime.applyService,
        allowed: runtime.allowed,
        collectStats: runtime.collectStats,
        logger: false,
        telemetry: false,
      })
    ).app;
    await app.ready();
    const server = app;

    let cookie: string | null = null;
    const call = async (
      method: string,
      url: string,
      init: { payload?: unknown; body?: Buffer; headers?: Record<string, string>; anonymous?: boolean } = {},
    ): Promise<Reply> => {
      const reply = await server.inject({
        method: method as 'GET',
        url,
        headers: {
          ...(cookie === null || init.anonymous === true ? {} : { cookie }),
          ...(init.body === undefined ? {} : { 'content-type': 'application/octet-stream' }),
          ...init.headers,
        },
        ...(init.body !== undefined ? { payload: init.body } : init.payload === undefined ? {} : { payload: init.payload as object }),
      });
      let json: unknown = null;
      try {
        json = reply.json();
      } catch {
        json = null;
      }
      return { status: reply.statusCode, json, text: reply.body, headers: reply.headers as Record<string, unknown> };
    };

    const login = await call('POST', '/api/v1/auth/login', { payload: { email, password } });
    const setCookie = login.headers['set-cookie'];
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '')).split(';')[0] ?? null;
    if (login.status !== 200 || cookie === null || cookie === '') {
      step(false, 'start a fresh Adminium', refusal(login));
      return done(kept);
    }

    const created = await call('POST', '/api/v1/connections', { payload: { name: 'Try', engine: 'sqlite', dsn: `sqlite:${sourceFile}` } });
    const connectionId = record(created.json)['id'];
    if (created.status !== 201 || typeof connectionId !== 'string') {
      step(false, 'start a fresh Adminium', refusal(created));
      return done(kept);
    }
    const introspect = await call('POST', `/api/v1/connections/${connectionId}/introspect`);
    if (introspect.status !== 200 && introspect.status !== 202) {
      step(false, 'start a fresh Adminium', refusal(introspect));
      return done(kept);
    }
    step(true, 'a fresh Adminium, with an empty SQLite database');

    // Add-ons the app may need, staged the way an operator sideloads them.
    if (opts.addOnsDir !== undefined) {
      const files = existsSync(opts.addOnsDir) ? readdirSync(opts.addOnsDir).filter((name) => name.endsWith('.tgz')).sort() : [];
      if (files.length === 0) step(false, `add-on packages in ${opts.addOnsDir}`, 'no <key>-<version>.tgz files are there');
      for (const name of files) {
        const file = join(opts.addOnsDir, name);
        const integrity = existsSync(`${file}.integrity`) ? readFileSync(`${file}.integrity`, 'utf8').trim() : '';
        const staged = await call('POST', `/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(integrity)}`, { body: readFileSync(file) });
        step(staged.status === 200, `the add-on package ${name} is accepted`, integrity === '' ? `${name}.integrity is missing` : refusal(staged));
      }
    }

    // ── upload → check the tables → install ──
    const upload = await call('POST', `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(packed.integrity)}`, { body: Buffer.from(packed.tarball) });
    if (!step(upload.status === 200, `the package uploads (${packed.fileName}, ${String(packed.fileCount)} files)`, refusal(upload))) return done(kept);

    const planned = await call('POST', '/api/v1/apps/plan', { payload: { key, version, connectionId } });
    const plan = record(record(planned.json)['plan']);
    const installable = planned.status === 200 && plan['installable'] === true;
    const tables = Array.isArray(plan['create']) ? plan['create'].length : 0;
    if (!installable) {
      const why = planned.status === 200 ? refusal({ ...planned, json: { error: { message: 'The plan is not installable.', details: plan } } }) : refusal(planned);
      // An add-on the app requires is not on a fresh Adminium unless its package is handed over.
      const needsAddOn = (manifest.addOns?.requires ?? []).length > 0 && opts.addOnsDir === undefined;
      step(false, `the table check passes (${String(tables)} table(s) to create)`, needsAddOn ? `${why}\nThis app requires an add-on. Pass its package:  adminium app try ${key} --add-ons <folder>` : why);
      return done(kept);
    }
    step(true, `the table check passes (${String(tables)} table(s) to create)`);

    const installed = await call('POST', '/api/v1/apps/install', {
      payload: { key, version, connectionId, publicAccess: true, ...(typeof plan['checksum'] === 'string' ? { planChecksum: plan['checksum'] } : {}) },
    });
    if (!step(installed.status === 200, 'it installs: tables, pages, roles', refusal(installed))) return done(kept);

    // What the install itself reported: a page it could not fill, a rule it could not write.
    const receipt = record(installed.json);
    const pageReport = record(receipt['pages']);
    const pageWarnings = (Array.isArray(pageReport['warnings']) ? pageReport['warnings'] : []).map(record);
    const made = Array.isArray(pageReport['created']) ? pageReport['created'].length : 0;
    if (pageWarnings.length === 0) step(true, `every page shows its table (${String(made)} page(s) made)`);
    for (const warning of pageWarnings) {
      step(false, `the page "${String(warning['page'])}" shows its table`, `${String(warning['message'])} (${String(warning['reason'])})`);
    }
    for (const skipped of (Array.isArray(record(receipt['rules'])['skipped']) ? (record(receipt['rules'])['skipped'] as unknown[]) : []).map(record)) {
      const entry: TryStep = {
        ok: true,
        warn: true,
        text: `the rule ${String(skipped['op'])} on "${String(skipped['table'])}.${String(skipped['column'])}" was not written: ${String(skipped['reason'])}`,
      };
      steps.push(entry);
      opts.onStep?.(entry);
    }
    const bootstrap = await call('GET', '/api/v1/bootstrap');
    step(bootstrap.status === 200, 'the dashboard still starts', refusal(bootstrap));

    // ── sample data ──
    if (manifest.sampleData !== undefined) {
      const asked = await call('POST', `/api/v1/apps/${key}/sample-data`);
      let loaded = false;
      let failure = asked.status === 200 ? 'the sample data was not loaded within 60 seconds' : refusal(asked);
      for (let waited = 0; asked.status === 200 && !loaded && waited < 60_000; waited += 250) {
        const status = record((await call('GET', `/api/v1/apps/${key}/sample-data`)).json);
        loaded = status['loaded'] === true;
        if (!loaded) {
          const jobId = record(asked.json)['jobId'];
          const job = typeof jobId === 'string' ? record((await call('GET', `/api/v1/jobs/${jobId}`)).json) : {};
          const state = record(job['job'] ?? job)['status'];
          if (state === 'failed' || state === 'cancelled') {
            failure = String(record(record(job['job'] ?? job)['error'])['message'] ?? record(job['job'] ?? job)['lastError'] ?? 'the sample data job failed');
            break;
          }
          await sleep(250);
        }
      }
      step(loaded, 'the sample data loads', failure);
    }

    // ── each side is served, with every file its page names ──
    const realNames: Record<string, string> = {};
    for (const side of opts.sides) {
      const anonymous = side === 'customer';
      const base = `/apps/${key}/${side}/`;
      const page = await call('GET', base, { anonymous, headers: { accept: 'text/html' } });
      const addresses = [...page.text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1] as string);
      let missing: string | null = page.status === 200 ? null : `${base} answered ${String(page.status)}`;
      for (const address of addresses) {
        if (missing !== null) break;
        const asset = await call('GET', address, { anonymous });
        if (asset.status !== 200) missing = `${address} answered ${String(asset.status)}`;
      }
      step(missing === null, `the ${side} side is served at ${base} (${String(addresses.length)} file(s) it names)`, missing ?? undefined);

      const config = await call('GET', `${base}surface-config.json`, { anonymous });
      const doc = record(config.json);
      if (side === 'staff') {
        const names = record(doc['tables']) as Record<string, string>;
        Object.assign(realNames, names);
        step(config.status === 200 && typeof doc['connectionId'] === 'string', 'the staff side is told its database and tables', refusal(config));
        const first = manifest.requiredSchema.tables[0]?.ref;
        if (first !== undefined && typeof doc['connectionId'] === 'string') {
          const rows = await call('GET', `/api/v1/data/${encodeURIComponent(doc['connectionId'])}/${encodeURIComponent(names[first] ?? first)}?limit=1`);
          step(rows.status === 200, `the staff side can read "${first}" as the signed-in person`, refusal(rows));
        }
        const signedOut = await call('GET', base, { anonymous: true, headers: { accept: 'application/json' } });
        step(signedOut.status === 401 || signedOut.status === 302, 'the staff side is refused to someone not signed in', `it answered ${String(signedOut.status)}`);
      } else {
        const publishableKey = doc['publishableKey'];
        Object.assign(realNames, record(doc['tables']));
        if (!step(config.status === 200 && typeof publishableKey === 'string', 'the customer side is served a browser key', refusal(config))) continue;
        // As the side's own page calls it: from this server's own address.
        const origin = { host: 'localhost', origin: 'http://localhost' };
        const withKey = { anonymous: true, headers: { ...origin, authorization: `Bearer ${String(publishableKey)}` } };

        const granted = new Map((manifest.publicAccess ?? []).filter((entry) => entry.kind !== 'availability').map((entry) => [entry.table, entry]));
        for (const [table, entry] of granted) {
          const name = realNames[table] ?? table;
          if (entry.methods.includes('GET') && entry.claim === undefined && entry.claimedBy === undefined) {
            const read = await call('GET', `/api/v1/public/records/${encodeURIComponent(name)}?limit=1`, withKey);
            step(read.status === 200, `the customer side can read "${table}", as access grants`, refusal(read));
            const noKey = await call('GET', `/api/v1/public/records/${encodeURIComponent(name)}?limit=1`, { anonymous: true, headers: origin });
            step(noKey.status === 401, `"${table}" is refused without the key`, `it answered ${String(noKey.status)}`);
          }
          if (!entry.methods.includes('GET')) {
            const read = await call('GET', `/api/v1/public/records/${encodeURIComponent(name)}?limit=1`, withKey);
            step(read.status >= 400, `the customer side cannot read "${table}", which access does not grant`, `it answered ${String(read.status)}`);
          }
          // A create with no values: one that is not granted is refused for access, one that is
          // granted is refused for its values (or asks for the human check). Nothing is written.
          const write = await call('POST', `/api/v1/public/records/${encodeURIComponent(name)}`, { ...withKey, payload: { values: {} } });
          const code = String(record(record(write.json)['error'])['code'] ?? write.status);
          // An entry that asks for the human check answers "prove you are a person": the grant is there.
          const refusedForAccess = code !== 'PUBLIC_PROOF_REQUIRED' && [401, 403, 404, 405].includes(write.status);
          if (entry.methods.includes('POST')) {
            const why = code === 'PUBLIC_PROOF_REQUIRED' ? 'it asks for the human check first' : `an empty one is refused for its values: ${code}`;
            step(!refusedForAccess, `the customer side may add to "${table}", as access grants (${why})`, refusal(write));
          } else {
            step(refusedForAccess, `the customer side cannot add to "${table}", which access does not grant`, `it answered ${code}`);
          }
        }
        // Every table of the app the manifest does not grant must be out of reach.
        const ungranted = manifest.requiredSchema.tables.map((table) => table.ref).filter((ref) => !granted.has(ref));
        for (const table of ungranted) {
          const name = realNames[table] ?? `${manifest.requiredSchema.prefixed === true ? `${key.replace(/-/g, '_')}_` : ''}${table}`;
          const read = await call('GET', `/api/v1/public/records/${encodeURIComponent(name)}?limit=1`, withKey);
          step(read.status >= 400, `the customer side cannot read "${table}", which access does not grant`, `it answered ${String(read.status)}`);
        }
        // And nothing outside the app at all: Adminium's own users.
        const outside = await call('GET', '/api/v1/public/records/adminium_users?limit=1', withKey);
        step(outside.status >= 400, 'the customer side cannot read a table outside the app', `it answered ${String(outside.status)}`);
      }
    }

    if (opts.sides.length === 0) {
      const listed = record((await call('GET', '/api/v1/apps')).json)['apps'];
      const row = (Array.isArray(listed) ? listed : []).map(record).find((entry) => entry['key'] === key);
      step(row !== undefined && row['missing'] === false && isManifestOnly(manifest), 'it is listed as installed, with no screens of its own');
    }

    return done(kept);
  } catch (error) {
    step(false, 'the try ran to its end', error instanceof Error ? (error.stack ?? error.message) : String(error));
    return done(kept);
  } finally {
    if (app !== null) await app.close().catch(() => undefined);
    if (runtime !== null) await runtime.close().catch(() => undefined);
    if (opts.keep !== true) rmSync(dir, { recursive: true, force: true });
  }
}
