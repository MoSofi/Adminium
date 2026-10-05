// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's deciding code, run: one classic script in a bare context made
 * for the call, with no clock, no randomness, no network and no way to make
 * code from text; JSON in, JSON out; an answer at once and in time, or none.
 */
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DECIDER_FILE_MAX, DECIDER_OUTPUT_MAX, DECIDER_TIMEOUT_MS, DeciderFailed, callDecider, loadDecider, type DeciderFailure } from '../src/add-ons/decide.js';

const load = (source: string) => loadDecider({ key: 'kit', version: '1.0.0', path: 'dist/server.js', bytes: Buffer.from(source, 'utf8') });
const failure = (run: () => unknown): DeciderFailure | 'answered' => {
  try {
    run();
    return 'answered';
  } catch (error) {
    if (error instanceof DeciderFailed) return error.cause;
    throw error;
  }
};

describe('loading a deciding file', () => {
  it('compiles it once and reads which questions it answers', () => {
    const both = load('module.exports = { rows: function (input) { return { rows: [] }; }, adjust: function () { return {}; }, helper: 1 };');
    expect(both.kinds).toEqual(['rows', 'adjust']);
    expect(both.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(both.script).toBeInstanceOf(vm.Script);
    expect(load('exports.rows = function () { return {}; };').kinds).toEqual(['rows']);
    expect(load('module.exports.adjust = function () { return {}; };').kinds).toEqual(['adjust']);
    // Other bytes are another decider.
    expect(load('module.exports = { rows: function () { return 1; } };').sha256).not.toBe(both.sha256);
  });

  it('refuses a file that is too large, will not compile, or answers neither question', () => {
    expect(() => load(`module.exports = { rows: function () { return {}; } };//${'x'.repeat(DECIDER_FILE_MAX)}`)).toThrow(/the most that is run is 524288/);
    expect(() => load('module.exports = {')).toThrow();
    expect(() => load('module.exports = { plan: function () {} };')).toThrow(/exports neither "rows" nor "adjust"/);
    expect(() => load('module.exports = 7;')).toThrow(/exports neither/);
    expect(() => load('module.exports = { rows: 1 };')).toThrow(/exports neither/);
  });

  it('refuses a file that reaches for a module system or the process as it loads', () => {
    expect(() => load('const fs = require("node:fs"); module.exports = { rows: function () { return {}; } };')).toThrow(/does not load: require is not defined/);
    expect(() => load('module.exports = { rows: function () { return {}; } }; process.exit(1);')).toThrow(/does not load: process is not defined/);
    expect(() => load('while (true) {} module.exports = { rows: function () {} };')).toThrow(/does not load/);
  });
});

describe('asking it a question', () => {
  it('hands the input in and reads the answer back, as plain data of this process', () => {
    const decider = load('module.exports = { rows: function (input) { return { echo: input, sum: input.lines.reduce(function (s, l) { return s + l.qty; }, 0) }; } };');
    const input = { lines: [{ qty: 2 }, { qty: 3 }], when: '2026-10-05' };
    const answer = callDecider('rows', decider, input) as { echo: unknown; sum: number };
    expect(answer).toEqual({ echo: input, sum: 5 });
    expect(answer.echo).not.toBe(input);
    // An object of this process: nothing of the context came out.
    expect(Object.getPrototypeOf(answer)).toBe(Object.prototype);
    expect(Array.isArray((answer.echo as typeof input).lines)).toBe(true);
  });

  it('gives it no clock, no randomness, no network, no timers and no way to make code from text', () => {
    const decider = load(`module.exports = { rows: function () {
      var names = ['Date', 'Intl', 'fetch', 'process', 'require', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'eval', 'Function', 'WeakRef', 'FinalizationRegistry', 'console', 'globalThis.Buffer'];
      var seen = {};
      for (var i = 0; i < names.length; i += 1) { try { seen[names[i]] = typeof (0, globalThis)[names[i]]; } catch (e) { seen[names[i]] = 'threw'; } }
      seen.random = typeof Math.random;
      seen.json = typeof JSON.parse;
      seen.locale = (1234.5).toFixed(1);
      return seen;
    } };`);
    const seen = callDecider('rows', decider, {}) as Record<string, string>;
    const { random, json, locale, ...globals } = seen;
    expect(Object.values(globals).every((type) => type === 'undefined')).toBe(true);
    expect(Object.keys(globals)).toHaveLength(18);
    expect(random).toBe('undefined');
    // The language itself is all there.
    expect(json).toBe('function');
    expect(locale).toBe('1234.5');
  });

  it.each([
    ['a function made from text', "(function () {}).constructor('return 1')()"],
    ['the array constructor\'s constructor', "[].constructor.constructor('return 1')()"],
    ['an async function made from text', "(async function () {}).constructor('return 1')"],
    ['a generator made from text', "(function* () {}).constructor('return 1')"],
  ])('refuses %s', (_name, attempt) => {
    const decider = load(`module.exports = { rows: function () { return ${attempt}; } };`);
    const error = (() => {
      try {
        callDecider('rows', decider, {});
      } catch (caught) {
        return caught as DeciderFailed;
      }
      return null;
    })();
    expect(error?.cause).toBe('threw');
    expect(error?.detail).toMatch(/Code generation from strings disallowed/);
  });

  it('freezes what it was handed, all the way down', () => {
    // A change that would throw throws; one that plain code makes in silence is not made.
    const push = load('module.exports = { rows: function (input) { input.lines.push(1); return {}; } };');
    const strict = load('"use strict"; module.exports = { rows: function (input) { input.lines[0].qty = 9; return {}; } };');
    expect(failure(() => callDecider('rows', push, { lines: [{ qty: 1 }] }))).toBe('threw');
    expect(failure(() => callDecider('rows', strict, { lines: [{ qty: 1 }] }))).toBe('threw');
    const quiet = load('module.exports = { rows: function (input) { input.lines[0].qty = 9; input.extra = 1; delete input.when; return input; } };');
    expect(callDecider('rows', quiet, { lines: [{ qty: 1 }], when: 'now' })).toEqual({ lines: [{ qty: 1 }], when: 'now' });
    const frozen = load('module.exports = { rows: function (input) { return { top: Object.isFrozen(input), list: Object.isFrozen(input.lines), row: Object.isFrozen(input.lines[0]) }; } };');
    expect(callDecider('rows', frozen, { lines: [{ qty: 1 }] })).toEqual({ top: true, list: true, row: true });
  });

  it('keeps nothing between two calls: the second starts as the first did', () => {
    const decider = load('var n = 0; module.exports = { rows: function () { n += 1; return { n: n }; } };');
    expect(callDecider('rows', decider, {})).toEqual({ n: 1 });
    expect(callDecider('rows', decider, {})).toEqual({ n: 1 });
  });

  it('gives no answer when the code runs on, and takes about as long as the limit to say so', () => {
    const decider = load('module.exports = { rows: function () { while (true) {} } };');
    const started = performance.now();
    expect(failure(() => callDecider('rows', decider, {}))).toBe('timeout');
    const took = performance.now() - started;
    expect(took).toBeGreaterThanOrEqual(DECIDER_TIMEOUT_MS - 20);
    expect(took).toBeLessThan(DECIDER_TIMEOUT_MS * 4);
    // A chain of promises that feeds itself after the answer is stopped the same way.
    const chain = load('module.exports = { rows: function () { var again = function () { Promise.resolve().then(again); }; again(); return {}; } };');
    expect(failure(() => callDecider('rows', chain, {}))).toBe('timeout');
  });

  it('gives no answer for a promise, a throw, a value JSON cannot hold, too much, or the wrong question', () => {
    expect(failure(() => callDecider('rows', load('module.exports = { rows: async function () { return {}; } };'), {}))).toBe('thenable');
    expect(failure(() => callDecider('rows', load('module.exports = { rows: function () { return { then: function () {} }; } };'), {}))).toBe('thenable');
    expect(failure(() => callDecider('rows', load('module.exports = { rows: function () { return undefined; } };'), {}))).toBe('shape');
    expect(failure(() => callDecider('rows', load('module.exports = { rows: function () { var a = {}; a.a = a; return a; } };'), {}))).toBe('threw');
    expect(failure(() => callDecider('adjust', load('module.exports = { rows: function () { return {}; } };'), {}))).toBe('no-method');
    const large = load(`module.exports = { rows: function () { return { text: 'x'.repeat(${String(DECIDER_OUTPUT_MAX)}) }; } };`);
    expect(failure(() => callDecider('rows', large, {}))).toBe('too-large');
    const under = load(`module.exports = { rows: function () { return { text: 'x'.repeat(${String(DECIDER_OUTPUT_MAX - 100)}) }; } };`);
    expect(failure(() => callDecider('rows', under, {}))).toBe('answered');
  });

  it('carries the add-on\'s own words out, cut short, and never its error object', () => {
    const decider = load(`module.exports = { rows: function () { throw new Error('${'no stock '.repeat(60)}'); } };`);
    try {
      callDecider('rows', decider, {});
      throw new Error('answered');
    } catch (error) {
      expect(error).toBeInstanceOf(DeciderFailed);
      const failed = error as DeciderFailed;
      expect(failed.cause).toBe('threw');
      expect(failed.detail.startsWith('no stock no stock')).toBe(true);
      expect(failed.detail).toHaveLength(200);
      expect(failed.message).toBe('The add-on\'s code gave no answer (threw).');
      // The message a caller may show never repeats the add-on's text.
      expect(failed.message).not.toContain('no stock');
    }
  });

  it('holds the answer to the contract\'s shape when one is given', () => {
    const decider = load('module.exports = { rows: function (input) { return input.good ? { rows: [], extra: 1 } : { rows: "none" }; } };');
    const shape = z.object({ rows: z.array(z.unknown()) }).strict();
    expect(failure(() => callDecider('rows', decider, { good: false }, { shape }))).toBe('shape');
    expect(failure(() => callDecider('rows', decider, { good: true }, { shape }))).toBe('shape');
    expect(callDecider('rows', decider, { good: true }, { shape: z.object({ rows: z.array(z.unknown()) }) })).toEqual({ rows: [] });
  });

  it('says so once when an answer was slow', () => {
    const lines: string[] = [];
    const slow = load('module.exports = { rows: function () { var n = 0; for (var i = 0; i < 1.5e8; i += 1) n += i % 7; return { n: n }; } };');
    const quick = load('module.exports = { rows: function () { return {}; } };');
    callDecider('rows', quick, {}, { log: (message) => lines.push(message) });
    expect(lines).toEqual([]);
    try {
      callDecider('rows', slow, {}, { log: (message) => lines.push(message) });
    } catch {
      // A machine slow enough to time it out has nothing to warn about.
      return;
    }
    expect(lines).toEqual(['an add-on took long to decide']);
  });
});
