// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * page-builder template tests (M7-T06, 09-generated-app.md §7.11):
 *
 *  - the block-kind meta registry has the CORRECT [label, icon] orientation
 *    for every entry — the Report Builder comp shipped four entries swapped
 *    (`['life-buoy', 'Contact']`, …), and 15-quality.md §comp-defects demands
 *    a unit test on the registry order;
 *  - the survey publish summary derives every count LIVE from the current
 *    question list (ia-mapping §5: the comp hard-coded "12 questions");
 *  - the invoice flavor composes palette → `document-canvas` → inspector, a
 *    palette add lands on the canvas and in `onDocChange`, canvas reorders
 *    echo back onto the doc;
 *  - the automation flavor guards the non-removable trigger on every commit;
 *  - invalid configs render the alert card, never a crash;
 *  - the email flavor keeps the always-light paper scope.
 */
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PageBuilder } from './PageBuilder.js';
import {
  BLOCK_IDS,
  BLOCK_KIND_META,
  BUILDER_DRAFT_CONNECTION_ID,
  DOC_TYPE_PALETTE,
  addBlockToDoc,
  builderDemoDoc,
  canvasItemOf,
  ensureTriggerFirst,
  isDraftMutation,
  reorderDocByBlockIds,
  starterDocOf,
  surveySummaryOf,
  type DocRecord,
} from './builder-config.js';

/**
 * This file's interaction tests wait for the `document-canvas` widget, which
 * WidgetHost resolves asynchronously (the lazy component barrel). The 1000ms
 * `waitFor` default is enough on a dev machine but has flaked past it on a
 * loaded CI runner. Raise the async-util timeout for THIS FILE ONLY — a global
 * bump breaks the media suite's deliberately-bounded `findByTestId` waits — and
 * restore it so nothing leaks if a worker reuses the process. 8s sits under the
 * widgets `testTimeout` (vitest.config.ts) so the test budget is never the cap.
 */
beforeAll(() => configure({ asyncUtilTimeout: 8000 }));
afterAll(() => configure({ asyncUtilTimeout: 1000 }));

// ── the Report Builder kindMeta fix (M7-T06; 15-quality comp-defect list) ────

describe('BLOCK_KIND_META (kindMeta swap regression)', () => {
  const KEBAB_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  it('covers every block id with label copy in the label slot and a kebab slug in the icon slot', () => {
    for (const id of BLOCK_IDS) {
      const meta = BLOCK_KIND_META[id];
      expect(meta, id).toBeDefined();
      // Labels are Title-cased human copy — an icon slug ('life-buoy') here is
      // exactly the comp's swap bug.
      expect(meta.label, `${id} label`).toMatch(/^[A-Z]/);
      expect(KEBAB_SLUG.test(meta.label), `${id} label must not be a slug`).toBe(false);
      // Icons are kebab lucide slugs — human copy here is the other half.
      expect(meta.icon, `${id} icon`).toMatch(KEBAB_SLUG);
    }
  });

  it('resolves every palette slug to a real glyph, never the placeholder', () => {
    // The registry's `icon` is a slug; `PageBuilder`'s BLOCK_ICONS maps it to a
    // component, and an UNMAPPED slug silently falls through to a
    // `SquareDashed` placeholder. Nothing used to notice: the test above checks
    // only that the slug is kebab-shaped, VRT skips this template (no `vrt`
    // story tag), and axe cannot see a glyph BlockIcon marks `aria-hidden`. So
    // the six `email.*` blocks shipped drawing the same dashed square as each
    // other at the top of the email palette.
    //
    // The assertion is `square-dashed IFF declared`, not "the rendered class
    // matches the slug", and that is deliberate. Some slugs name a DEPRECATED
    // lucide alias: `bar-chart-3` is a legal named import that renders
    // `class="lucide lucide-chart-column"`, because lucide renamed the icon and
    // kept the old export. The glyph is right and the spelling is history — a
    // class-equality check fails on it and teaches the next person to "correct"
    // a name that is fine.
    // The palette record, not BUILDER_DOC_TYPES: `survey` and `automation` are
    // builder doc types with no block rail at all (they mount the question
    // builder and the flow canvas), so they have no entry here.
    const palettes = Object.entries(DOC_TYPE_PALETTE);
    expect(palettes.length, 'doc types with a palette').toBe(3);

    for (const [docType, palette] of palettes) {
      const { container, unmount } = render(<PageBuilder config={{ docType }} />);
      // A doc type whose palette stopped rendering would pass everything below
      // by iterating nothing.
      expect(palette.length, `${docType} palette`).toBeGreaterThan(0);
      for (const block of palette) {
        const row = container.querySelector(`[data-part="builder-add-block"][data-block="${block}"]`);
        expect(row, `${docType}: no palette row for ${block}`).not.toBeNull();
        const glyph = row?.querySelector('svg')?.getAttribute('class') ?? '';
        const slug = BLOCK_KIND_META[block].icon;
        expect(
          glyph.includes('lucide-square-dashed'),
          `${docType}/${block} declares '${slug}' and drew the placeholder — add it to BLOCK_ICONS`,
        ).toBe(slug === 'square-dashed');
      }
      unmount();
    }
  });

  it('pins the four entries the comp shipped swapped', () => {
    expect(BLOCK_KIND_META['block-contact']).toEqual({ label: 'Contact', icon: 'life-buoy' });
    expect(BLOCK_KIND_META['block-loyalty-banner']).toEqual({ label: 'Loyalty points', icon: 'award' });
    expect(BLOCK_KIND_META['block-delivery-stepper']).toEqual({ label: 'Delivery timeline', icon: 'truck' });
    expect(BLOCK_KIND_META['block-recurring-banner']).toEqual({ label: 'Recurring', icon: 'repeat' });
  });
});

