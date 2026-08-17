// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../input/index.js';
import { FormField, useFormField } from './FormField.js';

describe('FormField', () => {
  it('wires label htmlFor to the child control id', () => {
    render(
      <FormField label="Email">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.tagName).toBe('INPUT');
  });

  it('wires aria-describedby to the helper caption', () => {
    render(
      <FormField label="Email" helper="We never share it.">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    const caption = screen.getByText('We never share it.');
    expect(input.getAttribute('aria-describedby')).toBe(caption.id);
    expect(caption.className).toContain('text-fg-muted');
  });

  it('replaces helper with error, sets aria-invalid, and styles the caption danger', () => {
    render(
      <FormField label="Email" helper="We never share it." error="Invalid email.">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('We never share it.')).toBeNull();
    const caption = screen.getByText('Invalid email.');
    expect(input.getAttribute('aria-describedby')).toBe(caption.id);
    expect(caption.className).toContain('text-danger');
  });

  it('marks required with a decorative danger asterisk and aria-required', () => {
    render(
      <FormField label="Name" required>
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText(/Name/);
    expect(input.getAttribute('aria-required')).toBe('true');
    const asterisk = screen.getByText('*');
    expect(asterisk.getAttribute('aria-hidden')).toBe('true');
    expect(asterisk.className).toContain('text-danger');
  });

  it('renders the type-annotation tag slot', () => {
    render(
      <FormField label="id" tag={<span data-testid="tag">uuid</span>}>
        <Input />
      </FormField>,
    );
    expect(screen.getByTestId('tag')).toBeDefined();
  });

  it('honors an explicit controlId', () => {
    render(
      <FormField label="Slug" controlId="slug-field">
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText('Slug').id).toBe('slug-field');
  });

  it('exposes the wiring through useFormField for composite controls', () => {
    let seen: ReturnType<typeof useFormField> = null;
    function Probe() {
      seen = useFormField();
      return <input aria-label="probe" />;
    }
    render(
      <FormField label="Owner" required error="Pick one.">
        <Probe />
      </FormField>,
    );
    expect(seen).not.toBeNull();
    expect(seen!.invalid).toBe(true);
    expect(seen!.required).toBe(true);
    expect(seen!.descriptionId).toContain('-caption');
  });

  it('returns null outside a FormField', () => {
    let seen: ReturnType<typeof useFormField> | 'unset' = 'unset';
    function Probe() {
      seen = useFormField();
      return null;
    }
    render(<Probe />);
    expect(seen).toBeNull();
  });
});
