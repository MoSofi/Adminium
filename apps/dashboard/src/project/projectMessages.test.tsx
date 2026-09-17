// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The deferred `project` namespace, wired (`projectMessages.ts`): a project
 * cell waits for the namespace and then speaks the reader's language, instead
 * of rendering its inline English. Real i18next, as in
 * `studio/studioMessages.test.ts`: the test stand-in resolves every namespace
 * at once, which is the condition under test.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { createI18n, loadLocaleBundle } from '@adminium/i18n';
import { CellValue, gridColumnSpecSchema } from '@adminium/widgets';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setI18nInstance, t } from '../i18n/t.js';
import { AppToastProvider } from '../pages/toasts.js';
import { makeBootstrap } from '../test/fixtures.js';
import { ProjectScope } from './scope.js';

const PROJECT_BUNDLE = /\/api\/v1\/i18n\/bundle\/(\w+)\/project$/;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const match = PROJECT_BUNDLE.exec(String(input));
      if (match === null) return Promise.resolve(new Response('{}', { status: 404 }));
      return Promise.resolve(
        new Response(JSON.stringify({ locale: match[1], namespace: 'project', version: 1, overrides: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setI18nInstance(null);
});

describe('the project messages', () => {
  it('load before a project cell draws, in the reader’s language', async () => {
    const i18n = await createI18n({ locale: 'de_DE', loadBundle: loadLocaleBundle });
    setI18nInstance(i18n);
    // Not loaded yet: the inline text answers.
    expect(t('project:cell.unknown', 'NOT LOADED', { id: 'x' })).toBe('NOT LOADED');

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(
      ['bootstrap'],
      makeBootstrap({ project: { databases: {}, client: { digest: 'd', pages: [], widgets: [] } } }),
    );
    const column = gridColumnSpecSchema.parse({ name: 'flagged', label: 'Flag', widget: 'project.nope' });
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <AppToastProvider>
            <ProjectScope>
              <CellValue column={column} row={{ flagged: 'yes' }} />
            </ProjectScope>
          </AppToastProvider>
        </QueryClientProvider>,
      );
    });

    expect(await screen.findByRole('img', { name: 'Dieses Projekt hat kein Widget project.nope.' })).toBeTruthy();
    expect(t('project:table.empty', 'NOT LOADED')).toBe('Keine Datensätze');
  });
});
