// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which heading of a landing page is its one `h1`: read by the vocabulary's
 * readers and by the renderer, which must not load the schemas (a stranger's
 * page carries no Zod). Types only from the document.
 */
import type { LandingBlockOf, LandingPage } from './document.js';

/**
 * The page's one main heading: the first Hero's, else the first Heading's,
 * else the page's title, drawn for people who cannot see the page only
 * (`block` is then null). Every other heading on the page is a section's.
 */
export function mainHeadingOf(page: LandingPage): { block: string | null; text: string } {
  const hero = page.blocks.find((block): block is LandingBlockOf<'hero'> => block.kind === 'hero');
  if (hero !== undefined) return { block: hero.id, text: hero.heading };
  const heading = page.blocks.find((block): block is LandingBlockOf<'heading'> => block.kind === 'heading');
  if (heading !== undefined) return { block: heading.id, text: heading.text };
  return { block: null, text: page.title };
}
