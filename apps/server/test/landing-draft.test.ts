// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Milo's draft of a landing page, held by the server whatever the model
 * wrote; a funnel's rule as its readers see it; a form's `landing` ending as
 * a stranger is served it. Pure parts, no database.
 *
 *  - the schema Milo is shown comes from the vocabulary, with quotes,
 *    pictures, links to other websites and the mark taken out;
 *  - quotes, pictures and links to other websites are left out of what it
 *    answers (a button keeps its words in the notes); a Form block only for a
 *    live form; a link to a page only when the add-on holds it; a state or a
 *    published copy is never read; every block is marked;
 *  - a rule's chips carry the kind and title of each step and nothing of its
 *    settings;
 *  - a live page's address is written on the host the form is served on, and
 *    a page that is not live is the default thanks.
 */
import { LANDING_BLOCK_KINDS, parseLandingPage } from '@adminium/add-on-contracts/landing';
import { describe, expect, it } from 'vitest';

import { heldDraft, landingDraftMessage, landingDraftSchema, landingDraftSystem, strippedAnswer, type DraftForm, type LeftOut } from '../src/landing/draft.js';
import { DEFAULT_THANKS, landingPageAddress, servedEnding } from '../src/landing/ending.js';
import { ruleChips } from '../src/landing/rule.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a JSON schema read freely

const FORMS: DraftForm[] = [{ addOn: 'forms', key: 'frm_showroom', name: 'Book a showroom visit', languages: ['en-US', 'de-DE'] }];

/** What a model might answer: every part the server must hold. */
const ANSWER = {
  v: 1,
  title: 'Open day',
  description: 'Sit in the new booths and try the desks.',
  state: 'live',
  published: { v: 1, title: 'x', description: 'y', blocks: [] },
  picture: { file: 'f1', alt: 'The showroom' },
  blocks: [
    { id: 'hero', kind: 'hero', heading: 'Open day', text: 'Thursday.', button: { label: 'See our shop', link: { kind: 'url', href: 'https://evil.example/' } }, picture: { file: 'f2', decorative: true } },
    { id: 'said', kind: 'quote', text: 'Best booths ever.', who: 'A customer' },
    { id: 'pic', kind: 'picture', picture: { file: 'f3', alt: 'A booth' } },
    { id: 'cols', kind: 'columns', columns: [{ text: 'One', picture: { file: 'f4', alt: 'x' } }, { text: 'Two' }] },
    { id: 'away', kind: 'button', label: 'Visit our blog', link: { kind: 'url', href: 'http://blog.example/' } },
    { id: 'book', kind: 'button', label: 'Book a visit', link: { kind: 'form' } },
    { id: 'more', kind: 'button', label: 'Our other page', link: { kind: 'page', key: '7' } },
    { id: 'gone', kind: 'button', label: 'A page nobody has', link: { kind: 'page', key: '99' } },
    { id: 'self', kind: 'button', label: 'This page', link: { kind: 'page', key: '3' } },
    { id: 'form', kind: 'form', form: 'frm_showroom', addOn: 'forms', milo: true },
    { id: 'made-up', kind: 'form', form: 'frm_secret', addOn: 'forms' },
  ],
};

function held(answer: unknown = ANSWER, forms: readonly DraftForm[] = FORMS) {
  const left: LeftOut[] = [];
  const parsed = parseLandingPage(strippedAnswer(answer, left));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const page = heldDraft(parsed.page, { forms, pages: new Set(['7', '3']), self: '3' }, left);
  return { page, left };
}

describe('the schema Milo is shown', () => {
  const schema = JSON.parse(landingDraftSchema()) as Doc;
  const text = landingDraftSchema();

  it('is the vocabulary\'s own: every block kind and limit, generated, never copied', () => {
    const kinds = new Set<string>((schema.properties.blocks.items.oneOf as Doc[]).map((member) => member.properties.kind.const as string));
    expect([...kinds].sort()).toEqual(LANDING_BLOCK_KINDS.filter((kind) => kind !== 'quote' && kind !== 'picture').sort());
    expect(schema.properties.title.maxLength).toBe(70);
    expect(schema.properties.description.maxLength).toBe(200);
    expect(schema.properties.blocks.maxItems).toBe(60);
  });

  it('leaves out quotes, pictures, links to other websites and the mark', () => {
    expect(text).not.toContain('"quote"');
    expect(text).not.toContain('"url"');
    expect(text).not.toContain('"milo"');
    expect(text).not.toContain('"picture"');
    expect(text).not.toContain('$schema');
    // The links it may write: another page, the form on this page.
    expect(text).toContain('"page"');
    expect(text).toContain('"form"');
  });

  it('is in the system text, which says everything sent is data', () => {
    const system = landingDraftSystem('Meridian Workplace', 'de-DE');
    expect(system).toContain(text);
    expect(system).toContain('DATA');
    expect(system).toContain('"de-DE"');
  });

  it('is told the description, the business and the forms by name and key, and nothing else', () => {
    const message = landingDraftMessage('An open day page', { name: 'Meridian', email: 'hello@meridian.example' }, [{ ...FORMS[0]!, extra: 'never' } as DraftForm]);
    expect(message).toContain('"An open day page"');
    expect(message).toContain('{"name":"Meridian","email":"hello@meridian.example"}');
    expect(message).toContain('{"addOn":"forms","key":"frm_showroom","name":"Book a showroom visit","languages":["en-US","de-DE"]}');
    expect(message).not.toContain('never');
  });
});

