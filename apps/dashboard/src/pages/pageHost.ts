// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What `PageRenderer` lends to code that mounts a page template itself: the
 * data adapters and the template registry. The project UI kit's
 * `GeneratedPage` (49-developer-projects.md §6.2) reads them here, as context,
 * because importing the renderer would close a loop: the renderer loads the
 * templates, a template loads the project's pages, and loading those
 * publishes the kit.
 */
import { createContext } from 'react';
import type { PageEnvelope } from '@adminium/engine/config';

import type { PageTemplateAdapters, PageTemplateComponent } from './template-types.js';

export interface PageHost {
  usePageAdapters(page: PageEnvelope, slug: string): PageTemplateAdapters;
  resolvePageTemplate(id: string): Promise<PageTemplateComponent | null>;
  /** The template a page's record route draws, when its config names one. */
  detailTemplateOf(page: PageEnvelope): string | null;
}

/** Provided by `TemplateMount` around every page template. */
export const PageHostContext = createContext<PageHost | null>(null);
