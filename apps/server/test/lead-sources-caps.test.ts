// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What bounds the calls to a source, so a click or a rule never spends more
 * of the owner's account than they said.
 *
 * In memory: a third call in flight on one source is refused `BUSY` while
 * another source answers; a source paused (a 429) is refused `PAUSED` with the
 * seconds left, and only that source; a source's own rate window runs out and
 * fills again.
 *
 * Persisted, on every engine this run can reach: the 101st paid call of the
 * day is refused by name; two calls at once at 99 do not both pass; a person
 * past their share is refused while a colleague is not; the automation step
 * counts apart, on a budget of its own; a call that was never made counts
 * nothing.
 */
import { SOURCE_DAY_STEP, SOURCE_DAY_TOTAL, sourceDayOf, sourceDaysRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_IN_FLIGHT, SourceGate, personCap, reserveDay, retryAfterSeconds, stepCap, usedToday } from '../src/lead-sources/caps.js';
import { forgetSources, mutateSourceState, readSourcesState, type SourceState } from '../src/lead-sources/state.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const AT = Date.UTC(2026, 10, 18, 9, 0, 0);

describe('the in-memory gate of each source', () => {
  it('refuses a third call in flight on one source BUSY, and lets another source answer meanwhile', () => {
    const gate = new SourceGate(() => AT);
    const one = gate.enter('mft_a', 'hunter', undefined);
    const two = gate.enter('mft_a', 'hunter', undefined);
    expect(one.ok && two.ok).toBe(true);
    const third = gate.enter('mft_a', 'hunter', undefined);
    expect(third).toMatchObject({ ok: false, code: 'BUSY' });
    expect(MAX_IN_FLIGHT).toBe(2);
    // Another source of the same install, and the same source of another install, are their own.
    expect(gate.enter('mft_a', 'companies-house', undefined).ok).toBe(true);
    expect(gate.enter('mft_b', 'hunter', undefined).ok).toBe(true);
    // One call ends: the next goes in; leaving twice frees one place, not two.
    if (one.ok) {
      one.leave();
      one.leave();
    }
    expect(gate.enter('mft_a', 'hunter', undefined).ok).toBe(true);
    expect(gate.enter('mft_a', 'hunter', undefined)).toMatchObject({ ok: false, code: 'BUSY' });
  });

  it('pauses only the source that said "too many", for the seconds it named', () => {
    let now = AT;
    const gate = new SourceGate(() => now);
    gate.pause('mft_a', 'hunter', 30);
    expect(gate.enter('mft_a', 'hunter', undefined)).toMatchObject({ ok: false, code: 'PAUSED', retryAfterSeconds: 30 });
    expect(gate.enter('mft_a', 'companies-house', undefined).ok).toBe(true);
    now += 29_000;
    expect(gate.enter('mft_a', 'hunter', undefined)).toMatchObject({ ok: false, code: 'PAUSED', retryAfterSeconds: 1 });
    now += 1_000;
    expect(gate.enter('mft_a', 'hunter', undefined).ok).toBe(true);
    // No seconds named: a minute.
    gate.pause('mft_a', 'sirene', undefined);
    expect(gate.pausedFor('mft_a', 'sirene')).toBe(60);
  });

  it("runs out of a source's own window and fills again as it runs", () => {
    let now = AT;
    const gate = new SourceGate(() => now);
    const window = { calls: 2, seconds: 10 };
    for (let n = 0; n < 2; n += 1) {
      const entered = gate.enter('mft_a', 'sirene', window);
      expect(entered.ok).toBe(true);
      if (entered.ok) entered.leave();
    }
    expect(gate.enter('mft_a', 'sirene', window)).toMatchObject({ ok: false, code: 'PAUSED', retryAfterSeconds: 5 });
    now += 5_000;
    expect(gate.enter('mft_a', 'sirene', window).ok).toBe(true);
  });

  it('reads a Retry-After header as seconds or as a date', () => {
    expect(retryAfterSeconds('120')).toBe(120);
    expect(retryAfterSeconds(new Date(AT + 30_000).toUTCString(), AT)).toBe(30);
    expect(retryAfterSeconds('soon')).toBeUndefined();
    expect(retryAfterSeconds(null)).toBeUndefined();
  });

  it("counts a person's share and the step's budget from the day's cap", () => {
    expect(personCap({ dailyCap: 100, personShare: 50 })).toBe(50);
    expect(personCap({ dailyCap: 3, personShare: 10 })).toBe(1);
    expect(personCap({ dailyCap: null, personShare: 50 })).toBeNull();
    expect(personCap({ dailyCap: 100, personShare: null })).toBeNull();
    expect(stepCap({ dailyCap: 100 })).toBe(20);
    expect(stepCap({ dailyCap: null })).toBe(100);
  });
});

