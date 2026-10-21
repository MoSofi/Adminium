// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pay page's entry: which page this is, which language and colours, then
 * the page. Words are loaded before the first render, so nothing is drawn in
 * one language and redrawn in another.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@adminium/i18n/react';

import { DemoPage } from './DemoPage.js';
import { applyDirection, PayApp } from './PayApp.js';
import { routeOf } from './route.js';
import { initPayWords, PAY_LANGUAGES, payLocaleFor } from './words.js';
import './pay.css';

function theme(): void {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
  const apply = (): void => {
    document.documentElement.dataset['theme'] = dark?.matches === true ? 'dark' : 'light';
  };
  apply();
  dark?.addEventListener?.('change', apply);
}

async function start(): Promise<void> {
  theme();
  document.documentElement.dataset['accent'] = 'orange';
  const route = routeOf(window.location.pathname, window.location.search);
  const locale = payLocaleFor(navigator.languages ?? [navigator.language]);
  const language = PAY_LANGUAGES.find((one) => one.id === locale) ?? PAY_LANGUAGES[0]!;
  applyDirection(language.tag, language.dir);
  const i18n = await initPayWords(locale);
  const container = document.getElementById('pay-root');
  if (container === null) return;
  createRoot(container).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        {route.kind === 'demo' ? <DemoPage attempt={route.attempt} locale={language.tag} /> : route.kind === 'none' ? <PayApp route={{ kind: 'link', token: '' }} /> : <PayApp route={route} />}
      </I18nProvider>
    </StrictMode>,
  );
}

void start();
