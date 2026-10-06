// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ADD-ON CODE THAT DECIDES, INSIDE A SAVE.
 *
 * Two contracts hand an add-on a question in the middle of a write: which
 * rows a posting makes (`posting-rows`), and what a price is lowered by
 * (`price-adjust`). The answer is worked out by the add-on's own code, so
 * that code is run here and nowhere else, under these rules:
 *
 *  - It is one classic script that assigns `module.exports = { rows }`,
 *    `{ adjust }` or both. It is never `import()`ed: it is compiled into a
 *    `vm.Script` and run in a bare context made for the one call.
 *  - The context has no clock, no randomness, no network, no timers and no
 *    way to make code from text. The same input gives the same output.
 *  - Input crosses as JSON text and is parsed and frozen inside; the answer
 *    is turned to JSON text inside and parsed outside. No object of this
 *    process is ever handed in, and none of the context's comes out.
 *  - It answers at once (no promise) within {@link DECIDER_TIMEOUT_MS}, or
 *    the call fails and the save that asked is refused.
 *
 * This is hardening against mistakes, not a sandbox against hostile code.
 * What keeps hostile code out is trust: a deciding package loads only when
 * its bytes are the ones this build bundles, the ones the catalogue named
 * when it was downloaded, or (never in production) the developer's own.
 */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import vm from 'node:vm';

import type { z } from 'zod';

import { ConflictError } from '../errors.js';

/** The hard limit of one call, and when a slow one is worth a line in the log. */
export const DECIDER_TIMEOUT_MS = 250;
export const DECIDER_WARN_MS = 50;
/** The largest file that is run, and the largest answer that is read. */
export const DECIDER_FILE_MAX = 512 * 1024;
export const DECIDER_OUTPUT_MAX = 2 * 1024 * 1024;
/** How long an install, update or uninstall waits for the saves in flight. */
export const DECIDER_GATE_WAIT_MS = 30_000;

/** What a ledger's reads and writes are held to (the write path's, kept with the other limits). */
export const LEDGER_READS_MAX = 6;
export const LEDGER_READ_ROWS = 1000;
export const LEDGER_READ_ROWS_ALL = 3000;
export const LEDGER_ROWS_WRITTEN = 500;
export const POSTINGS_PER_TABLE = 6;
export const WORDS_IDS_MAX = 60;

/** The two questions an add-on's code answers, by the method that answers each. */
export const DECIDER_KINDS = ['rows', 'adjust'] as const;
export type DeciderKind = (typeof DECIDER_KINDS)[number];

/** The contracts whose server file is a decider: run here, never imported. */
export const DECIDER_CONTRACTS: Readonly<Record<string, DeciderKind>> = { 'posting-rows': 'rows', 'price-adjust': 'adjust' };

/** Why a call gave no answer. Never shown to a customer: the save is refused in the ledger's own words. */
export type DeciderFailure = 'timeout' | 'threw' | 'thenable' | 'shape' | 'too-large' | 'no-method';

export class DeciderFailed extends Error {
  override readonly name = 'DeciderFailed';

  constructor(
    readonly cause: DeciderFailure,
    /** The add-on's own words, cut short. Never the context's error object. */
    readonly detail: string,
  ) {
    super(`The add-on's code gave no answer (${cause}).`);
  }
}

/** An add-on's deciding code, compiled and ready to run. */
export interface InstalledDecider {
  key: string;
  version: string;
  /** Of the file's bytes: a re-upload with other bytes is another decider. */
  sha256: string;
  /** The methods the file exports. */
  kinds: readonly DeciderKind[];
  script: vm.Script;
  cached: Buffer | undefined;
}

/** Everything a decider may not reach: taken off the context before its code runs. */
const STRIPPED = ['Date', 'Intl', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'eval', 'Function', 'queueMicrotask', 'WeakRef', 'FinalizationRegistry', 'console'];

