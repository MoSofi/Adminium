// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The start prompt is never lost (W3).
 *
 *  - `/system/info` says it waits only where the Designer is live and switched on, and a default model is there.
 *  - A run the operator's gateway refused at its cap (429 before any step) spends nothing: the tally goes back, the
 *    session is told when it starts again, `POST /designer/start-prompt` answers 409 `START_PROMPT_WAITING`, and at
 *    that time it runs again in the same session. Any other failure keeps the tally spent.
 *  - A server restarted while it waits starts it at its next boot.
 */
import { operatorTalliesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesignerEventBody } from '../src/designer/events.js';
import type { Designer } from '../src/designer/service.js';
import {
  createStartPromptRetry,
  runStartPrompt,
  START_PROMPT_TALLY,
  START_PROMPT_WAIT_TALLY,
  startPromptWaiting,
  startPromptWaitsUntil,
  type StartPromptRetry,
} from '../src/designer/start-prompt.js';
import type { AiConnections } from '../src/llm/connections.js';
import { systemInfo } from '../src/routes/system/handlers.js';
import { AVAILABLE, makeStore, type EngineName } from './archive.helpers.js';
import { makeEnv } from './helpers.js';

const ENGINES = (['sqlite', 'postgres', 'mysql'] as EngineName[]).filter((engine) => AVAILABLE[engine]);
const PROMPT = 'A booking desk for my piano lessons.';
const OWNER = { id: 'usr_owner', label: 'Owner' };

/** A Designer that records the turns it is asked to start, and the events its sessions are told. */
function fakeDesigner() {
  const starts: { sessionId: string; text: string; by: unknown; defaultNo: boolean }[] = [];
  const told: { sessionId: string; body: DesignerEventBody }[] = [];
  let made = 0;
  const designer = {
    createSession: async () => ({ id: `ses_${String((made += 1))}` }),
    store: { read: (id: string) => ({ id, turns: 1 }) },
    runner: {
      claim: () => ({ release: () => undefined }),
      start: async (sessionId: string, input: { text: string; by: unknown; defaultNo?: boolean }) => {
        starts.push({ sessionId, text: input.text, by: input.by, defaultNo: input.defaultNo === true });
        return { turn: starts.filter((one) => one.sessionId === sessionId).length };
      },
      events: (sessionId: string) => ({
        emit: (_turn: number, body: DesignerEventBody) => {
          told.push({ sessionId, body });
          return body;
        },
      }),
    },
  } as unknown as Designer;
  return { designer, starts, told };
}

const withModel = { default: async () => ({ connection: { id: 'env:openai-compatible' }, model: 'house' }), refusal: () => null } as unknown as AiConnections;

