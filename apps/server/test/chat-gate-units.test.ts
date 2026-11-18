// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Small rules of a website chat that need no database:
 *  - the wider IPv6 networks a new conversation is also counted by (a /56,
 *    a /48), and none for an IPv4 client;
 *  - "Make an enquiry" never writes a consent column: neither the entry's
 *    own default for one ("off" or "on"), so the table's default stands.
 */
import { describe, expect, it } from 'vitest';

import type { LiveChat } from '../src/chat/catalog.js';
import { planEnquiry } from '../src/chat/enquiry.js';
import type { FormsScopes, FormsTable } from '../src/forms/scope.js';
import { ipv6Network } from '../src/public-api/limiter.js';

describe('the wider IPv6 networks', () => {
  it('a /56 and a /48 of an IPv6 address; nothing for IPv4', () => {
    expect(ipv6Network('2001:db8:1:2a3b::1', 56)).toBe('2001:db8:1:2a00::/56');
    expect(ipv6Network('2001:db8:1:2a3b::1', 48)).toBe('2001:db8:1::/48');
    expect(ipv6Network('2001:0DB8:0001:00ff:ffff::9', 56)).toBe('2001:db8:1:0::/56');
    expect(ipv6Network('fe80::1%en0', 48)).toBe('fe80:0:0::/48');
    expect(ipv6Network('198.51.100.7', 48)).toBeNull();
    expect(ipv6Network('::ffff:198.51.100.7', 56)).toBeNull();
    expect(ipv6Network('not an address', 48)).toBeNull();
  });
});

describe('"Make an enquiry" and consent', () => {
  const chat = { connectionId: 'conn', addOn: 'live-chat' } as Pick<LiveChat, 'connectionId' | 'addOn'>;
  /** A table opened to the chat whose entry gives these defaults and opens these columns. */
  const opened = (defaults: Record<string, unknown>, writable: string[]): FormsScopes =>
    ({
      scopeFor: async () => {
        const table = { appKey: 'crm', ref: 'enquiries', entry: { decided: [] }, resource: { writable: new Set(writable), defaults } } as unknown as FormsTable;
        return { tables: new Map([['main.enquiries', table]]), byRef: new Map([['crm:enquiries', table]]) };
      },
    }) as unknown as FormsScopes;

  it('never writes a consent column, whatever the entry defaults it to', async () => {
    for (const consent of [false, true]) {
      const scopes = opened({ source: 'chat', state: 'open', may_email: consent, marketing_ok: consent, newsletter: consent, email_consent: consent }, ['person', 'email', 'message', 'may_email', 'marketing_ok']);
      const plan = await planEnquiry(scopes, chat, { name: 'Marta Kovac', email: 'marta@cobalt.example' }, 'Do you ship to Spain?');
      expect(plan).toMatchObject({ ok: true });
      expect(plan.ok && plan.values).toEqual({ source: 'chat', state: 'open', person: 'Marta Kovac', email: 'marta@cobalt.example', message: 'Do you ship to Spain?' });
    }
  });
});