describe.each(META_ENGINES)('the day caps of a paid source — $name', (engine) => {
  let handle: MetaHandle;
  const base = { installId: 'mft_one', source: 'hunter', at: AT };
  const paid = { dailyCap: 100, personShare: 100 };

  beforeEach(async () => {
    if (engine.available) handle = await engine.make();
  });
  afterEach(async () => {
    if (engine.available) await handle.destroy();
  });

  /** Calls `count` times, each made and settled, as `spender`. */
  async function spend(spender: string, count: number, state: Pick<SourceState, 'dailyCap' | 'personShare'> = paid): Promise<void> {
    for (let n = 0; n < count; n += 1) {
      const held = await reserveDay(handle.meta, { ...base, spender, state });
      if (!held.ok) throw new Error(`call ${String(n)} refused: ${held.code}`);
      await held.hold.settle(true);
    }
  }

  it.skipIf(!engine.available)('refuses the 101st paid call of the day by name, and counts nothing for it', async () => {
    await spend('usr_mara', 60);
    await spend('usr_tom', 40);
    expect(await usedToday(handle.meta, 'mft_one', 'hunter', AT)).toBe(100);
    const refused = await reserveDay(handle.meta, { ...base, spender: 'usr_tom', state: paid });
    expect(refused).toMatchObject({ ok: false, code: 'DAILY_CAP', used: 100, cap: 100 });
    expect(!refused.ok && refused.message).toBe('hunter: 100 of 100 today.');
    expect(await usedToday(handle.meta, 'mft_one', 'hunter', AT)).toBe(100);
    // Tomorrow is a new day.
    expect((await reserveDay(handle.meta, { ...base, at: AT + 86_400_000, spender: 'usr_tom', state: paid })).ok).toBe(true);
  });

  it.skipIf(!engine.available)('lets only one of two calls at once at 99 pass', async () => {
    await spend('usr_mara', 99);
    const both = await Promise.all([reserveDay(handle.meta, { ...base, spender: 'usr_mara', state: paid }), reserveDay(handle.meta, { ...base, spender: 'usr_tom', state: paid })]);
    expect(both.filter((one) => one.ok)).toHaveLength(1);
    expect(both.filter((one) => !one.ok).map((one) => !one.ok && one.code)).toEqual(['DAILY_CAP']);
    const total = await sourceDaysRepo(handle.meta).day({ installId: 'mft_one', source: 'hunter', day: sourceDayOf(AT), spender: SOURCE_DAY_TOTAL });
    expect(total).toMatchObject({ calls: 99, held: 1 });
  });

  it.skipIf(!engine.available)('refuses a person past their share while a colleague still calls', async () => {
    const shared = { dailyCap: 10, personShare: 50 };
    await spend('usr_mara', 5, shared);
    const mara = await reserveDay(handle.meta, { ...base, spender: 'usr_mara', state: shared });
    expect(mara).toMatchObject({ ok: false, code: 'PERSON_SHARE', used: 5, cap: 5 });
    // Her refusal held nothing of the day.
    expect(await sourceDaysRepo(handle.meta).day({ installId: 'mft_one', source: 'hunter', day: sourceDayOf(AT), spender: SOURCE_DAY_TOTAL })).toMatchObject({ calls: 5, held: 0 });
    const tom = await reserveDay(handle.meta, { ...base, spender: 'usr_tom', state: shared });
    expect(tom.ok).toBe(true);
  });

  it.skipIf(!engine.available)('counts the automation step apart, on a budget of its own', async () => {
    const shared = { dailyCap: 10, personShare: 50 };
    await spend('usr_mara', 5, shared);
    // A fifth of the day's cap: two calls.
    await spend(SOURCE_DAY_STEP, 2, shared);
    expect(await reserveDay(handle.meta, { ...base, spender: SOURCE_DAY_STEP, state: shared })).toMatchObject({ ok: false, code: 'PERSON_SHARE', cap: 2 });
    expect(await sourceDaysRepo(handle.meta).day({ installId: 'mft_one', source: 'hunter', day: sourceDayOf(AT), spender: SOURCE_DAY_STEP })).toMatchObject({ calls: 2, held: 0 });
    // A person's count is not the step's.
    expect((await reserveDay(handle.meta, { ...base, spender: 'usr_tom', state: shared })).ok).toBe(true);
  });

  it.skipIf(!engine.available)("forgets an install's sources when it goes: its document and its counts, never another install's", async () => {
    const entry = { id: 'hunter', hosts: ['api.hunter.io'], key: 'hunter_key', gives: ['people' as const], paid: true };
    await spend('usr_mara', 2);
    await mutateSourceState(handle.meta, 'mft_one', entry, (state) => ({ ...state, on: true }));
    await mutateSourceState(handle.meta, 'mft_two', entry, (state) => ({ ...state, on: true }));
    await forgetSources(handle.meta, 'mft_one');
    expect(await usedToday(handle.meta, 'mft_one', 'hunter', AT)).toBe(0);
    expect((await readSourcesState(handle.meta, 'mft_one')).sources).toEqual({});
    expect((await readSourcesState(handle.meta, 'mft_two')).sources['hunter']?.on).toBe(true);
  });

  it.skipIf(!engine.available)('counts nothing for a call that was never made, and still counts a free source with no cap', async () => {
    const held = await reserveDay(handle.meta, { ...base, spender: 'usr_mara', state: paid });
    if (!held.ok) throw new Error(held.code);
    await held.hold.settle(false);
    await held.hold.settle(true);
    expect(await usedToday(handle.meta, 'mft_one', 'hunter', AT)).toBe(0);
    await spend('usr_mara', 3, { dailyCap: null, personShare: 50 });
    expect(await usedToday(handle.meta, 'mft_one', 'hunter', AT)).toBe(3);
  });
});
