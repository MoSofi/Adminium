// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LANDING PAGE'S DOCUMENT: what a page is made of, as staff write it, as
 * the assistant drafts it, and as the engine draws it for a stranger.
 *
 * `{ v: 1, title, description, picture?, blocks }`. Every text is plain text:
 * no HTML, no markdown, no link inside a text. A text is drawn as React text,
 * so markup typed into one is harmless characters and is kept as typed; what
 * is refused is a control character, and any value that would become an
 * attribute (a link's address, a picture's file) outside its typed shape.
 *
 *  - LINKS are typed, never free text: an absolute `https:` address (parsed,
 *    with no user or password), another page of this add-on by its key, or
 *    the form block on this page. `http:`, `javascript:` and `data:` are
 *    refused, whatever their case or spacing.
 *  - PICTURES name a file the page owns, by its id (never an address, never a
 *    `data:` URL), with a description read aloud or the word that it is only
 *    decoration.
 *  - THE ASSISTANT'S MARKS: a block it drafted carries `milo: true` until a
 *    person has looked at it. A published copy never carries one.
 *
 * There is no footer block (the page's footer is the shell's), no pay link
 * and never a block of code.
 *
 * Pure: no I/O.
 */
import { z } from 'zod';

/** The version of this vocabulary a page document is written in. */
export const LANDING_VOCABULARY_VERSION = 1;

/** The most blocks one page holds. */
export const LANDING_BLOCKS_MAX = 60;

/** The longest each text may be, in characters. The editor shows these. */
export const LANDING_TEXT_MAX = {
  /** The page's title: the browser tab, a shared link's title, the hidden main heading. */
  title: 70,
  /** The page's description: a shared link's line, the search result's. */
  description: 200,
  /** A Hero's heading, a Heading, a column's or a block's title, a feature's or a person's name. */
  heading: 120,
  /** A Hero's text, a feature's text, a quote. */
  short: 600,
  /** A column's text, an answer. */
  medium: 2000,
  /** A Text block: paragraphs, by a blank line. */
  long: 5000,
  /** A question. */
  question: 200,
  /** A button's words. */
  label: 60,
  /** A picture's description, read aloud. */
  alt: 300,
  /** An address a link goes to. */
  href: 2048,
} as const;

/** How many columns a Columns block has. */
export const LANDING_COLUMNS_MIN = 2;
export const LANDING_COLUMNS_MAX = 3;
/** How many items a Features block, and a Questions and answers block, holds. */
export const LANDING_FEATURES_MAX = 12;
export const LANDING_QUESTIONS_MAX = 20;

/** The block kinds, in the order the editor's picker lists them (Form last, under "Action"). */
export const LANDING_BLOCK_KINDS = ['hero', 'heading', 'text', 'picture', 'button', 'columns', 'features', 'quote', 'questions', 'spacer', 'form'] as const;
export type LandingBlockKind = (typeof LANDING_BLOCK_KINDS)[number];

/** The sizes of a Spacer: small, medium, large. */
export const LANDING_SPACER_SIZES = ['s', 'm', 'l'] as const;

/**
 * The icons a feature may carry, by name: a closed list, drawn by the host
 * (the stranger's page and the editor each draw it with their own icon set).
 */
export const LANDING_FEATURE_ICONS = [
  'check',
  'star',
  'heart',
  'shield-check',
  'clock',
  'calendar',
  'map-pin',
  'phone',
  'mail',
  'truck',
  'leaf',
  'sparkles',
  'zap',
  'wind',
  'volume-x',
  'move',
  'users',
  'wrench',
  'thumbs-up',
  'lock',
] as const;
export type LandingFeatureIcon = (typeof LANDING_FEATURE_ICONS)[number];

/** Codes a page is refused with, beside Zod's own. */
export const LANDING_DOCUMENT_CODES = [
  /** A text holds a control character (a line break is let into a text of several lines only). */
  'control-character',
  /** A text is only spaces. */
  'blank',
  /** A link's address is not an absolute `https:` address, or carries a user or a password. */
  'link-https',
  /** A picture names something that is not a file id (an address, a `data:` URL). */
  'picture-file',
  /** Two blocks share an id. */
  'block-id-twice',
  /** A link goes to "the form on this page", and the page has no Form block. */
  'link-form-missing',
] as const;
export type LandingDocumentCode = (typeof LANDING_DOCUMENT_CODES)[number];

