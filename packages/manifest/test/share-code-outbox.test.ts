// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A shared link's code and the outbox's own columns, as a studio's manifest
 * declares them: the code is never shown, filtered or ordered by — on the
 * page it opens or through any other entry of its table — a column says
 * whether it is a secret (a shape's column may be made one, never shown),
 * and a rule never decides or refuses a column Adminium writes as it sends a
 * message.
 */
import { describe, expect, it } from 'vitest';

import { shapeConformanceIssues, shapeKey, validateManifest, type ShapeDefinitionView } from '../src/index.js';
import { addOnManifest, columnOf, entryOf, issuesText, tableOf, valid, type Doc } from './invoicing-fixture.js';

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

  it('refuses a rule that would refuse what Adminium writes there', () => {
    const narrowed = withApprover({ validation: { maxLength: 120 } });
    expect(issuesText(narrowed)).toContain('"messages.approved_by" is the outbox\'s approvedBy, which Adminium writes, so it takes no validation rule');
    const m = valid();
    columnOf(m, 'messages', 'status')['rules'] = { required: true };
    expect(issuesText(m)).toContain('"messages.status" is the outbox\'s status, which Adminium writes, so it takes no required rule');
  });

  it('holds the address and the language Adminium writes as it sends to the same, but a check of a typed address', () => {
    const m = valid();
    columnOf(m, 'messages', 'to')['rules'] = { required: true };
    expect(issuesText(m)).toContain('"messages.to" is the outbox\'s to, which Adminium writes, so it takes no required rule');
    columnOf(m, 'messages', 'to')['rules'] = { default: { from: { table: 'settings', column: 'reply_to' } } };
    expect(issuesText(m)).toContain('"messages.to" is the outbox\'s to, which Adminium writes, so it takes no default rule');
    columnOf(m, 'messages', 'to')['rules'] = { validation: { format: 'email' } };
    expect(issuesText(m)).toBe('');
  });

  it('leaves a rule that only labels one alone', () => {
    const m = valid();
    columnOf(m, 'messages', 'status')['rules'] = { enumLabels: { labels: { queued: 'Waiting' } } };
    expect(issuesText(m)).toBe('');
  });
});

describe('a shared link’s code', () => {
  it('opens its row and is never shown by the entry it opens', () => {
    const m = valid();
    entryOf(m, 'projects', 'handover')['select'] = ['status', 'handover_file', 'share_token'];
    expect(issuesText(m)).toContain('"projects.share_token" is the link\'s secret: it opens the row, and is never shown');
  });

  it('is never shown, filtered or ordered by through another entry of its table, whatever its key', () => {
    let m = valid();
    (m['publicAccess'] as Doc[]).push({ table: 'projects', methods: ['GET'], select: ['status', 'share_token'] });
    expect(issuesText(m)).toContain('"projects.share_token" is the code a shared link opens its row with: no entry shows, filters or orders by it');
    m = valid();
    (m['publicAccess'] as Doc[]).push({ table: 'projects', methods: ['GET'], select: ['status'], filters: [{ column: 'share_token', op: 'eq', value: 'X' }] });
    expect(issuesText(m)).toContain('"projects.share_token" is the code a shared link opens its row with');
    // Another table's entries, and one naming none of it, are left alone.
    m = valid();
    (m['publicAccess'] as Doc[]).push({ table: 'projects', methods: ['GET'], select: ['status'] });
    expect(issuesText(m)).toBe('');
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

describe('a column of an add-on’s shape', () => {
  const shapes = (): Map<string, ShapeDefinitionView> => {
    const shape = ((addOnManifest()['addOn'] as Doc)['shapes'] as Doc[])[0]! as unknown as ShapeDefinitionView;
    return new Map([[shapeKey('invoices', shape), shape]]);
  };
  const conformance = (m: Doc) => shapeConformanceIssues(m as never, shapes()).map((issue) => issue.message).join('\n');

  it('may be made a secret by the app, and never shown', () => {
    const m = valid();
    columnOf(m, 'invoices', 'void_reason')['rules'] = { secret: true };
    expect(conformance(m)).toBe('');
    columnOf(m, 'invoices', 'void_reason')['rules'] = { secret: false };
    expect(conformance(m)).toContain('"invoices.void_reason" may be made a secret, never shown: only "secret": true is added to a shape\'s column');
  });
});
