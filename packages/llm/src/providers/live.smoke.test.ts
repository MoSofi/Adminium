// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The real providers, called for real. Never in CI.
 *
 * Every other provider test answers with a reply we wrote, so none of them
 * can notice an API that stopped taking a field or changed its stream. This
 * one can. It runs only when `ADMINIUM_LIVE_PROVIDERS=1`, and only for the
 * providers the environment has a key or an address for:
 *
 *   ADMINIUM_AI_ANTHROPIC_API_KEY     (+ ADMINIUM_LIVE_ANTHROPIC_MODEL)
 *   ADMINIUM_AI_OPENAI_API_KEY        (+ ADMINIUM_LIVE_OPENAI_MODEL)
 *   ADMINIUM_AI_COMPATIBLE_BASE_URL   (+ ADMINIUM_AI_COMPATIBLE_API_KEY, ADMINIUM_LIVE_COMPATIBLE_MODEL)
 *   ADMINIUM_AI_OLLAMA_BASE_URL       (+ ADMINIUM_LIVE_OLLAMA_MODEL)
 *
 * With `ADMINIUM_RECORD_STREAMS=<folder>` each reply's raw stream is written
 * there as `<provider>-<case>.txt`, with the key and every id that names an
 * account or a request replaced. Those files are what the run tests replay.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scrubSecret } from './http.js';
import { canBuild, createProviderRunner } from './run-factory.js';
import type { RunEvent, RunTool } from './run-types.js';
import type { ProviderConfig } from './types.js';

const env = process.env;
const LIVE = env['ADMINIUM_LIVE_PROVIDERS'] === '1';
const RECORD = env['ADMINIUM_RECORD_STREAMS'];

interface Target {
  name: string;
  config: ProviderConfig;
  model: string;
}

