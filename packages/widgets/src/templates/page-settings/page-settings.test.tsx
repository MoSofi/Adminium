// @vitest-environment happy-dom
/**
 * `page-settings` template (M7 reports/notifications track): the controlled
 * matrix truth (host rollback snaps a cell back), per-cell autosave firing
 * with the requested value, the saved-indicator choreography, the §8.2
 * unavailable-channel explanation (togglable, explained, never hidden), and
 * the manifest passing the §10 schema.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import pageSettingsManifest from '../page-settings.json' with { type: 'json' };
import { parsePageTemplate } from '../template-schema.js';
import {
  PageSettings,
  settingsCellId,
  type SettingsChannelDef,
  type SettingsEventDef,
} from './PageSettings.js';

const CHANNELS: SettingsChannelDef[] = [
  { id: 'inApp', label: 'In-app', available: true },
  { id: 'email', label: 'Email', available: false, reason: 'No SMTP in this build.' },
];

const EVENTS: SettingsEventDef[] = [
  { key: 'report.ready', label: 'Report ready', channels: { inApp: true, email: false } },
  { key: 'report.failed', label: 'Report failed', channels: { inApp: false, email: false } },
];

function cell(rowLabel: string, colLabel: string) {
  // ToggleMatrix cells are buttons named `${row.label} — ${column.label}`.
  const cells = screen.getAllByRole('button');
  return cells.find((el) => {
    const name = el.getAttribute('aria-label') ?? '';
    return name.includes(rowLabel) && name.includes(colLabel);
  });
}

describe('page-settings manifest', () => {
  it('passes the §10 schema with a required toggle-matrix slot', () => {
    const parsed = parsePageTemplate(pageSettingsManifest);
    expect(parsed.id).toBe('page-settings');
    const matrix = parsed.slots.find((slot) => slot.slot === 'matrix');
    expect(matrix?.required).toBe(true);
    expect(matrix?.accepts.widgets).toContain('toggle-matrix');
  });
});

describe('PageSettings', () => {
  it('renders the matrix from props and fires per-cell autosave with the next value', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <PageSettings channels={CHANNELS} events={EVENTS} onToggle={onToggle} testId="settings" />,
    );

    // Rows and columns are all present.
    expect(screen.getByText('Report ready')).toBeTruthy();
    expect(screen.getByText('Report failed')).toBeTruthy();

    const target = cell('Report failed', 'In-app');
    expect(target).toBeTruthy();
    await user.click(target as HTMLElement);
    // Off → requested next is TRUE, identified by event key + channel id.
    expect(onToggle).toHaveBeenCalledWith('report.failed', 'inApp', true);
  });

  it('is fully controlled: a host rollback visibly snaps the cell back', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PageSettings channels={CHANNELS} events={EVENTS} onToggle={() => undefined} />,
    );
    const before = cell('Report ready', 'In-app');
    expect(before?.getAttribute('aria-pressed')).toBe('true');

    await user.click(before as HTMLElement);
    // The template does NOT self-mutate — truth stays with the events prop…
    expect(cell('Report ready', 'In-app')?.getAttribute('aria-pressed')).toBe('true');

    // …so a host that applied optimistically and then rolled back just
    // re-renders with the old data and the cell is visually back.
    const flipped: SettingsEventDef[] = [
      { ...EVENTS[0] as SettingsEventDef, channels: { inApp: false, email: false } },
      EVENTS[1] as SettingsEventDef,
    ];
    rerender(<PageSettings channels={CHANNELS} events={flipped} onToggle={() => undefined} />);
    expect(cell('Report ready', 'In-app')?.getAttribute('aria-pressed')).toBe('false');
    rerender(<PageSettings channels={CHANNELS} events={EVENTS} onToggle={() => undefined} />);
    expect(cell('Report ready', 'In-app')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('walks the saved indicator through the autosave choreography', () => {
    const { rerender, container } = render(
      <PageSettings channels={CHANNELS} events={EVENTS} saveState={{ state: 'idle' }} />,
    );
    const indicator = () => container.querySelector('[data-part="saved-indicator"]');
    expect(indicator()?.getAttribute('data-state')).toBe('idle');

    rerender(<PageSettings channels={CHANNELS} events={EVENTS} saveState={{ state: 'saving' }} />);
    expect(indicator()?.getAttribute('data-state')).toBe('saving');
    expect(indicator()?.textContent).toContain('Saving');

    rerender(<PageSettings channels={CHANNELS} events={EVENTS} saveState={{ state: 'saved' }} />);
    expect(indicator()?.getAttribute('data-state')).toBe('saved');
    expect(indicator()?.textContent).toContain('Saved');

    rerender(
      <PageSettings
        channels={CHANNELS}
        events={EVENTS}
        saveState={{ state: 'error', message: 'Could not save.' }}
      />,
    );
    expect(indicator()?.getAttribute('data-state')).toBe('error');
    expect(indicator()?.textContent).toContain('Could not save.');
  });

  it('marks in-flight cells dirty via pendingCells', () => {
    const { container } = render(
      <PageSettings
        channels={CHANNELS}
        events={EVENTS}
        pendingCells={new Set([settingsCellId('report.ready', 'inApp')])}
      />,
    );
    // Exactly one dirty diff dot (ToggleMatrix renders it for dirty cells).
    const dirty = container.querySelectorAll('[data-dirty="true"]');
    expect(dirty.length).toBe(1);
  });

  it('explains an unavailable channel instead of hiding or locking it (§8.2)', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<PageSettings channels={CHANNELS} events={EVENTS} onToggle={onToggle} />);

    // The reason renders under the matrix…
    expect(screen.getByText(/No SMTP in this build/)).toBeTruthy();
    // …the column header carries the tag…
    expect(screen.getByText(/Email · Not available yet/)).toBeTruthy();
    // …and the cell still toggles: intent is stored, not blocked.
    const emailCell = cell('Report ready', 'Email');
    await user.click(emailCell as HTMLElement);
    expect(onToggle).toHaveBeenCalledWith('report.ready', 'email', true);
  });

  it('renders loading / error / empty shells', () => {
    const { rerender } = render(<PageSettings channels={[]} events={[]} status="loading" />);
    expect(screen.getByLabelText('Loading preferences')).toBeTruthy();

    const onRetry = vi.fn();
    rerender(
      <PageSettings channels={[]} events={[]} status="error" errorMessage="boom" onRetry={onRetry} />,
    );
    expect(screen.getByText('These settings failed to load')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();

    rerender(<PageSettings channels={CHANNELS} events={[]} />);
    expect(screen.getByText('Nothing to configure yet')).toBeTruthy();
  });
});
