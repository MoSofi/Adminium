// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 3 — the account fields.
 *
 * Both password fields can be unmasked, independently: someone choosing a
 * password they must retype in the next field is exactly who needs to see it.
 * What is pinned here is that the toggle is a BUTTON in a form — a reveal that
 * submitted the wizard would be worse than no reveal — and that its accessible
 * name says which way it goes, because an eye glyph alone does not.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import { EMPTY_ACCOUNT } from '../../accountValidation.js';
import { AccountStep } from './AccountStep.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

function renderStep(onSubmit = (): void => undefined) {
  render(
    <AccountStep
      values={{ ...EMPTY_ACCOUNT, password: 'correct-horse', confirm: 'correct-horse' }}
      errors={{}}
      passwordMinLength={10}
      onChange={() => undefined}
      onSubmit={onSubmit}
    />,
  );
}

// FormField appends a decorative "*" to a required label, so the label's text
// content is "Password*" — anchored, or `PasswordStrength`'s own "Password
// strength" label matches too the moment a value is typed.
const password = (): HTMLInputElement => screen.getByLabelText(/^Password\*$/) as HTMLInputElement;
const confirm = (): HTMLInputElement =>
  screen.getByLabelText(/^Confirm password\*$/) as HTMLInputElement;

describe('unmasking', () => {
  it('starts masked, and both fields have their own toggle', () => {
    renderStep();
    expect(password().type).toBe('password');
    expect(confirm().type).toBe('password');
    expect(screen.getAllByRole('button', { name: 'Show password' })).toHaveLength(2);
  });

  it('reveals one field without revealing the other', async () => {
    renderStep();
    const [first] = screen.getAllByRole('button', { name: 'Show password' });
    await userEvent.click(first!);
    expect(password().type).toBe('text');
    expect(confirm().type).toBe('password');
  });

  it('renames the control once the value is showing, and says it is pressed', async () => {
    renderStep();
    const [first] = screen.getAllByRole('button', { name: 'Show password' });
    await userEvent.click(first!);
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(hide);
    expect(password().type).toBe('password');
  });

  it('does not submit the form — it is a reveal, not an answer', async () => {
    const onSubmit = vi.fn();
    renderStep(onSubmit);
    const [first] = screen.getAllByRole('button', { name: 'Show password' });
    await userEvent.click(first!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('the form itself', () => {
  it('submits on Enter, since the shell owns the only button', async () => {
    const onSubmit = vi.fn();
    renderStep(onSubmit);
    await userEvent.type(screen.getByLabelText(/^Email\*$/), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
