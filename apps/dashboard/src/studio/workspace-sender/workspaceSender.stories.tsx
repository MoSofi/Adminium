// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A workspace's sender sheet, in the states its notes describe: no sender yet,
 * its own sender, a From the server cannot send for (refused in words), and a
 * server with no mail set up. Nothing asks a server: where it can send from is
 * written into the page's cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { SENDING_DOMAINS_KEY, acceptedList, type SenderDraft, type SenderRefusal, type SenderWorkspace, type SendingDomains } from './senderApi.js';
import { WorkspaceSenderSheet } from './WorkspaceSenderSheet.js';

const SENDING: SendingDomains = { domains: ['fernhill.example', 'kilnstreet.example'], addresses: ['ana.potter@gmail.com', 'studio@kilnstreet.example'] };
const KILN: SenderWorkspace = { id: 'wsp_kiln', name: 'Kiln Street Pottery', sender: { name: null, from: null, replyTo: null, postal: null } };
const OWN: SenderWorkspace = {
  ...KILN,
  sender: { name: 'Kiln Street Pottery', from: 'studio@kilnstreet.example', replyTo: 'hello@kilnstreet.example', postal: 'Kiln Street Pottery, 12 Kiln Street, Stoke-on-Trent ST1 1AA' },
};

function Open({ workspace, sending = SENDING, draft, refusal }: { workspace: SenderWorkspace; sending?: SendingDomains; draft?: SenderDraft; refusal?: SenderRefusal }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(SENDING_DOMAINS_KEY, sending);
  return (
    <QueryClientProvider client={client}>
      <WorkspaceSenderSheet
        workspace={workspace}
        defaultOpen
        {...(draft === undefined ? {} : { defaultDraft: draft })}
        {...(refusal === undefined ? {} : { defaultRefusal: refusal })}
        opener={(open) => (
          <button type="button" onClick={open}>
            Sender
          </button>
        )}
      />
    </QueryClientProvider>
  );
}

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Studio/Workspaces/Sender' };
export default meta;

export const NoSenderYet = { tags: ['vrt'], render: () => <Open workspace={KILN} /> };
export const OwnSender = { tags: ['vrt'], render: () => <Open workspace={OWN} /> };
export const RefusedFrom = {
  tags: ['vrt'],
  render: () => (
    <Open
      workspace={KILN}
      draft={{ name: 'Kiln Street Pottery', from: 'hello@kiln-pottery.example', replyTo: '', postal: '' }}
      refusal={{ field: 'from', code: 'not-a-sending-domain', accepted: acceptedList(SENDING) }}
    />
  ),
};
export const NoMailOnServer = { tags: ['vrt'], render: () => <Open workspace={KILN} sending={{ domains: [], addresses: [] }} /> };
