/**
 * Review value-view rendering (06-llm-assist.md §10.3). Pins the RTL-correctness
 * of the relation direction arrow (acceptance #14 "RTL-correct in ar_EG"): the
 * literal U+2192 is not a bidi-mirrored glyph, so it must carry `rtl:-scale-x-100`
 * to keep pointing from→to after the flex row reverses under RTL.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RelationChips } from './valueViews.js';

describe('RelationChips — RTL arrow', () => {
  it('flips the → glyph under RTL', () => {
    const { container } = render(
      <RelationChips
        value={{
          fromTable: 'public.orders',
          fromColumns: ['product_id'],
          toTable: 'public.products',
          toColumns: ['id'],
          kind: 'many-to-one',
        }}
      />,
    );
    const arrow = [...container.querySelectorAll('span')].find((el) => el.textContent === '→');
    expect(arrow, 'the relation arrow span').toBeTruthy();
    expect(arrow?.className).toContain('rtl:-scale-x-100');
  });
});
