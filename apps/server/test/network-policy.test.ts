// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ADMINIUM_NETWORK_POLICY`: `open` (the default) calls the server's own
 * network like any other address; `strict` refuses private ranges for source
 * databases, webhooks and storage endpoints. A source host named in
 * `ADMINIUM_DATABASE_HOSTS` still passes, and only a source host: the list
 * names databases. Cloud metadata is refused under both.
 *
 * Every name here is answered by an injected lookup, and every "server" a
 * request reaches is a real one on 127.0.0.1 that counts its visitors: the
 * names (`hook.test`) do not resolve anywhere else, so a request that arrives
 * proves it went to the address that was checked, not to a second lookup.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AdapterRegistry, type AdapterProvider, type DatabaseEndpoint } from '@adminium/engine/adapter';
import type { Automation } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runWebhookAction } from '../src/automations/actions/webhook.js';
import { ActionFailure, type ActionContext } from '../src/automations/actions/types.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { resolveRule } from '../src/automations/validate.js';
import { loadEnv } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { guardOutboundUrl, parseDatabaseHost, type DatabaseHost } from '../src/connections/dsn.js';
import { ConnectionManager } from '../src/connections/manager.js';
import type { HostLookup } from '../src/net/address-guard.js';
import type { NetworkPolicy } from '../src/net/outbound-check.js';

const crypto = dsnCryptoFromSecret('network-policy-test-secret');
const fakeMeta = { db: null, dialect: 'sqlite' } as never;

/** A lookup that answers from a table; a name not in it does not resolve. */
function table(answers: Record<string, readonly string[]>): HostLookup {
  return async (host) => {
    const answer = answers[host];
    if (answer === undefined) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return answer;
  };
}

const ANSWERS = {
  'db.test': ['10.0.0.5'],
  'lan.test': ['192.168.1.20'],
  'ula.test': ['fd12:3456::7'],
  'cgnat.test': ['100.64.3.4'],
  'public.test': ['203.0.113.10'],
  'meta.test': ['169.254.169.254'],
  'hook.test': ['127.0.0.1'],
  'empty.test': [],
};

interface Dialled {
  dsn?: string;
  endpoint?: DatabaseEndpoint;
}

function recordingRegistry(dialled: Dialled[]): AdapterRegistry<AdapterProvider> {
  const registry = new AdapterRegistry<AdapterProvider>();
  for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
    registry.register({
      dialect,
      create(config: Dialled) {
        dialled.push(config);
        return {
          test: async () => ({ ok: true, latencyMs: 1, serverVersion: '18', canWrite: true }),
          probeCapabilities: async () => ({
            capabilities: {},
            privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
            serverVersion: '18',
            currentRole: { name: 'app', readOnly: false },
          }),
          close: async () => undefined,
        };
      },
      createQueryEngine: () => ({}),
    } as unknown as AdapterProvider);
  }
  return registry;
}

function listed(entries: string): DatabaseHost[] {
  return entries.split(',').map((raw) => {
    const parsed = parseDatabaseHost(raw);
    if (!parsed.ok) throw new Error(`bad entry ${raw}`);
    return parsed.entry;
  });
}

function manager(opts: { policy?: NetworkPolicy; blockLoopback?: boolean; hosts?: DatabaseHost[]; dialled?: Dialled[] } = {}): ConnectionManager {
  return new ConnectionManager({
    meta: fakeMeta,
    crypto,
    registry: recordingRegistry(opts.dialled ?? []),
    blockLoopback: opts.blockLoopback ?? true,
    lookup: table(ANSWERS),
    databaseHosts: opts.hosts ?? [],
    ...(opts.policy === undefined ? {} : { networkPolicy: opts.policy }),
  });
}

describe('ADMINIUM_NETWORK_POLICY in the environment', () => {
  const base = { ADMINIUM_SECRET: 'x'.repeat(32) };

  it('is open when unset or empty, strict when asked, and nothing else', () => {
    expect(loadEnv(base).ADMINIUM_NETWORK_POLICY).toBe('open');
    expect(loadEnv({ ...base, ADMINIUM_NETWORK_POLICY: '' }).ADMINIUM_NETWORK_POLICY).toBe('open');
    expect(loadEnv({ ...base, ADMINIUM_NETWORK_POLICY: 'strict' }).ADMINIUM_NETWORK_POLICY).toBe('strict');
    expect(loadEnv({ ...base, ADMINIUM_NETWORK_POLICY: ' Strict ' }).ADMINIUM_NETWORK_POLICY).toBe('strict');
    expect(() => loadEnv({ ...base, ADMINIUM_NETWORK_POLICY: 'closed' })).toThrow('ADMINIUM_NETWORK_POLICY');
  });
});

