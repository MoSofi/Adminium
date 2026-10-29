// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The picture dialog in the states the server's view decides, with no picture to load: search off on
 * this server (with the ways that are left), an app made before spots, the same with some made, and
 * Apply waiting for a turn. Dark, right-to-left and density come from the Storybook globals and the
 * VRT matrix. Nothing asks a server: the view is written into the page's cache, as the page would
 * have read it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AppToastProvider } from '../../../pages/toasts.js';
import { designerKeys, type MakersView, type PicturesView } from '../../api.js';
import { PictureDialog } from './PictureDialog.js';

const noop = (): void => undefined;
const SESSION = 'ds_000000000000000000000001';

const VIEW: PicturesView = {
  ownBuild: false,
  spots: [
    { id: 'hero', label: 'Hero', shape: 'wide', shows: 'the best dish', search: 'fried chicken', words: 'fried chicken, photo, natural light, no text', version: 'a1', thumb: null, alt: '', decorative: false, licence: null },
    { id: 'team', label: 'Team', shape: 'wide', shows: 'the people who cook', search: 'kitchen team', words: 'kitchen team, photo, natural light, no text', version: 'b2', thumb: null, alt: '', decorative: false, licence: null },
    { id: 'kitchen', label: 'Kitchen', shape: 'square', shows: 'the kitchen at work', search: 'restaurant kitchen', words: 'restaurant kitchen, photo, natural light, no text', version: 'c3', thumb: null, alt: '', decorative: false, licence: null },
  ],
  tables: [],
  inApp: [],
  mode: 'placeholders',
  legacy: 0,
  sources: [],
  unsplash: 'ok',
  version: 13,
};

function Dialog({ view, working = false, swapping = false, makers }: { view: PicturesView; working?: boolean; swapping?: boolean; makers?: MakersView }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(designerKeys.pictures(SESSION), view);
  if (makers !== undefined) {
    client.setQueryData(designerKeys.makers, makers);
    client.setQueryData(designerKeys.made(SESSION), { pictures: [], running: null });
  }
  return (
    <QueryClientProvider client={client}>
      <AppToastProvider>
        <PictureDialog sessionId={SESSION} open onOpenChange={noop} appName="Crispy Bites" spot="hero" working={working} onApplied={noop} onSwappable={noop} swapping={swapping} {...(makers === undefined ? {} : { initialTab: 'make' as const })} />
      </AppToastProvider>
    </QueryClientProvider>
  );
}

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Designer/Picture dialog' };
export default meta;

export const SearchOff = { tags: ['vrt'], render: () => <Dialog view={VIEW} /> };
export const WhileATurnRuns = { tags: ['vrt'], render: () => <Dialog view={VIEW} working /> };
export const MadeBeforeSpots = { tags: ['vrt'], render: () => <Dialog view={{ ...VIEW, spots: [], legacy: 3 }} /> };
export const MakingThemSwappable = { tags: ['vrt'], render: () => <Dialog view={{ ...VIEW, spots: [], legacy: 3 }} working swapping /> };
export const SomeNotInSpotsYet = { tags: ['vrt'], render: () => <Dialog view={{ ...VIEW, legacy: 2 }} /> };

// The Make one tab. Not in the VRT matrix until its baselines are taken.
const MAKERS: MakersView = {
  makers: [],
  chosen: { id: 'env:openai', label: 'OpenAI', model: 'gpt-image-2', local: false },
  state: 'ok',
  usd: 0.053,
  left: { mine: 18, all: 96 },
  limits: { mine: 20, all: 100 },
  resetsAt: 0,
  chat: true,
  canChoose: true,
};
export const MakeOneReady = { render: () => <Dialog view={VIEW} makers={MAKERS} /> };
export const MakeOneNoService = { render: () => <Dialog view={VIEW} makers={{ ...MAKERS, chosen: null, state: 'none', usd: null, canChoose: false }} /> };