// ── survey live counts (ia-mapping §5 static-counts fix) ─────────────────────

describe('surveySummaryOf', () => {
  it('derives counts from the question list, never a constant', () => {
    const two = surveySummaryOf({ questions: [{ required: true }, { required: false }] });
    expect(two).toEqual({ questions: 2, required: 1, estMinutes: 1 });

    const twelve = surveySummaryOf({
      questions: Array.from({ length: 12 }, (_, index) => ({ required: index % 3 === 0 })),
    });
    expect(twelve.questions).toBe(12);
    expect(twelve.required).toBe(4);
    expect(twelve.estMinutes).toBe(3);
  });

  it('reads both a bare values bag and a form-state envelope', () => {
    expect(surveySummaryOf({ values: { questions: [{}] } }).questions).toBe(1);
    expect(surveySummaryOf(undefined).questions).toBe(0);
  });
});

// ── doc algebra ──────────────────────────────────────────────────────────────

describe('doc algebra', () => {
  it('addBlockToDoc appends a collision-free instance and clears a hide-flag', () => {
    const doc: DocRecord = {
      docType: 'invoice',
      blockOrder: [{ id: 'block-signature-0', block: 'block-signature' }],
      flags: { 'block-signature': false },
    };
    const next = addBlockToDoc(doc, 'block-signature', 'invoice');
    expect(next.blockOrder?.map((instance) => instance.id)).toEqual([
      'block-signature-0',
      'block-signature-1',
    ]);
    expect(next.flags?.['block-signature']).toBeUndefined();
  });

  it('reorderDocByBlockIds echoes the canvas order, drops removed and unknown ids', () => {
    const doc: DocRecord = {
      docType: 'invoice',
      blockOrder: [
        { id: 'a', block: 'block-line-items' },
        { id: 'b', block: 'block-totals-summary', label: 'Totals' },
        { id: 'c', block: 'block-signature' },
      ],
    };
    const next = reorderDocByBlockIds(
      doc,
      ['block-signature', 'block-line-items', 'not-a-block'],
      'invoice',
    );
    expect(next.blockOrder).toEqual([
      { id: 'c', block: 'block-signature' },
      { id: 'a', block: 'block-line-items' },
    ]);
  });

  it('canvasItemOf prefers the docType canvas, falls back to any canvas, then synthesizes', () => {
    const layout = {
      items: [
        { i: 'p', widget: 'chip-cloud', config: {} },
        { i: 'q', widget: 'question-builder', config: { maxQuestions: 5 } },
      ],
    };
    expect(canvasItemOf(layout, 'survey')).toEqual({
      i: 'q',
      widget: 'question-builder',
      config: { maxQuestions: 5 },
    });
    // Wrong-flavor layout still yields a canvas (stored docs keep rendering).
    expect(canvasItemOf(layout, 'invoice').widget).toBe('question-builder');
    expect(canvasItemOf(undefined, 'automation')).toEqual({
      i: 'canvas-flow-builder',
      widget: 'flow-builder',
      config: {},
    });
  });

  it('ensureTriggerFirst re-seats a lost trigger and leaves complete lists alone', () => {
    const previous = [
      { id: 't', kind: 'trigger' },
      { id: 'a', kind: 'action' },
    ];
    expect(ensureTriggerFirst([{ id: 'a', kind: 'action' }], previous)).toEqual([
      { id: 't', kind: 'trigger' },
      { id: 'a', kind: 'action' },
    ]);
    const kept = [
      { id: 't', kind: 'trigger' },
      { id: 'b', kind: 'action' },
    ];
    expect(ensureTriggerFirst(kept, previous)).toEqual(kept);
    // A flow that never had a trigger passes through — the palette adds it.
    expect(ensureTriggerFirst([{ id: 'x', kind: 'action' }], [])).toEqual([{ id: 'x', kind: 'action' }]);
  });

  it('starterDocOf seeds the domain-true donation receipt with its Tax ID block', () => {
    const doc = starterDocOf('st-donation', 'invoice');
    expect(doc.title).toBe('Donation receipt (Tax ID)');
    expect(doc.rates?.taxRate).toBe(0);
    expect(doc.blockOrder?.some((instance) => instance.block === 'block-highlight-box')).toBe(true);
    // Deterministic: same starter, same doc (04 §7.7).
    expect(starterDocOf('st-donation', 'invoice')).toEqual(doc);
  });
});

