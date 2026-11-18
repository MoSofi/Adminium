// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminium/add-on-contracts/landing` — the landing page vocabulary: a
 * page's document, its blocks, links and pictures, the assistant's marks, the
 * slug rule, and what the engine and the add-on read of a page.
 *
 * Both the engine and the landing pages add-on import it, so the editor, the
 * publish seal and the page a stranger sees can never disagree. Pure: no I/O,
 * no `node:` import. The renderer is its own entry,
 * `@adminium/add-on-contracts/landing/render`, so a reader of the vocabulary
 * never loads React.
 */
export {
  LANDING_BLOCKS_MAX,
  LANDING_BLOCK_KINDS,
  LANDING_COLUMNS_MAX,
  LANDING_COLUMNS_MIN,
  LANDING_DOCUMENT_CODES,
  LANDING_FEATURES_MAX,
  LANDING_FEATURE_ICONS,
  LANDING_QUESTIONS_MAX,
  LANDING_SPACER_SIZES,
  LANDING_TEXT_MAX,
  LANDING_VOCABULARY_VERSION,
  buttonBlockSchema,
  columnsBlockSchema,
  featuresBlockSchema,
  formBlockSchema,
  headingBlockSchema,
  heroBlockSchema,
  isLandingHref,
  landingBlockSchema,
  landingLinkSchema,
  landingPageSchema,
  pictureBlockSchema,
  pictureRefSchema,
  questionsBlockSchema,
  quoteBlockSchema,
  spacerBlockSchema,
  textBlockSchema,
  type LandingBlock,
  type LandingBlockKind,
  type LandingBlockOf,
  type LandingDocumentCode,
  type LandingFeatureIcon,
  type LandingLink,
  type LandingPage,
  type PictureRef,
} from './document.js';
export { formBlocksOf, hasMiloMarks, mainHeadingOf, pageLinks, pagePictures, parseLandingPage, stripMiloMarks, type LandingIssue, type ParsedLandingPage } from './parse.js';
export { LANDING_SLUG, LANDING_SLUG_MAX, LANDING_SLUGS_RESERVED, isLandingSlug } from './slug.js';
