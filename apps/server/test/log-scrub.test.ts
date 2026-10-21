// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `scrubUrlForLog`.
 *
 * The unit half of the leak `desktop-session.test.ts` closes end-to-end: pino's
 * `redact` cannot reach inside a string, so a credential in a query string is
 * invisible to every other redaction rule the server has.
 */
import { describe, expect, it } from 'vitest';

import { Writable } from 'node:stream';

import pino from 'pino';

import { REDACT_PATHS } from '../src/app.js';
import { REDACTED, SENSITIVE_QUERY_PARAMS, scrubUrlForLog } from '../src/log-scrub.js';

const TOKEN = 'f'.repeat(64);

describe('scrubUrlForLog', () => {
  it("redacts a pay link's token, a way back's nonce and a demo attempt, in every pay path", () => {
    const token = 'Xk2v9QpL7mN3aR5tW8yZ1b';
    expect(scrubUrlForLog(`/pay/${token}`)).toBe(`/pay/${REDACTED}`);
    expect(scrubUrlForLog(`/pay/api/${token}`)).toBe(`/pay/api/${REDACTED}`);
    expect(scrubUrlForLog(`/pay/api/${token}/challenge`)).toBe(`/pay/api/${REDACTED}/challenge`);
    expect(scrubUrlForLog(`/pay/api/${token}/checkout`)).toBe(`/pay/api/${REDACTED}/checkout`);
    expect(scrubUrlForLog(`/pay/api/${token}/logo?v=2`)).toBe(`/pay/api/${REDACTED}/logo?v=2`);
    expect(scrubUrlForLog('/pay/back/nonce_123?left=1')).toBe(`/pay/back/${REDACTED}?left=1`);
    expect(scrubUrlForLog('/pay/api/back/nonce_123')).toBe(`/pay/api/back/${REDACTED}`);
    expect(scrubUrlForLog('/pay/demo/pat_1')).toBe(`/pay/demo/${REDACTED}`);
    expect(scrubUrlForLog('/pay/api/demo/pat_1')).toBe(`/pay/api/demo/${REDACTED}`);
    // The page's own files carry nothing secret.
    expect(scrubUrlForLog('/pay/assets/pay-abc123.js')).toBe('/pay/assets/pay-abc123.js');
    // Other paths are untouched.
    expect(scrubUrlForLog(`/payments/${token}`)).toBe(`/payments/${token}`);
    expect(scrubUrlForLog(`/api/v1/pay/${token}`)).toBe(`/api/v1/pay/${token}`);
  });

  it('redacts a code a guest typed, in the query and in its header', () => {
    expect(scrubUrlForLog('/public/records/tickets?code=K7PX2QWE&limit=5')).toBe(`/public/records/tickets?code=${REDACTED}&limit=5`);
    const lines: string[] = [];
    const log = pino({ redact: { paths: [...REDACT_PATHS], censor: REDACTED } }, new Writable({ write: (chunk, _enc, done) => (lines.push(String(chunk)), done()) }));
    log.info({ req: { headers: { 'x-adminium-code': 'K7PX2QWE', accept: 'application/json' } } }, 'request');
    expect(lines.join('')).not.toContain('K7PX2QWE');
    expect(lines.join('')).toContain('application/json');
  });

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

  it('redacts the storage seed URL\u2019s bucket credential (37 \u00a76 item 10)', () => {
    // NAMED for the same reason as the redaction test's S3 case: the loop below
    // cannot fail on a name that is in the list. `ADMINIUM_STORAGE_URL` carries
    // the credential in its QUERY STRING and the docs' per-host recipes tell
    // operators to write exactly this, so any log line echoing it is a leak.
    const url = `/x?endpoint=https%3A%2F%2Fnyc3.digitaloceanspaces.com&accessKey=${TOKEN}&secretKey=${TOKEN}&pathStyle=0`;
    const out = scrubUrlForLog(url);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('pathStyle=0');
    expect(out).toContain('nyc3.digitaloceanspaces.com');
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
