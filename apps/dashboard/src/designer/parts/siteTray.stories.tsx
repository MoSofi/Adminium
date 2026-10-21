// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A site template in the Designer's message box, in the states the composer draws: in the tray
 * with what was left out, going up (Send waits), refused, the question a second site asks, and held
 * on Home before there is a session. Dark, right-to-left and density come from the Storybook
 * globals and the VRT matrix.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppToastProvider } from '../../pages/toasts.js';
import type { DesignerAttachment } from '../api.js';
import { BuildComposer } from './BuildComposer.js';
import { NO_SITE, type SiteControl, type SiteTrayItem } from './siteState.js';
import { SiteTray } from './siteTray.js';

const SITE: DesignerAttachment = {
  id: 'att_00000000000000000001',
  label: 'harbor-bakery',
  kind: 'site',
  mediaType: 'application/zip',
  bytes: 1,
  pages: 9,
  files: 64,
  leftOut: [
    { file: 'shop.php', reason: 'php' },
    { file: 'intro.mp4', reason: 'video' },
  ],
  leftOutCount: 2,
};
const pending = { key: 's1', name: 'harbor-bakery', filename: 'harbor-bakery.zip', source: { kind: 'zip' as const, zip: new Blob() } };
const item = (over: Partial<SiteTrayItem>): SiteTrayItem => ({ key: 's1', name: 'harbor-bakery', phase: 'ready', percent: 100, attachment: SITE, sessionId: 'ds_000000000000000000000001', pending, ...over });
const control = (over: Partial<SiteControl>): SiteControl => ({ ...NO_SITE, ...over });
const box = (site: SiteControl) => (
  <div className="relative mt-[200px] flex w-[340px] flex-col gap-1.5 rounded-2xl border border-border-strong bg-surface px-3 pb-12 pt-2.5">
    <SiteTray site={site} />
  </div>
);

// Plain CSF objects: Storybook needs no types, and the dashboard does not depend on Storybook.
const meta = { title: 'Designer/Site template tray' };
export default meta;

export const InTheTray = { tags: ['vrt'], render: () => box(control({ current: item({}) })) };

export const GoingUp = {
  tags: ['vrt'],
  render: () => {
    const site = control({ current: item({ phase: 'uploading', percent: 64 }), uploading: true });
    const attach = { files: [], refused: null, add: () => undefined, addFigma: () => undefined, remove: () => undefined, clear: () => undefined, upload: async () => [], hasImage: false, site };
    // The composer's attach menu reads the project's templates when it opens, and its Figma dialog says things in toasts:
    // a client and a toast host of its own, asked nothing here.
    return (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })}>
        <AppToastProvider>
        <div className="w-[340px] bg-bg">
          <BuildComposer value="Make this my bakery." onChange={() => undefined} onSend={() => undefined} onStop={() => undefined} working={false} canSend placeholder="" model={null} attach={attach} tray={box(site)} />
        </div>
        </AppToastProvider>
      </QueryClientProvider>
    );
  },
};

export const Refused = { tags: ['vrt'], render: () => box(control({ refused: 'menu.zip is locked with a password, so it cannot be read.' })) };

export const ReplacesTheFirst = { tags: ['vrt'], render: () => box(control({ current: item({}), confirm: { dropped: 'corner-cafe.zip', old: 'harbor-bakery' } })) };

export const HeldOnHome = { tags: ['vrt'], render: () => box(control({ current: { key: 's1', name: 'harbor-bakery', phase: 'held', percent: 0, pending } })) };
