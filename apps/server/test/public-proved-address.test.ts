// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one address a public session proved it reads mail at
 * (`public-api/proved-address.ts`): the signed-in row's address, for a
 * session raised by an e-mailed code or opened by an e-mailed link, and for
 * nothing else. No database: the function reads the row it is given.
 */
import { describe, expect, it } from 'vitest';

import type { PublicSessionContext } from '../src/public-api/claim.js';
import { provedAddressOf } from '../src/public-api/proved-address.js';
import type { CompiledScope } from '../src/public-api/scope.js';

const scope = { claim: { strategy: 'email-link', ref: 'customer', match: ['email'], verify: 'email-link', email: 'email' } } as unknown as Pick<CompiledScope, 'claim'>;
const row = { id: 7, email: '  Wes@FieldMail.io ' };
const session = (over: Partial<PublicSessionContext> = {}): PublicSessionContext => ({ id: 's1', keyId: 'k1', grant: { ref: 'customer', column: 'id', value: 7 }, level: 'verified', ...over }) as PublicSessionContext;

describe('the address a public session proved', () => {
  it('a code-verified session and a link session prove their own row\'s address, trimmed and lower case', () => {
    expect(provedAddressOf(scope, session(), row)).toBe('wes@fieldmail.io');
    expect(provedAddressOf(scope, session({ kind: 'link' }), row)).toBe('wes@fieldmail.io');
  });

  it('a details-only session, a row\'s own link, and no session prove none', () => {
    expect(provedAddressOf(scope, session({ level: 'lookup' }), row)).toBeNull();
    expect(provedAddressOf(scope, session({ level: 'lookup', kind: 'claim' }), row)).toBeNull();
    expect(provedAddressOf(scope, session({ kind: 'token' }), row)).toBeNull();
    expect(provedAddressOf(scope, null, row)).toBeNull();
    expect(provedAddressOf(scope, session(), null)).toBeNull();
  });

  it('nothing is proved through another identity, a claim that mails nobody, or a value that is not one plain address', () => {
    expect(provedAddressOf(scope, session({ grant: { ref: 'supplier', column: 'id', value: 7 } }), row)).toBeNull();
    expect(provedAddressOf({ claim: null }, session(), row)).toBeNull();
    expect(provedAddressOf({ claim: { ...scope.claim!, email: undefined } } as Pick<CompiledScope, 'claim'>, session(), row)).toBeNull();
    for (const email of ['"wes@fieldmail.io"', 'wes@fieldmail.io;', 'Wes <wes@fieldmail.io>', '', null]) {
      expect(provedAddressOf(scope, session(), { id: 7, email }), String(email)).toBeNull();
    }
  });
});
