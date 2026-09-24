// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's own rows, opened through ONE identity: the scope rules that hold
 * it together (a sensitive identity opens only its own select at `lookup`;
 * `verified` only where a code is sent; a claim bound to its identity's ref;
 * a session-less create and nothing else) and the predicate a session buys.
 */
import { describe, expect, it } from 'vitest';

import { claimPredicateFor, type PublicSessionContext } from '../src/public-api/claim.js';
import { compileScope, ScopeCompileError, type CompiledResource, type PublicScopeDocument } from '../src/public-api/scope.js';
import { prepareValues } from '../src/public-api/values.js';

const columns = new Map<string, ReadonlySet<string>>([
  ['public.patients', new Set(['id', 'name', 'mobile', 'born_on', 'email'])],
  ['public.visits', new Set(['id', 'patient_id', 'starts_at', 'status', 'new_name', 'check_status'])],
]);
const columnsOf = (table: string) => columns.get(table) ?? null;

type Resource = PublicScopeDocument['resources'][number];
const patients: Resource = {
  ref: 'patients_claimed',
  table: 'public.patients',
  actions: ['read'],
  expose: ['name'],
  claim: { column: 'id' },
  sensitive: true,
} as Resource;
const visits = (over: Partial<Resource> = {}): Resource =>
  ({
    ref: 'visits_verified',
    table: 'public.visits',
    actions: ['read'],
    expose: ['id', 'starts_at'],
    claim: { column: 'patient_id', ref: 'patients_claimed' },
    sensitive: true,
    level: 'verified',
    ...over,
  }) as Resource;

const doc = (resources: Resource[], claim: Partial<NonNullable<PublicScopeDocument['claim']>> = {}): PublicScopeDocument =>
  ({
    version: 1,
    side: 'customer',
    timezone: 'Europe/London',
    claim: { strategy: 'lookup', ref: 'patients_claimed', match: ['mobile', 'born_on'], verify: 'email-code', email: 'email', ...claim },
    resources,
  }) as PublicScopeDocument;

const codes = (document: PublicScopeDocument): string[] => {
  try {
    compileScope(document, columnsOf);
    return [];
  } catch (error) {
    if (!(error instanceof ScopeCompileError)) throw error;
    return error.issues.map((i) => `${i.code}:${i.ref ?? ''}`);
  }
};

describe('a sensitive identity claimed by lookup', () => {
  it('opens its own select at lookup, and every other sensitive row only at verified', () => {
    expect(codes(doc([patients, visits()]))).toEqual([]);
    expect(codes(doc([patients, visits({ level: 'lookup' })]))).toEqual(['SCOPE_CLAIM_TIER_TOO_WEAK:visits_verified']);
    // A row that reveals nothing, and says so, may open at lookup.
    expect(codes(doc([patients, visits({ level: 'lookup', sensitive: false })]))).toEqual([]);
  });

  it('cannot be claimed by lookup at all when no code is sent', () => {
    const noCode = doc([patients, visits({ level: 'lookup', sensitive: false })], { verify: undefined, email: undefined });
    expect(codes(noCode)).toEqual(['SCOPE_CLAIM_TIER_TOO_WEAK:patients_claimed']);
  });

  it('asks a verified session only where a code can verify one, sent to a column the row has', () => {
    const plain = doc([{ ...patients, sensitive: false }, visits({ sensitive: false })], { verify: undefined, email: undefined });
    expect(codes(plain)).toEqual(['SCOPE_LEVEL_UNREACHABLE:visits_verified']);
    expect(codes(doc([patients, visits()], { email: 'nope' }))).toContain('SCOPE_CLAIM_UNKNOWN_COLUMN:');
  });

  it('binds a claim to its identity, and lets only a create go without a session', () => {
    expect(codes(doc([patients, visits({ claim: { column: 'patient_id', ref: 'someone_else' } })]))).toEqual([
      'SCOPE_CLAIM_REF_MISMATCH:visits_verified',
    ]);
    const optional = { claim: { column: 'patient_id', ref: 'patients_claimed', optional: true as const }, sensitive: false, level: 'lookup' as const };
    expect(codes(doc([patients, visits({ ...optional, actions: ['create'], writable: ['starts_at'] })]))).toEqual([]);
    expect(codes(doc([patients, visits({ ...optional, actions: ['create', 'read'], writable: ['starts_at'] })]))).toEqual([
      'SCOPE_CLAIM_OPTIONAL_NOT_CREATE:visits_verified',
    ]);
  });
});

describe('the predicate a session buys', () => {
  const scope = compileScope(
    doc([patients, visits(), visits({ ref: 'visits_new', actions: ['create'], writable: ['starts_at', 'new_name'], level: 'lookup', sensitive: false, claim: { column: 'patient_id', ref: 'patients_claimed', optional: true }, onClaim: { clear: ['new_name', 'check_status'] }, defaults: { check_status: 'to_check' } })]),
    columnsOf,
  );
  const resource = (ref: string) => scope.byRef.get(ref) as CompiledResource;
  const session = (ref: string, level: 'lookup' | 'verified' = 'lookup'): PublicSessionContext => ({
    id: 'pss_1',
    keyId: 'pbk_1',
    grant: { ref, column: 'id', value: 7 },
    level,
  });

  it('is the claim column, only for a session claimed through the resource’s identity', () => {
    expect(claimPredicateFor(resource('visits_verified'), session('patients_claimed'))).toEqual({
      reachable: true,
      predicate: { column: 'patient_id', op: 'eq', value: 7 },
    });
    expect(claimPredicateFor(resource('visits_verified'), session('orders_claimed'))).toEqual({ reachable: false });
    expect(claimPredicateFor(resource('visits_verified'), null)).toEqual({ reachable: false });
  });

  it('lets an optional create through without a session, adding nothing', () => {
    expect(claimPredicateFor(resource('visits_new'), null)).toEqual({ reachable: true, predicate: null });
  });

  it('fills the claim column and empties what a stranger would have typed, only with a session', () => {
    const r = resource('visits_new');
    expect(prepareValues(r, { starts_at: 'x', new_name: 'Cara' }, null, 'create', 'postgres')).toEqual({
      starts_at: 'x',
      new_name: 'Cara',
      check_status: 'to_check',
    });
    expect(prepareValues(r, { starts_at: 'x', new_name: 'Mallory' }, session('patients_claimed'), 'create', 'postgres')).toEqual({
      starts_at: 'x',
      new_name: null,
      check_status: null,
      patient_id: 7,
    });
  });
});
