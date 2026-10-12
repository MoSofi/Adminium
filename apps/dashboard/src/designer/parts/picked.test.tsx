// SPDX-License-Identifier: AGPL-3.0-only
/** The chip of the element a person pointed at: waiting above the prompt box, and under a sent message. */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { DesignerPicked } from '../api.js';
import { PickedTray, SentPicked } from './picked.js';

const PICKED: DesignerPicked = { side: 'customer', path: '/menu', page: 1280, part: 'button btn primary', text: 'Add to cart', label: '', within: ['div card'], nth: 1, of: 1, width: 120, height: 40 };

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('the picked element’s chip', () => {
  it('is not there when nothing is picked', () => {
    const { container } = render(
      <>
        <PickedTray picked={null} onRemove={() => undefined} />
        <SentPicked picked={null} />
      </>,
    );
    expect(container.textContent).toBe('');
  });

  it('says the tag, the words and the page, and can be taken off while it waits', async () => {
    const onRemove = vi.fn();
    render(<PickedTray picked={PICKED} onRemove={onRemove} />);
    const chip = screen.getByRole('group', { name: 'Picked element' });
    expect(chip.textContent).toBe('<button>Add to cart/menu');
    expect(chip.getAttribute('title')).toBe('<button class="btn primary">');
    await userEvent.click(screen.getByRole('button', { name: 'Take the picked element off' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('says an element with no words by its name, and one with neither by its tag alone', () => {
    render(<SentPicked picked={{ ...PICKED, part: 'img', text: '', label: 'The house burger' }} />);
    expect(screen.getByRole('group', { name: 'Picked element' }).textContent).toBe('<img>The house burger/menu');
    expect(screen.getByRole('group', { name: 'Picked element' }).getAttribute('title')).toBe('<img>');
  });
});
