// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the Designer's model is told, and how a long session is made to fit.
 *
 * The smallest window the Designer builds with is an OpenAI-compatible
 * server's (24,000 tokens read). What the model must be told, with every
 * skill a request can pull in, has to leave room in it for the
 * conversation; and when the conversation grows, what is cut must never
 * leave a provider a transcript it refuses.
 */
import { rmSync } from 'node:fs';

import { ASSISTANT_INPUT_TOKEN_LIMIT, estimateTokens, type RunMessage } from '@adminium/llm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrompt, skillsFor, trimTranscript } from '../src/designer/prompt.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import { createSkills } from '../src/designer/skills.js';
import { closeDangling } from '../src/designer/transcript.js';
import { runCli } from '../src/cli/run.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

let root: string;
beforeEach(async () => {
  root = tempProject('adminium-designer-prompt-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs', '--staff', '--customer', '--no-install'], { io, deps }), io.stderr()).toBe(0);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const session = (over: Partial<DesignerSession> = {}): DesignerSession =>
  ({ id: 'ds_000000000000000000000000', appKey: 'repairs', target: 'auto', connectionId: 'env:ollama', model: 'm', ...over }) as DesignerSession;
const say = (role: 'user' | 'assistant', text: string): RunMessage => ({ role, content: [{ type: 'text', text }] });

describe('what the Designer’s model is told', () => {
  it('carries the entry and app skills always, the screens skill for screens, the add-ons skill when one is named', () => {
    expect(skillsFor(session(), { hasSides: false, mentionsAddOn: false })).toEqual(['adminium/SKILL.md', 'adminium-app/SKILL.md', 'adminium-app/references/INDEX.md']);
    expect(skillsFor(session({ target: 'web' }), { hasSides: false, mentionsAddOn: false })).toContain('adminium-surface/SKILL.md');
    expect(skillsFor(session(), { hasSides: true, mentionsAddOn: true })).toEqual(expect.arrayContaining(['adminium-surface/SKILL.md', 'adminium-add-ons/SKILL.md']));
  });

  it('fits the smallest window with every skill a request can pull in, and leaves room to talk', async () => {
    const prompt = createPrompt({ root, version: APP_VERSION, skills: createSkills(), providerOf: async () => 'openai-compatible' });
    const { system, messages } = await prompt(session({ target: 'web' }), [say('user', 'Make a repair desk, and use the Invoices add-on.')]);
    expect(system).toContain('You are Adminium Designer');
    expect(system).toContain('===== adminium-app/SKILL.md =====');
    expect(system).toContain('===== adminium-surface/SKILL.md =====');
    expect(system).toContain('===== adminium-add-ons/SKILL.md =====');
    expect(system).toContain('Table items:');
    expect(system).toContain('apps/repairs/manifest/app.json');
    expect(system).not.toMatch(/^---\nname:/m);
    const used = estimateTokens(system);
    expect(used).toBeLessThan(ASSISTANT_INPUT_TOKEN_LIMIT['openai-compatible'] / 2);
    expect(messages).toHaveLength(1);
  });

  it('fits Ollama’s window too, the smallest a local model reads', async () => {
    const prompt = createPrompt({ root, version: APP_VERSION, skills: createSkills(), providerOf: async () => 'ollama' });
    const { system } = await prompt(session(), [say('user', 'go')]);
    expect(estimateTokens(system)).toBeLessThan(ASSISTANT_INPUT_TOKEN_LIMIT.ollama - 6000);
  });
});

describe('a long session, made to fit', () => {
  const turn = (n: number, resultSize: number): RunMessage[] => [
    say('user', `Request number ${String(n)}`),
    { role: 'assistant', content: [{ type: 'tool_call', id: `c${String(n)}`, name: 'read_file', input: { path: 'a.json' } }] },
    { role: 'user', content: [{ type: 'tool_result', callId: `c${String(n)}`, content: 'x'.repeat(resultSize) }] },
    say('assistant', `Done with number ${String(n)}.`),
  ];

  it('is left alone when it fits', () => {
    const messages = turn(1, 100);
    expect(trimTranscript(messages, 100_000)).toEqual(messages);
  });

  it('cuts old tool results first, keeping the last two turns whole', () => {
    const messages = [...turn(1, 20_000), ...turn(2, 20_000), ...turn(3, 20_000)];
    const trimmed = trimTranscript(messages, 13_000);
    const results = trimmed.flatMap((message) => message.content.flatMap((block) => (block.type === 'tool_result' ? [block.content.length] : [])));
    expect(results[0]).toBeLessThan(400);
    expect(results.slice(1)).toEqual([20_000, 20_000]);
  });

  it('folds whole old turns into a line each, keeps the first message, and never leaves a call without its answer', () => {
    const messages = Array.from({ length: 12 }, (_value, index) => turn(index + 1, 4000)).flat();
    const trimmed = trimTranscript(messages, 3000);
    expect(trimmed[0]).toEqual(say('user', 'Request number 1'));
    expect(JSON.stringify(trimmed)).toContain('Earlier: Request number 2 → Done with number 2.');
    // Every call still has its answer.
    expect(closeDangling(trimmed)).toEqual(trimmed);
    expect(estimateTokens(JSON.stringify(trimmed))).toBeLessThan(estimateTokens(JSON.stringify(messages)) / 4);
  });
});