describe('source databases', () => {
  const privateHosts = [
    ['10/8 by name', 'postgres://u@db.test:5432/app'],
    ['192.168/16 by name', 'postgres://u@lan.test:5432/app'],
    ['IPv6 ULA by name', 'mysql://u@ula.test:3306/app'],
    ['100.64/10 by name', 'postgres://u@cgnat.test:5432/app'],
    ['172.16/12 as written', 'postgres://u@172.20.1.2:5432/app'],
    ['10/8 as written', 'mysql://u@10.1.2.3:3306/app'],
  ] as const;

  it.each(privateHosts)('open lets %s through, at the checked address', async (_what, dsn) => {
    const dialled: Dialled[] = [];
    await manager({ dialled }).testDsn(dsn.startsWith('mysql') ? 'mysql' : 'postgres', dsn);
    expect(dialled).toHaveLength(1);
    expect(dialled[0]?.endpoint?.addresses?.length).toBe(1);
  });

  it.each(privateHosts)('strict refuses %s, naming the list entry that would let it through', async (_what, dsn) => {
    const dialled: Dialled[] = [];
    const engine = dsn.startsWith('mysql') ? 'mysql' : 'postgres';
    await expect(manager({ policy: 'strict', dialled }).testDsn(engine, dsn)).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('ADMINIUM_NETWORK_POLICY=strict'),
      details: { variable: 'ADMINIUM_DATABASE_HOSTS', policy: 'strict' },
    });
    expect(dialled).toEqual([]);
  });

  it('strict still lets a public host through', async () => {
    const dialled: Dialled[] = [];
    await manager({ policy: 'strict', dialled }).testDsn('postgres', 'postgres://u@public.test:5432/app');
    expect(dialled[0]?.endpoint?.addresses).toEqual(['203.0.113.10']);
  });

  it('strict lets a host in ADMINIUM_DATABASE_HOSTS through, on that port only', async () => {
    const dialled: Dialled[] = [];
    const strict = manager({ policy: 'strict', hosts: listed('db.test:5432'), dialled });
    await strict.testDsn('postgres', 'postgres://u@db.test:5432/app');
    expect(dialled[0]?.endpoint?.addresses).toEqual(['10.0.0.5']);
    await expect(strict.testDsn('postgres', 'postgres://u@db.test:6432/app')).rejects.toThrow('ADMINIUM_NETWORK_POLICY=strict');
  });

  it('strict applies where loopback is allowed too (not only in production), and loopback keeps its own rule', async () => {
    const dialled: Dialled[] = [];
    const devStrict = manager({ policy: 'strict', blockLoopback: false, dialled });
    await expect(devStrict.testDsn('postgres', 'postgres://u@db.test:5432/app')).rejects.toThrow('ADMINIUM_NETWORK_POLICY=strict');
    await devStrict.testDsn('postgres', 'postgres://u@hook.test:5432/app');
    expect(dialled[0]?.endpoint?.addresses).toEqual(['127.0.0.1']);
  });

  it('checks again before every new pool, not only when the connection is saved', async () => {
    await expect(manager({ policy: 'strict' }).checkDsnAllowed('postgres://u@db.test:5432/app', 'postgres')).rejects.toThrow('ADMINIUM_NETWORK_POLICY=strict');
  });

  it.each(['open', 'strict'] as const)('%s refuses cloud metadata, listed or not', async (policy) => {
    const hosts = listed('meta.test:5432');
    await expect(manager({ policy, hosts }).testDsn('postgres', 'postgres://u@meta.test:5432/app')).rejects.toThrow('blocked address range');
    await expect(manager({ policy, blockLoopback: false }).testDsn('postgres', 'postgres://u@169.254.169.254:5432/app')).rejects.toThrow('blocked address range');
  });

  it('a name that cannot be looked up is its own failure (502), not a policy refusal', async () => {
    for (const dsn of ['postgres://u@nowhere.test:5432/app', 'postgres://u@empty.test:5432/app']) {
      await expect(manager({ policy: 'strict', blockLoopback: false }).testDsn('postgres', dsn)).rejects.toMatchObject({
        statusCode: 502,
        code: 'HOST_LOOKUP_FAILED',
        message: expect.stringMatching(/^Could not look up (nowhere|empty)\.test\./),
      });
    }
  });
});

// ── webhooks ───────────────────────────────────────────────────────────────

