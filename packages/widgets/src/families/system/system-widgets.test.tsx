// @vitest-environment happy-dom
/**
 * TRACK FCS — `system` family unit tests (annex §12).
 *
 * The QA harness (qa/*) already proves the generic contracts for every
 * delivered widget: four WidgetFrame states, config-fuzz render safety,
 * demoData determinism, and chunk budget. These tests cover what is SPECIFIC to
 * this family's logic — the derivations a reviewer would want pinned:
 *   · worst-wins service aggregation (`status-banner-hero`)
 *   · the autosave phase precedence machine
 *   · log-line projection: tail-keeping, unknown-kind tolerance, pct derivation
 *   · the state-hero `stateMap` partial-override merge
 *   · payload-shape leniency (a malformed payload must not throw)
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AlertBannerWidget } from './AlertBanner.js';
import { AutosaveIndicatorWidget, autosaveStatusOf } from './AutosaveIndicatorWidget.js';
import { ConnectionStatusWidget } from './ConnectionStatus.js';
import { DiagnosticsReadoutWidget } from './DiagnosticsReadout.js';
import { ProgressLogConsoleWidget, logLinesOf, progressPctOf } from './ProgressLogConsole.js';
import { StateHeroWidget, resolveStateHeroEntry } from './StateHero.js';
import { StatusBannerHeroWidget } from './StatusBannerHero.js';
import { StatusPillWidget } from './StatusPill.js';
import { worstServiceState } from './system-lib.js';
import {
  alertBannerConfigSchema,
  autosaveIndicatorConfigSchema,
  connectionStatusConfigSchema,
  diagnosticsReadoutConfigSchema,
  progressLogConsoleConfigSchema,
  stateHeroConfigSchema,
  statusBannerHeroConfigSchema,
  statusPillConfigSchema,
} from './system-config.js';

afterEach(cleanup);

/** Schema defaults + overrides — the same projection WidgetHost performs. */
function cfg<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse(overrides);
}

const noop = () => {};

// ── status-banner-hero: worst-wins ─────────────────────────────────────────

describe('worstServiceState (annex §12)', () => {
  it('is "up" only when every service is up', () => {
    expect(worstServiceState(['up', 'up', 'up'])).toBe('up');
  });

  it('one degraded service degrades the whole hero', () => {
    expect(worstServiceState(['up', 'degraded', 'up'])).toBe('degraded');
  });

  it('down beats degraded regardless of order', () => {
    expect(worstServiceState(['degraded', 'down', 'up'])).toBe('down');
    expect(worstServiceState(['down', 'degraded'])).toBe('down');
  });

  it('an empty list is "up" (nothing is broken)', () => {
    expect(worstServiceState([])).toBe('up');
  });
});

describe('StatusBannerHeroWidget', () => {
  it('derives the hero state from the service list, not from a pre-computed field', () => {
    render(
      <StatusBannerHeroWidget
        config={cfg(statusBannerHeroConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ rows: [{ name: 'API', state: 'up' }, { name: 'Exports', state: 'down' }], total: 2 }}
      />,
    );
    // One row says "down" — the hero must not claim all-clear.
    expect(document.querySelector('[data-widget="status-banner-hero"]')?.getAttribute('data-state')).toBe('down');
    expect(screen.getByText('Major outage')).toBeTruthy();
  });

  it('renders only the KPI stats the payload actually carries', () => {
    render(
      <StatusBannerHeroWidget
        config={cfg(statusBannerHeroConfigSchema, {
          stats: [{ key: 'uptime', label: 'Uptime', unit: '%' }, { key: 'missing', label: 'Nope' }],
        })}
        instanceId="t"
        onEvent={noop}
        data={{ rows: [{ name: 'API', state: 'up', uptime: 99.9 }], total: 1 }}
      />,
    );
    expect(screen.getByText('Uptime')).toBeTruthy();
    expect(screen.queryByText('Nope')).toBeNull();
  });

  it('treats an unrecognised state value as "up" rather than crashing', () => {
    render(
      <StatusBannerHeroWidget
        config={cfg(statusBannerHeroConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ rows: [{ name: 'API', state: 'banana' }], total: 1 }}
      />,
    );
    expect(document.querySelector('[data-widget="status-banner-hero"]')?.getAttribute('data-state')).toBe('up');
  });
});