// ── rendered flavors ─────────────────────────────────────────────────────────

describe('PageBuilder (invoice flavor)', () => {
  it('composes palette → document-canvas → inspector; palette add reaches canvas + onDocChange', async () => {
    const onDocChange = vi.fn();
    const { container } = render(
      <PageBuilder
        config={{ docType: 'invoice' }}
        data={{ row: builderDemoDoc('invoice', 21) }}
        onDocChange={onDocChange}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-widget="document-canvas"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-part="builder-palette"]')).not.toBeNull();
    expect(container.querySelector('[data-part="builder-inspector"]')).not.toBeNull();
    expect(container.querySelector('[data-part="block-instance"][data-block="block-signature"]')).toBeNull();

    fireEvent.click(
      container.querySelector('[data-part="builder-add-block"][data-block="block-signature"]') as Element,
    );

    const doc = onDocChange.mock.calls.at(-1)?.[0] as DocRecord;
    expect(doc.blockOrder?.some((instance) => instance.block === 'block-signature')).toBe(true);
    await waitFor(() => {
      expect(
        container.querySelector('[data-part="block-instance"][data-block="block-signature"]'),
      ).not.toBeNull();
    });
  });

  it('echoes a canvas reorder back onto the doc and forwards the mutate intent', async () => {
    const onDocChange = vi.fn();
    const onEvent = vi.fn();
    const doc: DocRecord = {
      docType: 'invoice',
      title: 'Invoice',
      items: [],
      blockOrder: [
        { id: 'x1', block: 'block-line-items' },
        { id: 'x2', block: 'block-totals-summary' },
      ],
    };
    const { container } = render(
      <PageBuilder config={{ docType: 'invoice' }} data={{ row: doc }} onDocChange={onDocChange} onEvent={onEvent} />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('[data-part="block-instance"]').length).toBe(2);
    });
    fireEvent.click(container.querySelector('[data-part="block-move-down"]') as Element);

    expect(onEvent).toHaveBeenCalledTimes(1);
    const [instanceId, event] = onEvent.mock.calls[0] as [string, { type: string; table: string }];
    expect(instanceId).toBe('canvas-document-canvas');
    expect(event.type).toBe('mutate');
    expect(isDraftMutation(event as never)).toBe(true);

    const next = onDocChange.mock.calls.at(-1)?.[0] as DocRecord;
    expect(next.blockOrder?.map((instance) => instance.id)).toEqual(['x2', 'x1']);
  });

  it('inspector module toggle hides a block without dropping it from the doc', async () => {
    const onDocChange = vi.fn();
    const { container } = render(
      <PageBuilder
        config={{ docType: 'invoice' }}
        data={{ row: builderDemoDoc('invoice', 3) }}
        onDocChange={onDocChange}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-widget="document-canvas"]')).not.toBeNull();
    });

    fireEvent.click(
      container.querySelector('[data-part="inspector-module"][data-block="block-line-items"]') as Element,
    );
    const doc = onDocChange.mock.calls.at(-1)?.[0] as DocRecord;
    expect(doc.flags?.['block-line-items']).toBe(false);
    await waitFor(() => {
      expect(
        container.querySelector('[data-part="block-instance"][data-block="block-line-items"]'),
      ).toBeNull();
    });
  });
});

