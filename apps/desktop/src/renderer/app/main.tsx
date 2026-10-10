// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@adminium/i18n/react';
import { ThemeProvider } from '@adminium/ui';

import { App, SharedApp } from './App.js';
import { desktopApi, startApi } from './bridge.js';
import { initWords, localeFor } from './words.js';
import './styles.css';

async function start(): Promise<void> {
  // The sharing details of a project: there is no Start to ask (it is answered only while Start is the screen).
  const shared = window.location.hash === '#/shared' ? await desktopApi().project.shareInfo?.() : null;
  const state = shared == null ? await startApi().state() : null;
  const locale = localeFor((shared ?? state)?.language ?? null, navigator.language);
  const i18n = await initWords(locale);

  const container = document.getElementById('root');
  if (container === null) throw new Error('missing #root container');
  createRoot(container).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        {/* No control for either on these pages: they follow the app's saved choice, set in the window's menu. */}
        <ThemeProvider userPrefs={{ theme: (shared ?? state)?.theme ?? 'system', locale }}>{shared != null ? <SharedApp initial={shared} /> : state === null ? null : <App initial={state} />}</ThemeProvider>
      </I18nProvider>
    </StrictMode>,
  );
}

void start();