// ── autosave-indicator: phase precedence ───────────────────────────────────

describe('autosaveStatusOf (annex §12 cycle)', () => {
  it('reports idle with no state at all', () => {
    expect(autosaveStatusOf({})).toBe('idle');
  });

  it('reports saved once a savedAt stamp exists', () => {
    expect(autosaveStatusOf({ savedAt: 1 })).toBe('saved');
  });

  it('dirty beats saved', () => {
    expect(autosaveStatusOf({ dirty: true, savedAt: 1 })).toBe('dirty');
  });

  it('saving beats dirty — an in-flight save is the truer statement', () => {
    expect(autosaveStatusOf({ dirty: true, saving: true })).toBe('saving');
  });

  it('error beats everything — a silent data-loss state must be impossible', () => {
    expect(autosaveStatusOf({ dirty: true, saving: true, savedAt: 1, error: true })).toBe('error');
  });
});

describe('AutosaveIndicatorWidget', () => {
  it('shows the unsaved-changes pill while dirty', () => {
    render(
      <AutosaveIndicatorWidget
        config={cfg(autosaveIndicatorConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ row: { dirty: true, saving: false } }}
      />,
    );
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('stamps the saved time only in the saved phase', () => {
    const { container } = render(
      <AutosaveIndicatorWidget
        config={cfg(autosaveIndicatorConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ row: { dirty: false, saving: false, savedAt: Date.UTC(2026, 2, 17, 9, 15) } }}
      />,
    );
    expect(screen.getByText('All changes saved')).toBeTruthy();
    expect(container.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('omits the stamp when showStamp is off', () => {
    const { container } = render(
      <AutosaveIndicatorWidget
        config={cfg(autosaveIndicatorConfigSchema, { showStamp: false })}
        instanceId="t"
        onEvent={noop}
        data={{ row: { savedAt: Date.UTC(2026, 2, 17, 9, 15) } }}
      />,
    );
    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

// ── progress-log-console ───────────────────────────────────────────────────

describe('logLinesOf / progressPctOf (annex §12)', () => {
  const base = cfg(progressLogConsoleConfigSchema);

  it('keeps the TAIL when the payload exceeds maxLines (a long run ends interesting)', () => {
    const rows = Array.from({ length: 10 }, (_, n) => ({ text: `line ${n}`, kind: 'info' }));
    const lines = logLinesOf({ rows, total: 10 }, { ...base, maxLines: 3 });
    expect(lines.map((l) => l.text)).toEqual(['line 7', 'line 8', 'line 9']);
  });

  it('renders a line with an unrecognised kind as info rather than dropping it', () => {
    const lines = logLinesOf({ rows: [{ text: 'hi', kind: 'wat' }], total: 1 }, base);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe('info');
  });

  it('skips rows with no text (nothing to show)', () => {
    expect(logLinesOf({ rows: [{ kind: 'info' }], total: 1 }, base)).toHaveLength(0);
  });

  it('reads a stream snapshot as well as a record-list', () => {
    const lines = logLinesOf({ channel: 'runs:1', snapshot: [{ text: 'streamed', kind: 'ok' }] }, base);
    expect(lines[0]?.text).toBe('streamed');
  });

  it('takes the NEWEST pct that exists', () => {
    expect(progressPctOf([{ id: 'a', kind: 'ok', text: 'a', pct: 10 }, { id: 'b', kind: 'ok', text: 'b', pct: 60 }])).toBe(60);
  });

  it('falls back to a pct derived from completed lines when none carry one', () => {
    // 3 lines, 1 still running → 2/3 complete.
    expect(
      progressPctOf([
        { id: 'a', kind: 'ok', text: 'a' },
        { id: 'b', kind: 'ok', text: 'b' },
        { id: 'c', kind: 'running', text: 'c' },
      ]),
    ).toBeCloseTo(66.666, 1);
  });

  it('clamps an out-of-range pct instead of overflowing the bar', () => {
    expect(progressPctOf([{ id: 'a', kind: 'ok', text: 'a', pct: 250 }])).toBe(100);
  });

  it('is 0 for no lines', () => {
    expect(progressPctOf([])).toBe(0);
  });
});

describe('ProgressLogConsoleWidget', () => {
  it('renders lines with their kind exposed for styling/VRT', () => {
    render(
      <ProgressLogConsoleWidget
        config={cfg(progressLogConsoleConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ rows: [{ text: 'Connected', kind: 'ok' }, { text: 'PII detected', kind: 'warn' }], total: 2 }}
      />,
    );
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(document.querySelector('[data-part="log-line"][data-kind="warn"]')).toBeTruthy();
  });

  it('exposes the log as a polite live region (never interrupts on append)', () => {
    render(
      <ProgressLogConsoleWidget
        config={cfg(progressLogConsoleConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ rows: [{ text: 'x', kind: 'info' }], total: 1 }}
      />,
    );
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });

  it('renders its own empty copy with no lines', () => {
    render(
      <ProgressLogConsoleWidget
        config={cfg(progressLogConsoleConfigSchema, { emptyTitle: 'Nothing yet' })}
        instanceId="t"
        onEvent={noop}
        data={{ rows: [], total: 0 }}
      />,
    );
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });

  it('does not throw when scrollIntoView is unavailable (happy-dom / older engines)', () => {
    // The follow effect optional-calls it; prove the guard, not the browser.
    const original = Element.prototype.scrollIntoView;
    // @ts-expect-error — deliberately removing the API to exercise the guard.
    delete Element.prototype.scrollIntoView;
    expect(() =>
      render(
        <ProgressLogConsoleWidget
          config={cfg(progressLogConsoleConfigSchema, { follow: true })}
          instanceId="t"
          onEvent={noop}
          data={{ rows: [{ text: 'x', kind: 'info' }], total: 1 }}
        />,
      ),
    ).not.toThrow();
    Element.prototype.scrollIntoView = original;
  });
});

// ── state-hero ─────────────────────────────────────────────────────────────

describe('resolveStateHeroEntry (annex §12 stateMap)', () => {
  it('returns the built-in entry when config overrides nothing', () => {
    expect(resolveStateHeroEntry('404', undefined).code).toBe('404');
  });

  it('merges a PARTIAL override over the built-in rest', () => {
    const entry = resolveStateHeroEntry('404', { '404': { title: 'Nope', tone: 'danger' } });
    expect(entry.title).toBe('Nope');
    expect(entry.tone).toBe('danger');
    // Untouched fields survive the merge.
    expect(entry.code).toBe('404');
    expect(entry.primaryLabel).toBe('Back to dashboard');
  });
});

describe('StateHeroWidget', () => {
  it('lets the bound payload steer which view renders', () => {
    render(
      <StateHeroWidget
        config={cfg(stateHeroConfigSchema, { view: '404' })}
        instanceId="t"
        onEvent={noop}
        data={{ row: { view: 'conn-error' } }}
      />,
    );
    expect(document.querySelector('[data-widget="state-hero"]')?.getAttribute('data-state')).toBe('conn-error');
  });

  it('falls back to the config view for an unknown payload value', () => {
    render(
      <StateHeroWidget
        config={cfg(stateHeroConfigSchema, { view: 'maintenance' })}
        instanceId="t"
        onEvent={noop}
        data={{ row: { view: 'not-a-view' } }}
      />,
    );
    expect(document.querySelector('[data-widget="state-hero"]')?.getAttribute('data-state')).toBe('maintenance');
  });

  it('routes CTAs through onEvent — the widget never navigates itself', () => {
    const onEvent = vi.fn();
    render(
      <StateHeroWidget config={cfg(stateHeroConfigSchema, { view: '404' })} instanceId="t" onEvent={onEvent} data={{}} />,
    );
    fireEvent.click(screen.getByText('Back to dashboard'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/' });
  });

  it('emits drill-through for a quick-link chip', () => {
    const onEvent = vi.fn();
    render(
      <StateHeroWidget
        config={cfg(stateHeroConfigSchema, { view: '404', quickLinks: [{ label: 'Orders', href: '/orders' }] })}
        instanceId="t"
        onEvent={onEvent}
        data={{}}
      />,
    );
    fireEvent.click(screen.getByText('Orders'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/orders' });
  });
});

// ── status-pill ────────────────────────────────────────────────────────────

describe('StatusPillWidget', () => {
  it('uses the shared statusTone vocabulary with no config map', () => {
    render(
      <StatusPillWidget config={cfg(statusPillConfigSchema)} instanceId="t" onEvent={noop} data={{ row: { status: 'paid' } }} />,
    );
    expect(document.querySelector('[data-widget="status-pill"]')?.getAttribute('data-tone')).toBe('pos');
  });

  it('a config map overrides both label and tone', () => {
    render(
      <StatusPillWidget
        config={cfg(statusPillConfigSchema, { map: { churned: { label: 'Churned out', tone: 'danger' } } })}
        instanceId="t"
        onEvent={noop}
        data={{ row: { status: 'churned' } }}
      />,
    );
    expect(screen.getByText('Churned out')).toBeTruthy();
    expect(document.querySelector('[data-widget="status-pill"]')?.getAttribute('data-tone')).toBe('danger');
  });

  it('renders an unmapped enum readably rather than blank', () => {
    render(
      <StatusPillWidget
        config={cfg(statusPillConfigSchema, { fallbackTone: 'info' })}
        instanceId="t"
        onEvent={noop}
        data={{ row: { status: 'bespoke-state' } }}
      />,
    );
    expect(screen.getByText('bespoke-state')).toBeTruthy();
    expect(document.querySelector('[data-widget="status-pill"]')?.getAttribute('data-tone')).toBe('info');
  });

  it('renders nothing when the bound field is absent', () => {
    const { container } = render(
      <StatusPillWidget config={cfg(statusPillConfigSchema)} instanceId="t" onEvent={noop} data={{ row: {} }} />,
    );
    expect(container.querySelector('[data-widget="status-pill"]')).toBeNull();
  });
});

// ── alert-banner ───────────────────────────────────────────────────────────

describe('AlertBannerWidget', () => {
  it('maps a severity value onto an Alert tone', () => {
    render(
      <AlertBannerWidget
        config={cfg(alertBannerConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ row: { severity: 'critical', message: 'Over limit' } }}
      />,
    );
    expect(document.querySelector('[data-widget="alert-banner"]')?.getAttribute('data-tone')).toBe('danger');
  });

  it('leads with the stat and demotes the message to the body', () => {
    render(
      <AlertBannerWidget
        config={cfg(alertBannerConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ row: { severity: 'warn', lead: '92% disk used', message: 'Approaching capacity.' } }}
      />,
    );
    expect(screen.getByText('92% disk used')).toBeTruthy();
    expect(screen.getByText('Approaching capacity.')).toBeTruthy();
  });

  it('drops a CTA that has nowhere to go', () => {
    render(
      <AlertBannerWidget
        config={cfg(alertBannerConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ row: { severity: 'info', message: 'FYI', ctaLabel: 'Do it' } }}
      />,
    );
    expect(screen.queryByText('Do it')).toBeNull();
  });

  it('emits drill-through from the CTA when an href exists', () => {
    const onEvent = vi.fn();
    render(
      <AlertBannerWidget
        config={cfg(alertBannerConfigSchema)}
        instanceId="t"
        onEvent={onEvent}
        data={{ row: { severity: 'warn', message: 'Over capacity', ctaLabel: 'Free up space', ctaHref: '/settings/storage' } }}
      />,
    );
    fireEvent.click(screen.getByText('Free up space'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/settings/storage' });
  });

  it('dismisses when dismissible', () => {
    render(
      <AlertBannerWidget
        config={cfg(alertBannerConfigSchema, { dismissible: true, dismissLabel: 'Dismiss' })}
        instanceId="t"
        onEvent={noop}
        data={{ row: { severity: 'info', message: 'FYI' } }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(document.querySelector('[data-widget="alert-banner"]')).toBeNull();
  });
});

// ── connection-status ──────────────────────────────────────────────────────

describe('ConnectionStatusWidget', () => {
  it('renders the bound state and host', () => {
    render(
      <ConnectionStatusWidget
        config={cfg(connectionStatusConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ row: { state: 'connected', host: 'db:5432', detail: '14 tables detected' } }}
      />,
    );
    expect(document.querySelector('[data-widget="connection-status"]')?.getAttribute('data-state')).toBe('connected');
    expect(screen.getByText('db:5432')).toBeTruthy();
    expect(screen.getByText('14 tables detected')).toBeTruthy();
  });

  it('hides the Test action on an UNBOUND instance — there is nowhere to send the intent', () => {
    render(
      <ConnectionStatusWidget
        config={cfg(connectionStatusConfigSchema, { testable: true })}
        instanceId="t"
        onEvent={noop}
        data={{ row: { state: 'idle' } }}
      />,
    );
    expect(document.querySelector('[data-part="connection-test"]')).toBeNull();
  });

  it('emits a mutate intent from Test on a bound instance', () => {
    const onEvent = vi.fn();
    render(
      <ConnectionStatusWidget
        config={cfg(connectionStatusConfigSchema, {
          testable: true,
          testLabel: 'Test',
          binding: { connectionId: 'c1', source: { schema: 'public', name: 'conns' }, shape: 'record' },
        })}
        instanceId="t"
        onEvent={onEvent}
        data={{ row: { state: 'failed' } }}
      />,
    );
    fireEvent.click(screen.getByText('Test'));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'update', connectionId: 'c1', table: 'public.conns' }),
    );
  });

  it('disables Test while a probe is already in flight', () => {
    render(
      <ConnectionStatusWidget
        config={cfg(connectionStatusConfigSchema, {
          testable: true,
          testLabel: 'Test',
          binding: { connectionId: 'c1', source: { name: 'conns' }, shape: 'record' },
        })}
        instanceId="t"
        onEvent={noop}
        data={{ row: { state: 'connecting' } }}
      />,
    );
    expect(screen.getByText('Test').closest('button')?.disabled).toBe(true);
  });
});

// ── diagnostics-readout ────────────────────────────────────────────────────

describe('DiagnosticsReadoutWidget', () => {
  it('tones a check value through its map', () => {
    render(
      <DiagnosticsReadoutWidget
        config={cfg(diagnosticsReadoutConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ row: { tcp: 'Refused', checkedAt: Date.UTC(2026, 2, 17, 9, 15) } }}
      />,
    );
    expect(document.querySelector('[data-check="tcp"]')?.getAttribute('data-tone')).toBe('danger');
  });

  it('omits checks the payload did not answer (blank rows read as broken)', () => {
    render(
      <DiagnosticsReadoutWidget
        config={cfg(diagnosticsReadoutConfigSchema)}
        instanceId="t"
        onEvent={noop}
        data={{ row: { tcp: 'Reachable' } }}
      />,
    );
    expect(document.querySelector('[data-check="tcp"]')).toBeTruthy();
    expect(document.querySelector('[data-check="tls"]')).toBeNull();
  });

  it('renders the last-checked stamp', () => {
    const { container } = render(
      <DiagnosticsReadoutWidget
        config={cfg(diagnosticsReadoutConfigSchema, { checkedAtLabel: 'Checked' })}
        instanceId="t"
        onEvent={noop}
        data={{ row: { tcp: 'Reachable', checkedAt: Date.UTC(2026, 2, 17, 9, 15) } }}
      />,
    );
    expect(container.textContent).toContain('Checked');
    expect(container.textContent).toMatch(/\d{1,2}:\d{2}/);
  });
});

// ── payload leniency (04 §3) ───────────────────────────────────────────────

describe('malformed payloads never throw into the error boundary', () => {
  const cases: [string, unknown][] = [
    ['null', null],
    ['a string', 'nope'],
    ['an array', [1, 2, 3]],
    ['a number', 42],
    ['an empty object', {}],
    ['rows of nonsense', { rows: [null, 'x', 3], total: 3 }],
  ];

  for (const [label, data] of cases) {
    it(`status-pill tolerates ${label}`, () => {
      expect(() =>
        render(<StatusPillWidget config={cfg(statusPillConfigSchema)} instanceId="t" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`progress-log-console tolerates ${label}`, () => {
      expect(() =>
        render(
          <ProgressLogConsoleWidget
            config={cfg(progressLogConsoleConfigSchema)}
            instanceId="t"
            onEvent={noop}
            data={data}
          />,
        ),
      ).not.toThrow();
    });

    it(`status-banner-hero tolerates ${label}`, () => {
      expect(() =>
        render(
          <StatusBannerHeroWidget
            config={cfg(statusBannerHeroConfigSchema)}
            instanceId="t"
            onEvent={noop}
            data={data}
          />,
        ),
      ).not.toThrow();
    });

    it(`diagnostics-readout tolerates ${label}`, () => {
      expect(() =>
        render(
          <DiagnosticsReadoutWidget
            config={cfg(diagnosticsReadoutConfigSchema)}
            instanceId="t"
            onEvent={noop}
            data={data}
          />,
        ),
      ).not.toThrow();
    });
  }
});
