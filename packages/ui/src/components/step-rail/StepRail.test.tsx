// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * What the rail has to say, and to whom.
 *
 * The labels hide below 640px (DP11), so the only thing carrying "which step am
 * I on" at every width is `aria-current` — which makes it the assertion.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StepRail } from './StepRail.js';

afterEach(cleanup);

const STEPS = [{ label: 'Profile' }, { label: 'Role' }, { label: 'Access' }];

describe('StepRail', () => {
  it('marks the current step, and only it', () => {
    render(<StepRail steps={STEPS} current={1} label="Steps" />);
    const marked = screen
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('aria-current') === 'step');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toContain('Role');
  });

  it('keeps a done step’s NUMBER rather than turning it into a tick', () => {
    render(<StepRail steps={STEPS} current={2} label="Steps" />);
    // The comp draws it that way, and it is what lets a person say "three of
    // three" when they look back.
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('is a display until it is given something to do', async () => {
    const onStep = vi.fn();
    const { rerender } = render(<StepRail steps={STEPS} current={2} label="Steps" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    rerender(<StepRail steps={STEPS} current={2} label="Steps" onStep={onStep} />);
    await userEvent.setup().click(screen.getAllByRole('button')[0] as HTMLElement);
    expect(onStep).toHaveBeenCalledWith(0);
  });
});