describe('PageBuilder (survey flavor — live counts)', () => {
  it('inspector and publish modal derive counts from the CURRENT questions, not a constant', async () => {
    const seed = {
      fields: [],
      values: {
        questions: [
          { id: 'q1', kind: 'nps', q: 'Recommend us?', required: true },
          { id: 'q2', kind: 'short-text', q: 'Anything else?', required: false },
        ],
      },
    };
    const { container } = render(<PageBuilder config={{ docType: 'survey' }} data={seed} />);

    await waitFor(() => {
      expect(container.querySelector('[data-widget="question-builder"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-part="summary-questions"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-part="summary-required"]')?.textContent).toBe('1');

    // Add a question through the builder's own palette — the counts must move.
    fireEvent.click(container.querySelector('[data-part="palette-kind"][data-kind="rating"]') as Element);
    await waitFor(() => {
      expect(container.querySelector('[data-part="summary-questions"]')?.textContent).toBe('3');
    });

    // The publish modal reads the SAME live summary (the comp's "12" bug).
    fireEvent.click(container.querySelector('[data-part="builder-publish"]') as Element);
    await waitFor(() => {
      expect(document.querySelector('[data-part="publish-questions"]')?.textContent).toBe('3');
    });
    fireEvent.click(document.querySelector('[data-part="publish-confirm"]') as Element);
    await waitFor(() => {
      expect(screen.getByText('Survey published')).toBeDefined();
    });
  });
});

describe('PageBuilder (automation flavor)', () => {
  it('renders the flow canvas and keeps the trigger through a removal commit', async () => {
    const onEvent = vi.fn();
    const seed = {
      fields: [],
      values: {
        nodes: [
          { id: 'n1', kind: 'trigger', icon: 'zap', title: 'When a user signs up', sub: 'account.created' },
          { id: 'n2', kind: 'action', icon: 'mail', title: 'Send welcome email' },
        ],
        runs: 2481,
        successRate: 99,
      },
    };
    const { container } = render(
      <PageBuilder config={{ docType: 'automation' }} data={seed} onEvent={onEvent} />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-widget="flow-builder"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-part="summary-steps"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-part="flow-stats"]')?.textContent).toContain('2481');

    // Remove the TRIGGER node — the forwarded intent must still carry it first.
    fireEvent.click(container.querySelector('[data-part="flow-remove"]') as Element);
    const event = onEvent.mock.calls.at(-1)?.[1] as {
      values: { nodes: { id: string; kind: string }[] };
      connectionId: string;
    };
    expect(event.connectionId).toBe(BUILDER_DRAFT_CONNECTION_ID);
    expect(event.values.nodes[0]?.kind).toBe('trigger');
    expect(container.querySelector('[data-part="summary-steps"]')?.textContent).toBe('2');
    // The remounted canvas re-seeds with the trigger restored.
    await waitFor(() => {
      expect(container.querySelectorAll('[data-part="flow-node"]').length).toBe(2);
    });
  });
});

describe('PageBuilder (config + flavors edge cases)', () => {
  it('renders the invalid-config alert for an unknown docType, never a crash', () => {
    render(<PageBuilder config={{ docType: 'bogus' }} />);
    expect(screen.getByTestId('page-builder-invalid')).toBeDefined();
  });

  it('email flavor keeps the always-light paper scope', async () => {
    const { container } = render(
      <PageBuilder config={{ docType: 'email' }} data={{ row: builderDemoDoc('email', 3) }} />,
    );
    await waitFor(() => {
      const canvas = container.querySelector('[data-widget="document-canvas"]');
      expect(canvas?.getAttribute('data-doc-type')).toBe('email');
      expect(canvas?.className).toContain('adm-always-light');
    });
  });

  it('mounts the canvas named by a stored layout item and omits the palette for survey', async () => {
    const config = {
      docType: 'survey',
      layout: {
        version: 1,
        items: [{ i: 'slot-canvas', widget: 'question-builder', x: 3, y: 0, w: 6, h: 24, config: {} }],
      },
    };
    const { container } = render(<PageBuilder config={config} />);
    await waitFor(() => {
      expect(container.querySelector('[data-widget="question-builder"]')).not.toBeNull();
    });
    // question-builder ships its own palette rail — the template omits ITS
    // block palette exactly like the manifest slot's `fallback: 'omit'`.
    expect(container.querySelector('[data-part="builder-palette"]')).toBeNull();
  });
});

describe('builder chrome localization (ui:templates.builder.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? {
              templates: {
                builder: {
                  paletteTitle: 'Bausteine',
                  // One dynamic-prefix leaf proves the render-boundary lookup
                  // over the English BLOCK_KIND_META const.
                  blocks: { 'block-line-items': 'Positionen' },
                },
              },
            }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <PageBuilder config={{ docType: 'invoice' }} data={{ row: builderDemoDoc('invoice', 3) }} />
      </I18nProvider>,
    );
    expect(screen.getByText('Bausteine')).toBeTruthy();
    // Palette row + inspector module row both resolve the bundle label.
    expect(screen.getAllByText('Positionen').length).toBeGreaterThanOrEqual(2);

    cleanup();
    render(<PageBuilder config={{ docType: 'invoice' }} data={{ row: builderDemoDoc('invoice', 3) }} />);
    expect(screen.getByText('Blocks')).toBeTruthy();
    expect(screen.getAllByText('Line items').length).toBeGreaterThanOrEqual(2);
  });
});
