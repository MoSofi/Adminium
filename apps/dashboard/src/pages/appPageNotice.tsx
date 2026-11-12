// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a page says above its template: that an app's sample data is loaded,
 * that a trial's database is over its size limit (`pageNotices.tsx`).
 *
 * Wrapped around the built-in templates in `templateLoaders.ts`. Which notice
 * a page shows, and the notices themselves, are one chunk away: most pages
 * show none, so the entry carries only this wrapper.
 */
import { Suspense, lazy } from 'react';

import type { PageTemplateComponent, PageTemplateProps } from './template-types.js';

const PageNotices = lazy(() => import('./pageNotices.js'));

const wrapped = new WeakMap<PageTemplateComponent, PageTemplateComponent>();

/**
 * The template, with the page's notices above it. One wrapper per template, as
 * `withProjectScope` does it: a new component each time would remount the page.
 */
export function withAppPageNotice(Template: PageTemplateComponent): PageTemplateComponent {
  const existing = wrapped.get(Template);
  if (existing !== undefined) return existing;
  function WithAppPageNotice(props: PageTemplateProps) {
    return (
      <>
        <Suspense fallback={null}>
          <PageNotices page={props.page} />
        </Suspense>
        <Template {...props} />
      </>
    );
  }
  WithAppPageNotice.displayName = `AppPageNotice(${Template.displayName ?? Template.name})`;
  wrapped.set(Template, WithAppPageNotice);
  return WithAppPageNotice;
}
