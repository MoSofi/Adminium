// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The grid every picker draws: one keyboard model whoever hosts it, and the
 * two looks (a field's square thumbnails with the name under; the Designer's
 * pictures in the spot's shape with the title over).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { PictureGrid, type GridAspect, type GridTile } from './PictureGrid.js';

const tiles: GridTile[] = Array.from({ length: 6 }, (_, index) => ({ id: `p${String(index)}`, src: `/p${String(index)}.jpg`, name: `Picture ${String(index)} by Ana, Credit needed`, title: `Picture ${String(index)}` }));

function Host({ multiple = false, caption = 'over', aspect = 'wide', dir = 'ltr' }: { multiple?: boolean; caption?: 'over' | 'under'; aspect?: GridAspect; dir?: 'ltr' | 'rtl' }) {
  const [focus, setFocus] = useState(0);
  const [log, setLog] = useState<number[]>([]);
  return (
    <div dir={dir}>
      <PictureGrid tiles={tiles} label="Pictures for Hero" aspect={aspect} caption={caption} cols={4} multiple={multiple} focus={focus} onFocus={setFocus} onActivate={(index) => setLog((before) => [...before, index])} />
      <output data-testid="log">{log.join(',')}</output>
    </div>
  );
}

afterEach(cleanup);

describe('the grid of pictures', () => {
  it('is a list with one tab stop, its pictures alt="" and named by their tiles, in the spot’s shape with the title over its foot', () => {
    render(<Host />);
    const list = screen.getByRole('listbox', { name: 'Pictures for Hero' });
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    expect(options[0]?.getAttribute('aria-label')).toBe('Picture 0 by Ana, Credit needed');
    expect(list.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(list.querySelector('[data-part="picker-caption"]')?.textContent).toBe('Picture 0');
    expect(list.querySelector('.aspect-\\[16\\/10\\]')).not.toBeNull();
  });

  it('moves with the arrows, a row with Up and Down, to the ends with Home and End, and activates with Enter; Space does nothing where one is chosen', () => {
    render(<Host />);
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[5]?.tabIndex).toBe(0);
    fireEvent.keyDown(list, { key: 'Home' });
    expect(screen.getAllByRole('option')[0]?.tabIndex).toBe(0);
    fireEvent.keyDown(list, { key: 'End' });
    fireEvent.keyDown(list, { key: ' ' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(screen.getByTestId('log').textContent).toBe('5');
  });

  it('flips the sideways arrows right to left, and ticks with Space where several may be ticked', () => {
    render(<Host multiple dir="rtl" />);
    const list = screen.getByRole('listbox');
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(screen.getAllByRole('option')[1]?.tabIndex).toBe(0);
    fireEvent.keyDown(list, { key: ' ' });
    expect(screen.getByTestId('log').textContent).toBe('1');
  });

  it('draws a field’s thumbnails square, with the name under them', () => {
    render(<Host caption="under" aspect="square" />);
    const list = screen.getByRole('listbox');
    expect(list.querySelector('[data-part="picker-caption"]')).toBeNull();
    expect(list.querySelector('.aspect-square')).not.toBeNull();
    expect(screen.getByText('Picture 3')).toBeTruthy();
  });
});
