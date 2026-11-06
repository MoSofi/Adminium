// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send as" on the template editor: hidden while the server has no
 * workspace; offers by the record, the server and each workspace (one with
 * no sender says so); a choice is saved at once and written into the
 * template's cached detail.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../../test/fixtures.js';
import { EMAIL_DOCUMENTS_KEY } from '../../../queries.js';
import type { SendAsOptions } from '../../../sendAs.js';
import { SendAsField } from './SendAsField.js';

const OPTIONS: SendAsOptions = {
  server: 'Shared Host <news@shared-host.example>',
  workspaces: [
    { id: 'wsp_kiln', name: 'Kiln Street Pottery', from: 'studio@kilnstreet.example' },
    { id: 'wsp_archive', name: 'Archive', from: null },
  ],
};

function mount(options: SendAsOptions, sendAs: string | null) {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { sendAs: string | null };
        puts.push({ url: String(input), body });
        return jsonResponse(200, { key: 'firing-done', sendAs: body.sendAs });
      }
      return jsonResponse(200, options);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([...EMAIL_DOCUMENTS_KEY, 'detail', 'tpl_1'], { id: 'tpl_1', sendAs });
  render(
    <QueryClientProvider client={client}>
      <SendAsField documentId="tpl_1" sendAs={sendAs} />
    </QueryClientProvider>,
  );
  return { client, puts };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Send as', () => {
  it('is not offered while the server has no workspace', async () => {
    mount({ server: 'news@shared-host.example', workspaces: [] }, null);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByTestId('email-send-as')).toBeNull();
  });

  it('offers by the record, the server and each workspace, and says what each does', async () => {
    mount(OPTIONS, null);
    const select = (await screen.findByTestId('email-send-as')) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'By the record’s workspace',
      'The server · Shared Host <news@shared-host.example>',
      'Kiln Street Pottery · studio@kilnstreet.example',
      'Archive · no sender yet',
    ]);
    expect(select.value).toBe('');
    expect(screen.getByText('Mail about a record goes from the sender of the workspace its database is in.')).toBeTruthy();
  });

  it('saves a choice at once, for the template, and keeps it in the cached detail', async () => {
    const { client, puts } = mount(OPTIONS, null);
    const select = await screen.findByTestId('email-send-as');
    await userEvent.selectOptions(select, 'wsp_kiln');
    await waitFor(() => expect(puts).toEqual([{ url: '/api/v1/email-templates/tpl_1/send-as', body: { sendAs: 'wsp_kiln' } }]));
    await waitFor(() => expect(client.getQueryData<{ sendAs: string | null }>([...EMAIL_DOCUMENTS_KEY, 'detail', 'tpl_1'])?.sendAs).toBe('wsp_kiln'));
  });

  it('says a workspace with no sender of its own goes as the server', async () => {
    mount(OPTIONS, 'wsp_archive');
    await screen.findByTestId('email-send-as');
    expect(screen.getByText('Archive has no sender of its own yet, so this template goes from the server’s sender.')).toBeTruthy();
  });
});
