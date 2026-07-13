import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OtpInput } from './OtpInput.js';

afterEach(cleanup);

const cells = (container: HTMLElement) => [...container.querySelectorAll('[data-part="otp-cell"]')];

describe('OtpInput', () => {
  it('renders one invisible input and 6 cells', () => {
    const { container } = render(<OtpInput label="One-time code" />);
    expect(screen.getByLabelText('One-time code')).toBeDefined();
    expect(cells(container)).toHaveLength(6);
  });

  it('typing digits fills cells in order and fires onComplete once full', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onComplete = vi.fn();
    const { container } = render(
      <OtpInput label="One-time code" onChange={onChange} onComplete={onComplete} />,
    );
    const input = screen.getByLabelText('One-time code');

    await user.click(input);
    await user.keyboard('123');
    expect(cells(container).map((c) => c.textContent)).toEqual(['1', '2', '3', '', '', '']);
    expect(onComplete).not.toHaveBeenCalled();

    await user.keyboard('456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(onChange).toHaveBeenLastCalledWith('123456');
  });

  it('ignores non-digit characters', async () => {
    const user = userEvent.setup();
    const { container } = render(<OtpInput label="One-time code" />);
    await user.click(screen.getByLabelText('One-time code'));
    await user.keyboard('a1b2-');
    expect(cells(container).map((c) => c.textContent)).toEqual(['1', '2', '', '', '', '']);
  });

  it('paste fills all cells', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<OtpInput label="One-time code" onComplete={onComplete} />);
    const input = screen.getByLabelText('One-time code');
    await user.click(input);
    await user.paste('987654');
    expect(onComplete).toHaveBeenCalledWith('987654');
  });

  it('Backspace clears backwards', async () => {
    const user = userEvent.setup();
    const { container } = render(<OtpInput label="One-time code" defaultValue="123" />);
    await user.click(screen.getByLabelText('One-time code'));
    await user.keyboard('{Backspace}');
    expect(cells(container).map((c) => c.textContent)).toEqual(['1', '2', '', '', '', '']);
  });

  it('supports controlled usage', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [code, setCode] = useState('');
      return <OtpInput label="One-time code" value={code} onChange={setCode} />;
    }
    const { container } = render(<Controlled />);
    await user.click(screen.getByLabelText('One-time code'));
    await user.keyboard('42');
    expect(cells(container).map((c) => c.textContent)).toEqual(['4', '2', '', '', '', '']);
  });

  it('marks invalid state on the native input', () => {
    render(<OtpInput label="One-time code" invalid />);
    expect(screen.getByLabelText('One-time code').getAttribute('aria-invalid')).toBe('true');
  });
});
