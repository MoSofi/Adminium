// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Speaking to the assistant (`assistant/voice.ts`, `POST /assistant/transcribe`).
 *
 * The route is asked as a real person of the test workspace, with a model
 * connection whose client records what it was handed. What is asserted: who
 * may, when it is on, what a recording is counted as and held against, that
 * one person has one recording under way, and that what was said is in no
 * record this server keeps.
 */
import { ProviderError, type ProviderClient, type TranscribeRequest } from '@adminium/llm';
import { assistantUseDay, assistantUseRepo, auditRepo, permissionsRepo, rolesRepo, settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { VOICE_MAX_BYTES, recordingSeconds, voiceWay } from '../src/assistant/voice.js';
import type { AiConnections } from '../src/llm/connections.js';
import { assistantRoutes } from '../src/routes/assistant/index.js';
import { asUser, buildDataTestApp, type DataTestContext } from './connections-helpers.js';

let t: DataTestContext;
/** The workspace's model service, as the tests set it. */
let provider: 'openai' | 'anthropic' = 'openai';
let heard: TranscribeRequest[] = [];
let answer: (req: TranscribeRequest) => Promise<{ text: string }> = async () => ({ text: 'How many orders shipped today?' });

const connection = () => ({ id: provider, provider, label: provider, source: 'saved', baseUrl: null, hasKey: true }) as never;
const connections = {
  default: async () => ({ connection: connection(), model: 'gpt-x' }),
  refusal: () => null,
  client: async () => ({
    client: {
      id: provider,
      listModels: async () => [],
      complete: async () => ({ text: '' }),
      test: async () => ({ ok: true as const, model: 'gpt-x', latencyMs: 1 }),
      ...(provider === 'openai'
        ? {
            transcribe: async (req: TranscribeRequest) => {
              heard.push(req);
              return answer(req);
            },
          }
        : {}),
    } satisfies ProviderClient,
  }),
} as unknown as AiConnections;

const say = (bytes: number | Buffer, query = '', as = t.users.admin, type = 'audio/webm;codecs=opus') =>
  t.app.inject({ method: 'POST', url: `/api/v1/assistant/transcribe${query}`, headers: { ...asUser(as), 'content-type': type }, payload: Buffer.isBuffer(bytes) ? bytes : Buffer.alloc(bytes, 7) });
const availability = async (as = t.users.admin) => (await t.app.inject({ method: 'GET', url: '/api/v1/assistant/availability', headers: asUser(as) })).json() as { voice: Record<string, unknown> };

beforeAll(async () => {
  t = await buildDataTestApp({
    extraRoutes: async (api, ctx) => {
      await api.register(assistantRoutes({ meta: ctx.meta, manager: ctx.manager, networkFeatures: true, secret: null, connections }) as never);
    },
  });
}, 60_000);

beforeEach(async () => {
  provider = 'openai';
  heard = [];
  answer = async () => ({ text: 'How many orders shipped today?' });
  await settingsRepo(t.meta).set('assistant.voice.input', true);
  await settingsRepo(t.meta).set('assistant.voice.dailyMinutes', 30);
  await t.meta.db.deleteFrom('adminium_assistant_use').execute();
});

afterAll(async () => {
  await t.app.close();
});

describe('how a recording becomes text here', () => {
  it('is the provider\'s when it transcribes, the browser\'s when it does not, and nobody\'s while the switch is off', () => {
    expect(voiceWay({ on: true, provider: 'openai', enabled: true })).toBe('provider');
    expect(voiceWay({ on: true, provider: 'openai-compatible', enabled: true })).toBe('provider');
    expect(voiceWay({ on: true, provider: 'anthropic', enabled: true })).toBe('browser');
    expect(voiceWay({ on: true, provider: 'ollama', enabled: true })).toBe('browser');
    // A provider that may not be reached (no outbound network) transcribes nothing either.
    expect(voiceWay({ on: true, provider: 'openai', enabled: false })).toBe('browser');
    expect(voiceWay({ on: true, provider: null, enabled: false })).toBe('browser');
    expect(voiceWay({ on: false, provider: 'openai', enabled: true })).toBe('none');
  });

  it('is counted from what arrived: never less than its weight, never more than one recording may be', () => {
    expect(recordingSeconds(16_000, 1)).toBe(1);
    expect(recordingSeconds(16_000, 14.2)).toBe(15);
    // "One second" of a heavy file is counted by its weight.
    expect(recordingSeconds(1_600_000, 1)).toBe(100);
    expect(recordingSeconds(VOICE_MAX_BYTES, 1)).toBe(120);
    expect(recordingSeconds(10, undefined)).toBe(1);
    expect(recordingSeconds(10, Number.NaN)).toBe(1);
  });

  it('is told to the panel, with where the voice goes', async () => {
    expect((await availability()).voice).toEqual({ input: 'provider', to: 'openai', output: true, maxSeconds: 120 });
    provider = 'anthropic';
    expect((await availability()).voice).toMatchObject({ input: 'browser' });
    await settingsRepo(t.meta).set('assistant.voice.input', false);
    await settingsRepo(t.meta).set('assistant.voice.output', false);
    expect((await availability()).voice).toMatchObject({ input: 'none', output: false });
    await settingsRepo(t.meta).set('assistant.voice.output', true);
  });
});

describe('the workspace\'s choices', () => {
  it('are off for the microphone and on for reading aloud on a new workspace, each changed alone and on record', async () => {
    await t.meta.db.deleteFrom('adminium_settings').where('key', 'like', 'assistant.voice.%').execute();
    const admin = await rolesRepo(t.meta).findBySlug('admin');
    await permissionsRepo(t.meta).grant(admin!.id, 'system', 'settings.manage', { allowed: true });
    const get = await t.app.inject({ method: 'GET', url: '/api/v1/assistant/settings', headers: asUser(t.users.admin) });
    expect(get.json().voice).toEqual({ input: false, dailyMinutes: 30, output: true, writtenBy: 'provider' });
    const put = (voice: Record<string, unknown>) => t.app.inject({ method: 'PUT', url: '/api/v1/assistant/settings', headers: asUser(t.users.admin), payload: { voice } });
    expect((await put({ input: true })).json().voice).toMatchObject({ input: true, dailyMinutes: 30, output: true });
    expect((await put({ dailyMinutes: 5, output: false })).json().voice).toMatchObject({ input: true, dailyMinutes: 5, output: false });
    provider = 'anthropic';
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/assistant/settings', headers: asUser(t.users.admin) })).json().voice.writtenBy).toBe('browser');
    provider = 'openai';
    const [entry] = await auditRepo(t.meta).list({ category: 'settings', limit: 1 });
    expect(entry).toMatchObject({ action: 'assistant.settings.update', changes: { before: { 'voice.dailyMinutes': 30, 'voice.output': true }, after: { 'voice.dailyMinutes': 5, 'voice.output': false } } });
    expect((await put({ dailyMinutes: 2_000 })).statusCode).toBe(422);
    expect((await put({ speed: 2 })).statusCode).toBe(422);
    await put({ output: true });
  });
});

describe('POST /assistant/transcribe', () => {
  it('turns one recording into text for a person who may use the assistant, and counts it', async () => {
    const res = await say(32_000, '?language=de_DE&seconds=14');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ text: 'How many orders shipped today?', seconds: 14, allowance: { limitSeconds: 1_800, usedSeconds: 14 } });
    // The provider was handed the bytes, their type and the language as two letters.
    expect(heard).toHaveLength(1);
    expect(heard[0]!.audio.byteLength).toBe(32_000);
    expect(heard[0]!.mime).toBe('audio/webm');
    expect(heard[0]!.language).toBe('de');
    expect((await assistantUseRepo(t.meta).get(t.users.admin.id, assistantUseDay(Date.now()))).voiceSeconds).toBe(14);

    // The audit says who and how long, and never what was said.
    const [entry] = await auditRepo(t.meta).list({ category: 'llm', limit: 1 });
    expect(entry).toMatchObject({ action: 'assistant.transcribe', changes: { after: { seconds: 14, provider: 'openai' } } });
    expect(JSON.stringify(entry)).not.toContain('orders shipped');
  });

  it('is refused to a person without the assistant, to nobody signed in, and while the switch is off', async () => {
    expect((await say(1_000, '', t.users.viewer)).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/assistant/transcribe', headers: { 'content-type': 'audio/webm' }, payload: Buffer.alloc(10) })).statusCode).toBe(401);
    await settingsRepo(t.meta).set('assistant.voice.input', false);
    const off = await say(1_000);
    expect(off.statusCode).toBe(403);
    expect(off.json().error).toMatchObject({ details: { reason: 'voice-off' } });
    expect(heard).toHaveLength(0);
  });

  it('says so when the workspace\'s service does not transcribe, so the panel can use the browser\'s', async () => {
    provider = 'anthropic';
    const none = await say(1_000);
    expect(none.statusCode).toBe(409);
    expect(none.json().error).toMatchObject({ details: { reason: 'voice-not-here' } });
    // A compatible server with no such route answers the same.
    provider = 'openai';
    answer = async () => {
      throw new ProviderError({ provider: 'openai-compatible', code: 'not_found', status: 404, message: 'openai-compatible: HTTP 404' });
    };
    expect((await say(1_000)).json().error).toMatchObject({ details: { reason: 'voice-not-here' } });
    // Any other fault of the provider is a failed recording, with nothing of the provider's own words.
    answer = async () => {
      throw new ProviderError({ provider: 'openai', code: 'server', status: 500, message: 'openai: HTTP 500 — secret words' });
    };
    const failed = await say(1_000);
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error).toMatchObject({ code: 'VOICE_FAILED', details: { code: 'server' } });
    expect(failed.body).not.toContain('secret words');
  });

  it('takes only a recording, and only one of a size a recording has', async () => {
    const json = await t.app.inject({ method: 'POST', url: '/api/v1/assistant/transcribe', headers: asUser(t.users.admin), payload: { audio: 'x' } });
    expect(json.statusCode).toBe(422);
    expect((await say(Buffer.alloc(0))).statusCode).toBeGreaterThanOrEqual(400);
    const heavy = await say(VOICE_MAX_BYTES + 1);
    expect(heavy.statusCode).toBe(413);
    expect(heard).toHaveLength(0);
    // What a phone's recorder makes is taken too.
    expect((await say(2_000, '', t.users.admin, 'audio/mp4')).statusCode).toBe(200);
    expect(heard[0]!.mime).toBe('audio/mp4');
  });

  it('holds a person to the day\'s minutes, counted before the provider is asked', async () => {
    await settingsRepo(t.meta).set('assistant.voice.dailyMinutes', 1);
    expect((await say(16_000, '?seconds=50')).statusCode).toBe(200);
    // Eleven seconds would pass the minute: refused, and the provider is not called for it.
    const over = await say(16_000, '?seconds=11');
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toMatchObject({ code: 'VOICE_ALLOWANCE', details: { limitSeconds: 60, usedSeconds: 50 } });
    expect(heard).toHaveLength(1);
    // Ten fits exactly; a recording that fails at the provider is still counted (it was sent).
    answer = async () => {
      throw new ProviderError({ provider: 'openai', code: 'server', status: 500, message: 'x' });
    };
    expect((await say(16_000, '?seconds=10')).statusCode).toBe(502);
    expect((await assistantUseRepo(t.meta).get(t.users.admin.id, assistantUseDay(Date.now()))).voiceSeconds).toBe(60);
    // No limit at 0.
    await settingsRepo(t.meta).set('assistant.voice.dailyMinutes', 0);
    answer = async () => ({ text: 'ok' });
    expect((await say(16_000, '?seconds=100')).statusCode).toBe(200);
  });

  it('gives one person one recording at a time, and frees their turn when it ends', async () => {
    let release: (value: { text: string }) => void = () => undefined;
    answer = () => new Promise((resolve) => (release = resolve));
    const first = say(16_000, '?seconds=3');
    // The first is with the provider: a second of the same person is told to wait, and costs nothing.
    await expect.poll(() => heard.length).toBe(1);
    const second = await say(16_000, '?seconds=3');
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({ details: { reason: 'voice-busy' } });
    release({ text: 'done' });
    expect((await first).json()).toMatchObject({ text: 'done' });
    expect((await assistantUseRepo(t.meta).get(t.users.admin.id, assistantUseDay(Date.now()))).voiceSeconds).toBe(3);
    answer = async () => ({ text: 'again' });
    expect((await say(16_000, '?seconds=3')).json()).toMatchObject({ text: 'again' });
  });
});
