// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 1 — the starting point (45-onboarding.md §2, R3).
 *
 * The ruling this pins: Blank canvas is FIRST and is what a person gets by
 * pressing Continue without touching anything. The other four are the
 * generation intents that already exist — asserting their values here is what
 * stops the step from drifting into the comp's three imaginary templates.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import { DEFAULT_HELD_ANSWERS } from '../heldAnswers.js';
import { StartStep } from './StartStep.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('the starting point', () => {
  it('offers Blank canvas first, then the four real intents', () => {
    render(<StartStep value="blank" onChange={() => undefined} />);
    const names = screen.getAllByRole('radio').map((radio) => radio.textContent ?? '');
    expect(names).toHaveLength(5);
    expect(names[0]).toContain('Blank canvas');
    expect(names.join(' | ')).toContain('Full admin panel');
    expect(names.join(' | ')).toContain('Read-only analytics');
    expect(names.join(' | ')).toContain('CRUD tables');
    expect(names.join(' | ')).toContain('Support console');
  });

  it('defaults to Blank canvas — pressing Continue untouched generates nothing', () => {
    expect(DEFAULT_HELD_ANSWERS.start).toBe('blank');
    render(<StartStep value={DEFAULT_HELD_ANSWERS.start} onChange={() => undefined} />);
    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent ?? '').toContain('Blank canvas');
  });

  it('reports the intent value the generator understands, not the label', async () => {
    const onChange = vi.fn();
    render(<StartStep value="blank" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: /Read-only analytics/ }));
    expect(onChange).toHaveBeenCalledWith('read-only-analytics');
  });

  it('names the group for assistive tech — the step title is not inside the body', () => {
    render(<StartStep value="blank" onChange={() => undefined} />);
    expect(screen.getByRole('radiogroup', { name: 'What will you build first?' })).toBeDefined();
  });

  it('renders no heading of its own — the shell owns the title', () => {
    render(<StartStep value="blank" onChange={() => undefined} />);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
