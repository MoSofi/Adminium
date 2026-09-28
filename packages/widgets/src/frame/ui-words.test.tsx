// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A widget waits for its words. en-US ships `ui.widgets.*` and
 * `ui.templates.*` as their own chunk (`UI_DEFERRED_GROUPS`); a widget that
 * painted before the chunk was in would show its inline English and then the
 * catalogue's — or, for a key it reads by name (a card's description), its
 * id. So every widget translator waits (`useUiWords`), and the first frame a
 * reader sees already carries the catalogue's words.
 *
 * The run's setup reads the words once for every other test; this one starts
 * from a fresh copy of the i18n modules, where nothing has read them yet.
 */
import { act, render, screen } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

describe('the widget and template words', () => {
  it('are not in a new en-US instance, and a widget waits for them before it paints', async () => {
    vi.resetModules();
    const { createI18n, hasUiWords, UI_DEFERRED_GROUPS } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const { useMaybeT } = await import('../lib/i18n.js');
    expect([...UI_DEFERRED_GROUPS]).toEqual(['widgets', 'templates']);

    const i18n = await createI18n({ locale: 'en_US' });
    // The eager `ui` carries the frame's words, never the widgets' or the templates'.
    expect(i18n.getResource('en-US', 'ui', 'frame.emptyTitle')).toBe('No data for range');
    expect(hasUiWords(i18n)).toBe(false);

    const painted: string[] = [];
    function Card(): ReactNode {
      const t = useMaybeT();
      // A key read by name, whose "fallback" is only the widget's id: what a reader would see if it painted early.
      const text = t('ui:widgets.tables.miniTable.viewAllLabel', 'miniTable.viewAllLabel');
      painted.push(text);
      return <p data-testid="card">{text}</p>;
    }
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <Suspense fallback={<p data-testid="waiting" />}>
            <Card />
          </Suspense>
        </I18nProvider>,
      );
    });
    expect((await screen.findByTestId('card')).textContent).toBe('View all');
    // Never once painted with the stand-in.
    expect(painted.every((text) => text === 'View all')).toBe(true);
    expect(hasUiWords(i18n)).toBe(true);

    // An instance made after (an override rebuild) starts with them: nothing waits twice.
    const next = await createI18n({ locale: 'en_US' });
    expect(hasUiWords(next)).toBe(true);
  });

  it('keep an override an admin wrote for one of them', async () => {
    vi.resetModules();
    const { createI18n, uiWordsReady } = await import('@adminium/i18n');
    const i18n = await createI18n({ locale: 'en_US' });
    // Applied at boot, before the words were read (the dashboard's override refresh).
    i18n.addResources('en-US', 'ui', { 'widgets.tables.miniTable.viewAllLabel': 'Everything' });
    await uiWordsReady(i18n);
    expect(i18n.t('ui:widgets.tables.miniTable.viewAllLabel')).toBe('Everything');
    expect(i18n.t('ui:widgets.tables.capacityLeft.takenOnly', { taken: 3 })).toBe('3 taken');
  });
});
