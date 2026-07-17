/**
 * `desktop/lanShare.ts` — the pure half of §8.3's panel.
 *
 * `lanShareView` is here because its interesting states are the ones where the
 * config and the socket DISAGREE, and those are unreachable from a component
 * test that can only click the toggle.
 */
import { describe, expect, it } from 'vitest';

import { lanPortSuggestion, lanShareView } from './lanShare.js';

describe('lanPortSuggestion (§8.3 "Try 4601")', () => {
  /**
   * THE OTHER SIDE OF THE CONTRACT, copied verbatim.
   *
   * `apps/desktop/src/main/index.ts`'s `lanBindError` builds this string, and
   * `main/index.test.ts`'s "refuses a busy port with LAN_PORT_IN_USE" asserts
   * that it produces exactly this shape. A structured `suggestedPort` field has
   * nowhere to ride — `ipc.ts` flattens a throw to `{ code, message }` — so the
   * prose IS the wire format, and these two tests are what keep the producer and
   * this parser from drifting apart in silence.
   */
  const FROM_MAIN = 'LAN_PORT_IN_USE: Port 4600 is already in use by another program. Try 4601.';

  it('reads the port out of the message main actually sends', () => {
    expect(lanPortSuggestion(FROM_MAIN)).toBe(4601);
  });

  it('is null when main had nothing to suggest (the top of the port range)', () => {
    // `suggestNextPort(65535)` returns null and `lanBindError` then omits the
    // sentence entirely — the panel must render no button rather than "Try NaN".
    expect(
      lanPortSuggestion('LAN_PORT_IN_USE: Port 65535 is already in use by another program.'),
    ).toBeNull();
  });

  it('is null for an unrelated message', () => {
    expect(lanPortSuggestion('The Adminium server could not bind port 80: EACCES')).toBeNull();
    expect(lanPortSuggestion('')).toBeNull();
  });

  it('refuses a port outside the legal range rather than suggesting it', () => {
    expect(lanPortSuggestion('Try 70000.')).toBeNull();
    expect(lanPortSuggestion('Try 0.')).toBeNull();
  });
});

describe('lanShareView (§8.3)', () => {
  it('off: not sharing, not trying to', () => {
    expect(lanShareView({ configEnabled: false, active: false })).toBe('off');
  });

  it('sharing: the config says on and the socket agrees — the only state with URLs', () => {
    expect(lanShareView({ configEnabled: true, active: true })).toBe('sharing');
  });

  it('pending: the toggle is on but the server has not rebound yet', () => {
    // The panel shows no URLs here. Handing out an address that nothing is
    // listening on is this feature's worst possible output.
    expect(lanShareView({ configEnabled: true, active: false })).toBe('pending');
  });

  it('pending: an unknown server answer is not a "sharing" answer', () => {
    expect(lanShareView({ configEnabled: true, active: null })).toBe('pending');
  });

  it('mismatch: the config says off and the server is STILL bound wide', () => {
    // Should be unreachable — main reverts a failed rebind — and if it happens
    // it is a live network exposure the user did not ask for, so it is reported
    // rather than rendered as `off`.
    expect(lanShareView({ configEnabled: false, active: true })).toBe('mismatch');
  });

  it('off, not mismatch, while the server answer is unknown', () => {
    expect(lanShareView({ configEnabled: false, active: null })).toBe('off');
  });
});
