// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The landing page renderer, drawn in a browser's document: one main heading
 * whatever the page holds, right to left from the same rules, the canvas's
 * "Edit …" buttons, every block kind, the host's slots, and text drawn as
 * text. The module itself is read too: it imports only React, sets no markup
 * from a string, and its stylesheet uses logical properties only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { LandingBlock, LandingPage } from '../src/landing/index.js';
import { LandingPageView, landingFormAnchor, type LandingPageViewProps } from '../src/landing/render.js';

afterEach(cleanup);

/** A file of this package, read as text (the browser's own URL is in place here, so the path is built from Node's). */
const read = (path: string): string => readFileSync(join(fileURLToPath(import.meta.url), '..', '..', path), 'utf8');

const hero = (id: string, heading: string): LandingBlock => ({ id, kind: 'hero', heading, text: 'Our booths cut the noise of a busy floor by half.' });
const EVERY: LandingBlock[] = [
  { ...hero('hero', 'Acoustic booths for open offices'), button: { label: 'See them at our open day', link: { kind: 'page', key: '12' } }, picture: { file: 'file_hero', alt: 'Two grey acoustic booths in an open office' } } as LandingBlock,
  { id: 'heading', kind: 'heading', text: 'What fits where' },
  { id: 'text', kind: 'text', text: 'Single booths for calls.\n\nDouble booths for two people.' },
  { id: 'picture', kind: 'picture', picture: { file: 'file_floor', decorative: true } },
  { id: 'button', kind: 'button', label: 'Book a showroom visit', link: { kind: 'form' } },
  { id: 'columns', kind: 'columns', columns: [{ heading: 'Single', text: 'For calls.' }, { heading: 'Double', text: 'For two.', picture: { file: 'file_two', alt: 'A double booth' } }] },
  { id: 'features', kind: 'features', items: [{ icon: 'volume-x', heading: 'Quiet inside', text: 'Talk at a normal voice.' }, { heading: 'Moves with you', text: 'Roll it to a new spot.' }] },
  { id: 'quote', kind: 'quote', text: 'The floor is calm again.', who: 'Marta Kovac' },
  { id: 'questions', kind: 'questions', title: 'Questions and answers', items: [{ question: 'How long does fitting take?', answer: 'One day for up to four booths.' }] },
  { id: 'spacer', kind: 'spacer', size: 'l' },
  { id: 'form', kind: 'form', form: '7', addOn: 'forms' },
  { id: 'outside', kind: 'button', label: 'Our website', link: { kind: 'url', href: 'https://www.meridian.example/' } },
];
const page = (blocks: LandingBlock[], title = 'Acoustic booths'): LandingPage => ({ v: 1, title, description: 'Quiet booths for open offices.', blocks });
const draw = (blocks: LandingBlock[], more: Partial<LandingPageViewProps> = {}) => render(<LandingPageView page={page(blocks)} language="en-US" dir="ltr" mode="stranger" {...more} />);

