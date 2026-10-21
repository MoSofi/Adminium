// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Figma card of the Security page: not connected, connected, and set by the project's environment. Nothing asks
 * a server: the connection is written into the page's cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { designerKeys, type FigmaStatus } from '../designer/api.js';
import { FigmaCard } from './FigmaCard.js';

function Card({ status }: { status: FigmaStatus }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(designerKeys.figma, status);
  return (
    <QueryClientProvider client={client}>
      <div className="max-w-[760px] p-6">
        <FigmaCard />
      </div>
    </QueryClientProvider>
  );
}

const base: FigmaStatus = { connected: false, source: null, handle: null, network: true, lasting: true };

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Account/Security/Figma' };
export default meta;

export const NotConnected = { tags: ['vrt'], render: () => <Card status={base} /> };
export const Connected = { tags: ['vrt'], render: () => <Card status={{ ...base, connected: true, source: 'mine', handle: 'ava.reyes' }} /> };
export const FromTheEnvironment = { tags: ['vrt'], render: () => <Card status={{ ...base, connected: true, source: 'environment' }} /> };
