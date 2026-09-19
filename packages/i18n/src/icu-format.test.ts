// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ICU formatter's default error handler, and the promise its own comment
 * makes: **never throw at render time**.
 *
 * Nothing pinned that promise, and it was being broken. Handing the raw error
 * to `console.warn` kept it under plain node and broke it under vitest: a
 * `MissingValueError` — an unsupplied message argument, the most ordinary
 * failure on this path — took the console capture 8 seconds to serialise and
 * then threw `RangeError: Invalid string length` from inside the handler. The
 * object is not large; `node:util` inspects it to 1,189 characters at any
 * depth. Some console implementations walk further, and a handler whose whole
 * job is to report a failure must not depend on which one is listening.
 *
 * So the cases below drive the handler through a console that is hostile in
 * exactly that way, which is the only kind of test that could have caught it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFormatFailures, formatFailures } from './format-errors.js';
import { IcuFormat } from './icu-format.js';

const MISSING_ARG = '{name} wurde wiederhergestellt';

let warnings: unknown[][];

beforeEach(() => {
  clearFormatFailures();
  warnings = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A console that refuses to serialise anything but a string, as vitest's effectively does. */
function hostileConsole(): void {
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg !== 'string') {
        throw new RangeError('Invalid string length');
      }
    }
    warnings.push(args);
  });
}

describe('the default ICU error handler', () => {
  it('does not throw when a message is missing an argument', () => {
    hostileConsole();
    const icu = new IcuFormat();

    // The call under test is `parse`, exactly as i18next invokes it.
    expect(() => icu.parse(MISSING_ARG, {}, 'de-DE', 'files', 'files:toast.restored')).not.toThrow();
  });

  it('returns the raw message, so a broken string still renders as itself', () => {
    hostileConsole();
    const icu = new IcuFormat();

    // Not the empty string and not a placeholder: the untranslatable source is
    // the most useful thing left to show.
    expect(icu.parse(MISSING_ARG, {}, 'de-DE', 'files', 'files:toast.restored')).toBe(MISSING_ARG);
  });

  it('warns with one bounded string, never an object', () => {
    hostileConsole();
    const icu = new IcuFormat();

    icu.parse(MISSING_ARG, {}, 'de-DE', 'files', 'files:toast.restored');

    expect(warnings).toHaveLength(1);
    const [args] = warnings;
    expect(args).toHaveLength(1);
    expect(typeof args?.[0]).toBe('string');
    // And it still says which key and why, because a bounded log that names
    // nothing would be a different bug.
    expect(args?.[0]).toContain('files:toast.restored');
    expect(args?.[0]).toMatch(/name/);
  });

  it('records the failure for the Translations editor, with the same reason', () => {
    hostileConsole();
    const icu = new IcuFormat();

    icu.parse(MISSING_ARG, {}, 'de-DE', 'files', 'files:toast.restored');

    const [failure] = formatFailures();
    expect(failure?.key).toBe('files:toast.restored');
    expect(failure?.lng).toBe('de-DE');
    expect(failure?.message).toMatch(/name/);
    // The console line and the ring agree, because they are the same string.
    expect(warnings[0]?.[0]).toContain(failure?.message as string);
  });

  it('survives a malformed message as well as a missing argument', () => {
    hostileConsole();
    const icu = new IcuFormat();

    // Unbalanced braces: this throws at CONSTRUCTION rather than at format,
    // which is the other way into the same handler.
    expect(() => icu.parse('{count, plural, one {x}', {}, 'de-DE', 'ui', 'ui:broken')).not.toThrow();
    expect(formatFailures().map((f) => f.key)).toContain('ui:broken');
  });

  it('leaves a caller-supplied handler in charge', () => {
    hostileConsole();
    const seen: string[] = [];
    const icu = new IcuFormat({ onError: (key) => seen.push(key) });

    icu.parse(MISSING_ARG, {}, 'de-DE', 'files', 'files:toast.restored');

    expect(seen).toEqual(['files:toast.restored']);
    // The default handler did not also run.
    expect(warnings).toEqual([]);
    expect(formatFailures()).toEqual([]);
  });
});
