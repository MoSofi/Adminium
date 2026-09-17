// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 5 — bring your team.
 *
 * The case that matters is the one a fresh `npx` install always hits: no SMTP,
 * so the invitation comes back with `emailSent: false` and a link that is shown
 * exactly once. An invite flow that swallowed it would hand someone an account
 * they can never activate.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import { nameFromEmail, TeamStep, type InvitedPerson } from './TeamStep.js';

const createUser = vi.fn();
vi.mock('../../../team/teamApi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../team/teamApi.js')>();
  return { ...actual, createUser: (...args: unknown[]) => createUser(...args) };
});

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => createUser.mockReset());

const INVITE = { token: 'tok_1', expiresAt: Date.now() + 86_400_000, activationPath: '/reset/tok_1' };

function invited(overrides: Partial<InvitedPerson> = {}): InvitedPerson {
  return { email: 'sam@example.com', emailSent: true, invite: INVITE, ...overrides };
}

describe('inviting', () => {
  it('sends the address and a name derived from it', async () => {
    createUser.mockResolvedValue({ user: {}, invite: INVITE, emailSent: true });
    const onInvited = vi.fn();
    render(<TeamStep invited={[]} onInvited={onInvited} />);
    await userEvent.type(screen.getByLabelText(/Teammate/), 'morgan@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(createUser).toHaveBeenCalledWith({ email: 'morgan@example.com', name: 'morgan' });
  });

  it('refuses a malformed address without asking the server', async () => {
    render(<TeamStep invited={[]} onInvited={() => undefined} />);
    await userEvent.type(screen.getByLabelText(/Teammate/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(screen.getByRole('alert').textContent ?? '').toContain('valid email');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('refuses the same person twice', async () => {
    render(<TeamStep invited={[invited()]} onInvited={() => undefined} />);
    await userEvent.type(screen.getByLabelText(/Teammate/), 'sam@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(screen.getByRole('alert').textContent ?? '').toContain('already been invited');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('surfaces what the server said when it refuses', async () => {
    createUser.mockRejectedValue(new Error('That email is already in use.'));
    render(<TeamStep invited={[]} onInvited={() => undefined} />);
    await userEvent.type(screen.getByLabelText(/Teammate/), 'sam@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('alert').textContent ?? '').toContain('already in use');
  });
});

describe('what happens to the link', () => {
  it('shows it when no email was sent — it is the only copy that exists', () => {
    render(<TeamStep invited={[invited({ emailSent: false })]} onInvited={() => undefined} />);
    expect(screen.getByText(/\/reset\/tok_1/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeDefined();
  });

  it('keeps it hidden when the invitation was emailed', () => {
    render(<TeamStep invited={[invited({ emailSent: true })]} onInvited={() => undefined} />);
    expect(screen.queryByText(/\/reset\/tok_1/)).toBeNull();
    expect(screen.getByText('Invitation emailed')).toBeDefined();
  });
});

describe('the name it derives', () => {
  it('takes the local part, and never sends an empty one', () => {
    expect(nameFromEmail('ada@example.com')).toBe('ada');
    expect(nameFromEmail('  morgan.lee@corp.example  ')).toBe('morgan.lee');
    expect(nameFromEmail('@example.com')).toBe('@example.com');
  });
});
