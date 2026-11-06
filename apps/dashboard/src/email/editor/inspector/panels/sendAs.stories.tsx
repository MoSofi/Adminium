// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send as" on the template editor's Branding panel: by the record, the
 * server, a workspace with its own sender, and one with none yet. Nothing asks
 * a server: the choices are written into the page's cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { sendAsOptionsQuery, type SendAsOptions } from '../../../sendAs.js';
import { SendAsField } from './SendAsField.js';

const OPTIONS: SendAsOptions = {
  server: 'Shared Host <news@shared-host.example>',
  workspaces: [
    { id: 'wsp_coffee', name: 'Fernhill Coffee', from: 'orders@fernhill.example' },
    { id: 'wsp_kiln', name: 'Kiln Street Pottery', from: 'studio@kilnstreet.example' },
    { id: 'wsp_archive', name: 'Archive', from: null },
  ],
};

function Field({ sendAs }: { sendAs: string | null }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(sendAsOptionsQuery().queryKey, OPTIONS);
  return (
    <QueryClientProvider client={client}>
      <div className="w-[300px] p-6">
        <SendAsField documentId="tpl_1" sendAs={sendAs} />
      </div>
    </QueryClientProvider>
  );
}

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Email/Editor/Send as' };
export default meta;

export const ByTheRecord = { tags: ['vrt'], render: () => <Field sendAs={null} /> };
export const AsTheServer = { tags: ['vrt'], render: () => <Field sendAs="server" /> };
export const AsAWorkspace = { tags: ['vrt'], render: () => <Field sendAs="wsp_kiln" /> };
export const WorkspaceWithoutSender = { tags: ['vrt'], render: () => <Field sendAs="wsp_archive" /> };
