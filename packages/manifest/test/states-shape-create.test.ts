// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A table built on an add-on's shape holds its create to a condition on a
 * column the app added — as it may already hold one of the shape's moves —
 * and to nothing else: never a condition on a column of the shape's, never a
 * linked row, a setting or a window on the clock, and never less than a
 * create the shape writes itself.
 */
import { describe, expect, it } from 'vitest';

import { shapeConformanceIssues, shapeKey, type ShapeDefinitionView } from '../src/index.js';
import { addOnManifest, issuesText, tableOf, valid, type Doc } from './invoicing-fixture.js';

const shapes = (mutate?: (shape: Doc) => void): Map<string, ShapeDefinitionView> => {
  const shape = structuredClone(((addOnManifest()['addOn'] as Doc)['shapes'] as Doc[])[0]!);
  mutate?.(shape);
  return new Map([[shapeKey('invoices', shape as unknown as ShapeDefinitionView), shape as unknown as ShapeDefinitionView]]);
};
const conformance = (m: Doc, map = shapes()) => shapeConformanceIssues(m as never, map).map((issue) => issue.message).join('\n');

/** The invoices, with a column the app added (the client's standing, kept on the invoice) and a create held to it. */
function held(create: Doc | undefined): Doc {
  const m = valid();
  // A create held to a column the app added is read from 0.3.33 on (`shape.create`).
  (m['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.33';
  const invoices = tableOf(m, 'invoices');
  (invoices['columns'] as Doc[]).push({ ref: 'client_state', type: 'enum', enum: ['active', 'closed'], nullable: true });
  if (create !== undefined) (invoices['states'] as Doc)['create'] = create;
  return m;
}

describe("a shape's create, held to more by the app", () => {
  it('takes a condition on a column the app added', () => {
    const m = held({ requires: { where: [{ column: 'client_state', eq: 'active' }] } });
    expect(issuesText(m)).toBe('');
    expect(conformance(m)).toBe('');
    // Without one, as ever.
    expect(conformance(held(undefined))).toBe('');
  });

  it('refuses a condition on a column of the shape\'s, named', () => {
    const m = held({ requires: { where: [{ column: 'client_state', eq: 'active' }, { column: 'total', gt: 0 }] } });
    expect(issuesText(m)).toBe('');
    expect(conformance(m)).toContain("a condition an app adds to the shape's create reads a column the app added, never total");
  });

  it('refuses a linked row, a setting or a window on the clock: those are the shape\'s to ask', () => {
    const linked = held({ requires: { linked: [{ via: 'client_id', where: [{ column: 'email', isNull: false }] }] } });
    expect(issuesText(linked)).toBe('');
    expect(conformance(linked)).toContain("create is the shape's (an app may only hold it to a condition on a column it added)");
    const both = held({ requires: { where: [{ column: 'client_state', eq: 'active' }], linked: [{ via: 'client_id', where: [{ column: 'email', isNull: false }] }] } });
    expect(conformance(both)).toContain("create is the shape's");
  });

  it('keeps a create the shape writes, as written, beside the app\'s own condition', () => {
    const kept = shapes((shape) => {
      ((shape['parts'] as Record<string, Doc>)['document']!['states'] as Doc)['create'] = { requires: { where: [{ column: 'currency', isNull: false }] } };
    });
    const shapeOwn = { column: 'currency', isNull: false };
    expect(conformance(held({ requires: { where: [shapeOwn] } }), kept)).toBe('');
    expect(conformance(held({ requires: { where: [shapeOwn, { column: 'client_state', eq: 'active' }] } }), kept)).toBe('');
    // Dropped, or asked less: the shape's.
    expect(conformance(held(undefined), kept)).toContain("create is the shape's");
    expect(conformance(held({ requires: { where: [{ column: 'client_state', eq: 'active' }] } }), kept)).toContain("create is the shape's");
  });
});