let receiver: Server;
let port: number;
let hits: string[];

beforeEach(async () => {
  hits = [];
  receiver = createServer((request, response) => {
    hits.push(`${request.method ?? ''} ${request.headers.host ?? ''}${request.url ?? ''}`);
    request.resume();
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  });
  await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', done));
  port = (receiver.address() as AddressInfo).port;
});

afterEach(async () => {
  receiver.closeAllConnections();
  await new Promise<void>((done) => receiver.close(() => done()));
});

const rule = { id: 'rule_1', name: 'Tell the hook' } as Automation;

function webhook(url: string) {
  return { kind: 'webhook', url, method: 'POST', bodyKind: 'json', body: null, headerName: null, headerValueEncrypted: null } as const;
}

function ctxWith(m: ConnectionManager): ActionContext {
  return { meta: fakeMeta, manager: m, rule, runId: 'run_1', hops: 0, now: Date.now(), source: null, tokens: {}, text: TRACE_EN, secret: 's'.repeat(32) } as unknown as ActionContext;
}

describe('webhooks', () => {
  it('open calls a name on this test server at the address its lookup gave, and nothing else', async () => {
    const result = await runWebhookAction(webhook(`http://hook.test:${String(port)}/in`) as never, ctxWith(manager({ blockLoopback: false })));
    expect(result.log).toContain('→ 200');
    expect(hits).toEqual([`POST hook.test:${String(port)}/in`]);
  });

  it.each(['db.test', 'lan.test', 'ula.test', 'cgnat.test'])('strict refuses %s at send time, and nothing is sent', async (host) => {
    const run = runWebhookAction(webhook(`http://${host}:${String(port)}/in`) as never, ctxWith(manager({ policy: 'strict', blockLoopback: false })));
    await expect(run).rejects.toBeInstanceOf(ActionFailure);
    await expect(run).rejects.toThrow("on this server's own network, which ADMINIUM_NETWORK_POLICY=strict does not call");
    expect(hits).toEqual([]);
  });

  it('strict refuses an address written as numbers before any lookup', async () => {
    await expect(runWebhookAction(webhook('http://10.0.0.5/in') as never, ctxWith(manager({ policy: 'strict', blockLoopback: false })))).rejects.toThrow('ADMINIUM_NETWORK_POLICY=strict');
  });

  it('a host in ADMINIUM_DATABASE_HOSTS does not let a webhook through: the list names databases only', async () => {
    const strict = manager({ policy: 'strict', blockLoopback: false, hosts: listed(`db.test:${String(port)},db.test:443,db.test:80`) });
    await expect(runWebhookAction(webhook(`http://db.test:${String(port)}/in`) as never, ctxWith(strict))).rejects.toThrow('ADMINIUM_NETWORK_POLICY=strict');
    expect(hits).toEqual([]);
  });

  it.each(['open', 'strict'] as const)('%s refuses cloud metadata by name and as written', async (policy) => {
    for (const url of ['http://meta.test/latest/', 'http://169.254.169.254/latest/', 'http://[fd00:ec2::254]/latest/']) {
      await expect(runWebhookAction(webhook(url) as never, ctxWith(manager({ policy, blockLoopback: false }))), url).rejects.toThrow('blocked address range');
    }
  });

  it('a name that cannot be looked up fails the step with the lookup wording, not a policy one', async () => {
    await expect(runWebhookAction(webhook('https://nowhere.test/in') as never, ctxWith(manager({ blockLoopback: false })))).rejects.toThrow('Could not look up nowhere.test');
  });

  it('strict refuses a private address written into a rule when it is saved', () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 'n1', kind: 'trigger', title: 'Trigger' },
        { id: 'n2', kind: 'action', title: 'Tell', onError: false, action: webhook('http://192.168.1.20/in') },
      ],
    } as never;
    const trigger = { kind: 'schedule', connectionId: null, schedule: { kind: 'interval', everyMinutes: '15' } } as never;
    const ctx = { view: null, templateKeys: new Set<string>(), blockLoopback: false };
    expect(() => resolveRule(trigger, graph, { ...ctx, blockPrivate: true })).toThrow('ADMINIUM_NETWORK_POLICY=strict');
    expect(() => resolveRule(trigger, graph, ctx)).not.toThrow();
    expect(() => guardOutboundUrl('http://192.168.1.20/in', { blockPrivate: true })).toThrow('ADMINIUM_NETWORK_POLICY=strict');
    expect(() => guardOutboundUrl('http://192.168.1.20/in', {})).not.toThrow();
  });
});
