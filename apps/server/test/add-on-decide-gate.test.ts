// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whose deciding code may run, and when it may change. A package is trusted
 * by its bytes (bundled, or as the catalogue named it) or, outside
 * production, by a developer's say. And an install, update or uninstall
 * waits for the saves in flight and keeps new ones out until it is done.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  bindDeciderGates,
  callDecider,
  createDeciderGates,
  deciderGate,
  deciderTrusted,
  devTrustedKeys,
  installRejectionGuard,
  isForeignPromise,
  loadDecider,
  withDeciders,
  type GateDeps,
} from '../src/add-ons/decide.js';

const PKG = { key: 'kit', version: '1.0.0', integrity: 'sha512-AAAA' };

describe('whether a package\'s deciding code may run', () => {
  const none = { bundled: [], recorded: {} };

  it('yes when its tarball is the one this build bundles', () => {
    expect(deciderTrusted(PKG, { ...none, bundled: [PKG] })).toBe(true);
    expect(deciderTrusted(PKG, { ...none, bundled: [{ ...PKG, integrity: 'sha512-BBBB' }] })).toBe(false);
    expect(deciderTrusted(PKG, { ...none, bundled: [{ ...PKG, version: '1.0.1' }] })).toBe(false);
    expect(deciderTrusted(PKG, { ...none, bundled: [{ ...PKG, key: 'other' }] })).toBe(false);
  });

  it('yes when it is the one recorded for that key and version', () => {
    expect(deciderTrusted(PKG, { ...none, recorded: { 'kit@1.0.0': 'sha512-AAAA' } })).toBe(true);
    expect(deciderTrusted(PKG, { ...none, recorded: { 'kit@1.0.0': 'sha512-BBBB' } })).toBe(false);
    expect(deciderTrusted(PKG, { ...none, recorded: { 'kit@1.0.1': 'sha512-AAAA' } })).toBe(false);
  });

  it('yes for a key on the developer\'s list, never in production', () => {
    expect(deciderTrusted(PKG, { ...none, devKeys: 'other, kit', nodeEnv: 'development' })).toBe(true);
    expect(deciderTrusted(PKG, { ...none, devKeys: 'kit' })).toBe(true);
    expect(deciderTrusted(PKG, { ...none, devKeys: 'kit', nodeEnv: 'production' })).toBe(false);
    expect(deciderTrusted(PKG, { ...none, devKeys: 'kitchen', nodeEnv: 'test' })).toBe(false);
    expect(deciderTrusted(PKG, { ...none, devKeys: '' })).toBe(false);
    expect(deciderTrusted(PKG, none)).toBe(false);
    expect(devTrustedKeys(' a ,, b ', 'test')).toEqual(['a', 'b']);
    expect(devTrustedKeys('a', 'production')).toEqual([]);
  });
});

/** A row's status and the reloads, as a gate's writer sees them. */
function world(start: string | null = 'installed', waitMs = 80) {
  const log: string[] = [];
  let status = start;
  const deps: GateDeps = {
    status: async () => status,
    setStatus: async (_key, next) => {
      status = next;
      log.push(`status ${next}`);
    },
    rebuild: async () => {
      log.push('rebuild');
    },
    waitMs,
  };
  return { deps, log, status: () => status, remove: () => (status = null) };
}
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the gate round an add-on\'s code', () => {
  it('lets saves in together, and an update in alone, after them', async () => {
    const w = world();
    const gates = createDeciderGates(() => w.deps);
    const gate = gates.gate('kit');
    const leaveA = await gate.read();
    const leaveB = await gate.read();
    const order: string[] = [];
    const update = gate.write(async () => {
      order.push('update runs');
      return 'done';
    });
    await tick();
    // Marked for other processes at once; waiting here for the two saves.
    expect(w.status()).toBe('updating');
    expect(order).toEqual([]);
    leaveA();
    await tick();
    expect(order).toEqual([]);
    leaveB();
    await expect(update).resolves.toBe('done');
    expect(order).toEqual(['update runs']);
    expect(w.log).toEqual(['status updating', 'rebuild', 'status installed']);
  });

  it('keeps a save that arrives during an update out until it is done', async () => {
    const w = world();
    const gate = createDeciderGates(() => w.deps).gate('kit');
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const update = gate.write(() => new Promise<void>((resolve) => (finish = () => resolve())).then(() => void order.push('update done')));
    await tick();
    const save = gate.read().then((leave) => {
      order.push('save in');
      leave();
    });
    await tick();
    expect(order).toEqual([]);
    finish();
    await Promise.all([update, save]);
    expect(order).toEqual(['update done', 'save in']);
  });

  it('a save that arrives while an update still waits for others waits behind it', async () => {
    const w = world();
    const gate = createDeciderGates(() => w.deps).gate('kit');
    const order: string[] = [];
    const leave = await gate.read();
    const update = gate.write(async () => void order.push('update'));
    await tick();
    const late = gate.read().then((done) => {
      order.push('late save');
      done();
    });
    await tick();
    expect(order).toEqual([]);
    leave();
    await Promise.all([update, late]);
    expect(order).toEqual(['update', 'late save']);
  });

  it('gives up on saves that do not finish, puts the row back, and says to try again', async () => {
    const w = world('disabled', 30);
    const gate = createDeciderGates(() => w.deps).gate('kit');
    const leave = await gate.read();
    let ran = false;
    await expect(gate.write(async () => void (ran = true))).rejects.toMatchObject({ code: 'WRITE_CONFLICT', statusCode: 409, details: { retry: true } });
    expect(ran).toBe(false);
    expect(w.log).toEqual(['status updating', 'status disabled']);
    // The gate is open again: the next save and the next update go through.
    leave();
    (await gate.read())();
    await expect(gate.write(async () => 'second')).resolves.toBe('second');
  });

  it('leaves the row "updating" when the update stops half way, and still lets go of the gate', async () => {
    const w = world();
    const gate = createDeciderGates(() => w.deps).gate('kit');
    await expect(gate.write(async () => Promise.reject(new Error('the disk is full')))).rejects.toThrow('the disk is full');
    expect(w.status()).toBe('updating');
    expect(w.log).toEqual(['status updating']);
    (await gate.read())();
  });

  it('marks nothing when the work removed the add-on, or when it was never installed', async () => {
    const gone = world();
    await createDeciderGates(() => gone.deps).gate('kit').write(async () => void gone.remove());
    expect(gone.log).toEqual(['status updating', 'rebuild']);
    const fresh = world(null);
    await createDeciderGates(() => fresh.deps).gate('kit').write(async () => undefined);
    // An install: no row to mark before; the work made none here either.
    expect(fresh.log).toEqual(['rebuild']);
  });

  it('is one gate per add-on: another add-on\'s update waits for nobody here', async () => {
    const w = world();
    const gates = createDeciderGates(() => w.deps);
    const leave = await gates.gate('kit').read();
    await expect(gates.gate('other').write(async () => 'free')).resolves.toBe('free');
    leave();
  });

  it('with nothing bound, still keeps saves and updates apart', async () => {
    const gate = createDeciderGates(() => null).gate('kit');
    const leave = await gate.read();
    let ran = false;
    const update = gate.write(async () => void (ran = true));
    await tick();
    expect(ran).toBe(false);
    leave();
    await update;
    expect(ran).toBe(true);
  });
});