describe.each(ENGINES)('the start prompt’s wait [%s]', { timeout: 60_000 }, (engine) => {
  let meta: MetaDb;
  let destroy: () => Promise<void> = async () => undefined;
  let retry: StartPromptRetry | null = null;
  beforeEach(async () => {
    ({ meta, destroy } = await makeStore(engine, true));
  });
  afterEach(async () => {
    retry?.stop();
    retry = null;
    await destroy();
  });

  it('a 429 at the cap before any step spends nothing, says when, refuses a second start, and runs again in the same session', async () => {
    const fake = fakeDesigner();
    const clock = Date.UTC(2026, 10, 19, 10, 0, 0);
    retry = createStartPromptRetry({ meta, designer: fake.designer, connections: withModel, prompt: PROMPT, now: () => clock, retryMs: 50 });
    const deps = { meta, designer: fake.designer, connections: withModel, prompt: PROMPT, retry };
    const started = await runStartPrompt(deps, OWNER);
    expect(await operatorTalliesRepo(meta).get(START_PROMPT_TALLY)).not.toBeNull();

    await retry.turnFinished({ sessionId: started.sessionId, startPrompt: true, outcome: 'failed', failure: 'rate_limit', steps: 0 });
    expect(await operatorTalliesRepo(meta).get(START_PROMPT_TALLY)).toBeNull();
    expect(await startPromptWaitsUntil({ meta, prompt: PROMPT })).toBe(clock + 50);
    // Waiting is not "waits to run": the wizard starts nothing, and a second start is refused with the time.
    expect(await startPromptWaiting({ meta, prompt: PROMPT })).toBe(false);
    await expect(runStartPrompt(deps, OWNER)).rejects.toMatchObject({ details: { reason: 'START_PROMPT_WAITING', until: clock + 50 } });
    expect(fake.told).toEqual([{ sessionId: started.sessionId, body: expect.objectContaining({ kind: 'error', code: 'start-prompt-waiting' }) }]);
    expect((fake.told[0]?.body as { message: string }).message).toContain(new Date(clock + 50).toISOString());

    // At its time: the same session, as the person who started it, every card answered no.
    await vi.waitFor(() => expect(fake.starts).toHaveLength(2), { timeout: 5_000, interval: 20 });
    expect(fake.starts[1]).toEqual({ sessionId: started.sessionId, text: PROMPT, by: OWNER, defaultNo: true });
    expect(await operatorTalliesRepo(meta).get(START_PROMPT_TALLY)).not.toBeNull();
    expect(await operatorTalliesRepo(meta).get(START_PROMPT_WAIT_TALLY)).toBeNull();
  });

  it('any other end keeps the tally spent: a failure past the first step, another error, a finished build', async () => {
    const fake = fakeDesigner();
    retry = createStartPromptRetry({ meta, designer: fake.designer, connections: withModel, prompt: PROMPT, retryMs: 50 });
    const started = await runStartPrompt({ meta, designer: fake.designer, connections: withModel, prompt: PROMPT, retry }, OWNER);
    for (const end of [
      { outcome: 'failed', failure: 'rate_limit', steps: 3 },
      { outcome: 'failed', failure: 'auth', steps: 0 },
      { outcome: 'done', steps: 9 },
    ]) {
      await retry.turnFinished({ sessionId: started.sessionId, startPrompt: true, ...end });
      expect(await operatorTalliesRepo(meta).get(START_PROMPT_TALLY)).not.toBeNull();
      expect(await operatorTalliesRepo(meta).get(START_PROMPT_WAIT_TALLY)).toBeNull();
    }
    // A turn that is not the start prompt's is none of its business.
    await retry.turnFinished({ sessionId: 'ses_other', outcome: 'failed', failure: 'rate_limit', steps: 0 });
    expect(await operatorTalliesRepo(meta).get(START_PROMPT_WAIT_TALLY)).toBeNull();
  });

  it('a server restarted while it waits starts it at its next boot, in a new session', async () => {
    const fake = fakeDesigner();
    await operatorTalliesRepo(meta).raise(START_PROMPT_WAIT_TALLY, Date.now() + 30);
    retry = createStartPromptRetry({ meta, designer: fake.designer, connections: withModel, prompt: PROMPT });
    await retry.resume();
    await vi.waitFor(() => expect(fake.starts).toHaveLength(1), { timeout: 5_000, interval: 20 });
    expect(fake.starts[0]).toMatchObject({ text: PROMPT, defaultNo: true });
    expect(await operatorTalliesRepo(meta).get(START_PROMPT_WAIT_TALLY)).toBeNull();
    expect(await operatorTalliesRepo(meta).get(START_PROMPT_TALLY)).not.toBeNull();
  });

  it('/system/info says it waits only where the Designer is switched on and a model is there', async () => {
    const env = makeEnv({ ADMINIUM_DESIGNER_START_PROMPT_B64: Buffer.from(PROMPT).toString('base64') });
    const ask = async (designer: 'live' | 'local' | 'off', model: boolean) =>
      (await systemInfo({ env, meta, designer, hasDefaultModel: async () => model })).designer;
    expect((await ask('off', true)).startPrompt).toBe(false);
    // Live, but the switch is off: nothing would run it.
    expect((await ask('live', true)).startPrompt).toBe(false);
    await settingsRepo(meta).set('designer.live', true, { updatedBy: null });
    expect((await ask('live', false)).startPrompt).toBe(false);
    expect(await ask('live', true)).toMatchObject({ startPrompt: true, startPromptWaitsUntil: null });
    expect((await ask('local', true)).startPrompt).toBe(true);
    // Waiting for the cap: not offered, and the time is said.
    await operatorTalliesRepo(meta).raise(START_PROMPT_WAIT_TALLY, 1_800_000_000_000);
    expect(await ask('live', true)).toMatchObject({ startPrompt: false, startPromptWaitsUntil: 1_800_000_000_000 });
  });
});
