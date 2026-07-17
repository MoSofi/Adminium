/**
 * The handshake contract (11-electron.md §2.2 steps 7/9).
 *
 * These parse a wire format that crosses a process boundary, so the interesting
 * cases are all the malformed ones: structured clone hands the parent `unknown`,
 * and the only thing standing between a wedged child and a `TypeError` inside an
 * event handler nobody awaits is this schema.
 */

import { describe, expect, it } from 'vitest';

import { parseParentMessage, parseServerMessage, SERVER_BOOT_STAGES } from './protocol.js';

describe('parseServerMessage', () => {
  it('accepts the §2.2 step 7 ready message', () => {
    const result = parseServerMessage({
      type: 'ready',
      port: 51234,
      host: '127.0.0.1',
      migrations: { applied: 3 },
    });

    expect(result).toEqual({
      ok: true,
      message: { type: 'ready', port: 51234, host: '127.0.0.1', migrations: { applied: 3 } },
    });
  });

  it('accepts a ready message reporting zero applied migrations', () => {
    // The second launch onwards. `firstRun` is idempotent, so `applied: 0` is
    // the NORMAL case and a schema that demanded >0 would reject every boot but
    // the first.
    const result = parseServerMessage({
      type: 'ready',
      port: 1,
      host: '127.0.0.1',
      migrations: { applied: 0 },
    });

    expect(result.ok).toBe(true);
  });

  it('accepts an error message for every declared boot stage', () => {
    for (const stage of SERVER_BOOT_STAGES) {
      const result = parseServerMessage({ type: 'error', stage, message: 'nope' });
      expect(result.ok, stage).toBe(true);
    }
  });

  it('carries the optional detail through', () => {
    const result = parseServerMessage({
      type: 'error',
      stage: 'meta-store',
      message: 'EACCES',
      detail: 'Error: EACCES\n    at open',
    });

    expect(result.ok && result.message).toEqual({
      type: 'error',
      stage: 'meta-store',
      message: 'EACCES',
      detail: 'Error: EACCES\n    at open',
    });
  });

  it.each([
    ['a port of 0', { type: 'ready', port: 0, host: '127.0.0.1', migrations: { applied: 0 } }],
    [
      'a port above 65535',
      { type: 'ready', port: 70000, host: '127.0.0.1', migrations: { applied: 0 } },
    ],
    [
      'a non-integer port',
      { type: 'ready', port: 5123.5, host: '127.0.0.1', migrations: { applied: 0 } },
    ],
    [
      'a stringly-typed port',
      { type: 'ready', port: '51234', host: '127.0.0.1', migrations: { applied: 0 } },
    ],
    ['a missing migrations block', { type: 'ready', port: 51234, host: '127.0.0.1' }],
    ['an unknown stage', { type: 'error', stage: 'wat', message: 'x' }],
    ['an unknown type', { type: 'hello', port: 51234 }],
    ['a bare string', 'ready'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, raw) => {
    const result = parseServerMessage(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects a ready port of 0 — the resolved port can never be the ephemeral request', () => {
    // §2.1 asks the child to LISTEN on 0; a `ready` reporting 0 back means the
    // child read the config instead of the socket, and the window would navigate
    // to http://127.0.0.1:0.
    const result = parseServerMessage({
      type: 'ready',
      port: 0,
      host: '127.0.0.1',
      migrations: { applied: 0 },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('port');
  });

  it('names the offending field rather than throwing', () => {
    const result = parseServerMessage({ type: 'ready', host: '127.0.0.1' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('port');
  });
});

describe('parseParentMessage', () => {
  it('accepts shutdown', () => {
    expect(parseParentMessage({ type: 'shutdown' })).toEqual({
      ok: true,
      message: { type: 'shutdown' },
    });
  });

  it.each([
    ['an unknown type', { type: 'restart' }],
    ['an empty object', {}],
    ['a number', 7],
  ])('rejects %s', (_label, raw) => {
    expect(parseParentMessage(raw).ok).toBe(false);
  });
});
