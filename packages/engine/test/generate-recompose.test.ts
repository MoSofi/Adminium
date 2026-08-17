import { describe, expect, it } from 'vitest';

import { applyClassification } from '../src/classify/index.js';
import { pageEnvelopeSchema } from '../src/config-schema/index.js';
import { composeRequestedPage, isTableBoundTemplate } from '../src/generate/index.js';
import { ARCHETYPE_CONNECTION, archetypeModel } from './fixtures/archetypes-model.js';

/**
 * `composeRequestedPage` — the Studio page editor's "show me THIS table with
 * THIS template" write.
 *
 * The two sibling entry points do not cover it: `generatePages` composes a
 * whole app and picks templates itself, and `composeRequestedArchetype` refuses
 * every template outside the nine §14 archetypes — including `page-crud`, the
 * single most likely thing an admin picks by hand. Without this an admin could
 * create a CRUD page and never give it data.
 */

const model = applyClassification(archetypeModel);

const CTX = {
  connectionId: ARCHETYPE_CONNECTION,
  id: 'page_01HZXTEST',
  slug: 'my-page',
  navGroup: 'library' as const,
  navIcon: 'table',
  navOrder: 7,
};

/** A table the fixture model definitely classifies as a real entity. */
const someTable = model.tables.find((table) => !table.system)?.id as string;

describe('composeRequestedPage', () => {
  it('composes a page-crud body with real columns from the table', () => {
    const result = composeRequestedPage(model, someTable, 'page-crud', CTX);
    expect(result.bindable).toBe(true);
    expect(result.envelope).not.toBeNull();

    const envelope = pageEnvelopeSchema.parse(result.envelope);
    expect(envelope.template).toBe('page-crud');
    expect(envelope.source.table).toBe(someTable);
    // The point of the whole exercise: an empty `columns[]` is the useless
    // state a hand-created crud page is otherwise stuck in.
    expect((envelope.config['columns'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('carries the caller identity into the envelope, not the table name', () => {
    // The page already exists; recomposing must not mint a new id or move it.
    const result = composeRequestedPage(model, someTable, 'page-crud', CTX);
    const envelope = pageEnvelopeSchema.parse(result.envelope);
    expect(envelope.id).toBe(CTX.id);
    expect(envelope.nav.slug).toBe('my-page');
    expect(envelope.nav.group).toBe('library');
    expect(envelope.nav.order).toBe(7);
  });

  it('reports non-table-bound templates rather than blanking them', () => {
    for (const template of ['page-dashboard', 'page-builder', 'page-wizard', 'page-settings']) {
      const result = composeRequestedPage(model, someTable, template, CTX);
      expect(isTableBoundTemplate(template)).toBe(false);
      // `bindable: false` is the signal to KEEP the current body — a dashboard's
      // widgets are real work that a template re-pick must not destroy.
      expect(result).toMatchObject({ bindable: false, envelope: null });
    }
  });

  it('explains an unknown table instead of throwing', () => {
    const result = composeRequestedPage(model, 'public.does_not_exist', 'page-crud', CTX);
    expect(result.bindable).toBe(true);
    expect(result.envelope).toBeNull();
    expect(result.reason).toMatch(/not available/i);
  });

  it('composes an archetype the table actually supports', () => {
    // Every §14 archetype the fixture model earns should compose when asked for
    // by name; the ones it cannot back return a reason, never a throw.
    const outcomes = [
      'page-board',
      'page-calendar',
      'page-directory',
      'page-master-detail',
      'page-queue-inbox',
    ].map((template) => composeRequestedPage(model, someTable, template, CTX));

    expect(outcomes.every((result) => result.bindable)).toBe(true);
    for (const result of outcomes) {
      if (result.envelope === null) {
        expect(result.reason).not.toBe('');
      } else {
        expect(() => pageEnvelopeSchema.parse(result.envelope)).not.toThrow();
      }
    }
    // At least one must succeed, or the fixture has drifted and this suite is
    // silently asserting nothing.
    expect(outcomes.some((result) => result.envelope !== null)).toBe(true);
  });
});
