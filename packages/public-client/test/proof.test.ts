// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The human check's own work: the hash, the bit count and the search.
 *
 * The SHA-256 here is written out by hand, so it is held to Node's on every
 * length that matters to one — the block boundaries — and on text that is
 * not ASCII. A hash that is wrong on one input in a thousand is a visitor who
 * cannot book one time in a thousand, and nothing else would say why.
 */
import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { leadingZeroBits, proofWorkerSource, sha256, solveChallenge } from '../src/index.js';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const nodeSha = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex');

/** Zero bits at the front of a hex digest, counted the slow and obvious way. */
function zeroBitsOfHex(digest: string): number {
  const bits = [...digest].map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('');
  const one = bits.indexOf('1');
  return one === -1 ? bits.length : one;
}

/**
 * The server's rule, from Node's hash and the slow count: the first counter
 * whose nonce does the work. Nothing of the client's is used to find it.
 */
function firstNonce(salt: string, difficulty: number): string {
  for (let n = 0; ; n += 1) {
    const nonce = n.toString(36);
    if (zeroBitsOfHex(nodeSha(`${salt}${nonce}`)) >= difficulty) return nonce;
  }
}

describe('sha256 matches Node', () => {
  it('on every length either side of the block boundaries', () => {
    for (let length = 0; length <= 200; length += 1) {
      const text = 'x'.repeat(length);
      expect(hex(sha256(text)), `length ${String(length)}`).toBe(nodeSha(text));
    }
  });

  it('on the known vectors', () => {
    expect(hex(sha256(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('on a thousand random salts and nonces, the shape the server hashes', () => {
    for (let i = 0; i < 1_000; i += 1) {
      const salt = Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))).toString('base64url');
      const input = `${salt}${Math.floor(Math.random() * 1e9).toString(36)}`;
      expect(hex(sha256(input))).toBe(nodeSha(input));
    }
  });

  it('on text that is not ASCII, as UTF-8', () => {
    for (const text of ['é', 'naïve café', '日本語のテキスト', '🙂🙃', 'a\u0000b', 'ß'.repeat(70)]) {
      expect(hex(sha256(text))).toBe(nodeSha(text));
    }
  });

  it('on bytes, and on a long input spanning many blocks', () => {
    const bytes = Uint8Array.from({ length: 1_000 }, (_, i) => (i * 31) % 256);
    expect(hex(sha256(bytes))).toBe(nodeSha(bytes));
    const long = 'abcdefghij'.repeat(10_000);
    expect(hex(sha256(long))).toBe(nodeSha(long));
  });
});

describe('leadingZeroBits', () => {
  it('counts across byte boundaries', () => {
    expect(leadingZeroBits(Uint8Array.from([0x80]))).toBe(0);
    expect(leadingZeroBits(Uint8Array.from([0x01]))).toBe(7);
    expect(leadingZeroBits(Uint8Array.from([0x00, 0x0f]))).toBe(12);
    expect(leadingZeroBits(Uint8Array.from([0x00, 0x00, 0x01]))).toBe(23);
    expect(leadingZeroBits(new Uint8Array(32))).toBe(256);
  });

  it('agrees with a count of the digest’s bits on many hashes', () => {
    for (let n = 0; n < 2_000; n += 1) {
      const digest = createHash('sha256').update(`s${String(n)}`).digest();
      expect(leadingZeroBits(digest)).toBe(zeroBitsOfHex(digest.toString('hex')));
    }
  });
});

describe('solveChallenge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const challenge = (salt: string, difficulty: number) => ({ id: 'ch', salt, difficulty, expiresAt: 0 });

  it('finds the nonce the server would, in lowercase base 36, where there is no worker', async () => {
    expect(typeof Worker).toBe('undefined');
    const nonce = await solveChallenge(challenge('c2FsdHNhbHRzYWx0', 12));
    expect(nonce).toMatch(/^[0-9a-z]{1,32}$/);
    expect(nonce).toBe(firstNonce('c2FsdHNhbHRzYWx0', 12));
    expect(zeroBitsOfHex(nodeSha(`c2FsdHNhbHRzYWx0${nonce}`))).toBeGreaterThanOrEqual(12);
  });

  it('solves a full-strength challenge, yielding to the page between chunks', async () => {
    // Sixteen bits is what the server asks: tens of thousands of attempts,
    // which on the main thread must not be one long task.
    const salt = 'AAECAwQFBgcICQoLDA0ODw';
    const expected = firstNonce(salt, 16);
    expect(parseInt(expected, 36)).toBeGreaterThan(2_000);
    const yielded = vi.spyOn(globalThis, 'setTimeout');
    expect(await solveChallenge(challenge(salt, 16))).toBe(expected);
    expect(yielded).toHaveBeenCalled();
  });

  describe('in a worker', () => {
    /**
     * A worker as small as the client needs: it runs the source the client
     * built, from the Blob the client made, with a `self` of its own. So what
     * is tested is the text a browser would run, not a copy of it.
     */
    function installWorker(behaviour: 'run' | 'throw' | 'error' = 'run') {
      const blobs = new Map<string, Blob>();
      const revoked: string[] = [];
      const made: FakeWorker[] = [];
      vi.stubGlobal('URL', Object.assign(Object.create(URL) as typeof URL, {
        createObjectURL: (blob: Blob) => {
          const url = `blob:test/${String(blobs.size)}`;
          blobs.set(url, blob);
          return url;
        },
        revokeObjectURL: (url: string) => revoked.push(url),
      }));

      class FakeWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: { preventDefault: () => void }) => void) | null = null;
        terminated = false;
        private readonly ready: Promise<{ onmessage?: (event: { data: unknown }) => void }>;

        constructor(url: string) {
          if (behaviour === 'throw') throw new Error('SecurityError: blob: refused');
          made.push(this);
          const blob = blobs.get(url);
          if (blob === undefined) throw new Error(`no blob at ${url}`);
          this.ready = blob.text().then((source) => {
            const scope: { onmessage?: (event: { data: unknown }) => void; postMessage: (data: unknown) => void } = {
              postMessage: (data) => this.onmessage?.({ data }),
            };
            new Function('self', source)(scope);
            return scope;
          });
        }

        postMessage(data: unknown) {
          if (behaviour === 'error') {
            queueMicrotask(() => this.onerror?.({ preventDefault: () => undefined }));
            return;
          }
          void this.ready.then((scope) => scope.onmessage?.({ data }));
        }

        terminate() {
          this.terminated = true;
        }
      }
      vi.stubGlobal('Worker', FakeWorker);
      return { made, revoked };
    }

    it('runs the built source and answers what the main thread would', async () => {
      const { made, revoked } = installWorker();
      const nonce = await solveChallenge(challenge('d29ya2VyLXNhbHQ', 10));
      expect(nonce).toBe(firstNonce('d29ya2VyLXNhbHQ', 10));
      expect(made).toHaveLength(1);
      expect(made[0]!.terminated).toBe(true);
      expect(revoked).toEqual(['blob:test/0']);
    });

    it('falls back to this thread when the worker cannot be made', async () => {
      installWorker('throw');
      expect(await solveChallenge(challenge('Y3NwLXNhbHQ', 8))).toBe(firstNonce('Y3NwLXNhbHQ', 8));
    });

    it('falls back to this thread when the worker fails to run', async () => {
      const { made, revoked } = installWorker('error');
      expect(await solveChallenge(challenge('ZXJyLXNhbHQ', 8))).toBe(firstNonce('ZXJyLXNhbHQ', 8));
      expect(made[0]!.terminated).toBe(true);
      expect(revoked).toHaveLength(1);
    });
  });

  it('builds a worker source that names nothing from outside itself', () => {
    // Run with an empty scope: a reference to a module-level helper would
    // throw here, exactly as it would in the browser's worker.
    const scope: { onmessage?: (event: { data: unknown }) => void; postMessage: (data: unknown) => void } = {
      postMessage: vi.fn(),
    };
    new Function('self', proofWorkerSource())(scope);
    scope.onmessage?.({ data: { salt: 'aXNvbGF0ZWQ', difficulty: 6 } });
    expect(scope.postMessage).toHaveBeenCalledWith(firstNonce('aXNvbGF0ZWQ', 6));
  });
});