const STRIP = new vm.Script(
  `(function () {
    'use strict';
    for (const name of ${JSON.stringify(STRIPPED)}) {
      try { delete globalThis[name]; } catch (e) {}
      if (name in globalThis) Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
    }
    Object.defineProperty(Math, 'random', { value: undefined, writable: false, configurable: false });
  })();`,
  { filename: 'adminium:decider-strip' },
);

/** Which methods the file exports, as JSON text. */
const KINDS = new vm.Script(
  `JSON.stringify(Object.keys(__decider === null || typeof __decider !== 'object' ? {} : __decider).filter(function (name) { return typeof __decider[name] === 'function'; }))`,
  { filename: 'adminium:decider-kinds' },
);

/** Parses and freezes the input inside, calls the method, refuses a promise, answers JSON text. */
const ENTRY = new vm.Script(
  `(function () {
    'use strict';
    var freeze = function (value) {
      if (value !== null && typeof value === 'object') {
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i += 1) freeze(value[keys[i]]);
        Object.freeze(value);
      }
      return value;
    };
    var method = __decider === null || typeof __decider !== 'object' ? undefined : __decider[__kind];
    if (typeof method !== 'function') return '\\u0000no-method';
    var answer = method(freeze(JSON.parse(__input)));
    if (answer !== null && (typeof answer === 'object' || typeof answer === 'function') && typeof answer.then === 'function') return '\\u0000thenable';
    var text = JSON.stringify(answer);
    return typeof text === 'string' ? text : '\\u0000shape';
  })()`,
  { filename: 'adminium:decider-entry' },
);

/** The file, wrapped so `module.exports` is its own and is left on the context for the entry to call. */
function wrap(source: string): string {
  return `(function () { var module = { exports: {} }; (function (module, exports) {\n${source}\n}).call(module.exports, module, module.exports); Object.defineProperty(globalThis, '__decider', { value: module.exports, writable: false, configurable: false, enumerable: false }); })();`;
}

