// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an installed app's own page says above its template: today, that the
 * app's sample data is loaded — to whoever manages apps, with a way to
 * remove it.
 *
 * Wrapped around the built-in templates in `templateLoaders.ts`, so it rides
 * the template chunks and never the entry: most pages belong to no app, and
 * most people cannot manage one. The banner itself is one more chunk away.
 */
import { Suspense, lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';

import { bootstrapQuery, findPageBySlug, holdsSystemAction } from '../app/bootstrap.js';
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
  const item = bootstrap === undefined ? null : findPageBySlug(bootstrap, slug);
  if (bootstrap === undefined || item?.appKey == null || !holdsSystemAction(bootstrap, 'manifests.manage')) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <SampleDataBanner appKey={item.appKey} />
    </Suspense>
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
        <Template {...props} />
      </>
    );
  }
  WithAppPageNotice.displayName = `AppPageNotice(${Template.displayName ?? Template.name})`;
  wrapped.set(Template, WithAppPageNotice);
  return WithAppPageNotice;
}
