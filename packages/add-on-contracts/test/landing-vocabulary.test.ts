// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The landing page vocabulary: every block kind is read back as written; a
 * page carries plain text and typed links only; a picture names a file the
 * page owns; the assistant's marks are seen and taken off; the slug rule; and
 * what the engine and the add-on read of a page. Each refusal is one broken
 * thing of a page that parses.
 */
import { describe, expect, it } from 'vitest';

import {
  LANDING_BLOCKS_MAX,
  LANDING_BLOCK_KINDS,
  LANDING_SLUGS_RESERVED,
  LANDING_TEXT_MAX,
  formBlocksOf,
  hasMiloMarks,
  isLandingHref,
  isLandingSlug,
  mainHeadingOf,
  pageLinks,
  pagePictures,
  parseLandingPage,
  stripMiloMarks,
  type LandingBlock,
  type LandingPage,
} from '../src/landing/index.js';

/** One of every block kind, each with its optional parts filled. */
const EVERY: LandingBlock[] = [
  { id: 'hero', kind: 'hero', heading: 'Acoustic booths for open offices', text: 'Our booths cut the noise of a busy floor by half.', button: { label: 'See them at our open day', link: { kind: 'page', key: '12' } }, picture: { file: 'file_hero01', alt: 'Two grey acoustic booths in an open office' } },
  { id: 'heading', kind: 'heading', text: 'What fits where' },
  { id: 'text', kind: 'text', text: 'Single booths for calls.\n\nDouble booths for two people.' },
  { id: 'picture', kind: 'picture', picture: { file: 'file_floor', decorative: true } },
  { id: 'button', kind: 'button', label: 'Book a showroom visit', link: { kind: 'form' } },
  { id: 'columns', kind: 'columns', columns: [{ heading: 'Single', text: 'For calls.', picture: { file: 'file_one', alt: 'A single booth' } }, { text: 'For two people.' }] },
  { id: 'features', kind: 'features', title: 'Why booths', items: [{ icon: 'volume-x', heading: 'Quiet inside', text: 'Talk at a normal voice.' }, { heading: 'Moves with you', text: 'Roll it to a new spot.' }] },
  { id: 'quote', kind: 'quote', text: 'The floor is calm again.', who: 'Marta Kovac, office manager' },
  { id: 'questions', kind: 'questions', title: 'Questions and answers', items: [{ question: 'How long does fitting take?', answer: 'One day for up to four booths.' }] },
  { id: 'spacer', kind: 'spacer', size: 'm' },
  { id: 'form', kind: 'form', form: '7', addOn: 'forms' },
];

