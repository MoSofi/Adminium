// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `scrubUrlForLog`.
 *
 * The unit half of the leak `desktop-session.test.ts` closes end-to-end: pino's
 * `redact` cannot reach inside a string, so a credential in a query string is
 * invisible to every other redaction rule the server has.
 */
import { describe, expect, it } from 'vitest';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

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

  it('redacts a named survey token on the stranger pages, and only there', () => {
    expect(scrubUrlForLog(`/x/forms/api/feedback/files?q=qfiles&t=${TOKEN}&name=a.pdf`)).toBe(`/x/forms/api/feedback/files?q=qfiles&t=${REDACTED}&name=a.pdf`);
    expect(scrubUrlForLog(`/x/forms/feedback?t=${TOKEN}`)).toBe(`/x/forms/feedback?t=${REDACTED}`);
    // Elsewhere `t` is an ordinary parameter.
    expect(scrubUrlForLog('/api/v1/rows?t=5')).toBe('/api/v1/rows?t=5');
  });

  it('redacts the token of a mail link: confirm, unsubscribe and click', () => {
    for (const letter of ['c', 'u', 'l']) {
      expect(scrubUrlForLog(`/m/${letter}/${TOKEN}~abc_DEF-123`)).toBe(`/m/${letter}/${REDACTED}`);
      expect(scrubUrlForLog(`/m/${letter}/${TOKEN}?List-Unsubscribe=One-Click`)).toBe(`/m/${letter}/${REDACTED}?List-Unsubscribe=One-Click`);
    }
    // Another of the door's paths, and a path that only begins alike, keep what they are.
    expect(scrubUrlForLog('/m/x/abc')).toBe('/m/x/abc');
    expect(scrubUrlForLog('/media/c/abc')).toBe('/media/c/abc');
  });

  it('redacts the token of an object link, which erases a person', () => {
    expect(scrubUrlForLog(`/m/o/${TOKEN}`)).toBe(`/m/o/${REDACTED}`);
    expect(scrubUrlForLog(`/m/o/${TOKEN}~abc_DEF-123?from=mail`)).toBe(`/m/o/${REDACTED}?from=mail`);
    expect(scrubUrlForLog('/m/o/')).toBe('/m/o/');
  });

  it('redacts a mail or pay token however the router-accepted address is spelled', () => {
    expect(scrubUrlForLog(`/m/%6F/${TOKEN}`)).toBe(`/m/%6F/${REDACTED}`);
    expect(scrubUrlForLog(`/m/%75/${TOKEN}`)).toBe(`/m/%75/${REDACTED}`);
    expect(scrubUrlForLog(`/%6D/l/${TOKEN}?x=1`)).toBe(`/%6D/l/${REDACTED}?x=1`);
    expect(scrubUrlForLog(`/p%61y/${TOKEN}`)).toBe(`/p%61y/${REDACTED}`);
    expect(scrubUrlForLog(`/pay/%61pi/${TOKEN}/challenge`)).toBe(`/pay/%61pi/${REDACTED}/challenge`);
    expect(scrubUrlForLog(`/pay/b%61ck/${TOKEN}`)).toBe(`/pay/b%61ck/${REDACTED}`);
    expect(scrubUrlForLog(`/pay/api/d%65mo/${TOKEN}`)).toBe(`/pay/api/d%65mo/${REDACTED}`);
    expect(scrubUrlForLog(`http://shop.example/m/o/${TOKEN}`)).toBe(`http://shop.example/m/o/${REDACTED}`);
    expect(scrubUrlForLog(`http://shop.example/pay/${TOKEN}`)).toBe(`http://shop.example/pay/${REDACTED}`);
    // A broken escape in the token does not hide it.
    expect(scrubUrlForLog(`/m/%6F/${TOKEN}%zz`)).not.toContain(TOKEN);
    expect(scrubUrlForLog(`/p%61y/${TOKEN}%zz`)).not.toContain(TOKEN);
  });

  it('keeps the paths around the mail and pay links as they were', () => {
    for (const url of ['/m', '/m/', '/m/u/', '/m/x/abc', '/mo/abc', '/pay', '/pay/', '/pay/api/', '/pay/back/', '/pay/assets/pay-abc123.js', '/pay/assets/', '/payments/abc']) {
      expect(scrubUrlForLog(url), url).toBe(url);
    }
  });

  it('redacts the one-use codes of the signed-in doors and keeps the route readable', () => {
    for (const route of ['/api/v1/bridge/seed/', '/api/v1/documents/print-once/', '/api/v1/data/undo/', '/api/v1/llm/runs/run_1/undo/']) {
      expect(scrubUrlForLog(`${route}${TOKEN}`)).toBe(`${route}${REDACTED}`);
      expect(scrubUrlForLog(`${route}${TOKEN}?x=1`)).toBe(`${route}${REDACTED}?x=1`);
      expect(scrubUrlForLog(`http://shop.example${route}${TOKEN}`)).toBe(`http://shop.example${route}${REDACTED}`);
    }
    expect(scrubUrlForLog(`/api/v1/d%61ta/undo/${TOKEN}`)).toBe(`/api/v1/d%61ta/undo/${REDACTED}`);
    expect(scrubUrlForLog(`/api/v1/llm/runs/run_1/%75ndo/${TOKEN}`)).toBe(`/api/v1/llm/runs/run_1/%75ndo/${REDACTED}`);
    expect(scrubUrlForLog(`/api/v1/data/undo//${TOKEN}`)).not.toContain(TOKEN);
  });

  it('leaves the routes beside those doors alone', () => {
    for (const url of ['/api/v1/bridge/handoff', '/api/v1/bridge/seed', '/api/v1/bridge/seed/', '/api/v1/documents/print', '/api/v1/documents/print-once', '/api/v1/data/undo', '/api/v1/data/undo/', '/api/v1/data/conn_1/orders', '/api/v1/data/conn_1/orders/5', '/api/v1/llm/runs/run_1', '/api/v1/llm/runs/run_1/undo', '/api/v1/llm/runs/run_1/undo/']) {
      expect(scrubUrlForLog(url), url).toBe(url);
    }
  });

  it('no log line or audit row takes a request URL unscrubbed', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
    });
    const raw = files(root).filter((file) => /\burl: *(?:req|request)\.(?:raw\.)?url\b/.test(readFileSync(file, 'utf8')));
    expect(raw.map((file) => file.slice(root.length + 1))).toEqual([]);
  });

  it('redacts a mail notice token and keeps the service', () => {
    for (const service of ['ses', 'postmark', 'mailgun', 'brevo', 'sendgrid', 'other']) {
      expect(scrubUrlForLog(`/api/v1/email/notices/${service}/${TOKEN}`)).toBe(`/api/v1/email/notices/${service}/${REDACTED}`);
    }
    expect(scrubUrlForLog(`/api/v1/email/notices/other/${TOKEN}?attempt=2`)).toBe(`/api/v1/email/notices/other/${REDACTED}?attempt=2`);
    // As sent, apart from the token: a log line should read like the request that made it.
    expect(scrubUrlForLog(`/api/v1/email/n%6Ftices/oth%65r/${TOKEN}`)).toBe(`/api/v1/email/n%6Ftices/oth%65r/${REDACTED}`);
    expect(scrubUrlForLog(`http://mail.example/api/v1/email/notices/other/${TOKEN}`)).toBe(`http://mail.example/api/v1/email/notices/other/${REDACTED}`);
  });

  it('redacts a token that landed in the wrong place on a notice address', () => {
    expect(scrubUrlForLog(`/api/v1/email/notices/${TOKEN}`)).toBe(`/api/v1/email/notices/${REDACTED}`);
    expect(scrubUrlForLog(`/api/v1/email/notices/other//${TOKEN}`)).toBe(`/api/v1/email/notices/other/${REDACTED}`);
    expect(scrubUrlForLog(`/api/v1/email/notices/other/${TOKEN}/extra`)).toBe(`/api/v1/email/notices/other/${REDACTED}`);
    expect(scrubUrlForLog(`/api/v1/email/n%6Ftices/other/${TOKEN}%zz`)).not.toContain(TOKEN);
  });

  it('leaves paths that only look like a notice address alone', () => {
    for (const url of ['/api/v1/email/notices', '/api/v1/email/notices/', '/api/v1/email/notices/other', '/api/v1/email/other/abc', '/api/v2/email/notices/other/abc', '/x/api/v1/email/notices/other/abc']) {
      expect(scrubUrlForLog(url), url).toBe(url);
    }
  });
});
