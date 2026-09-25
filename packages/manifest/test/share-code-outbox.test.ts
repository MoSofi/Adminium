// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A shared link's code and the outbox's own columns, as a studio's manifest
 * declares them: the code is never shown on the page it opens, a column says
 * whether it is a secret, and a rule never decides a column Adminium writes
 * as it sends a message.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';
import { columnOf, entryOf, issuesText, tableOf, valid, type Doc } from './invoicing-fixture.js';

const outboxColumns = (m: Doc) => (m['outbox'] as Doc)['columns'] as Doc;

/** The fixture's outbox with who approved a held message, and when it was sent. */
function withApprover(rules?: Record<string, unknown>): Doc {
  const m = valid();
  (tableOf(m, 'messages')['columns'] as Doc[]).push(
    { ref: 'approved_by', type: 'text', maxLength: 120, nullable: true, ...(rules === undefined ? {} : { rules }) },
    { ref: 'sent_at', type: 'timestamptz', nullable: true },
  );
  Object.assign(outboxColumns(m), { approvedBy: 'approved_by', sentAt: 'sent_at' });
  return m;
}

describe('the columns Adminium writes as it sends', () => {
  it('take no rule of the app’s own, and the refusal names the column', () => {
    expect(issuesText(withApprover())).toBe('');
    const stamped = withApprover({ stamp: { set: 'user-name', on: { column: 'status', values: ['queued'] } } });
    expect(issuesText(stamped)).toContain('"messages.approved_by" is the outbox\'s approvedBy, which Adminium writes, so it takes no stamp rule');
    const sent = withApprover();
    columnOf(sent, 'messages', 'sent_at')['rules'] = { stamp: { set: 'now', on: { column: 'status', values: ['sent'] } } };
    expect(issuesText(sent)).toContain('"messages.sent_at" is the outbox\'s sentAt, which Adminium writes, so it takes no stamp rule');
  });

  it('refuses any rule that decides one, on every column Adminium keeps', () => {
    const m = valid();
    columnOf(m, 'messages', 'skip_reason')['rules'] = { default: { from: { table: 'settings', column: 'reply_to' } } };
    columnOf(m, 'messages', 'effect_at')['rules'] = { stamp: { set: 'now', on: 'create' } };
    const text = issuesText(m);
    expect(text).toContain('"messages.skip_reason" is the outbox\'s skipReason, which Adminium writes, so it takes no default rule');
    expect(text).toContain('"messages.effect_at" is the outbox\'s effectAt, which Adminium writes, so it takes no stamp rule');
  });

  it('leaves a rule that only narrows or labels one alone', () => {
    const m = withApprover({ validation: { maxLength: 120 } });
    expect(issuesText(m)).toBe('');
  });
});

describe('a shared link’s code', () => {
  it('opens its row and is never shown by the entry it opens', () => {
    const m = valid();
    entryOf(m, 'projects', 'handover')['select'] = ['status', 'handover_file', 'share_token'];
    expect(issuesText(m)).toContain('"projects.share_token" is the link\'s secret: it opens the row, and is never shown');
  });

  it('may say whether it is a secret, as a column says whether it is personal', () => {
    const m = valid();
    (columnOf(m, 'projects', 'share_token')['rules'] as Doc)['secret'] = false;
    columnOf(m, 'projects', 'handover_file')['rules'] = { secret: true };
    expect(issuesText(m)).toBe('');
    columnOf(m, 'projects', 'handover_file')['rules'] = { secret: 'yes' };
    expect(validateManifest(m).ok).toBe(false);
  });
});