const page = (blocks: LandingBlock[] = EVERY, more: Partial<LandingPage> = {}): LandingPage => ({ v: 1, title: 'Acoustic booths', description: 'Quiet booths for open offices, fitted in a day.', blocks, ...more });
/** The page with one block changed, as stored (anything the test likes). */
const withBlock = (index: number, edit: Record<string, unknown>): unknown => ({ ...page(), blocks: EVERY.map((block, b) => (b === index ? { ...block, ...edit } : block)) });
const codesOf = (json: unknown): string[] => {
  const parsed = parseLandingPage(json);
  return parsed.ok ? [] : parsed.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`);
};

describe('a landing page document', () => {
  it('reads every block kind back as written, from an object and from its stored text', () => {
    expect(EVERY.map((block) => block.kind)).toEqual([...LANDING_BLOCK_KINDS]);
    const parsed = parseLandingPage(page());
    expect(parsed).toEqual({ ok: true, page: page() });
    expect(parseLandingPage(JSON.stringify(page()))).toEqual({ ok: true, page: page() });
    for (const block of EVERY) expect(parseLandingPage(page([block, ...(block.kind === 'button' ? [EVERY[10]!] : [])])).ok, block.kind).toBe(true);
    // A sharing picture of its own, and an empty page (a draft just started).
    expect(parseLandingPage(page([], { picture: { file: 'file_share', alt: 'The showroom' } })).ok).toBe(true);
  });

  it('refuses text that is not JSON, an unknown version, an unknown kind and an extra field', () => {
    expect(codesOf('{"v":1,')).toEqual([':not-json']);
    expect(codesOf({ ...page(), v: 2 })).toEqual(['v:invalid_value']);
    expect(codesOf(withBlock(1, { kind: 'footer' }))).toEqual(['blocks.1.kind:invalid_union']);
    expect(codesOf(withBlock(1, { kind: 'pay-link', href: 'https://pay.example' }))).toEqual(['blocks.1.kind:invalid_union']);
    expect(codesOf(withBlock(1, { kind: 'code', text: '<script>' }))).toEqual(['blocks.1.kind:invalid_union']);
    expect(codesOf(withBlock(1, { html: '<b>x</b>' }))).toEqual(['blocks.1:unrecognized_keys']);
    expect(codesOf({ ...page(), footer: 'x' })).toEqual([':unrecognized_keys']);
    expect(codesOf(withBlock(5, { columns: [{ text: 'a', style: 'x' }, { text: 'b' }] }))).toEqual(['blocks.5.columns.0:unrecognized_keys']);
  });

  it(`holds ${String(LANDING_BLOCKS_MAX)} blocks at most`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i): LandingBlock => ({ id: `b${String(i)}`, kind: 'spacer', size: 's' }));
    expect(parseLandingPage(page(many(LANDING_BLOCKS_MAX))).ok).toBe(true);
    expect(codesOf(page(many(LANDING_BLOCKS_MAX + 1)))).toEqual(['blocks:too_big']);
  });

  it('keeps markup typed into a text as the characters it is: drawn as text, never refused', () => {
    const typed = '<img src=x onerror=alert(1)> **bold** [a](https://x.example)';
    const parsed = parseLandingPage(withBlock(2, { text: typed }));
    expect(parsed.ok && parsed.page.blocks[2]).toMatchObject({ text: typed });
  });

  it('refuses a control character, a line break in a one-line text, a blank text and one too long', () => {
    expect(codesOf(withBlock(1, { text: 'What fits\u0007 where' }))).toEqual(['blocks.1.text:control-character']);
    expect(codesOf(withBlock(1, { text: 'What fits\nwhere' }))).toEqual(['blocks.1.text:control-character']);
    expect(codesOf(withBlock(2, { text: 'Tabs\tare not text' }))).toEqual(['blocks.2.text:control-character']);
    expect(codesOf(withBlock(2, { text: 'An ending\u009b' }))).toEqual(['blocks.2.text:control-character']);
    expect(codesOf(withBlock(1, { text: '   ' }))).toEqual(['blocks.1.text:blank']);
    expect(codesOf(withBlock(1, { text: '' }))).toContain('blocks.1.text:too_small');
    expect(codesOf(withBlock(1, { text: 'x'.repeat(LANDING_TEXT_MAX.heading + 1) }))).toEqual(['blocks.1.text:too_big']);
    expect(codesOf({ ...page(), title: 'x'.repeat(LANDING_TEXT_MAX.title + 1) })).toEqual(['title:too_big']);
    expect(codesOf({ ...page(), description: 'x'.repeat(LANDING_TEXT_MAX.description + 1) })).toEqual(['description:too_big']);
    // A paragraph break is a text's own.
    expect(parseLandingPage(withBlock(2, { text: 'One.\n\nTwo.' })).ok).toBe(true);
  });

  it('links only to an https address, another page, or the form on this page', () => {
    const button = (link: unknown) => codesOf(withBlock(4, { link }));
    expect(button({ kind: 'url', href: 'https://www.meridian.example/visit?day=thu#map' })).toEqual([]);
    for (const href of [
      'http://www.meridian.example/',
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://user:secret@www.meridian.example/',
      '//www.meridian.example/',
      '/x/pages/open-day',
      'mailto:hello@meridian.example',
      `https://www.meridian.example/${'a'.repeat(LANDING_TEXT_MAX.href)}`,
    ]) {
      expect(button({ kind: 'url', href }).join(), href).toMatch(/blocks\.4\.link\.href:(link-https|too_big)/);
      expect(isLandingHref(href), href).toBe(false);
    }
    expect(button({ kind: 'page', key: '../admin' })).toEqual(['blocks.4.link.key:invalid_format']);
    expect(button({ kind: 'page', key: '12', href: 'https://x.example' })).toEqual(['blocks.4.link:unrecognized_keys']);
    expect(button({ kind: 'mail', to: 'hello@meridian.example' })).toEqual(['blocks.4.link.kind:invalid_union']);
    // The form on this page needs a Form block on it.
    expect(codesOf(page([EVERY[4]!]))).toEqual(['blocks.0.link:link-form-missing']);
    expect(codesOf(page([{ ...(EVERY[0] as LandingBlock & { kind: 'hero' }), button: { label: 'Book', link: { kind: 'form' } } }]))).toEqual(['blocks.0.button.link:link-form-missing']);
  });

  it('names a picture by its own file, described or marked as decoration, never by an address', () => {
    expect(codesOf(withBlock(3, { picture: { file: 'data:image/png;base64,iVBORw0KGgo=', alt: 'A dot' } })).join()).toContain('blocks.3.picture');
    expect(codesOf(withBlock(3, { picture: { file: 'https://cdn.example/booth.jpg', alt: 'A booth' } })).join()).toContain('blocks.3.picture');
    expect(codesOf(withBlock(3, { picture: { file: '../../etc/passwd', alt: 'x' } })).join()).toContain('blocks.3.picture');
    // Neither a description nor "decoration": refused.
    expect(codesOf(withBlock(3, { picture: { file: 'file_floor' } }))).toEqual(['blocks.3.picture:invalid_union']);
    expect(codesOf(withBlock(3, { picture: { file: 'file_floor', decorative: false } }))).toEqual(['blocks.3.picture:invalid_union']);
    expect(codesOf(withBlock(3, { picture: { file: 'file_floor', alt: 'x', src: 'https://x.example/a.png' } }))).toEqual(['blocks.3.picture:unrecognized_keys']);
  });

  it('refuses two blocks with one id, an icon off the list, too few columns, an unknown spacer', () => {
    expect(codesOf(withBlock(1, { id: 'hero' }))).toEqual(['blocks.1.id:block-id-twice']);
    expect(codesOf(withBlock(6, { items: [{ icon: 'skull', heading: 'x', text: 'y' }] }))).toEqual(['blocks.6.items.0.icon:invalid_value']);
    expect(codesOf(withBlock(5, { columns: [{ text: 'one' }] }))).toEqual(['blocks.5.columns:too_small']);
    expect(codesOf(withBlock(9, { size: 'xl' }))).toEqual(['blocks.9.size:invalid_value']);
    expect(codesOf(withBlock(10, { addOn: 'Forms' }))).toEqual(['blocks.10.addOn:invalid_format']);
  });
});