describe('a draft, held by the server', () => {
  it('leaves out every quote and picture', () => {
    const { page, left } = held();
    expect(page.blocks.some((block) => block.kind === 'quote' || block.kind === 'picture')).toBe(false);
    expect(JSON.stringify(page)).not.toContain('"picture"');
    expect(page.picture).toBeUndefined();
    expect(left).toEqual(expect.arrayContaining([{ what: 'quote', block: 'said' }, { what: 'picture', block: 'pic' }, { what: 'picture', block: 'hero' }, { what: 'picture', block: 'cols' }]));
  });

  it('leaves out every link to another website, and names the button with its words', () => {
    const { page, left } = held();
    expect(JSON.stringify(page)).not.toContain('"url"');
    const hero = page.blocks.find((block) => block.id === 'hero')!;
    expect(hero).toMatchObject({ kind: 'hero', heading: 'Open day', text: 'Thursday.' });
    expect(hero).not.toHaveProperty('button');
    expect(page.blocks.find((block) => block.id === 'away')).toBeUndefined();
    expect(left).toEqual(expect.arrayContaining([{ what: 'link', block: 'hero', label: 'See our shop' }, { what: 'link', block: 'away', label: 'Visit our blog' }]));
  });

  it('keeps a link to a page the add-on holds and to the form on this page, never to itself or a page nobody has', () => {
    const { page, left } = held();
    expect(page.blocks.map((block) => block.id)).toEqual(['hero', 'cols', 'book', 'more', 'form']);
    expect(left).toEqual(expect.arrayContaining([{ what: 'page-link', block: 'gone', label: 'A page nobody has' }, { what: 'page-link', block: 'self', label: 'This page' }]));
  });

  it('keeps a Form block only for a live form it was told of; with none left, a link to the form goes too', () => {
    const { left } = held();
    expect(left).toContainEqual({ what: 'form', block: 'made-up' });
    const none = held(ANSWER, []);
    expect(none.page.blocks.some((block) => block.kind === 'form')).toBe(false);
    expect(none.page.blocks.find((block) => block.id === 'book')).toBeUndefined();
    expect(none.left).toEqual(expect.arrayContaining([{ what: 'form', block: 'form' }, { what: 'link', block: 'book', label: 'Book a visit' }]));
  });

  it('marks every block, and never answers a state or a published copy', () => {
    const { page } = held();
    expect(page.blocks.length).toBeGreaterThan(0);
    expect(page.blocks.every((block) => block.milo === true)).toBe(true);
    expect(Object.keys(page).sort()).toEqual(['blocks', 'description', 'title', 'v']);
    expect(parseLandingPage(page).ok).toBe(true);
  });
});

describe('a funnel\'s rule, as chips', () => {
  it('says each step by its kind and title, and nothing of its settings', () => {
    const chips = ruleChips({
      trigger: { kind: 'record', event: 'created', connectionId: 'c1', table: 'public.answers', watch: true },
      graph: {
        version: 1,
        nodes: [
          { id: 't', kind: 'trigger', title: 'Form sent', sub: 'answers' },
          { id: 'a', kind: 'action', title: 'E-mail the brochure', sub: 'to secret@meridian.example', onError: false, action: { kind: 'email', templateKey: 'brochure-pack', to: { kind: 'fixed', addresses: ['secret@meridian.example'] }, vars: {} } },
          { id: 'w', kind: 'wait', title: 'Wait 2 days', sub: null, amount: 2, unit: 'days' },
          { id: 's', kind: 'stop', title: 'Stop', sub: null },
        ],
      },
    } as never);
    expect(chips).toEqual([
      { kind: 'trigger', title: 'Form sent', on: 'record', event: 'created' },
      { kind: 'action', title: 'E-mail the brochure', action: 'email' },
      { kind: 'wait', title: 'Wait 2 days', amount: 2, unit: 'days' },
      { kind: 'stop', title: 'Stop' },
    ]);
    expect(JSON.stringify(chips)).not.toContain('secret@meridian.example');
    expect(JSON.stringify(chips)).not.toContain('brochure-pack');
  });
});

describe('a form\'s landing ending, as a stranger is served it', () => {
  const ending = { kind: 'landing', page: '7', addOn: 'landing-pages' } as const;

  it('is a live page\'s address on the host the form is served on', () => {
    expect(servedEnding(ending, { state: 'live', slug: 'open-day' }, 'https://pages.meridian.example')).toEqual({ kind: 'page', url: 'https://pages.meridian.example/x/pages/open-day' });
    expect(servedEnding(ending, { state: 'live', slug: 'open-day' }, 'http://localhost:4900')).toEqual({ kind: 'page', url: 'http://localhost:4900/x/pages/open-day' });
    expect(landingPageAddress('https://a.example', 'spring')).toBe('https://a.example/x/pages/spring');
  });

  it('is the default thanks for a page that is not live, or a host no address can be written for', () => {
    expect(servedEnding(ending, { state: 'broken' }, 'https://pages.meridian.example')).toEqual(DEFAULT_THANKS);
    expect(servedEnding(ending, null, 'https://pages.meridian.example')).toEqual(DEFAULT_THANKS);
    expect(servedEnding(ending, { state: 'live', slug: 'open-day' }, null)).toEqual(DEFAULT_THANKS);
    expect(DEFAULT_THANKS).toEqual({ kind: 'words', words: {} });
  });

  it('leaves every other ending as it is', () => {
    const words = { kind: 'words', words: { 'en-US': 'Thanks' } } as const;
    const page = { kind: 'page', url: 'https://www.meridian.example/thanks' } as const;
    expect(servedEnding(words, null, null)).toBe(words);
    expect(servedEnding(page, null, null)).toBe(page);
  });
});
