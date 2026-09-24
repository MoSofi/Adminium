// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The emailed code's own rules, below the route: a try is charged before it is
 * compared, so requests in flight together — each holding the same open code,
 * read before any of them was counted — get five compares between them and no
 * more; the address is masked as the page shows it; the person is counted by
 * their row; and a claim that sends a code may not let anyone rewrite the
 * address it goes to.
 */
import BetterSqlite3 from 'better-sqlite3';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  publicChallengesRepo,
  publicKeysRepo,
  publicScopesRepo,
  publicSessionsRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CODE_TRIES,
  codeBinding,
  codeKey,
  hashCode,
  maskAddress,
  newCode,
  subjectOf,
  tryCode,
} from '../src/public-api/claim-code.js';
import { compileScope, ScopeCompileError, type PublicScopeDocument } from '../src/public-api/scope.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { TEST_SECRET } from './helpers.js';

let meta: MetaDb;
let keyId: string;
let sessionId: string;
beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  // A real key and session: a challenge row names both.
  const connection = await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({
    name: 'src',
    engine: 'postgres',
    introspectDsn: 'postgres://ro:s@db/clinic',
    dataDsn: 'postgres://rw:s@db/clinic',
  });
  const scope = await publicScopesRepo(meta).create({
    connectionId: connection.id,
    side: 'customer',
    name: 'clinic',
    timezone: 'Europe/London',
    document: '{"version":1,"resources":[]}',
  });
  const key = await publicKeysRepo(meta).create({ name: 'web', prefix: 'adm_pub_codetest', tokenHash: 'h'.repeat(64), tokenEncrypted: 'sealed', scopeId: scope.id, side: 'customer' });
  keyId = key.id;
  sessionId = (await publicSessionsRepo(meta).create({ keyId, tokenHash: 's'.repeat(64), grants: '{}', expiresAt: Date.now() + 1_800_000 })).id;
});
afterEach(async () => {
  await meta.db.destroy();
});

const key = codeKey('a-test-secret-that-is-long-enough-for-hkdf');

async function openCode(code: string) {
  const at = Date.now();
  const repo = publicChallengesRepo(meta);
  const binding = codeBinding({ sessionId, purpose: 'verify', createdAt: at });
  await repo.create(
    {
      keyId,
      ref: 'patients_claimed',
      destinationHash: 'h',
      codeHash: hashCode(key, binding, code),
      expiresAt: at + 600_000,
      sessionId,
      purpose: 'verify',
      subject: 'row:1',
    },
    at,
  );
  return (await repo.findOpen(sessionId, 'verify', at))!;
}

describe('a typed code', () => {
  it('is charged before it is compared: eight requests in flight get five compares between them', async () => {
    const code = '123456';
    const open = await openCode(code);
    const repo = publicChallengesRepo(meta);
    // Every request read the open code before any of them was counted — then all try at once.
    const guesses = Array.from({ length: 8 }, (_, i) => String(200000 + i));
    const outcomes = await Promise.all(guesses.map((guess) => tryCode(repo, open, guess, key, Date.now())));
    expect(outcomes.filter((o) => o.outcome === 'wrong')).toHaveLength(CODE_TRIES);
    expect(outcomes.filter((o) => o.outcome === 'expired')).toHaveLength(8 - CODE_TRIES);
    // The fifth wrong try killed it: the right code, from the same stale read, opens nothing.
    expect(await tryCode(repo, open, code, key, Date.now())).toEqual({ outcome: 'expired' });
  });

  it('says how many tries are left, and is used once when right', async () => {
    const open = await openCode('654321');
    const repo = publicChallengesRepo(meta);
    expect(await tryCode(repo, open, '000000', key, Date.now())).toEqual({ outcome: 'wrong', triesLeft: 4 });
    expect(await tryCode(repo, open, ' 654321 ', key, Date.now())).toEqual({ outcome: 'right' });
    expect(await tryCode(repo, open, '654321', key, Date.now())).toEqual({ outcome: 'expired' });
  });

  it('matches only the challenge it was made for', async () => {
    const open = await openCode('111111');
    const moved = { ...open, createdAt: open.createdAt + 1 };
    expect(await tryCode(publicChallengesRepo(meta), moved, '111111', key, Date.now())).toMatchObject({ outcome: 'wrong' });
  });
});

describe('a session\u2019s codes', () => {
  it('count the codes sent, not the confirmations kept beside them', async () => {
    const repo = publicChallengesRepo(meta);
    await openCode('111111');
    await openCode('222222');
    // A code confirmed leaves a success marker on the session: it is no code sent.
    await repo.mark({ keyId, ref: 'patients_claimed', sessionId, subject: 'row:1', purpose: 'verified' });
    expect(await repo.countForSession(sessionId)).toBe(2);
  });
});

describe('the pieces around it', () => {
  it('makes six-digit codes, zero-padded', () => {
    for (let i = 0; i < 50; i += 1) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it('shows an address by its first letters, and a big provider whole', () => {
    expect(maskAddress('Lucy.Smith@Example.co.uk')).toBe('l•••@e•••.uk');
    expect(maskAddress('ben@gmail.com')).toBe('b•••@gmail.com');
    expect(maskAddress('x@work.internal.io')).toBe('x•••@w•••.io');
  });

  it('counts a person by their row, whichever key or ref they came through', () => {
    const a = subjectOf('con_1', 'public.patients', 'id', 7);
    expect(subjectOf('con_1', 'public.patients', 'id', '7')).toBe(a);
    expect(subjectOf('con_1', 'public.patients', 'id', 8)).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(191);
  });
});

describe('a claim that sends a code', () => {
  const doc = (writable: string[], actions: string[] = ['read', 'update']): PublicScopeDocument =>
    ({
      version: 1,
      side: 'customer',
      timezone: 'Europe/London',
      claim: { strategy: 'lookup', ref: 'patients_claimed', match: ['mobile', 'born_on'], verify: 'email-code', email: 'email' },
      resources: [
        { ref: 'patients_claimed', table: 'public.patients', actions: ['read'], expose: ['name'], claim: { column: 'id' } },
        { ref: 'patients_verified', table: 'public.patients', actions, expose: ['name', 'email'], writable, claim: { column: 'id', ref: 'patients_claimed' }, level: 'verified' },
      ],
    }) as PublicScopeDocument;
  const codes = (document: PublicScopeDocument) => {
    try {
      compileScope(document, () => new Set(['id', 'name', 'mobile', 'born_on', 'email', 'remind']));
      return [];
    } catch (error) {
      if (!(error instanceof ScopeCompileError)) throw error;
      return error.issues.map((i) => `${i.code}:${i.column ?? ''}`);
    }
  };

  it('lets nobody write the address it goes to, or the details that find the person', () => {
    expect(codes(doc(['remind']))).toEqual([]);
    expect(codes(doc(['remind', 'email']))).toEqual(['SCOPE_CLAIM_COLUMN_WRITABLE:email']);
    expect(codes(doc(['mobile']))).toEqual(['SCOPE_CLAIM_COLUMN_WRITABLE:mobile']);
  });

  it('lets nobody make a row where people prove who they are', () => {
    expect(codes(doc(['remind'], ['read', 'create']))).toContain('SCOPE_CLAIM_TABLE_CREATE:');
  });
});
