/**
 * `scrubUrlForLog` (08-server-api.md §1.3; 11-electron.md §2.2 step 8).
 *
 * The unit half of the leak `desktop-session.test.ts` closes end-to-end: pino's
 * `redact` cannot reach inside a string, so a credential in a query string is
 * invisible to every other redaction rule the server has.
 */
import { describe, expect, it } from 'vitest';

import { REDACTED, SENSITIVE_QUERY_PARAMS, scrubUrlForLog } from '../src/log-scrub.js';

const TOKEN = 'f'.repeat(64);

describe('scrubUrlForLog', () => {
  it('redacts the boot token and keeps everything else', () => {
    expect(scrubUrlForLog(`/?bootToken=${TOKEN}`)).toBe(`/?bootToken=${REDACTED}`);
    expect(scrubUrlForLog(`/p/orders?bootToken=${TOKEN}&tab=open`)).toBe(
      `/p/orders?bootToken=${REDACTED}&tab=open`,
    );
    // Order is preserved — a log line should read like the request that made it.
    expect(scrubUrlForLog(`/?tab=open&bootToken=${TOKEN}&sort=asc`)).toBe(
      `/?tab=open&bootToken=${REDACTED}&sort=asc`,
    );
  });

  it('redacts every declared parameter, whatever the caller capitalized', () => {
    for (const name of SENSITIVE_QUERY_PARAMS) {
      expect(scrubUrlForLog(`/x?${name}=${TOKEN}`)).toBe(`/x?${name}=${REDACTED}`);
      expect(scrubUrlForLog(`/x?${name.toUpperCase()}=${TOKEN}`)).not.toContain(TOKEN);
    }
    // A scrubber that only catches the spelling we emit fails exactly when
    // someone else gets it wrong.
    expect(scrubUrlForLog(`/x?boottoken=${TOKEN}`)).toBe(`/x?boottoken=${REDACTED}`);
  });

  it('redacts every occurrence when a parameter repeats', () => {
    expect(scrubUrlForLog(`/x?bootToken=${TOKEN}&bootToken=${TOKEN}`)).toBe(
      `/x?bootToken=${REDACTED}&bootToken=${REDACTED}`,
    );
  });

  it('returns the URL untouched when there is nothing to scrub', () => {
    // Byte-for-byte: the whole reason this does not round-trip through `URL`.
    const cases = [
      '/api/v1/healthz',
      '/p/orders?tab=open&q=a+b',
      '/p/orders?q=%E2%98%85&filter=token', // a VALUE that says "token" is not a token
      '/x?',
      '/x?=1',
      '/x?flag',
    ];
    for (const url of cases) {
      expect(scrubUrlForLog(url), url).toBe(url);
    }
  });

  it('never throws on the shapes a hostile query can take', () => {
    // `decodeURIComponent('%')` throws; a log line is not the place to die.
    expect(() => scrubUrlForLog('/x?%=1&bootToken=' + TOKEN)).not.toThrow();
    expect(scrubUrlForLog('/x?%=1&bootToken=' + TOKEN)).not.toContain(TOKEN);
    expect(scrubUrlForLog('/x?bootToken')).toBe('/x?bootToken');
    expect(scrubUrlForLog('/x?bootToken=')).toBe(`/x?bootToken=${REDACTED}`);
  });

  it('does not match a parameter whose name merely contains a sensitive one', () => {
    // Over-redaction is a real cost: these are ordinary query parameters.
    expect(scrubUrlForLog('/x?tokenizer=fast')).toBe('/x?tokenizer=fast');
    expect(scrubUrlForLog('/x?mybootToken=1')).toBe('/x?mybootToken=1');
  });
});
