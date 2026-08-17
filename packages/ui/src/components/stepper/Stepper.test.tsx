// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Stepper, type Step } from './Stepper.js';

afterEach(cleanup);

const STEPS: Step[] = [
  { id: 'connect', label: 'Connect' },
  { id: 'schema', label: 'Schema' },
  { id: 'review', label: 'Review' },
  { id: 'deploy', label: 'Deploy' },
];

describe('Stepper', () => {
  it('derives done/active/pending from activeIndex with aria-current', () => {
    render(<Stepper label="Setup progress" steps={STEPS} activeIndex={2} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.dataset['state'])).toEqual(['done', 'done', 'active', 'pending']);
    expect(items[2]?.getAttribute('aria-current')).toBe('step');
    expect(items[0]?.getAttribute('aria-current')).toBeNull();
  });

  it('honors explicit step states (loading / error)', () => {
    render(
      <Stepper
        steps={[
          { id: 'a', label: 'A', state: 'done' },
          { id: 'b', label: 'B', state: 'loading' },
          { id: 'c', label: 'C', state: 'error' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.dataset['state'])).toEqual(['done', 'loading', 'error']);
  });

  it('keyboard: completed steps are focusable buttons, pending steps are not', async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} activeIndex={2} onStepClick={onStepClick} />);

    // done, done and active are clickable; the pending step renders no button.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);

    await user.tab();
    expect(document.activeElement).toBe(buttons[0]);
    await user.keyboard('{Enter}');
    expect(onStepClick).toHaveBeenCalledWith(0);

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(buttons[2]);
    await user.keyboard('{Enter}');
    expect(onStepClick).toHaveBeenCalledWith(2);
  });

  it('renders descriptions in the vertical variant', () => {
    render(
      <Stepper
        orientation="vertical"
        steps={[{ id: 'a', label: 'Connect', description: 'postgres://…' }]}
      />,
    );
    expect(screen.getByText('postgres://…')).toBeDefined();
    expect(screen.getByRole('list').dataset['orientation']).toBe('vertical');
  });
});