const targets: Target[] = [];
if (env['ADMINIUM_AI_ANTHROPIC_API_KEY']) {
  targets.push({
    name: 'anthropic',
    config: { provider: 'anthropic', apiKey: env['ADMINIUM_AI_ANTHROPIC_API_KEY'] },
    model: env['ADMINIUM_LIVE_ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001',
  });
}
if (env['ADMINIUM_AI_OPENAI_API_KEY']) {
  targets.push({
    name: 'openai',
    config: { provider: 'openai', apiKey: env['ADMINIUM_AI_OPENAI_API_KEY'] },
    model: env['ADMINIUM_LIVE_OPENAI_MODEL'] ?? 'gpt-4o-mini',
  });
}
if (env['ADMINIUM_AI_COMPATIBLE_BASE_URL'] && env['ADMINIUM_LIVE_COMPATIBLE_MODEL']) {
  targets.push({
    name: 'openai-compatible',
    config: {
      provider: 'openai-compatible',
      baseUrl: env['ADMINIUM_AI_COMPATIBLE_BASE_URL'],
      ...(env['ADMINIUM_AI_COMPATIBLE_API_KEY'] ? { apiKey: env['ADMINIUM_AI_COMPATIBLE_API_KEY'] } : {}),
    },
    model: env['ADMINIUM_LIVE_COMPATIBLE_MODEL'],
  });
}
if (env['ADMINIUM_AI_OLLAMA_BASE_URL'] && env['ADMINIUM_LIVE_OLLAMA_MODEL']) {
  targets.push({
    name: 'ollama',
    config: { provider: 'ollama', baseUrl: env['ADMINIUM_AI_OLLAMA_BASE_URL'] },
    model: env['ADMINIUM_LIVE_OLLAMA_MODEL'],
  });
}

/** Ids that name a message, a request, an organisation or a user, as a placeholder of the same shape. */
function scrubIds(text: string): string {
  return text
    .replace(/\b(msg|req|toolu|srvtoolu)_[A-Za-z0-9]{6,}/g, (_all, prefix: string) => `${prefix}_${'0'.repeat(22)}`)
    .replace(/\bchatcmpl-[A-Za-z0-9]{6,}/g, `chatcmpl-${'0'.repeat(29)}`)
    .replace(/\bcall_[A-Za-z0-9]{6,}/g, `call_${'0'.repeat(24)}`)
    .replace(/\b(org|user|proj)-[A-Za-z0-9]{6,}/g, (_all, prefix: string) => `${prefix}-${'0'.repeat(24)}`)
    .replace(/"system_fingerprint":"[^"]*"/g, '"system_fingerprint":""');
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Save the next reply's raw stream. */
function record(target: Target, name: string): void {
  if (RECORD === undefined || RECORD === '') return;
  globalThis.fetch = async (input, init) => {
    const response = await realFetch(input, init);
    // A refusal is not a stream worth replaying.
    if (!response.ok) return response;
    const text = await response.clone().text();
    mkdirSync(RECORD, { recursive: true });
    const header = `# recorded ${new Date().toISOString().slice(0, 10)} from ${target.name}, model ${target.model}\n`;
    writeFileSync(join(RECORD, `${target.name}-${name}.txt`), header + scrubIds(scrubSecret(text, target.config.apiKey)));
    return response;
  };
}

const TOOLS: RunTool[] = [
  {
    name: 'write_file',
    description: 'Write a file of the app.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_files',
    description: 'List the files of the app.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

describe.skipIf(!LIVE)('real providers', { timeout: 300_000 }, () => {
  it.skipIf(targets.length > 0)('has at least one provider to call', () => {
    throw new Error('ADMINIUM_LIVE_PROVIDERS=1, and no ADMINIUM_AI_* key or address is set.');
  });

  for (const target of targets) {
    describe(target.name, () => {
      const runner = createProviderRunner(target.config);
      const ask = (text: string) => ({
        system: 'You are a careful builder. Follow the instruction exactly.',
        messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }],
        model: target.model,
        maxTokens: 1024,
      });

      it('can be built with', async () => {
        const verdict = await canBuild(runner, target.model);
        console.info(`${target.name} / ${target.model}: ${JSON.stringify(verdict)}`);
        expect(verdict.canBuild).toBe(true);
      });

      it('streams text', async () => {
        record(target, 'text');
        const events: RunEvent[] = [];
        const result = await runner.run({ ...ask('Say hello to the wörld in one short sentence.'), tools: [], onEvent: (event) => events.push(event) });
        expect(result.stop).toBe('end');
        expect(result.blocks.some((block) => block.type === 'text' && block.text.length > 0)).toBe(true);
        expect(events.some((event) => event.type === 'text')).toBe(true);
      });

      it('streams one tool call', async () => {
        record(target, 'one-tool');
        const events: RunEvent[] = [];
        const result = await runner.run({
          ...ask('Call write_file with path "apps/repairs/manifest/tables/jobs.json" and content "{\\"ref\\": \\"jobs\\"}". Do not answer in words.'),
          tools: TOOLS,
          onEvent: (event) => events.push(event),
        });
        expect(result.stop).toBe('tool_calls');
        expect(result.malformed).toEqual([]);
        const call = result.blocks.find((block) => block.type === 'tool_call');
        expect(call).toMatchObject({ name: 'write_file', input: { path: 'apps/repairs/manifest/tables/jobs.json' } });
        expect(events.some((event) => event.type === 'tool_call')).toBe(true);
      });

      it('streams two tool calls in one reply', async () => {
        record(target, 'two-tools');
        const result = await runner.run({
          ...ask('In ONE reply, call list_files, and also call write_file with path "a.json" and content "{}". Two tool calls, no words.'),
          tools: TOOLS,
        });
        // Not every model makes two calls at once; whatever it made must be readable.
        expect(result.malformed).toEqual([]);
        expect(result.blocks.filter((block) => block.type === 'tool_call').length).toBeGreaterThanOrEqual(1);
      });

      it('says when the tokens ran out', async () => {
        record(target, 'max-tokens');
        const result = await runner.run({ ...ask('Count from 1 to 500, one number per line.'), tools: [], maxTokens: 32 });
        expect(result.stop).toBe('max_tokens');
      });
    });
  }
});
