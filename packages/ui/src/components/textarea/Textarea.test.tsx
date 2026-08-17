// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Textarea } from './Textarea.js';

describe('Textarea', () => {
  it('renders with the shared input chrome', () => {
    render(<Textarea placeholder="Notes" />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.className).toContain('bg-surface-2');
    expect(textarea.className).toContain('border-border-strong');
    expect(textarea.className).toContain('resize-y');
  });

  it('accepts multi-line typed input', async () => {
    const user = userEvent.setup();
    render(<Textarea />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'line one{Enter}line two');
    expect(textarea.value).toBe('line one\nline two');
  });

  it('switches to content-driven sizing when autoResize', () => {
    render(<Textarea autoResize />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('field-sizing-content');
    expect(textarea.className).toContain('resize-none');
  });

  it('sets aria-invalid when error', () => {
    render(<Textarea error />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  });

  it('applies the mono variant', () => {
    render(<Textarea mono />);
    expect(screen.getByRole('textbox').className).toContain('font-mono');
  });

  it('is disabled when disabled', () => {
    render(<Textarea disabled />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
  });
});
