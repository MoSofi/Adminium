// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MetaPill } from './MetaPill.js';

afterEach(cleanup);

describe('MetaPill', () => {
  it('says the field’s name until something is chosen, then says that', () => {
    const { rerender } = render(<MetaPill placeholder="Due date" />);
    expect(screen.getByRole('button').textContent).toBe('Due date');
    rerender(<MetaPill placeholder="Due date" value="Tomorrow" />);
    expect(screen.getByRole('button').textContent).toBe('Tomorrow');
  });

  it('treats an empty value as nothing chosen', () => {
    // A cleared pill holds `''`, and a pill saying nothing at all would be a
    // control with no name.
    render(<MetaPill placeholder="Priority" value="" />);
    expect(screen.getByRole('button').textContent).toBe('Priority');
  });
});
