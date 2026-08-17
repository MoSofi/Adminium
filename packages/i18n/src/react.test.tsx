// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * React binding tests: provider re-render on languageChanged, useT fallback
 * signature, useRtl/useLocale, and useFmt locale binding.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createI18n, switchLocale, type I18nInstance } from './create-i18n.js';
import { I18nProvider, useFmt, useLocale, useMaybeT, useRtl, useT } from './react.js';

function Probe() {
  const t = useT();
  const locale = useLocale();
  const rtl = useRtl();
  const fmt = useFmt();
  return (
    <div>
      <p data-testid="title">{t('account.title', 'fallback-title')}</p>
      <p data-testid="missing">{t('no.such.key', 'the fallback')}</p>
      <p data-testid="locale">{locale}</p>
      <p data-testid="dir">{rtl ? 'rtl' : 'ltr'}</p>
      <p data-testid="number">{fmt.number(1234.5)}</p>
    </div>
  );
}

async function setup(): Promise<I18nInstance> {
  const i18n = await createI18n({
    locale: 'en_US',
    loadBundle: async (tag, ns) =>
      tag === 'de-DE' && ns === 'common' ? { account: { title: 'Konto' } } : null,
  });
  render(
    <I18nProvider i18n={i18n}>
      <Probe />
    </I18nProvider>,
  );
  return i18n;
}

describe('I18nProvider bindings', () => {
  afterEach(cleanup); // node-default env: no global setup registers testing-library cleanup

  it('translates with the key+fallback signature and exposes locale metadata', async () => {
    await setup();
    expect(screen.getByTestId('title').textContent).toBe('Account');
    expect(screen.getByTestId('missing').textContent).toBe('the fallback');
    expect(screen.getByTestId('locale').textContent).toBe('en_US');
    expect(screen.getByTestId('dir').textContent).toBe('ltr');
    expect(screen.getByTestId('number').textContent).toBe('1,234.5');
  });

  it('re-renders the subtree with fresh strings + formatters on locale switch', async () => {
    const i18n = await setup();
    await act(async () => {
      await switchLocale(i18n, 'de_DE');
    });
    expect(screen.getByTestId('title').textContent).toBe('Konto');
    expect(screen.getByTestId('locale').textContent).toBe('de_DE');
    expect(screen.getByTestId('number').textContent).toBe('1.234,5');
  });
});

function MaybeProbe() {
  const t = useMaybeT();
  return (
    <div>
      <p data-testid="maybe-title">{t('account.title', 'fallback-title')}</p>
      <p data-testid="maybe-icu">{t('no.such.key', '{count, plural, one {# card} other {# cards}}', { count: 2 })}</p>
      <p data-testid="maybe-arg">{t('no.such.key', 'Moved {title}.', { title: 'Invoice' })}</p>
    </div>
  );
}

describe('useMaybeT', () => {
  afterEach(cleanup);

  it('binds to the provider when present', async () => {
    const i18n = await createI18n({ locale: 'en_US', loadBundle: async () => null });
    render(
      <I18nProvider i18n={i18n}>
        <MaybeProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('maybe-title').textContent).toBe('Account');
  });

  it('ICU-formats the English fallback outside a provider instead of throwing', () => {
    render(<MaybeProbe />);
    expect(screen.getByTestId('maybe-title').textContent).toBe('fallback-title');
    expect(screen.getByTestId('maybe-icu').textContent).toBe('2 cards');
    expect(screen.getByTestId('maybe-arg').textContent).toBe('Moved Invoice.');
  });
});