describe('the main heading', () => {
  it('is one h1 for two Heroes: the first; the second is a section\'s', () => {
    const { container } = draw([hero('a', 'First'), hero('b', 'Second'), { id: 'h', kind: 'heading', text: 'Third' }]);
    const ones = container.querySelectorAll('h1');
    expect(ones).toHaveLength(1);
    expect(ones[0]!.textContent).toBe('First');
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Second', 'Third']);
  });

  it('is the first Heading without a Hero, and the title, for screen readers only, without either', () => {
    const headed = draw([{ id: 't', kind: 'text', text: 'Hello.' }, { id: 'h', kind: 'heading', text: 'Open day' }, { id: 'h2', kind: 'heading', text: 'Where' }]);
    expect([...headed.container.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['Open day']);
    cleanup();
    const bare = draw([{ id: 't', kind: 'text', text: 'Hello.' }]);
    const ones = bare.container.querySelectorAll('h1');
    expect(ones).toHaveLength(1);
    expect(ones[0]!.textContent).toBe('Acoustic booths');
    expect(ones[0]!.className).toBe('lp-hidden');
  });

  it('puts a titled block\'s items under it, and an untitled one\'s beside it', () => {
    const items = [{ heading: 'Quiet inside', text: 'Talk at a normal voice.' }];
    const { container } = draw([hero('a', 'First'), { id: 'f', kind: 'features', title: 'Why booths', items }, { id: 'g', kind: 'features', items }]);
    expect([...container.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Quiet inside']);
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Why booths', 'Quiet inside']);
  });
});

describe('every block, for a stranger', () => {
  it('draws each kind, with the host\'s slots', () => {
    const { container } = draw(EVERY, {
      slots: {
        picture: (ref, opts) => <img src={`/x/pages/api/open-day/pictures/${ref.file}`} alt={opts.alt} />,
        form: (block) => <p>{`Form ${block.form} of ${block.addOn}`}</p>,
        icon: (name) => <svg data-icon={name} />,
        pageHref: (key) => (key === '12' ? '/x/pages/open-day' : null),
        banner: () => <p>Can we remember your visit?</p>,
      },
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Acoustic booths for open offices');
    expect(screen.getByRole('link', { name: 'See them at our open day' }).getAttribute('href')).toBe('/x/pages/open-day');
    expect(screen.getByRole('link', { name: 'Book a showroom visit' }).getAttribute('href')).toBe(`#${landingFormAnchor('form')}`);
    expect(screen.getByRole('link', { name: 'Our website' }).getAttribute('href')).toBe('https://www.meridian.example/');
    expect(container.querySelector(`#${landingFormAnchor('form')}`)!.textContent).toBe('Form 7 of forms');
    expect(screen.getByRole('img', { name: 'Two grey acoustic booths in an open office' }).getAttribute('src')).toBe('/x/pages/api/open-day/pictures/file_hero');
    // A picture that is only decoration is handed to the slot as such.
    expect(container.querySelector('img[src$="file_floor"]')!.getAttribute('alt')).toBe('');
    expect(container.querySelector('svg[data-icon="volume-x"]')).not.toBeNull();
    expect([...container.querySelectorAll('.lp-body')].map((p) => p.textContent)).toContain('Double booths for two people.');
    expect(container.querySelector('blockquote')!.textContent).toBe('The floor is calm again.');
    expect(container.querySelector('figcaption')!.textContent).toBe('Marta Kovac');
    expect(container.querySelector('details summary')!.textContent).toBe('How long does fitting take?');
    expect(container.querySelector('.lp-spacer')!.getAttribute('data-size')).toBe('l');
    // The banner is read first.
    expect(container.querySelector('.lp')!.firstElementChild!.className).toBe('lp-banner');
    // No canvas buttons, and no block ids, for a stranger.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelector('[data-block-id]')).toBeNull();
  });

  it('draws a picture with no file yet as its description, and leaves out a button that goes nowhere', () => {
    const { container } = draw([
      { id: 'p', kind: 'picture', picture: { file: 'file_floor', alt: 'A floor sketch' } },
      { id: 'b', kind: 'button', label: 'The open day', link: { kind: 'page', key: '99' } },
      { id: 'b2', kind: 'button', label: 'Book a visit', link: { kind: 'form' } },
      hero('h', 'Open day'),
    ]);
    expect(screen.getByRole('img', { name: 'A floor sketch' }).textContent).toBe('A floor sketch');
    // A page with no address, and a form link on a page with no form: no dead button, and no empty row for one.
    expect(container.querySelector('.lp-button')).toBeNull();
    expect(container.querySelector('.lp-actions')).toBeNull();
    expect([...container.querySelectorAll('.lp-block')].map((one) => one.getAttribute('data-kind'))).toEqual(['picture', 'hero']);
  });

  it('leaves out a Form block whose form the host does not draw, band and all', () => {
    const { container } = draw([hero('h', 'Open day'), { id: 'form', kind: 'form', form: '7', addOn: 'forms' }], { slots: { form: () => null } });
    expect(container.querySelector('.lp-form')).toBeNull();
    expect(container.querySelector(`#${landingFormAnchor('form')}`)).toBeNull();
    expect(container.querySelectorAll('.lp-block')).toHaveLength(1);
  });

  it('keeps every button and Form block on the canvas, where nothing leaves the editor', () => {
    const { container } = render(
      <LandingPageView
        page={page([{ id: 'b', kind: 'button', label: 'The open day', link: { kind: 'page', key: '99' } }, { id: 'form', kind: 'form', form: '7', addOn: 'forms' }])}
        language="en-US"
        dir="ltr"
        mode="canvas"
        words={{ edit: (kind) => `Edit ${kind}` }}
        slots={{ form: () => null }}
      />,
    );
    expect(container.querySelector('.lp-button')!.hasAttribute('href')).toBe(false);
    expect(container.querySelector('.lp-form')).not.toBeNull();
  });

  it('draws markup typed into a text as the characters it is', () => {
    const typed = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = draw([hero('a', typed), { id: 't', kind: 'text', text: typed }]);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('h1')!.textContent).toBe(typed);
  });
});

describe('a page in Arabic', () => {
  it('is drawn right to left in its language, from the same rules', () => {
    const { container } = render(<LandingPageView page={page([hero('a', 'كبائن هادئة للمكاتب المفتوحة')])} language="ar-EG" dir="rtl" mode="stranger" />);
    const root = container.querySelector('.lp')!;
    expect(root.getAttribute('dir')).toBe('rtl');
    expect(root.getAttribute('lang')).toBe('ar-EG');
    // Mirrored by the browser itself: the stylesheet names no physical side, so nothing stays on the left.
    const css = read('src/landing/landing.css');
    expect(css).not.toMatch(/(^|[\s;{-])(left|right)\s*:/m);
    expect(css).not.toMatch(/(margin|padding|border)-(left|right)|text-align:\s*(left|right)|float:/);
    expect(css).toMatch(/inset-inline-end|margin-inline|padding-inline/);
  });
});

describe('the canvas', () => {
  it('gives each block a group with one "Edit" button and its id, and leaves the editor through no link', () => {
    const edited: string[] = [];
    const { container } = render(
      <LandingPageView page={page(EVERY)} language="en-US" dir="ltr" mode="canvas" words={{ edit: (kind) => `Edit ${kind}` }} onEdit={(id) => edited.push(id)} slots={{ pageHref: () => '/x/pages/open-day' }} />,
    );
    // Each block's group (a Questions block's `details` is a group of its own, inside one).
    const groups = screen.getAllByRole('group').filter((group) => group.hasAttribute('data-block-id'));
    expect(container.querySelectorAll('[data-block-id]')).toHaveLength(EVERY.length);
    expect(groups.map((group) => group.getAttribute('data-block-id'))).toEqual(EVERY.map((block) => block.id));
    for (const group of groups) expect(within(group).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(groups[0]!).getByRole('button', { name: 'Edit hero' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit questions' }));
    expect(edited).toEqual(['hero', 'questions']);
    expect(container.querySelectorAll('a[href]')).toHaveLength(0);
    // The same one main heading.
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });
});

describe('the module', () => {
  const source = read('src/landing/render.tsx');

  it('sets no markup from a string anywhere', () => {
    expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment/);
  });

  it('reaches no schema and no zod: a stranger\'s page carries none of their weight', () => {
    const seen = new Set<string>();
    const follow = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const found of read(`src/landing/${file}`).matchAll(/^import (?!type )[^;]*? from '([^']+)';/gm)) {
        const target = found[1]!;
        if (target.startsWith('./')) follow(target.slice(2).replace(/\.js$/, '.ts'));
        else seen.add(target);
      }
    };
    follow('render.tsx');
    expect([...seen].sort()).toEqual(['headings.ts', 'render.tsx']);
  });

  it('imports only React and the vocabulary beside it', () => {
    const imports = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1]);
    expect(imports.filter((from) => !from!.startsWith('./'))).toEqual(['react']);
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|style=\{/);
  });
});