// C0 and C1 controls and DEL; a line break is let into a text of several lines by its own rule.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
// eslint-disable-next-line no-control-regex
const LINE_BREAK = /[\n\r\t]/;

/** A plain text: at most `max` characters, a visible one among them, no control character; line breaks only when `lines`. */
function plain(max: number, lines = false) {
  return z
    .string()
    .min(1)
    .max(max)
    .superRefine((text, ctx) => {
      if (CONTROL.test(text) || (!lines && LINE_BREAK.test(text)) || (lines && /\t/.test(text))) ctx.addIssue({ code: 'custom', message: 'control-character', params: { code: 'control-character' } });
      else if (!/\S/.test(text)) ctx.addIssue({ code: 'custom', message: 'blank', params: { code: 'blank' } });
    });
}

/**
 * Whether an address is one a page may link to: absolute, `https:`, with a
 * host and no user or password. The URL parser reads it as a browser would,
 * so `JAVASCRIPT:`, a leading space or a tab inside the scheme are read for
 * what they are and refused.
 */
export function isLandingHref(text: string): boolean {
  if (text.length > LANDING_TEXT_MAX.href || text !== text.trim() || CONTROL.test(text) || LINE_BREAK.test(text)) return false;
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
}

/** A row's key, as a link or a form block names it: letters, digits, `_` and `-`. */
const rowKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'a row key');

/** Where a link goes: an `https:` address, another page of this add-on, or the form on this page. */
export const landingLinkSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('url'),
      href: z
        .string()
        .max(LANDING_TEXT_MAX.href)
        .refine(isLandingHref, { message: 'link-https', params: { code: 'link-https' } }),
    })
    .strict(),
  z.object({ kind: z.literal('page'), key: rowKeySchema }).strict(),
  z.object({ kind: z.literal('form') }).strict(),
]);
export type LandingLink = z.infer<typeof landingLinkSchema>;

/** A file id: the page's own copy of a picture. Never an address: no `:`, no `/`. */
const fileIdSchema = z.string().refine((file) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(file), { message: 'picture-file', params: { code: 'picture-file' } });

/** A picture the page owns: described for people who cannot see it, or marked as only decoration. */
export const pictureRefSchema = z.union([
  z.object({ file: fileIdSchema, alt: plain(LANDING_TEXT_MAX.alt) }).strict(),
  z.object({ file: fileIdSchema, decorative: z.literal(true) }).strict(),
]);
export type PictureRef = z.infer<typeof pictureRefSchema>;

/** A block's own id: unique on its page, what the editor selects and moves it by. */
const blockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'a block id');

/** What every block carries: its id, and the assistant's mark while nobody has looked at it. */
const base = { id: blockIdSchema, milo: z.literal(true).optional() };

const button = z.object({ label: plain(LANDING_TEXT_MAX.label), link: landingLinkSchema }).strict();

export const heroBlockSchema = z
  .object({ ...base, kind: z.literal('hero'), heading: plain(LANDING_TEXT_MAX.heading), text: plain(LANDING_TEXT_MAX.short, true), button: button.optional(), picture: pictureRefSchema.optional() })
  .strict();
