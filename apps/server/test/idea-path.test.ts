// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The idea path (W5): the visitor's idea is the Designer's start prompt, built as a dashboard in `main`, under the
 * operator's dashboard-only scope.
 *
 *  - The start prompt's session is a `dashboard` session, its idea the first user turn, every card answered no.
 *  - In an operator project the config lists `main` alone, whatever `ADMINIUM_YOUR_DATABASE` says: an app the Designer
 *    makes goes to the first database, `main`, never the user's own (`project/apps/project-apps.ts`).
 *  - `ADMINIUM_AI_OPERATOR_SCOPE=dashboard` refuses customer screens on the operator's AI.
 */
import { operatorTalliesRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Designer } from '../src/designer/service.js';
import { runStartPrompt, START_PROMPT_TALLY } from '../src/designer/start-prompt.js';
import type { AiConnections } from '../src/llm/connections.js';
import { operatorProjectConfig } from '../src/project/operator-project.js';
import { trialPolicy } from '../src/trial/policy.js';
import { makeStore } from './archive.helpers.js';
import { makeEnv } from './helpers.js';

const IDEA = 'A shop for my pottery, with orders and a stock list.';

describe('the idea path', () => {
  let meta: MetaDb;
  let destroy: () => Promise<void> = async () => undefined;
  beforeEach(async () => {
    ({ meta, destroy } = await makeStore('sqlite', true));
  });
  afterEach(async () => {
    await destroy();
  });

  it('the idea is the first user turn of a dashboard session on the default model, every card answered no', async () => {
    const sessions: unknown[] = [];
    const turns: unknown[] = [];
    const designer = {
      createSession: async (input: unknown) => (sessions.push(input), { id: 'ses_1' }),
      runner: { claim: () => ({ release: () => undefined }), start: async (_id: string, input: unknown) => (turns.push(input), { turn: 1 }) },
    } as unknown as Designer;
    const connections = { default: async () => ({ connection: { id: 'env:openai-compatible' }, model: 'house' }), refusal: () => null } as unknown as AiConnections;
    await runStartPrompt({ meta, designer, connections, prompt: IDEA }, { id: 'usr_1', label: 'Owner' });
    expect(sessions).toEqual([expect.objectContaining({ target: 'dashboard', connectionId: 'env:openai-compatible', model: 'house' })]);
    expect(turns).toEqual([expect.objectContaining({ text: IDEA, defaultNo: true })]);
    expect(await operatorTalliesRepo(meta).get(START_PROMPT_TALLY)).not.toBeNull();
  });

  it('an operator project lists main alone: the Designer’s app goes to main, never to the user’s own database', () => {
    const config = operatorProjectConfig({
      ADMINIUM_SOURCE_URL: 'postgres://trial_1:pw@pg-trials:5432/trial_1',
      ADMINIUM_YOUR_DATABASE: JSON.stringify({ url: 'postgres://u:p@db.example.com:5432/shop', intent: 'full-admin', tables: [] }),
    });
    expect(Object.keys(config.databases ?? {})).toEqual(['main']);
  });

  it('the operator’s dashboard scope refuses customer screens on its AI', () => {
    const policy = trialPolicy(makeEnv({ ADMINIUM_AI_OPERATOR_SCOPE: 'dashboard' }));
    expect(policy.allows('customerScreensOnOperatorAi')).toEqual({ allowed: false, reason: 'operator-ai-scope' });
  });
});
