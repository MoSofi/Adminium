// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SigV4 against AWS's own published test vectors (37-files-and-storage.md
 * 37-T05, D32).
 *
 * A signature test that checks only the final hex tells you it is wrong and
 * nothing else — and there are four independent ways to get this wrong (header
 * order, header value normalisation, path encoding, payload hash), each of
 * which produces the same opaque 403 from a real bucket. So every intermediate
 * string is asserted: canonical request, string-to-sign, signing key, and only
 * then the signature.
 *
 * The vectors are AWS's `aws-sig-v4-test-suite` values for `us-east-1` /
 * `service` at `20150830T123600Z` with the documented example credentials,
 * which are the same figures the SigV4 reference documentation prints.
 */
import { describe, expect, it } from 'vitest';

import {
  amzDate,
  canonicalPath,
  canonicalQuery,
  canonicalize,
  EMPTY_SHA256,
  presignGet,
  signingKey,
  signRequest,
  uriEncode,
} from '../src/files/drivers/sigv4.js';

/** AWS's documented example credentials — public, and used by every vector. */
const CREDENTIALS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};
const AT = new Date('2015-08-30T12:36:00Z');

describe('SigV4 primitives', () => {
  it('derives the documented signing key', () => {
    // `AWS4-HMAC-SHA256` chains four HMACs; the published value for
    // 20150830/us-east-1/iam pins all four at once.
    const key = signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam');
    expect(key.toString('hex')).toBe('c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
  });

  it('formats the two timestamps AWS wants', () => {
    expect(amzDate(AT)).toEqual({ amzDate: '20150830T123600Z', dateStamp: '20150830' });
  });

  it('encodes the characters encodeURIComponent gets wrong', () => {
    // The four AWS escapes that `encodeURIComponent` leaves alone…
    expect(uriEncode("!'()*")).toBe('%21%27%28%29%2A');
    // …and the one it escapes that AWS requires left alone.
    expect(uriEncode('~')).toBe('~');
    expect(uriEncode('a/b')).toBe('a%2Fb');
    expect(uriEncode('a/b', false)).toBe('a/b');
    expect(uriEncode('é')).toBe('%C3%A9');
  });

  it('canonicalises a path once, keeping separators', () => {
    expect(canonicalPath('/upload/2026/09/file_01M1Q-inv 1042.pdf')).toBe('/upload/2026/09/file_01M1Q-inv%201042.pdf');
    // Already-encoded input decodes once and re-encodes once — not twice, which
    // is the non-S3 rule and would break every key with a space in it.
    expect(canonicalPath('/a%20b/c')).toBe('/a%20b/c');
  });

  it('sorts the canonical query by encoded name then value', () => {
    expect(canonicalQuery([['b', '2'], ['a', '1'], ['a', '0']])).toBe('a=0&a=1&b=2');
    expect(canonicalQuery([['X-Amz-Date', '20150830T123600Z']])).toBe('X-Amz-Date=20150830T123600Z');
  });
});

describe('SigV4 vectors — get-vanilla', () => {
  /** The canonical fixture: GET /, one header, empty payload. */
  const parts = canonicalize(
    { method: 'GET', url: 'https://example.amazonaws.com/', headers: {}, payloadSha256: EMPTY_SHA256, region: 'us-east-1', service: 'service' },
    CREDENTIALS,
    { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
    { amzDate: '20150830T123600Z', dateStamp: '20150830' },
  );

  it('builds the published canonical request', () => {
    expect(parts.canonicalRequest).toBe(
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        EMPTY_SHA256,
      ].join('\n'),
    );
  });

  it('builds the published string to sign', () => {
    expect(parts.stringToSign).toBe(
      [
        'AWS4-HMAC-SHA256',
        '20150830T123600Z',
        '20150830/us-east-1/service/aws4_request',
        'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63',
      ].join('\n'),
    );
  });

  it('produces the published signature', () => {
    expect(parts.signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });
});

describe('SigV4 vectors — the four traps', () => {
  const stamp = { amzDate: '20150830T123600Z', dateStamp: '20150830' };

  it('sorts signed headers by lowercased name in BOTH places', () => {
    const parts = canonicalize(
      { method: 'GET', url: 'https://example.amazonaws.com/', headers: {}, payloadSha256: EMPTY_SHA256, region: 'us-east-1', service: 'service' },
      CREDENTIALS,
      { 'X-Amz-Date': '20150830T123600Z', Host: 'example.amazonaws.com', 'My-Header1': 'value1' },
      stamp,
    );
    expect(parts.signedHeaders).toBe('host;my-header1;x-amz-date');
    // …and the header block is in the same order, which is the half that is
    // easy to get right in the SignedHeaders line and wrong in the block.
    expect(parts.canonicalRequest.split('\n').slice(3, 6)).toEqual([
      'host:example.amazonaws.com',
      'my-header1:value1',
      'x-amz-date:20150830T123600Z',
    ]);
  });

  it('trims and collapses header values (get-header-value-trim)', () => {
    const parts = canonicalize(
      { method: 'GET', url: 'https://example.amazonaws.com/', headers: {}, payloadSha256: EMPTY_SHA256, region: 'us-east-1', service: 'service' },
      CREDENTIALS,
      { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z', 'my-header1': '  a  b  c  ' },
      stamp,
    );
    expect(parts.canonicalRequest).toContain('my-header1:a b c\n');
  });

  it('signs a dated key path with a space exactly once', () => {
    const parts = canonicalize(
      {
        method: 'PUT',
        url: 'http://127.0.0.1:9000/adminium/upload/2026/09/file_01M1Q-inv 1042.pdf',
        headers: {},
        payloadSha256: 'a'.repeat(64),
        region: 'us-east-1',
      },
      CREDENTIALS,
      { host: '127.0.0.1:9000' },
      stamp,
    );
    // A double-encoded `%2520` here is the bug that breaks precisely the keys
    // this plan generates.
    expect(parts.canonicalRequest.split('\n')[1]).toBe('/adminium/upload/2026/09/file_01M1Q-inv%201042.pdf');
  });

  it('always signs the real payload hash, never UNSIGNED-PAYLOAD', () => {
    const headers = signRequest(
      {
        method: 'PUT',
        url: 'http://127.0.0.1:9000/adminium/a.pdf',
        headers: { 'content-type': 'application/pdf' },
        payloadSha256: 'b'.repeat(64),
        region: 'us-east-1',
        now: AT,
      },
      CREDENTIALS,
    );
    expect(headers['x-amz-content-sha256']).toBe('b'.repeat(64));
    expect(headers['authorization']).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date');
    // The port is part of `host` and must be signed — dropping it is what
    // `URL.hostname` would do and is a 403 against a MinIO on :9000.
    expect(headers['host']).toBe('127.0.0.1:9000');
  });

  it('carries a session token into the signed set when there is one', () => {
    const headers = signRequest(
      { method: 'GET', url: 'https://b.s3.amazonaws.com/k', headers: {}, payloadSha256: EMPTY_SHA256, region: 'us-east-1', now: AT },
      { ...CREDENTIALS, sessionToken: 'FQoDYXdz' },
    );
    expect(headers['x-amz-security-token']).toBe('FQoDYXdz');
    expect(headers['authorization']).toContain('x-amz-security-token');
  });
});

describe('presignGet (written for O4, no caller in v1)', () => {
  const url = presignGet(
    { url: 'https://examplebucket.s3.amazonaws.com/test.txt', region: 'us-east-1', expiresInSeconds: 86400, now: AT },
    CREDENTIALS,
  );

  it('puts every signing parameter in the query and nothing in a header', () => {
    const parsed = new URL(url);
    expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(parsed.searchParams.get('X-Amz-Credential')).toBe('AKIDEXAMPLE/20150830/us-east-1/s3/aws4_request');
    expect(parsed.searchParams.get('X-Amz-Date')).toBe('20150830T123600Z');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('86400');
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for a fixed clock — the property a cache would need', () => {
    const again = presignGet(
      { url: 'https://examplebucket.s3.amazonaws.com/test.txt', region: 'us-east-1', expiresInSeconds: 86400, now: AT },
      CREDENTIALS,
    );
    expect(again).toBe(url);
  });

  it('signs UNSIGNED-PAYLOAD, which is correct HERE and nowhere else', () => {
    // The recipient has no body to hash. `signRequest` must never do this, and
    // the assertion above (`x-amz-content-sha256` = the real hash) is its half.
    const parts = canonicalize(
      { method: 'GET', url, headers: {}, payloadSha256: 'UNSIGNED-PAYLOAD', region: 'us-east-1' },
      CREDENTIALS,
      { host: 'examplebucket.s3.amazonaws.com' },
      { amzDate: '20150830T123600Z', dateStamp: '20150830' },
    );
    expect(parts.canonicalRequest).toContain('UNSIGNED-PAYLOAD');
  });
});