/** A heading; its level is the page's to decide (the main heading, or a section's). */
export const headingBlockSchema = z.object({ ...base, kind: z.literal('heading'), text: plain(LANDING_TEXT_MAX.heading) }).strict();
/** A text: paragraphs, by a blank line. */
export const textBlockSchema = z.object({ ...base, kind: z.literal('text'), text: plain(LANDING_TEXT_MAX.long, true) }).strict();
export const pictureBlockSchema = z.object({ ...base, kind: z.literal('picture'), picture: pictureRefSchema }).strict();
export const buttonBlockSchema = z.object({ ...base, kind: z.literal('button'), label: plain(LANDING_TEXT_MAX.label), link: landingLinkSchema }).strict();
/** One of the forms add-on's forms, by its row key, filled in on the page. */
export const formBlockSchema = z
  .object({ ...base, kind: z.literal('form'), form: rowKeySchema, addOn: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key') })
  .strict();
const column = z.object({ heading: plain(LANDING_TEXT_MAX.heading).optional(), text: plain(LANDING_TEXT_MAX.medium, true), picture: pictureRefSchema.optional() }).strict();
export const columnsBlockSchema = z.object({ ...base, kind: z.literal('columns'), columns: z.array(column).min(LANDING_COLUMNS_MIN).max(LANDING_COLUMNS_MAX) }).strict();
const feature = z.object({ icon: z.enum(LANDING_FEATURE_ICONS).optional(), heading: plain(LANDING_TEXT_MAX.heading), text: plain(LANDING_TEXT_MAX.short, true) }).strict();
export const featuresBlockSchema = z
  .object({ ...base, kind: z.literal('features'), title: plain(LANDING_TEXT_MAX.heading).optional(), items: z.array(feature).min(1).max(LANDING_FEATURES_MAX) })
  .strict();
export const quoteBlockSchema = z.object({ ...base, kind: z.literal('quote'), text: plain(LANDING_TEXT_MAX.short, true), who: plain(LANDING_TEXT_MAX.heading) }).strict();
const question = z.object({ question: plain(LANDING_TEXT_MAX.question), answer: plain(LANDING_TEXT_MAX.medium, true) }).strict();
/** Questions that open one by one. Its title is its own field ("Questions and answers" in the page's language, by default). */
export const questionsBlockSchema = z
  .object({ ...base, kind: z.literal('questions'), title: plain(LANDING_TEXT_MAX.heading), items: z.array(question).min(1).max(LANDING_QUESTIONS_MAX) })
  .strict();
export const spacerBlockSchema = z.object({ ...base, kind: z.literal('spacer'), size: z.enum(LANDING_SPACER_SIZES) }).strict();

/** One block of a page. */
export const landingBlockSchema = z.discriminatedUnion('kind', [
  heroBlockSchema,
  headingBlockSchema,
  textBlockSchema,
  pictureBlockSchema,
  buttonBlockSchema,
  columnsBlockSchema,
  featuresBlockSchema,
  quoteBlockSchema,
  questionsBlockSchema,
  spacerBlockSchema,
  formBlockSchema,
]);
export type LandingBlock = z.infer<typeof landingBlockSchema>;
/** A block of one kind. */
export type LandingBlockOf<K extends LandingBlockKind> = Extract<LandingBlock, { kind: K }>;

const pageShape = z
  .object({
    v: z.literal(LANDING_VOCABULARY_VERSION),
    title: plain(LANDING_TEXT_MAX.title),
    description: plain(LANDING_TEXT_MAX.description),
    /** The picture a shared link shows. */
    picture: pictureRefSchema.optional(),
    blocks: z.array(landingBlockSchema).max(LANDING_BLOCKS_MAX),
  })
  .strict();

/**
 * A page document. Each block's id is its own on the page, and a link to "the
 * form on this page" needs a Form block on it.
 */
export const landingPageSchema = pageShape.superRefine((page, ctx) => {
  const report = (code: LandingDocumentCode, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message: code, path, params: { code } });
  const ids = new Set<string>();
  page.blocks.forEach((block, b) => {
    if (ids.has(block.id)) report('block-id-twice', ['blocks', b, 'id']);
    ids.add(block.id);
  });
  if (!page.blocks.some((block) => block.kind === 'form')) {
    page.blocks.forEach((block, b) => {
      if (block.kind === 'button' && block.link.kind === 'form') report('link-form-missing', ['blocks', b, 'link']);
      if (block.kind === 'hero' && block.button?.link.kind === 'form') report('link-form-missing', ['blocks', b, 'button', 'link']);
    });
  }
});
export type LandingPage = z.infer<typeof landingPageSchema>;
