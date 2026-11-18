// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an installed app's own page — or an add-on's generated page — says
 * above its template: that its sample data is loaded — to whoever manages apps, with a way to
 * remove it. And in trial mode, on any page of a database over its size cap, that it is
 * (`sizeCapNotice.tsx`).
 *
 * Wrapped around the built-in templates in `templateLoaders.ts`, so it rides
 * the template chunks and never the entry: most pages belong to no app, and
 * most people cannot manage one. The banner itself is one more chunk away.
 */
import { Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';

import { bootstrapQuery, findPageBySlug } from '../app/bootstrap.js';
import { useInstallId } from '../studio/apps/installScope.js';
import { SAMPLE_BANNER_FRAME } from '../studio/apps/sampleBannerFrame.js';
import { sampleBannerOwner, sampleDataQuery, type SampleOwnerKind } from '../studio/apps/sampleDataStatus.js';
import { SizeCapPageNotice } from './sizeCapNotice.js';
import type { PageTemplateComponent, PageTemplateProps } from './template-types.js';

// Through the app's settings page, already its own chunk: a chunk of the
// banner's own would cost the entry a line in its preload table.
const SampleDataBanner = lazy(() =>
  import('../studio/apps/AppSettingsPage.js').then((module) => ({ default: module.SampleDataBanner })),
);

function AppPageNotice() {
  const params = useParams({ strict: false });
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const owner = bootstrap === undefined ? null : sampleBannerOwner(bootstrap, findPageBySlug(bootstrap, slug));
  return owner === null ? null : <SampleNotice appKey={owner.key} kind={owner.kind} />;
}

/**
 * The banner, when the sample data is loaded. The page route's loader has
 * asked already (`app/router.tsx`), so the answer is here on the first render,
 * before the template under it draws. The banner's code and the Studio's words
 * may still be on their way: until they are, a slot of the banner's own box
 * keeps its place, so the cards under it never move.
 */
function SampleNotice({ appKey, kind }: { appKey: string; kind: SampleOwnerKind }) {
  const install = useInstallId();
  const status = useQuery(sampleDataQuery(appKey, kind, install));
  if (status.data?.loaded !== true) return null;
  return (
    <Suspense fallback={<SampleBannerSlot />}>
      <SampleDataBanner appKey={appKey} kind={kind} />
    </Suspense>
  );
}

/** The banner's box, empty: one line of the banner's text high. */
function SampleBannerSlot() {
  return (
    <div aria-hidden data-testid="app-sample-banner-slot" className={SAMPLE_BANNER_FRAME}>
      <span className="text-[12.5px]">{'\u00a0'}</span>
    </div>
  );
}

const wrapped = new WeakMap<PageTemplateComponent, PageTemplateComponent>();

/**
 * The template, with the app's notice above it. One wrapper per template, as
 * `withProjectScope` does it: a new component each time would remount the page.
 */
export function withAppPageNotice(Template: PageTemplateComponent): PageTemplateComponent {
  const existing = wrapped.get(Template);
  if (existing !== undefined) return existing;
  function WithAppPageNotice(props: PageTemplateProps) {
    return (
      <>
        <AppPageNotice />
        <Suspense fallback={null}>
          <SizeCapPageNotice page={props.page} />
        </Suspense>
        <Template {...props} />
      </>
    );
  }
  WithAppPageNotice.displayName = `AppPageNotice(${Template.displayName ?? Template.name})`;
  wrapped.set(Template, WithAppPageNotice);
  return WithAppPageNotice;
}
