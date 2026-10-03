// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A model's reply, drawn.
 *
 *  1. Headings, lists (nested, numbered), bold, italic, code, a code block and
 *     a table become the elements a reader expects.
 *  2. Nothing a model wrote is run or fetched: a tag is shown as characters,
 *     an image is its description, a link is words with its address beside
 *     them and never an anchor, and an address that is not http(s) is not
 *     shown at all.
 *  3. A reply still being written is drawn as far as it goes: an open code
 *     block, a `**` with no partner. The caret stands at the end of the text.
 *  4. A name with underscores is not emphasis.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Markdown } from './markdown.js';

const draw = (text: string, caret?: React.ReactNode) => render(<Markdown text={text} caret={caret} />).container;

describe('Markdown', () => {
  it('draws headings, lists, emphasis, code and a table', () => {
    const el = draw(
      [
        '## What I built',
        '',
        'A **bakery** app with *two* sides and `orders`.',
        '',
        '- A staff screen',
        '  - with a board',
        '- A customer page',
        '',
        '1. Open the preview',
        '2. Place an order',
        '',
        '```ts',
        'const a = "<b>";',
        '```',
        '',
        '| Table | Rows |',
        '| --- | ---: |',
        '| cakes | 6 |',
        '| orders | 0 |',
      ].join('\n'),
    );
    expect(el.querySelector('h3')?.textContent).toBe('What I built');
    expect(el.querySelector('strong')?.textContent).toBe('bakery');
    expect(el.querySelector('em')?.textContent).toBe('two');
    expect(el.querySelector('p code')?.textContent).toBe('orders');
    const lists = el.querySelectorAll('ul');
    expect(lists).toHaveLength(2);
    expect(lists[0]?.children).toHaveLength(2);
    expect(lists[1]?.textContent).toBe('with a board');
    expect([...el.querySelectorAll('ol > li')].map((item) => item.textContent)).toEqual(['Open the preview', 'Place an order']);
    expect(el.querySelector('pre')?.textContent).toBe('const a = "<b>";');
    expect([...el.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['Table', 'Rows']);
    expect([...el.querySelectorAll('tbody tr')].map((row) => row.textContent)).toEqual(['cakes6', 'orders0']);
    expect(el.querySelectorAll('th')[1]?.className).toContain('text-end');
  });

  it('runs and fetches nothing a model wrote', () => {
    const el = draw(
      [
        '<script>window.hacked = true</script>',
        '<img src="https://evil.example/x.png" onerror="alert(1)">',
        '![a cake](https://evil.example/cake.png)',
        'See [the docs](https://docs.adminium.dev/x) and [this](javascript:alert(1)) and <a href="https://evil.example">here</a>.',
      ].join('\n\n'),
    );
    expect(el.querySelector('script, img, a, iframe, object, embed, style, link')).toBeNull();
    expect(el.textContent).toContain('<script>window.hacked = true</script>');
    expect(el.textContent).toContain('a cake');
    expect(el.textContent).not.toContain('cake.png');
    expect(el.textContent).toContain('the docs (https://docs.adminium.dev/x)');
    expect(el.textContent).not.toContain('javascript:');
    expect((window as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('draws a reply that has not ended yet, with the caret at its end', () => {
    const open = draw('Here is the file:\n\n```json\n{ "ref": "cakes"');
    expect(open.querySelector('pre')?.textContent).toBe('{ "ref": "cakes"');

    const bold = draw('This is **not closed', <span data-testid="caret" />);
    expect(bold.querySelector('strong')).toBeNull();
    expect(bold.textContent).toBe('This is **not closed');
    expect(bold.querySelector('p > [data-testid="caret"]')).not.toBeNull();

    const list = draw('- one\n- two', <span data-testid="caret" />);
    expect(list.querySelector('li:last-child > [data-testid="caret"]')).not.toBeNull();

    expect(draw('', <span data-testid="caret" />).querySelector('[data-testid="caret"]')).toBeNull();
  });

  it('leaves a name with underscores, a lone star and an escaped mark as they are', () => {
    const el = draw('The column order_code_id is 2 * 3 * 4, \\*not bold\\*, and snake_case_name too.');
    expect(el.querySelector('em, strong')).toBeNull();
    expect(el.textContent).toBe('The column order_code_id is 2 * 3 * 4, *not bold*, and snake_case_name too.');
  });

  it('keeps a line break inside a paragraph and survives a very long or odd reply', () => {
    expect(draw('one\ntwo').querySelectorAll('br')).toHaveLength(1);
    // A sign written as TeX in a sentence is the sign; a price in dollars is left alone.
    expect(draw('New $\\rightarrow$ Done, 2 $\\times$ $5').textContent).toBe('New → Done, 2 × $5');
    expect(() => draw(`${'- a\n'.repeat(3000)}${'  '.repeat(40)}- deep\n| a |\n|---|\n${'*'.repeat(500)}${'['.repeat(500)}`)).not.toThrow();
    const long = draw('x'.repeat(70_000));
    expect(long.textContent).toHaveLength(70_000);
  });
});

describe('a reply made to be slow', () => {
  const timed = (text: string): number => {
    const start = performance.now();
    render(<Markdown text={text} />);
    return performance.now() - start;
  };

  it('a heading with a long run of spaces is drawn at once, with its closing marks cut as before', () => {
    expect(timed(`# a${' '.repeat(20_000)}x`)).toBeLessThan(500);
    cleanup();
    render(<Markdown text={'## Orders ##\n\n# C#\n\n### Trailing   \n\n#### Mixed # marks ###'} />);
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Orders', 'C#', 'Trailing', 'Mixed # marks']);
  });

  it('a long run of brackets with no end is words, not a search of the whole reply at each one', () => {
    expect(timed('['.repeat(50_000))).toBeLessThan(1500);
    cleanup();
    expect(timed('!['.repeat(25_000))).toBeLessThan(1500);
    cleanup();
    // Emphasis that opens and never closes.
    expect(timed('_a '.repeat(20_000))).toBeLessThan(1500);
    cleanup();
    expect(timed('**a '.repeat(15_000))).toBeLessThan(1500);
  });
});
