// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A refusal the operator's switches cause (403 `OFF_BY_OPERATOR`) and the
 * installation's connection-test budget (429 `RATE_LIMITED`, scope
 * `instance`) read in the person's language wherever an error's message is
 * shown, not in the server's English: on screens that map the code
 * themselves and on every screen that does not (an automation's save, an
 * upload built by its own request).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setI18nInstance, type I18nInstance } from '../i18n/t.js';
import { api, ApiError } from './api.js';
import { setRefusalWords } from './refusals.js';
import { systemInfoQuery } from './capabilities.js';

const common = JSON.parse(readFileSync(join(process.cwd(), '../../packages/i18n/locales/de-DE/common.json'), 'utf8')) as Record<string, Record<string, string>>;
const german = (key: string): string => {
  const [group, name] = key.split('.') as [string, string];
  return common[group]![name]!;
};

/** A stand-in that answers from the German catalogue, as the dashboard does once a German locale is in. */
function installGerman(): void {
  setI18nInstance({
    language: 'de-DE',
    t: (key: string, options?: Record<string, unknown>) => {
      const { defaultValue, ...args } = options ?? {};
      const [group, name] = key.split('.');
      const message = common[group ?? '']?.[name ?? ''] ?? (typeof defaultValue === 'string' ? defaultValue : key);
      return message
        .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_, arg: string, one: string, other: string) => (args[arg] === 1 ? one : other).replace('#', String(args[arg])))
        .replace(/\{(\w+)\}/g, (_, arg: string) => String(args[arg] ?? `{${arg}}`));
    },
  } as unknown as I18nInstance);
}

function answer(status: number, error: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } })));
}

async function refusal(call: Promise<unknown>): Promise<ApiError> {
  const raised = await call.then(
    () => null,
    (error: unknown) => error,
  );
  expect(raised).toBeInstanceOf(ApiError);
  return raised as ApiError;
}

beforeEach(() => installGerman());
afterEach(() => {
  vi.unstubAllGlobals();
  setI18nInstance(null);
  setRefusalWords(null);
});

describe('a refusal the operator caused', () => {
  it('reads in the person’s language, with its code and details as the server sent them', async () => {
    answer(403, { code: 'OFF_BY_OPERATOR', message: 'Webhooks are off on this server.', requestId: 'r1', details: { question: 'webhooks', reason: 'trial-mode' } });
    const error = await refusal(api.post('/api/v1/automations/rules', {}));
    expect(error.message).toBe(german('operatorSwitches.webhooks'));
    expect(error.code).toBe('OFF_BY_OPERATOR');
    expect(error.details).toEqual({ question: 'webhooks', reason: 'trial-mode' });
  });

  it('says the own-code switches in their own words', async () => {
    answer(403, { code: 'OFF_BY_OPERATOR', message: 'Uploads are off.', details: { question: 'packageUploads', reason: 'trial-mode' } });
    expect((await refusal(api.post('/api/v1/add-ons/upload', {}))).message).toBe(german('operatorSwitches.packageUploads'));
  });

  it('says a question it has no words of its own for in the general sentence, never in English', async () => {
    answer(403, { code: 'OFF_BY_OPERATOR', message: 'Off.', details: { question: 'somethingNew', reason: 'hosted-mode' } });
    expect((await refusal(api.get('/api/v1/anything'))).message).toBe(german('operatorLock.lockedOff'));
  });

  it('reaches an error a screen builds from its own request, once the words are in', async () => {
    answer(403, { code: 'OFF_BY_OPERATOR', message: 'Off.', details: { question: 'webhooks', reason: 'trial-mode' } });
    await refusal(api.get('/api/v1/anything'));
    const upload = new ApiError(403, 'OFF_BY_OPERATOR', 'Designer uploads are off.', null, { question: 'designerUploads', reason: 'trial-mode' });
    expect(upload.message).toBe(german('operatorSwitches.designerUploads'));
  });
});

describe('an installation whose operator switched things off', () => {
  it('has the words in as soon as `/system/info` says so, before any refusal', async () => {
    const off = { allowed: false, reason: 'hosted-mode' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ offByOperator: { sqliteSources: off, storageDestinations: off, webhooks: { allowed: true, reason: null }, metaStoreRoutes: off } }), { status: 200 })));
    const query = systemInfoQuery();
    await (query.queryFn as () => Promise<unknown>)();
    await vi.waitFor(() => expect(new ApiError(403, 'OFF_BY_OPERATOR', 'Off.', null, { question: 'ownBuilds' }).message).toBe(german('operatorSwitches.ownBuilds')));
  });

  it('loads nothing on an installation with every switch on', async () => {
    const on = { allowed: true, reason: null };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ offByOperator: { sqliteSources: on, storageDestinations: on, webhooks: on, metaStoreRoutes: on } }), { status: 200 })));
    await (systemInfoQuery().queryFn as () => Promise<unknown>)();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(new ApiError(403, 'OFF_BY_OPERATOR', 'Off.', null, { question: 'ownBuilds' }).message).toBe('Off.');
  });
});

describe('the installation’s connection-test budget', () => {
  it('says how long to wait in the person’s language', async () => {
    answer(429, {
      code: 'RATE_LIMITED',
      message: 'This installation has tested 10 database connections in the last minute. Wait 12 seconds and try again.',
      details: { retryAfterSeconds: 12, limit: 10, scope: 'instance' },
    });
    const error = await refusal(api.post('/api/v1/connections/test', {}));
    expect(error.message).toBe('Diese Installation hat in der letzten Minute 10 Datenbankverbindungen getestet. Warten Sie 12 Sekunden und versuchen Sie es erneut.');
    expect(error.code).toBe('RATE_LIMITED');
  });

  it('leaves any other rate limit as it was', async () => {
    answer(429, { code: 'RATE_LIMITED', message: 'Too many requests.', details: { retryAfterSeconds: 3 } });
    expect((await refusal(api.post('/api/v1/auth/login', {}))).message).toBe('Too many requests.');
  });
});
