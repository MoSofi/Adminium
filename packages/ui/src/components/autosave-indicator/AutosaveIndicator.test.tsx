// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AutosaveIndicator } from './AutosaveIndicator.js';

afterEach(cleanup);

const labels = { savingLabel: 'Saving…', savedLabel: 'All changes saved', errorLabel: "Couldn't save" };

describe('AutosaveIndicator', () => {
  it('is a polite live region across states', () => {
    render(<AutosaveIndicator status="saving" {...labels} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('Saving…')).toBeDefined();
  });

  it('transitions saving → saved → error → idle', () => {
    const { rerender } = render(<AutosaveIndicator status="saving" {...labels} />);
    expect(screen.getByText('Saving…')).toBeDefined();

    rerender(<AutosaveIndicator status="saved" {...labels} />);
    expect(screen.queryByText('Saving…')).toBeNull();
    expect(screen.getByText('All changes saved')).toBeDefined();

    rerender(<AutosaveIndicator status="error" {...labels} />);
    expect(screen.getByText("Couldn't save")).toBeDefined();

    rerender(<AutosaveIndicator status="idle" {...labels} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
