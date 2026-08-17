// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Starlight content-collection schema (14-docs-site.md §10.1).
 *
 * `title` and `description` are both REQUIRED: the style guide's "one H1 per
 * page" rule is enforced by making the frontmatter title the only H1, and the
 * description is what Pagefind and the meta tags index. A page missing either
 * fails the build rather than shipping untitled.
 */
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection, z } from 'astro:content';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        description: z.string({
          message: 'Every docs page needs a `description` (14-docs-site.md §10.1).',
        }),
      }),
    }),
  }),
};