describe('a save that asks several add-ons', () => {
  afterEach(() => bindDeciderGates(null));

  it('enters each gate in key order, once, and leaves them all whatever happens', async () => {
    const gates = createDeciderGates(() => null);
    // While it runs, an update of either waits; named twice, a gate is entered once (and so left once).
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const save = gates.withDeciders(['b', 'a', 'b'], () => new Promise<void>((resolve) => (finish = () => resolve())).then(() => void order.push('save')));
    await tick();
    const updates = Promise.all(['a', 'b'].map((key) => gates.gate(key).write(async () => void order.push(`update ${key}`))));
    await tick();
    expect(order).toEqual([]);
    finish();
    await Promise.all([save, updates]);
    expect(order[0]).toBe('save');
    expect(order.slice(1).sort()).toEqual(['update a', 'update b']);
    // Left: an update of each goes straight through.
    await expect(gates.gate('a').write(async () => 'a')).resolves.toBe('a');
    await expect(gates.gate('b').write(async () => 'b')).resolves.toBe('b');
    await expect(gates.withDeciders(['a', 'b'], async () => Promise.reject(new Error('refused')))).rejects.toThrow('refused');
    await expect(gates.gate('a').write(async () => 'again')).resolves.toBe('again');
    await expect(gates.gate('b').write(async () => 'again')).resolves.toBe('again');
  });

  it('holds an update of any of them back while it runs', async () => {
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const save = withDeciders(['kit-a', 'kit-b'], () => new Promise<void>((resolve) => (finish = () => resolve())).then(() => void order.push('save done')));
    await tick();
    const update = deciderGate('kit-b').write(async () => void order.push('update'));
    await tick();
    expect(order).toEqual([]);
    finish();
    await Promise.all([save, update]);
    expect(order).toEqual(['save done', 'update']);
  });

  it('the process\'s own gates mark the row through what the server bound', async () => {
    const w = world();
    bindDeciderGates(w.deps);
    await deciderGate('kit-c').write(async () => undefined);
    expect(w.log).toEqual(['status updating', 'rebuild', 'status installed']);
  });
});

describe('a rejection an add-on leaves behind', () => {
  it('is told from one of this process\'s own by the promise it rejected', () => {
    const decider = loadDecider({ key: 'kit', version: '1.0.0', path: 'dist/server.js', bytes: Buffer.from('module.exports = { rows: function () { return {}; } };') });
    expect(callDecider('rows', decider, {})).toEqual({});
    const own = Promise.reject(new Error('ours'));
    own.catch(() => undefined);
    expect(isForeignPromise(own)).toBe(false);
    // A promise of another context is not an instance of this one's Promise.
    expect(isForeignPromise({ then: () => undefined })).toBe(true);
  });

  it('is dropped with one line in the log, and the process goes on', async () => {
    // The test runner listens for stray rejections too: step aside for this one test.
    const others = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    const lines: string[] = [];
    try {
      installRejectionGuard((message) => lines.push(message));
      const decider = loadDecider({
        key: 'kit',
        version: '1.0.0',
        path: 'dist/server.js',
        bytes: Buffer.from('module.exports = { rows: function () { Promise.reject(new Error("left behind")); return { ok: true }; } };'),
      });
      expect(callDecider('rows', decider, {})).toEqual({ ok: true });
      expect(callDecider('rows', decider, {})).toEqual({ ok: true });
      await tick(30);
      expect(lines).toEqual(['an add-on\'s code left a rejected promise behind; it was dropped']);
    } finally {
      process.removeAllListeners('unhandledRejection');
      for (const listener of others) process.on('unhandledRejection', listener);
    }
  });
});