describe('the assistant\'s marks', () => {
  const marked = page(EVERY.map((block, b) => (b % 2 === 0 ? { ...block, milo: true as const } : block)));

  it('are seen on any block, and taken off whole', () => {
    expect(parseLandingPage(marked).ok).toBe(true);
    expect(hasMiloMarks(marked)).toBe(true);
    expect(hasMiloMarks(page())).toBe(false);
    const stripped = stripMiloMarks(marked);
    expect(hasMiloMarks(stripped)).toBe(false);
    expect(stripped).toEqual(page());
    expect(parseLandingPage(withBlock(1, { milo: false })).ok).toBe(false);
  });
});

describe('what is read of a page', () => {
  it('its pictures, its links and its forms, in page order', () => {
    expect(pagePictures(page(EVERY, { picture: { file: 'file_share', alt: 'x' } }))).toEqual(['file_share', 'file_hero01', 'file_floor', 'file_one']);
    expect(pagePictures(page([EVERY[3]!, EVERY[3]!]))).toEqual(['file_floor']);
    expect(pageLinks(page())).toEqual([
      { block: 'hero', link: { kind: 'page', key: '12' } },
      { block: 'button', link: { kind: 'form' } },
    ]);
    expect(formBlocksOf(page()).map((block) => block.form)).toEqual(['7']);
  });

  it('its one main heading: the first Hero, else the first Heading, else its title', () => {
    expect(mainHeadingOf(page())).toEqual({ block: 'hero', text: 'Acoustic booths for open offices' });
    // A Hero after a Heading still holds it.
    expect(mainHeadingOf(page([EVERY[1]!, EVERY[0]!]))).toEqual({ block: 'hero', text: 'Acoustic booths for open offices' });
    expect(mainHeadingOf(page([EVERY[2]!, EVERY[1]!]))).toEqual({ block: 'heading', text: 'What fits where' });
    expect(mainHeadingOf(page([EVERY[2]!]))).toEqual({ block: null, text: 'Acoustic booths' });
  });
});

describe('a landing page\'s slug', () => {
  it('is a form slug\'s shape and no reserved word', () => {
    for (const slug of ['open-day', 'a', '2026-spring', 'x'.repeat(80)]) expect(isLandingSlug(slug), slug).toBe(true);
    for (const slug of ['', 'Open-Day', '-open', 'open-', 'open_day', 'open day', 'x'.repeat(81), 'é', null, 7]) expect(isLandingSlug(slug), String(slug)).toBe(false);
    expect(LANDING_SLUGS_RESERVED).toEqual(['api', 'assets', 'login', 'signin', 'sign-in', 'account', 'password', 'reset']);
    for (const slug of LANDING_SLUGS_RESERVED) expect(isLandingSlug(slug), slug).toBe(false);
  });
});
