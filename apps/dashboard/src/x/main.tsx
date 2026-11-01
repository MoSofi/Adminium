// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The entry of the pages a stranger sees at `/x/`: which page this is, which
 * language and theme, then the page. The engine's words are loaded before
 * the first render, so nothing is drawn in one language and redrawn in
 * another; the install's accent comes with the form.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@adminium/i18n/react';

import { applyDirection, XApp } from './XApp.js';
import { routeOf } from './route.js';
import { initXWords, languageOfTag, X_LANGUAGES, xLocaleFor } from './words.js';
import './x.css';

function theme(): void {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
  const apply = (): void => {
    document.documentElement.dataset['theme'] = dark?.matches === true ? 'dark' : 'light';
  };
  apply();
  dark?.addEventListener?.('change', apply);
}

async function start(): Promise<void> {
  const route = routeOf(window.location.pathname, window.location.search);
  // A frame is the website's page: its own background shows round the card, light.
  if (route.frame) document.documentElement.dataset['theme'] = 'light';
  else theme();
  const locale = xLocaleFor(route.lang, navigator.languages ?? [navigator.language]);
  const language = X_LANGUAGES.find((one) => one.id === locale) ?? languageOfTag('en-US');
  applyDirection(language);
  const i18n = await initXWords(locale);
  const container = document.getElementById('x-root');
  if (container === null) return;
  createRoot(container).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <XApp route={route} />
      </I18nProvider>
    </StrictMode>,
  );
}

void start();
