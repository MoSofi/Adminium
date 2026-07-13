import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from '../icon-button/index.js';
import { InputGroup } from './InputGroup.js';

describe('InputGroup', () => {
  it('renders the wrapper chrome around a borderless input', () => {
    const { container } = render(<InputGroup placeholder="Search" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('bg-surface-2');
    expect(wrapper.className).toContain('focus-within:border-accent');
    expect(screen.getByRole('textbox').className).toContain('bg-transparent');
  });

  it('renders prefix in mono and kbd suffix', () => {
    render(<InputGroup prefix="adminium.io/" kbd="⌘K" />);
    const prefix = screen.getByText('adminium.io/');
    expect(prefix.className).toContain('font-mono');
    expect(screen.getByText('⌘K').tagName).toBe('KBD');
  });

  it('renders a leading icon as decorative', () => {
    const { container } = render(<InputGroup iconLeading={<svg data-testid="icon" />} />);
    expect(screen.getByTestId('icon')).toBeDefined();
    const slot = container.querySelector('[aria-hidden="true"]');
    expect(slot).not.toBeNull();
  });

  it('keeps the trailing IconButton clickable and typing works', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(
      <InputGroup
        defaultValue="secret"
        trailing={<IconButton label="Copy value" onClick={onCopy} />}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy value' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    await user.type(screen.getByRole('textbox'), '!');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('secret!');
  });

  it('marks the wrapper and input invalid when error', () => {
    const { container } = render(<InputGroup error />);
    expect((container.firstElementChild as HTMLElement).hasAttribute('data-invalid')).toBe(true);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  });

  it('passes input props and ref to the inner input', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<InputGroup ref={ref} name="slug" defaultValue="acme" />);
    expect(ref.current?.name).toBe('slug');
    expect(ref.current?.value).toBe('acme');
  });
});
