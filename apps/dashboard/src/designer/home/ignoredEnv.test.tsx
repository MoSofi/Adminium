// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { IgnoredEnv } from './IgnoredEnv.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function show(ignoredEnv: string[] | undefined) {
  const state = { mode: 'local', project: 'bakery', limits: { maxSteps: 60, turnTokens: 1, sessionTokens: 1 }, active: null, ownerNeedsPassword: false, ...(ignoredEnv === undefined ? {} : { ignoredEnv }) };
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } })));
  vi.stubGlobal('fetch', fetch);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IgnoredEnv />
    </QueryClientProvider>,
  );
  return fetch;
}

describe('the note about ignored .env names', () => {
  it('names them, and stays away for the visit once it is hidden', async () => {
    show(['ADMINIUM_TRUST_PROXY', 'PORT']);
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('ADMINIUM_TRUST_PROXY, PORT');
    await userEvent.click(screen.getByRole('button', { name: 'Hide this note' }));
    expect(screen.queryByRole('note')).toBeNull();
    cleanup();
    show(['PORT']);
    await Promise.resolve();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('is nothing on a terminal (no name is ignored there) and on a server older than the field', async () => {
    for (const names of [[], undefined]) {
      const fetch = show(names);
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      await Promise.resolve();
      expect(screen.queryByRole('note')).toBeNull();
      cleanup();
    }
  });
});
