// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Slider } from './Slider.js';

describe('Slider', () => {
  it('renders a slider with min/max/now exposed', () => {
    render(<Slider defaultValue={[40]} min={0} max={100} thumbLabels={['Volume']} />);
    const thumb = screen.getByRole('slider', { name: 'Volume' });
    expect(thumb.getAttribute('aria-valuemin')).toBe('0');
    expect(thumb.getAttribute('aria-valuemax')).toBe('100');
    expect(thumb.getAttribute('aria-valuenow')).toBe('40');
  });

  it('steps with arrow keys and clamps with Home/End', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Slider defaultValue={[40]} min={0} max={100} step={5} onValueChange={onValueChange} thumbLabels={['Volume']} />);
    const thumb = screen.getByRole('slider');
    thumb.focus();
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith([45]);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onValueChange).toHaveBeenLastCalledWith([35]);
    await user.keyboard('{End}');
    expect(onValueChange).toHaveBeenLastCalledWith([100]);
    await user.keyboard('{Home}');
    expect(onValueChange).toHaveBeenLastCalledWith([0]);
  });

  it('renders one thumb per value for range sliders', () => {
    render(<Slider defaultValue={[20, 60]} thumbLabels={['Start', 'End']} />);
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(screen.getByRole('slider', { name: 'End' }).getAttribute('aria-valuenow')).toBe('60');
  });

  it('is inert when disabled', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Slider defaultValue={[40]} disabled onValueChange={onValueChange} thumbLabels={['Volume']} />);
    const thumb = screen.getByRole('slider');
    thumb.focus();
    await user.keyboard('{ArrowRight}').catch(() => undefined);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