/** A context with nothing in it but the language. */
function bareContext(): vm.Context {
  return vm.createContext(Object.create(null) as object, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
}

/** A thrown thing's message, as plain text of this process, cut short. */
function wordsOf(error: unknown): string {
  const own = ownValue(error, 'message');
  if (typeof own === 'string') return own.slice(0, 200);
  return error !== null && (typeof error === 'object' || typeof error === 'function') ? 'an error that could not be read' : String(error).slice(0, 200);
}

/**
 * A property of what an add-on threw, read WITHOUT running any of its code:
 * only a plain value the thing itself holds. A getter, a `toString` or a
 * proxy's trap would run here, in this process, after the call's time limit
 * has stopped counting — a loop there would never end.
 */
function ownValue(thrown: unknown, name: string): unknown {
  if (thrown === null || (typeof thrown !== 'object' && typeof thrown !== 'function') || types.isProxy(thrown)) return undefined;
  return Object.getOwnPropertyDescriptor(thrown, name)?.value;
}

/** What is left of a call's time, as the whole milliseconds a script's limit takes; never none. */
const msLeft = (deadline: number): number => Math.max(1, Math.ceil(deadline - performance.now()));

const timedOut = (error: unknown): boolean => ownValue(error, 'code') === 'ERR_SCRIPT_EXECUTION_TIMEOUT';

/** Runs the strip and the decider's file in a context, within what is left of the time. */
function prepared(decider: Pick<InstalledDecider, 'script'>, deadline: number): vm.Context {
  const context = bareContext();
  const left = (): number => msLeft(deadline);
  STRIP.runInContext(context, { timeout: left() });
  decider.script.runInContext(context, { timeout: left() });
  return context;
}

/**
 * Compiles an add-on's deciding file. Throws when it is too large, will not
 * compile, or exports neither method: the add-on is then unavailable, and
 * says so, rather than failing the first save that needs it.
 */
export function loadDecider(input: { key: string; version: string; path: string; bytes: Uint8Array }): InstalledDecider {
  if (input.bytes.byteLength > DECIDER_FILE_MAX) {
    throw new Error(`"${input.key}" ships a deciding file of ${String(input.bytes.byteLength)} bytes; the most that is run is ${String(DECIDER_FILE_MAX)}.`);
  }
  const source = Buffer.from(input.bytes).toString('utf8');
  const script = new vm.Script(wrap(source), {
    filename: `add-on:${input.key}@${input.version}/${input.path}`,
    // A file that asks for another module gets a refusal inside its own context, never one that reaches this process.
    importModuleDynamically: () => {
      throw new Error('An add-on\'s deciding file is one script: it imports nothing.');
    },
  });
  const decider = { key: input.key, version: input.version, sha256: createHash('sha256').update(input.bytes).digest('hex'), script, cached: undefined as Buffer | undefined };
  let kinds: DeciderKind[];
  try {
    const context = prepared(decider, performance.now() + DECIDER_TIMEOUT_MS);
    const named = JSON.parse(String(KINDS.runInContext(context, { timeout: DECIDER_TIMEOUT_MS }))) as string[];
    kinds = DECIDER_KINDS.filter((kind) => named.includes(kind));
  } catch (error) {
    throw new Error(`"${input.key}" ships a deciding file that does not load: ${wordsOf(error)}`);
  }
  if (kinds.length === 0) throw new Error(`"${input.key}" ships a deciding file that exports neither "rows" nor "adjust".`);
  return { ...decider, kinds, cached: script.createCachedData() };
}

export interface CallOptions {
  /** The shape the answer must have; an answer that misses it is no answer. */
  shape?: z.ZodType | undefined;
  log?: ((message: string, data?: Record<string, unknown>) => void) | undefined;
}

/**
 * Asks an add-on's code one question and answers what it said, or throws
 * {@link DeciderFailed}. Synchronous: nothing else of this process runs
 * while the add-on thinks, which is why it may think for so little.
 */
export function callDecider(kind: DeciderKind, decider: InstalledDecider, input: unknown, opts: CallOptions = {}): unknown {
  const started = performance.now();
  const deadline = started + DECIDER_TIMEOUT_MS;
  let text: unknown;
  try {
    const json = JSON.stringify(input);
    const context = prepared(decider, deadline);
    const sandbox = context as Record<string, unknown>;
    sandbox['__kind'] = kind;
    sandbox['__input'] = json;
    text = ENTRY.runInContext(context, { timeout: msLeft(deadline) });
  } catch (error) {
    throw new DeciderFailed(timedOut(error) ? 'timeout' : 'threw', wordsOf(error));
  }
  const took = performance.now() - started;
  if (took > DECIDER_WARN_MS) opts.log?.('an add-on took long to decide', { key: decider.key, version: decider.version, kind, ms: Math.round(took) });
  // Only text ever crosses back; anything else is no answer.
  if (typeof text !== 'string') throw new DeciderFailed('shape', 'the answer was not text');
  if (text === '\u0000thenable') throw new DeciderFailed('thenable', 'the add-on answered with a promise; it must answer at once');
  if (text === '\u0000no-method') throw new DeciderFailed('no-method', `the add-on exports no "${kind}"`);
  if (text === '\u0000shape') throw new DeciderFailed('shape', 'the answer cannot be written as JSON');
  if (text.length > DECIDER_OUTPUT_MAX || Buffer.byteLength(text) > DECIDER_OUTPUT_MAX) throw new DeciderFailed('too-large', `the answer is over ${String(DECIDER_OUTPUT_MAX)} bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DeciderFailed('shape', 'the answer is not JSON');
  }
  if (opts.shape === undefined) return parsed;
  const shaped = opts.shape.safeParse(parsed);
  if (!shaped.success) {
    const first = shaped.error.issues[0];
    throw new DeciderFailed('shape', `${(first?.path ?? []).join('.')}: ${first?.message ?? 'not the shape the contract asks'}`.slice(0, 200));
  }
  return shaped.data;
}

// ── trust ─────────────────────────────────────────────────────────────────────

/** A package this server may run deciding code of: its key, its version, and the hash of its tarball. */
export interface TrustedPackage {
  key: string;
  version: string;
  integrity: string;
}

export interface TrustSources {
  /** The packages this build bundles (`bundled-pins.ts`). */
  bundled: readonly TrustedPackage[];
  /** The packages the bundled seed and the catalogue's downloads recorded, by `<key>@<version>`. */
  recorded: Readonly<Record<string, string>>;
  /** `ADMINIUM_ADD_ON_DEV_TRUST`: keys a developer's own server runs whatever their bytes. */
  devKeys?: string | undefined;
  /** `NODE_ENV`: the developer's list is ignored in production. */
  nodeEnv?: string | undefined;
}

/** The keys of the developer's list; none in production. */
export function devTrustedKeys(devKeys: string | undefined, nodeEnv: string | undefined): string[] {
  if (nodeEnv === 'production' || devKeys === undefined) return [];
  return devKeys
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '');
}

/**
 * Whether a package's deciding code may run here: its tarball is the one this
 * build bundles, or the one the catalogue named when it was downloaded, or
 * its key is on a developer's list outside production.
 */
export function deciderTrusted(pkg: TrustedPackage, sources: TrustSources): boolean {
  if (sources.bundled.some((pin) => pin.key === pkg.key && pin.version === pkg.version && pin.integrity === pkg.integrity)) return true;
  if (sources.recorded[`${pkg.key}@${pkg.version}`] === pkg.integrity) return true;
  return devTrustedKeys(sources.devKeys, sources.nodeEnv).includes(pkg.key);
}

// ── the update gate ───────────────────────────────────────────────────────────

/** What a gate's writer does to the add-on's row and to the loaded code. */
export interface GateDeps {
  /** The add-on's status now; null when it is not installed. */
  status(key: string): Promise<string | null>;
  setStatus(key: string, status: 'updating' | 'installed' | 'disabled' | 'error' | 'installing'): Promise<void>;
  /** Loads the add-ons again, so the next save runs the new code. */
  rebuild(): Promise<void>;
  /** For tests: how long a writer waits. */
  waitMs?: number | undefined;
}

export interface DeciderGate {
  /** Enters as a reader, once no writer holds or waits. Call the answer to leave. */
  read(): Promise<() => void>;
  /**
   * Runs `fn` alone: the row says `updating`, the saves in flight finish
   * first. When `fn` returns, the add-ons are loaded again and the row says
   * `installed` (unless `fn` removed it). When `fn` throws, the row stays
   * `updating`: an update that stopped half way is not live.
   *
   * `mark: false` leaves the row and the reload to `fn` altogether: an
   * install writes its own row as `installing`, flips it last and loads the
   * add-ons itself, and a stopped one stays `installing`, which is what lets
   * the same call finish it.
   */
  write<T>(fn: () => Promise<T>, opts?: { mark?: boolean }): Promise<T>;
}

interface GateState {
  readers: number;
  /** Writers holding or waiting: a reader that arrives now waits for all of them. */
  writers: number;
  holding: boolean;
  waiting: (() => void)[];
}

/** The gates of one process, one per add-on. */
export function createDeciderGates(deps: () => GateDeps | null) {
  const states = new Map<string, GateState>();
  const stateOf = (key: string): GateState => {
    let state = states.get(key);
    if (state === undefined) {
      state = { readers: 0, writers: 0, holding: false, waiting: [] };
      states.set(key, state);
    }
    return state;
  };
  const wake = (state: GateState): void => {
    for (const waiter of state.waiting.splice(0)) waiter();
  };
  const changed = (state: GateState): Promise<void> => new Promise((resolve) => state.waiting.push(resolve));

  function gate(key: string): DeciderGate {
    const state = stateOf(key);
    return {
      async read() {
        while (state.writers > 0) await changed(state);
        state.readers += 1;
        let left = false;
        return () => {
          if (left) return;
          left = true;
          state.readers -= 1;
          wake(state);
        };
      },
      async write(fn, opts = {}) {
        // An install marks its own row and loads the add-ons itself, inside `fn`: the gate only keeps saves out.
        const bound = opts.mark === false ? null : deps();
        const before = bound === null ? null : await bound.status(key);
        state.writers += 1;
        try {
          // Other processes read the row; this one's saves read the count above.
          if (bound !== null && before !== null) await bound.setStatus(key, 'updating');
          const deadline = Date.now() + (bound?.waitMs ?? DECIDER_GATE_WAIT_MS);
          while (state.readers > 0 || state.holding) {
            const leftMs = deadline - Date.now();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const late = leftMs <= 0 ? true : await Promise.race([changed(state).then(() => false), new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), leftMs)))]);
            if (timer !== undefined) clearTimeout(timer);
            if (late && (state.readers > 0 || state.holding)) {
              // Put back as it was: nothing was changed.
              if (bound !== null && before !== null) await bound.setStatus(key, before as 'installed');
              throw new ConflictError(`"${key}" is in use by saves that have not finished. Try again in a moment.`, 'WRITE_CONFLICT', { retry: true });
            }
          }
          state.holding = true;
          try {
            const result = await fn();
            if (bound !== null) {
              await bound.rebuild();
              // An uninstall removed the row: there is nothing to mark.
              if ((await bound.status(key)) !== null) await bound.setStatus(key, 'installed');
            }
            return result;
          } finally {
            state.holding = false;
          }
        } finally {
          state.writers -= 1;
          wake(state);
        }
      },
    };
  }

  /** Runs `run` as a reader of each add-on's gate, entered in key order and left whatever happens. */
  async function withDeciders<T>(keys: readonly string[], run: () => Promise<T>): Promise<T> {
    const leave: (() => void)[] = [];
    try {
      for (const key of [...new Set(keys)].sort()) leave.push(await gate(key).read());
      return await run();
    } finally {
      for (const done of leave.reverse()) done();
    }
  }

  return { gate, withDeciders };
}

let bound: GateDeps | null = null;
const processGates = createDeciderGates(() => bound);

/** Tells this process's gates how to mark an add-on's row and load the add-ons again. Called once, where the server is put together. */
export function bindDeciderGates(deps: GateDeps | null): void {
  bound = deps;
}

/** This process's gate for one add-on. */
export const deciderGate = (key: string): DeciderGate => processGates.gate(key);
/** Runs `run` as a reader of each named add-on's gate. */
export const withDeciders = <T>(keys: readonly string[], run: () => Promise<T>): Promise<T> => processGates.withDeciders(keys, run);

// ── a rejection left behind ───────────────────────────────────────────────────

/** Whether a rejected promise was made by code of another context: a decider's, never this process's own. */
export function isForeignPromise(promise: unknown): boolean {
  return !(promise instanceof Promise);
}

let guarded = false;

/**
 * A decider that leaves a rejected promise behind (or asks for a module)
 * would otherwise end the process. Installed once: a rejection of a promise
 * from another context is logged and dropped; every other is thrown, as Node
 * itself does.
 */
export function installRejectionGuard(log: (message: string, data?: Record<string, unknown>) => void): void {
  if (guarded) return;
  guarded = true;
  let lastLogged = 0;
  process.on('unhandledRejection', (reason, promise) => {
    if (!isForeignPromise(promise)) throw reason;
    const now = Date.now();
    if (now - lastLogged < 60_000) return;
    lastLogged = now;
    log('an add-on\'s code left a rejected promise behind; it was dropped', { reason: wordsOf(reason) });
  });
}
