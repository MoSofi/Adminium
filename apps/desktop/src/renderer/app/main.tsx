// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@adminium/i18n/react';
import { ThemeProvider } from '@adminium/ui';

import { App } from './App.js';
import { startApi } from './bridge.js';
import { initWords, localeFor } from './words.js';
import './styles.css';

async function start(): Promise<void> {
  const state = await startApi().state();
  const locale = localeFor(state.language, navigator.language);
  const i18n = await initWords(locale);

  const container = document.getElementById('root');
  if (container === null) throw new Error('missing #root container');
  createRoot(container).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        {/* No control for either on these pages: they follow the app's saved choice, set in the window's menu. */}
        <ThemeProvider userPrefs={{ theme: state.theme, locale }}>
          <App initial={state} />
        </ThemeProvider>
      </I18nProvider>
    </StrictMode>,
  );
}

void start();
