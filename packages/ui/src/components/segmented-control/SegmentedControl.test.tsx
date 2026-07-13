import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl } from './SegmentedControl.js';

const options = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

describe('SegmentedControl', () => {
  it('renders a radiogroup; first enabled option is selected by default', () => {
    render(<SegmentedControl aria-label="Period" options={options} />);
    expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Day' }).getAttribute('aria-checked')).toBe('true');
  });

  it('selects a segment on click and reports the value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<SegmentedControl aria-label="Period" options={options} onValueChange={onValueChange} />);
    await user.click(screen.getByRole('radio', { name: 'Month' }));
    expect(onValueChange).toHaveBeenCalledWith('month');
    const month = screen.getByRole('radio', { name: 'Month' });
    expect(month.getAttribute('aria-checked')).toBe('true');
    expect(month.hasAttribute('data-selected')).toBe(true);
  });

  it('has a single tab stop and arrow keys move + select with wrap-around', async () => {
    const user = userEvent.setup();
    render(<SegmentedControl aria-label="Period" options={options} defaultValue="week" />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Week' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Month' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Day' }).getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Day' }).getAttribute('aria-checked')).toBe('true');
  });

  it('mirrors arrow keys in RTL', async () => {
    const user = userEvent.setup();
    const { DirectionProvider } = await import('@radix-ui/react-direction');
    render(
      <DirectionProvider dir="rtl">
        <SegmentedControl aria-label="Period" options={options} defaultValue="week" />
      </DirectionProvider>,
    );
    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true');
  });

  it('skips disabled segments during keyboard navigation', async () => {
    const user = userEvent.setup();
    render(
      <SegmentedControl
        aria-label="Period"
        options={[options[0]!, { ...options[1]!, disabled: true }, options[2]!]}
        defaultValue="day"
      />,
    );
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true');
  });

  it('respects the controlled value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<SegmentedControl aria-label="Period" options={options} value="week" onValueChange={onValueChange} />);
    await user.click(screen.getByRole('radio', { name: 'Day' }));
    expect(onValueChange).toHaveBeenCalledWith('day');
    // parent did not re-render: stays on week
    expect(screen.getByRole('radio', { name: 'Week' }).getAttribute('aria-checked')).toBe('true');
  });

  it('renders count pills and icon-only segments with accessible names', () => {
    render(
      <SegmentedControl
        aria-label="Views"
        options={[
          { value: 'open', label: 'Open', count: 12 },
          { value: 'grid', icon: <svg aria-hidden="true" />, ariaLabel: 'Grid view' },
        ]}
      />,
    );
    expect(screen.getByText('12')).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Grid view' })).toBeDefined();
  });
});
