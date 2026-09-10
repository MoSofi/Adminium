// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wizard's chrome (45-onboarding.md §2, `designs/Onboarding.dc.html`).
 *
 * The shell is presentational, so what is worth pinning is what it REFUSES to
 * render: no Back on the first step, no Skip on a step that must be answered,
 * and no rail navigation while a submit is in flight — the last one because
 * the rail can otherwise move a person off the account step mid-request.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider } from '@adminium/ui';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { OnboardingWizard, type OnboardingWizardProps } from './OnboardingWizard.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

const NOOP = (): void => undefined;

function renderWizard(props: Partial<OnboardingWizardProps> = {}): void {
  const merged: OnboardingWizardProps = {
    step: 'start',
    onBack: NOOP,
    onSkip: NOOP,
    onNext: NOOP,
    children: <p>step body</p>,
    ...props,
  };
  render(
    <ThemeProvider resolveDir={() => 'ltr'}>
      <OnboardingWizard {...merged} />
    </ThemeProvider>,
  );
}

/** The rail is the only `<ol>` on the screen. */
function railRows(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

describe('the frame', () => {
  it('renders the rail, the kicker, the title and the step body', () => {
    renderWizard({ step: 'account' });
    expect(railRows()).toHaveLength(6);
    expect(screen.getByText('Step 3 of 6')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeDefined();
    expect(screen.getByText('step body')).toBeDefined();
    expect(screen.getByRole('progressbar')).toBeDefined();
    expect(screen.getByText('50% complete')).toBeDefined();
  });

  it('marks the current step for assistive tech', () => {
    renderWizard({ step: 'meta' });
    const current = screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent ?? '').toContain('Adminium’s data');
  });
});

describe('what the footer offers', () => {
  it('has no Back on the first step', () => {
    renderWizard({ step: 'start' });
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('offers Back once there is somewhere to go back to', () => {
    renderWizard({ step: 'connect' });
    expect(screen.getByRole('button', { name: 'Back' })).toBeDefined();
  });

  it('offers Skip only where the step may be passed', () => {
    renderWizard({ step: 'connect' });
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDefined();
  });

  it('never offers Skip on the account or the storage step', () => {
    renderWizard({ step: 'account' });
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('says Continue until the last step, then names the destination', () => {
    renderWizard({ step: 'team' });
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDefined();
  });

  it('says Go to dashboard on the last step', () => {
    renderWizard({ step: 'done' });
    expect(screen.getByRole('button', { name: /Go to dashboard/ })).toBeDefined();
  });

  it('lets the caller override the primary label', () => {
    renderWizard({ step: 'account', nextLabel: 'Create account' });
    expect(screen.getByRole('button', { name: /Create account/ })).toBeDefined();
  });
});

describe('errors and work in flight', () => {
  it('renders an error above the body, as an alert', () => {
    renderWizard({ step: 'account', error: 'That email is already taken.' });
    expect(screen.getByRole('alert').textContent ?? '').toContain('That email is already taken.');
  });

  it('disables Back and Skip while busy', () => {
    renderWizard({ step: 'connect', busy: true });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Back' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Skip' }).disabled).toBe(true);
  });

  it('will not let the rail move off a step mid-submit', async () => {
    const onStepSelect = vi.fn();
    renderWizard({ step: 'account', onStepSelect, busy: true });
    // `start` is completed, so it would be clickable if the rail were live.
    await userEvent.click(screen.getByText('Starting point'));
    expect(onStepSelect).not.toHaveBeenCalled();
  });

  it('navigates back through the rail when it is live', async () => {
    const onStepSelect = vi.fn();
    renderWizard({ step: 'account', onStepSelect });
    await userEvent.click(screen.getByText('Starting point'));
    expect(onStepSelect).toHaveBeenCalledWith('start');
  });
});
