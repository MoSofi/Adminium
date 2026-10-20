// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "From Figma…" dialog in the states the server's answer decides: not connected, connected, set
 * by the project's environment, network features off, and a server with no lasting disk. Dark, right-to-left and density come from the
 * Storybook globals and the VRT matrix. Nothing asks a server: the connection is written into the
 * page's cache, as the page would have read it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AppToastProvider } from '../../pages/toasts.js';
import { designerKeys, type FigmaStatus } from '../api.js';
import { FromFigmaDialog } from './FromFigma.js';

const noop = (): void => undefined;

function Dialog({ status }: { status: FigmaStatus }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(designerKeys.figma, status);
  return (
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <FromFigmaDialog open onOpenChange={noop} onImported={noop} />
      </AppToastProvider>
    </QueryClientProvider>
  );
}

const NONE: FigmaStatus = { connected: false, source: null, handle: null, network: true, lasting: true };
const MINE: FigmaStatus = { connected: true, source: 'mine', handle: 'ava.reyes', network: true, lasting: true };

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Designer/From Figma' };
export default meta;

export const NotConnected = { tags: ['vrt'], render: () => <Dialog status={NONE} /> };
export const Connected = { tags: ['vrt'], render: () => <Dialog status={MINE} /> };
export const FromTheEnvironment = { tags: ['vrt'], render: () => <Dialog status={{ ...MINE, source: 'environment', handle: null }} /> };
export const NetworkOff = { tags: ['vrt'], render: () => <Dialog status={{ ...NONE, network: false }} /> };
export const NoLastingDisk = { tags: ['vrt'], render: () => <Dialog status={{ ...MINE, lasting: false }} /> };
