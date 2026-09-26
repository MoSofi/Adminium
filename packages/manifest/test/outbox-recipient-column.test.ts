// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A message sent to an address the producing row holds: a text column of
 * that row (and, optionally, its name column), beside the setting form.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';
import { issuesText, valid, type Doc } from './invoicing-fixture.js';

function withRecipient(recipient: unknown): Doc {
  const m = valid();
  const producers = (m['outbox'] as { producers: Doc[] }).producers;
  producers.find((p) => p['kind'] === 'invoice-sent')!['recipient'] = recipient;
  return m;
}

describe('a producer that sends to an address on its own row', () => {
  it('validates with a text column and a text name column', () => {
    const m = withRecipient({ column: 'number', name: 'void_reason' });
    const result = validateManifest(m);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('refuses a column the row does not have, or one that holds no text', () => {
    expect(issuesText(withRecipient({ column: 'send_to' }))).toMatch(/send_to/);
    expect(issuesText(withRecipient({ column: 'number', name: 'total' }))).toMatch(/a text column/);
  });

  it('refuses a recipient that says both, or neither', () => {
    expect(validateManifest(withRecipient({ column: 'number', setting: { table: 'settings', column: 'reply_to' } })).ok).toBe(false);
    expect(validateManifest(withRecipient({})).ok).toBe(false);
  });
});
