// @vitest-environment happy-dom
/**
 * TRACK OPS unit tests (annex §13) — the eighteen ops / billing / API /
 * marketing cards that close the annex catalog.
 *
 * SCOPE. The central QA harness already runs the four-state, determinism,
 * config-fuzz and registry-parity gates over every entry in `qa/delivered.ts`,
 * so this suite does NOT re-assert them generically. It covers what is specific
 * to this slice and would otherwise go untested:
 *
 *   - THE CLOCK CONTRACT, which is the one thing most likely to rot here: the
 *     stopwatch's `timerSeconds` algebra, and the invariant that a PINNED
 *     `format.referenceTime` makes `live-timer` render without ever starting an
 *     interval or reading the wall clock. Asserted by spying on `Date.now` and
 *     `setInterval` — a test that only checked the rendered string would pass
 *     happily while the component ticked in the background.
 *   - REGISTRY METADATA (acceptance #1): the exact eighteen ids, family, the
 *     annex sizing in half-units, and the declared contracts — including the
 *     `['<shape>', 'static']` pairs, whose whole purpose is to stop the frame
 *     emptying a legitimate config-only instance.
 *   - NEVER WRITES (04 §2.1): every affordance emits an intent through
 *     `onEvent`, and an UNBOUND widget offers no write affordance at all.
 *   - `minSeconds` (annex): a too-short run is DISCARDED but still resets the
 *     stopwatch — the case where "discard" and "reset" are easy to conflate.
 *   - the security-shaped bits: the panel never renders a plaintext secret for a
 *     secret-kind key, and the card tile never renders more than the last four.
 *   - the LTR islands and the RTL-mirroring contract.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiKeysPanelWidget } from './ApiKeysPanel.js';
import { CreditCardTileWidget } from './CreditCardTile.js';
import { LiveTimerWidget, SyncStatusCardWidget, timerSeconds } from './OpsMonitoring.js';
import {
  CodeSnippetBlockWidget,
  ResourceApiCardWidget,
  WebhookEndpointsListWidget,
} from './OpsApi.js';
import {
  IpAllowlistCardWidget,
  PolicyListWidget,
  TestimonialCardWidget,
  TrustBadgesWidget,
} from './OpsTrust.js';
import { OnboardingChecklistWidget, StarterTemplatePickerWidget } from './OpsOnboarding.js';
import { SloMonitorCardWidget } from './SloMonitorCard.js';
import {
  OPS_DEMO_NOW_MS,
  apiKeysPanelConfigSchema,
  apiKeysPanelDemoData,
  codeSnippetBlockConfigSchema,
  creditCardTileConfigSchema,
  ipAllowlistCardConfigSchema,
  liveTimerConfigSchema,
  liveTimerDemoData,
  onboardingChecklistConfigSchema,
  policyListConfigSchema,
  resourceApiCardConfigSchema,
  sloMonitorCardConfigSchema,
  starterTemplatePickerConfigSchema,
  starterTemplatePickerDemoData,
  syncStatusCardConfigSchema,
  syncStatusCardDemoData,
  testimonialCardConfigSchema,
  testimonialCardDemoData,
  trustBadgesConfigSchema,
  webhookEndpointsListConfigSchema,
} from './domain-ops-config.js';
import { domainOpsTrackDefinitions } from './domain-ops-track.definitions.js';
import type { TimerState } from './domain-ops-types.js';

afterEach(cleanup);

/**
 * Build a widget config THROUGH its own schema, exactly as the registry does.
 * These widgets read their field names (`nameField`, `statusField`, …) from
 * config, and those names are schema DEFAULTS — hand-rolling a config bag would
 * silently hand the component `undefined` for every field and test a shape
 * production never sees.
 */
const cfg = <T,>(schema: { parse: (input: unknown) => T }, extra: Record<string, unknown> = {}): never =>
  schema.parse(extra) as never;

const noop = (): void => {};

/**
 * A bound instance — the presence of `binding` is what unlocks write affordances.
 * It goes through `queryDescriptorSchema`, so `shape` is REQUIRED: a descriptor
 * without one does not parse, and the widget would silently see `binding:
 * undefined` and render as unbound — i.e. the test would assert the opposite of
 * what it means to.
 */
const BINDING = {
  connectionId: 'conn-1',
  source: { schema: 'public', name: 'things' },
  shape: 'record-list' as const,
};

// ============================================================================
// timerSeconds — the stopwatch algebra (pure, the tick re-invokes it)
// ============================================================================

describe('timerSeconds', () => {
  const base: TimerState = { taskName: 'T', running: false, elapsed: 90 };

  it('returns the paused total when stopped, ignoring startedAt', () => {
    expect(timerSeconds(base, OPS_DEMO_NOW_MS)).toBe(90);
    expect(timerSeconds({ ...base, startedAt: OPS_DEMO_NOW_MS - 60_000 }, OPS_DEMO_NOW_MS)).toBe(90);
  });

  it('adds the current run to the paused total while running', () => {
    const state: TimerState = { ...base, running: true, startedAt: OPS_DEMO_NOW_MS - 30_000 };
    expect(timerSeconds(state, OPS_DEMO_NOW_MS)).toBe(120);
  });

  it('is pure in `now` — the same state at the same instant is always the same number', () => {
    const state: TimerState = { ...base, running: true, startedAt: OPS_DEMO_NOW_MS - 30_000 };
    expect(timerSeconds(state, OPS_DEMO_NOW_MS)).toBe(timerSeconds(state, OPS_DEMO_NOW_MS));
  });

  /**
   * Clock skew between the DB and the browser is real. Without the floor, a
   * `startedAt` an hour in the future subtracts from the paused total and the
   * stopwatch renders running BACKWARDS.
   */
  it('never runs backwards on a future startedAt (clock skew)', () => {
    const skewed: TimerState = { ...base, running: true, startedAt: OPS_DEMO_NOW_MS + 3_600_000 };
    expect(timerSeconds(skewed, OPS_DEMO_NOW_MS)).toBe(90);
  });

  it('clamps a negative paused total to zero', () => {
    expect(timerSeconds({ ...base, elapsed: -5 }, OPS_DEMO_NOW_MS)).toBe(0);
  });
});

// ============================================================================
// live-timer — the clock contract (04 §7.7 / the determinism gate)
// ============================================================================

describe('live-timer clock contract', () => {
  const runningRow = {
    row: { task_name: 'Schema review', project: 'Adminium', running: true, elapsed_sec: 60, started_at: OPS_DEMO_NOW_MS - 30_000 },
  };

  /**
   * THE load-bearing assertion of this slice. A pinned `referenceTime` means the
   * readout must be a pure function of config + data — so the component must not
   * read the wall clock OR schedule a tick. A test that only asserted the
   * rendered string would pass while the component ticked every second in the
   * background, leaking timers into every case that mounts it.
   */
  it('reads no wall clock and starts no interval when referenceTime is pinned', () => {
    const now = vi.spyOn(Date, 'now');
    const interval = vi.spyOn(globalThis, 'setInterval');

    render(
      <LiveTimerWidget
        config={cfg(liveTimerConfigSchema, { format: { referenceTime: OPS_DEMO_NOW_MS } })}
        data={runningRow}
        instanceId="t1"
        onEvent={noop}
      />,
    );

    // The widget really did render — otherwise "no clock read" would be
    // vacuously true for a component that never ran.
    expect(screen.getByText('Schema review')).toBeTruthy();
    expect(now).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();

    now.mockRestore();
    interval.mockRestore();
  });

  it('renders the pinned elapsed value — 60s paused + 30s of run = 1:30', () => {
    render(
      <LiveTimerWidget
        config={cfg(liveTimerConfigSchema, { format: { locale: 'en-US', referenceTime: OPS_DEMO_NOW_MS } })}
        data={runningRow}
        instanceId="t2"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('1:30')).toBeTruthy();
  });

  /** Unpinned + running is the only case that may tick. */
  it('starts the 1s interval only when unpinned AND running', () => {
    const interval = vi.spyOn(globalThis, 'setInterval');

    const { unmount } = render(
      <LiveTimerWidget config={cfg(liveTimerConfigSchema)} data={runningRow} instanceId="t3" onEvent={noop} />,
    );
    expect(interval).toHaveBeenCalled();
    unmount();
    interval.mockClear();

    // Stopped and unpinned: the readout cannot change, so ticking it would be
    // pure wakeups for an unchanging number.
    render(
      <LiveTimerWidget
        config={cfg(liveTimerConfigSchema)}
        data={{ row: { task_name: 'T', running: false, elapsed_sec: 10 } }}
        instanceId="t4"
        onEvent={noop}
      />,
    );
    expect(interval).not.toHaveBeenCalled();
    interval.mockRestore();
  });

  it('demoData is byte-identical across runs and varies by seed', () => {
    expect(liveTimerDemoData(7)).toEqual(liveTimerDemoData(7));
    expect(JSON.stringify(liveTimerDemoData(7))).not.toBe(JSON.stringify(liveTimerDemoData(8)));
  });
});

// ============================================================================
// live-timer — never writes; minSeconds discards but still resets
// ============================================================================

describe('live-timer intents', () => {
  const pinned = { format: { referenceTime: OPS_DEMO_NOW_MS } };

  it('emits an insert for the entry and an update to reset, when the run is long enough', () => {
    const onEvent = vi.fn();
    render(
      <LiveTimerWidget
        config={cfg(liveTimerConfigSchema, { ...pinned, binding: BINDING, minSeconds: 60 })}
        data={{ row: { task_name: 'Schema review', project: 'Adminium', running: true, elapsed_sec: 300, started_at: OPS_DEMO_NOW_MS } }}
        instanceId="t5"
        onEvent={onEvent}
      />,
    );

    fireEvent.click(screen.getByText('Stop'));

    const [insert, reset] = onEvent.mock.calls.map((call) => call[0] as Record<string, unknown>);
    expect(insert).toMatchObject({
      type: 'mutate',
      intent: 'insert',
      connectionId: 'conn-1',
      // The binding descriptor names the table at `source.name` (+ schema).
      table: 'public.things',
      values: { task_name: 'Schema review', project: 'Adminium', elapsed_sec: 300, billable: true },
    });
    expect(reset).toMatchObject({ type: 'mutate', intent: 'update', values: { running: false, elapsed_sec: 0 } });
  });

  /**
   * The annex's `minSeconds`. A mis-click that logs a 2-second entry is noise the
   * user then has to clean up — but the stopwatch must still reset, or it sticks
   * on forever. "Discard" and "reset" are separate outcomes.
   */
  it('discards a run shorter than minSeconds but STILL resets the stopwatch', () => {
    const onEvent = vi.fn();
    render(
      <LiveTimerWidget
        config={cfg(liveTimerConfigSchema, { ...pinned, binding: BINDING, minSeconds: 60 })}
        data={{ row: { task_name: 'Oops', running: true, elapsed_sec: 2, started_at: OPS_DEMO_NOW_MS } }}
        instanceId="t6"
        onEvent={onEvent}
      />,
    );

    fireEvent.click(screen.getByText('Stop'));

    const intents = onEvent.mock.calls.map((call) => call[0] as { intent: string });
    expect(intents.map((i) => i.intent)).toEqual(['update']);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ values: { running: false, elapsed_sec: 0 } }));
  });

  /** Unbound: there is nowhere to send the intent, so no affordance is offered. */
  it('renders no start/stop control when unbound', () => {
    render(
      <LiveTimerWidget
        config={cfg(liveTimerConfigSchema, pinned)}
        data={{ row: { task_name: 'T', running: true, elapsed_sec: 5, started_at: OPS_DEMO_NOW_MS } }}
        instanceId="t7"
        onEvent={noop}
      />,
    );
    expect(screen.queryByText('Stop')).toBeNull();
    expect(screen.queryByText('Start')).toBeNull();
  });
});

// ============================================================================
// api-keys-panel — masking (a security-shaped invariant)
// ============================================================================

describe('api-keys-panel masking', () => {
  const pinned = { format: { referenceTime: OPS_DEMO_NOW_MS } };

  it('masks a secret key until revealed, and never masks a publishable one', () => {
    render(
      <ApiKeysPanelWidget
        config={cfg(apiKeysPanelConfigSchema, pinned)}
        data={{
          rows: [
            { id: 'k1', name: 'Prod', env: 'live', prefix: 'sk_live_', tail: 'a1b2', scopes: ['read'], kind: 'secret' },
            { id: 'k2', name: 'Web', env: 'live', prefix: 'pk_live_', tail: 'c3d4', scopes: ['read'], kind: 'publishable' },
          ],
          total: 2,
        }}
        instanceId="k1"
        onEvent={noop}
      />,
    );

    const secret = document.querySelector('[data-key="k1"] [data-part="api-key-value"]');
    const publishable = document.querySelector('[data-key="k2"] [data-part="api-key-value"]');

    // The secret shows prefix + bullets + tail — never the middle.
    expect(secret?.textContent).toBe('sk_live_••••••••••••a1b2');
    expect(secret?.hasAttribute('data-masked')).toBe(true);
    // Publishable keys are not secret; masking them is theatre.
    expect(publishable?.textContent).toBe('pk_live_c3d4');
    expect(publishable?.hasAttribute('data-masked')).toBe(false);

    fireEvent.click(screen.getByLabelText('Reveal key'));
    expect(document.querySelector('[data-key="k1"] [data-part="api-key-value"]')?.textContent).toBe('sk_live_a1b2');
  });

  /**
   * The bullet run is a FIXED width, not the secret's real length — a
   * proportional run leaks how long the key is.
   */
  it('uses a fixed bullet run regardless of the key', () => {
    render(
      <ApiKeysPanelWidget
        config={cfg(apiKeysPanelConfigSchema, pinned)}
        data={{ rows: apiKeysPanelDemoData(7).rows, total: apiKeysPanelDemoData(7).total }}
        instanceId="k2"
        onEvent={noop}
      />,
    );
    const masked = [...document.querySelectorAll('[data-part="api-key-value"][data-masked]')];
    expect(masked.length).toBeGreaterThan(0);
    for (const node of masked) {
      expect((node.textContent ?? '').match(/•+/)?.[0]).toBe('•'.repeat(12));
    }
  });

  it('offers roll/revoke only when bound', () => {
    const data = { rows: [{ id: 'k1', name: 'Prod', env: 'live', prefix: 'sk_', tail: 'a1', scopes: [], kind: 'secret' }], total: 1 };

    const { unmount } = render(
      <ApiKeysPanelWidget config={cfg(apiKeysPanelConfigSchema, pinned)} data={data} instanceId="k3" onEvent={noop} />,
    );
    expect(screen.queryByLabelText('Revoke key')).toBeNull();
    unmount();

    const onEvent = vi.fn();
    render(
      <ApiKeysPanelWidget
        config={cfg(apiKeysPanelConfigSchema, { ...pinned, binding: BINDING })}
        data={data}
        instanceId="k4"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByLabelText('Revoke key'));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'delete', table: 'public.things', recordId: 'k1' }),
    );
  });
});

// ============================================================================
// credit-card-tile — never renders more than the last four
// ============================================================================

describe('credit-card-tile masking', () => {
  it('renders only the last four digits, in the brand grouping', () => {
    render(
      <CreditCardTileWidget
        config={cfg(creditCardTileConfigSchema)}
        data={{ row: { brand: 'visa', last4: '4242', holder: 'A. REYES', exp: '04/28', is_default: true } }}
        instanceId="c1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('•••• •••• •••• 4242')).toBeTruthy();
  });

  it('uses the amex 4-6-5 grouping for amex', () => {
    render(
      <CreditCardTileWidget
        config={cfg(creditCardTileConfigSchema)}
        data={{ row: { brand: 'amex', last4: '0005', holder: 'R. CHO', exp: '08/29', is_default: false } }}
        instanceId="c2"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('•••• •••••• •0005')).toBeTruthy();
  });
});

// ============================================================================
// toggles never write — webhook-endpoints-list / policy-list
// ============================================================================

describe('toggle widgets never write', () => {
  it('webhook-endpoints-list emits an update intent when bound', () => {
    const onEvent = vi.fn();
    render(
      <WebhookEndpointsListWidget
        config={cfg(webhookEndpointsListConfigSchema, { binding: BINDING, format: { referenceTime: OPS_DEMO_NOW_MS } })}
        data={{ rows: [{ id: 'wh0', event: 'orders.insert', url: 'https://x.dev/h', enabled: false }], total: 1 }}
        instanceId="w1"
        onEvent={onEvent}
      />,
    );

    fireEvent.click(screen.getByLabelText('orders.insert'));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'update', recordId: 'wh0', values: { enabled: true } }),
    );
  });

  /** Unbound: the toggle must not lie about a state it cannot persist. */
  it('renders a DISABLED toggle when unbound', () => {
    render(
      <WebhookEndpointsListWidget
        config={cfg(webhookEndpointsListConfigSchema, { format: { referenceTime: OPS_DEMO_NOW_MS } })}
        data={{ rows: [{ id: 'wh0', event: 'orders.insert', url: 'https://x.dev/h', enabled: true }], total: 1 }}
        instanceId="w2"
        onEvent={noop}
      />,
    );
    expect(screen.getByLabelText('orders.insert').hasAttribute('disabled')).toBe(true);
  });

  it('policy-list emits an update intent and uppercases the command for the tone map', () => {
    const onEvent = vi.fn();
    render(
      <PolicyListWidget
        config={cfg(policyListConfigSchema, { binding: BINDING })}
        // Lowercase `cmd`, as a pg catalog returns it.
        data={{ rows: [{ id: 'p0', name: 'Members read', cmd: 'select', role: 'member', enabled: true }], total: 1 }}
        instanceId="p1"
        onEvent={onEvent}
      />,
    );

    expect(screen.getByText('SELECT')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Members read'));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'update', recordId: 'p0', values: { enabled: false } }),
    );
  });
});

// ============================================================================
// sync-status-card / starter picker / checklist intents
// ============================================================================

describe('ops intents', () => {
  it('sync-status-card emits a sync intent only when bound', () => {
    const { unmount } = render(
      <SyncStatusCardWidget
        config={cfg(syncStatusCardConfigSchema)}
        data={syncStatusCardDemoData(7)}
        instanceId="s1"
        onEvent={noop}
      />,
    );
    expect(screen.queryByText('Sync now')).toBeNull();
    unmount();

    const onEvent = vi.fn();
    render(
      <SyncStatusCardWidget
        config={cfg(syncStatusCardConfigSchema, { binding: BINDING })}
        data={syncStatusCardDemoData(7)}
        instanceId="s2"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByText('Sync now'));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'update', values: { phase: 'syncing' } }),
    );
  });

  it('starter-template-picker seeds a doc, and the blank tile carries no starter id', () => {
    const onEvent = vi.fn();
    render(
      <StarterTemplatePickerWidget
        config={cfg(starterTemplatePickerConfigSchema, { binding: BINDING, docType: 'invoice' })}
        data={starterTemplatePickerDemoData(7)}
        instanceId="sp1"
        onEvent={onEvent}
      />,
    );

    fireEvent.click(screen.getByText('Standard invoice'));
    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'insert', values: { docType: 'invoice', starterId: 'st-standard' } }),
    );

    fireEvent.click(screen.getByText('Blank'));
    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'insert', values: { docType: 'invoice' } }),
    );
  });

  /** `showBlank` alone is not content — a picker with only the ghost tile is empty. */
  it('starter-template-picker empty-states when only the blank tile would render', () => {
    render(
      <StarterTemplatePickerWidget
        config={cfg(starterTemplatePickerConfigSchema, { showBlank: true })}
        data={{ rows: [], total: 0 }}
        instanceId="sp2"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('No starters')).toBeTruthy();
    expect(document.querySelector('[data-blank]')).toBeNull();
  });

  it('onboarding-checklist ticks through an intent and drill-throughs on the CTA', () => {
    const onEvent = vi.fn();
    render(
      <OnboardingChecklistWidget
        config={cfg(onboardingChecklistConfigSchema, {
          binding: BINDING,
          tasks: [{ id: 'connect', title: 'Connect a database', action: 'Connect', href: '/studio/connect', done: false }],
        })}
        data={undefined}
        instanceId="o1"
        onEvent={onEvent}
      />,
    );

    fireEvent.click(screen.getByLabelText('Connect a database'));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mutate', intent: 'update', recordId: 'connect', values: { done: true } }),
    );

    fireEvent.click(screen.getByText('Connect'));
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'drill-through', href: '/studio/connect' });
  });

  /**
   * The CTA needs no binding — an href is a route, not a table write. Ticking a
   * step does need one, which is why the two are gated separately.
   */
  it('onboarding-checklist drill-throughs while unbound, but offers no tick', () => {
    const onEvent = vi.fn();
    render(
      <OnboardingChecklistWidget
        config={cfg(onboardingChecklistConfigSchema, {
          tasks: [{ id: 'connect', title: 'Connect a database', action: 'Connect', href: '/studio/connect', done: false }],
        })}
        data={undefined}
        instanceId="o2"
        onEvent={onEvent}
      />,
    );

    expect((screen.getByLabelText('Connect a database') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Connect'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/studio/connect' });
  });

  it('onboarding-checklist recomputes progress from the same done/total on every render', () => {
    render(
      <OnboardingChecklistWidget
        config={cfg(onboardingChecklistConfigSchema, { format: { locale: 'en-US' } })}
        data={{
          rows: [
            { id: 'a', title: 'A', done: true },
            { id: 'b', title: 'B', done: true },
            { id: 'c', title: 'C', done: false },
            { id: 'd', title: 'D', done: false },
          ],
          total: 4,
        }}
        instanceId="o3"
        onEvent={noop}
      />,
    );
    /*
      The ring, the bar's accessible label and the text all derive from the SAME
      done/total — which is why "2 of 4 done" legitimately appears more than once
      and each readout is queried by its own part rather than by text.
    */
    expect(document.querySelector('[data-part="checklist-progress"]')?.textContent).toBe('2 of 4 done');
    expect(document.querySelector('[data-part="checklist-gauge"]')?.getAttribute('data-pct')).toBe('50');
    expect(document.querySelector('[data-part="checklist-gauge"] title')?.textContent).toBe('2 of 4 done');
    expect(document.querySelector('[data-part="checklist-pct"]')?.textContent).toBe('50%');
  });

  it('onboarding-checklist celebrates at 100% when configured', () => {
    render(
      <OnboardingChecklistWidget
        config={cfg(onboardingChecklistConfigSchema, { celebrateOnComplete: true, celebrateTitle: 'All done' })}
        data={{ rows: [{ id: 'a', title: 'A', done: true }], total: 1 }}
        instanceId="o4"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('All done')).toBeTruthy();
    expect(document.querySelector('[data-part="checklist-gauge"]')).toBeNull();
  });
});

// ============================================================================
// code-snippet-block — no highlighter, LTR island, static-config path
// ============================================================================

describe('code-snippet-block', () => {
  it('renders a static config snippet with no bound data (the `static` half of its contract)', () => {
    render(
      <CodeSnippetBlockWidget
        config={cfg(codeSnippetBlockConfigSchema, { code: 'npm i @adminium/cli', language: 'shell' })}
        data={undefined}
        instanceId="cs1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('npm i @adminium/cli')).toBeTruthy();
    expect(screen.getByText('shell')).toBeTruthy();
  });

  /** Code is an LTR island — a reordered shell command does not run. */
  it('pins the code block to dir="ltr"', () => {
    render(
      <CodeSnippetBlockWidget
        config={cfg(codeSnippetBlockConfigSchema, { code: 'curl -X GET /v1/orders' })}
        data={undefined}
        instanceId="cs2"
        onEvent={noop}
      />,
    );
    expect(document.querySelector('[data-part="snippet-code"]')?.getAttribute('dir')).toBe('ltr');
  });

  it('switches the rendered code when a language tab is picked', () => {
    render(
      <CodeSnippetBlockWidget
        config={cfg(codeSnippetBlockConfigSchema, {
          languages: ['cURL', 'Python'],
          templates: { cURL: 'curl /v1/orders', Python: 'httpx.get("/v1/orders")' },
        })}
        data={undefined}
        instanceId="cs3"
        onEvent={noop}
      />,
    );

    expect(screen.getByText('curl /v1/orders')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Python' }));
    expect(screen.getByText('httpx.get("/v1/orders")')).toBeTruthy();
  });

  it('empty-states when nothing is bound and no static snippet is configured', () => {
    render(
      <CodeSnippetBlockWidget config={cfg(codeSnippetBlockConfigSchema)} data={undefined} instanceId="cs4" onEvent={noop} />,
    );
    expect(screen.getByText('No snippet')).toBeTruthy();
  });
});

// ============================================================================
// ip-allowlist-card / trust-badges / testimonial-card
// ============================================================================

describe('trust widgets', () => {
  /** An IP literal is an LTR island — a reordered address does not resolve. */
  it('ip-allowlist-card pins each address to dir="ltr" and drops address-less rows', () => {
    render(
      <IpAllowlistCardWidget
        config={cfg(ipAllowlistCardConfigSchema)}
        data={{ rows: [{ ip: '52.18.144.21', label: 'eu-west-1' }, { ip: '', label: 'broken' }], total: 2 }}
        instanceId="ip1"
        onEvent={noop}
      />,
    );

    const rows = [...document.querySelectorAll('[data-part="allowlist-row"]')];
    expect(rows.length).toBe(1);
    expect(document.querySelector('[data-part="allowlist-ip"]')?.getAttribute('dir')).toBe('ltr');
  });

  /**
   * The copy button must stay honest where `navigator.clipboard` does not exist
   * (plain HTTP, happy-dom) rather than throw.
   */
  it('ip-allowlist-card confirms a copy without a clipboard API present', () => {
    render(
      <IpAllowlistCardWidget
        config={cfg(ipAllowlistCardConfigSchema)}
        data={{ rows: [{ ip: '52.18.144.21', label: 'eu-west-1' }], total: 1 }}
        instanceId="ip2"
        onEvent={noop}
      />,
    );

    expect(() => fireEvent.click(screen.getByLabelText('Copy'))).not.toThrow();
    expect(screen.getByLabelText('Copied')).toBeTruthy();
  });

  it('trust-badges renders config badges with no bound data (the `static` half)', () => {
    render(
      <TrustBadgesWidget
        config={cfg(trustBadgesConfigSchema, { badges: ['AGPL-3.0 core', 'Self-hosted'] })}
        data={undefined}
        instanceId="tb1"
        onEvent={noop}
      />,
    );
    expect(document.querySelectorAll('[data-part="trust-badge"]').length).toBe(2);
    expect(screen.getByText('Self-hosted')).toBeTruthy();
  });

  it('testimonial-card empty-states on a quote-less row (an avatar and a name say nothing)', () => {
    render(
      <TestimonialCardWidget
        config={cfg(testimonialCardConfigSchema)}
        data={{ row: { quote: '', name: 'Dana Whitfield' } }}
        instanceId="tc1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('No testimonial')).toBeTruthy();
  });

  it('testimonial-card renders the quote and attribution', () => {
    render(
      <TestimonialCardWidget
        config={cfg(testimonialCardConfigSchema)}
        data={testimonialCardDemoData(7)}
        instanceId="tc2"
        onEvent={noop}
      />,
    );
    const quote = document.querySelector('[data-part="testimonial-quote"]');
    expect(quote?.textContent?.length).toBeGreaterThan(10);
    expect(document.querySelector('[data-part="testimonial-attribution"]')?.textContent).toContain('·');
  });
});

// ============================================================================
// resource-api-card / slo-monitor-card projections
// ============================================================================

describe('projections', () => {
  /**
   * p95 latency is milliseconds, NOT a percent. Routing it through the percent
   * reader would clamp a real 240ms p95 down to 100.
   */
  it('slo-monitor-card does not clamp p95 latency to 100', () => {
    render(
      <SloMonitorCardWidget
        config={cfg(sloMonitorCardConfigSchema, { format: { locale: 'en-US' } })}
        data={{ row: { name: 'API', target: 99.9, current: 99.95, status: 'operational', budget: 80, p95: 240, history: ['operational'] } }}
        instanceId="m1"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('240 ms')).toBeTruthy();
  });

  it('slo-monitor-card coerces status synonyms rather than greying a healthy service', () => {
    render(
      <SloMonitorCardWidget
        config={cfg(sloMonitorCardConfigSchema)}
        data={{ row: { name: 'API', status: 'healthy', current: 99.9, target: 99.9, budget: 90, history: [] } }}
        instanceId="m2"
        onEvent={noop}
      />,
    );
    expect(document.querySelector('[data-widget="slo-monitor-card"]')?.getAttribute('data-status')).toBe('operational');
  });

  it('resource-api-card falls back to config methods only when the row has none', () => {
    const { unmount } = render(
      <ResourceApiCardWidget
        config={cfg(resourceApiCardConfigSchema, { methods: ['GET', 'POST'] })}
        data={{ row: { name: 'orders', row_count: 10, rls: true, requests: [1, 2], per_day: 2 } }}
        instanceId="r1"
        onEvent={noop}
      />,
    );
    expect([...document.querySelectorAll('[data-part="resource-method"]')].map((n) => n.textContent)).toEqual(['GET', 'POST']);
    unmount();

    render(
      <ResourceApiCardWidget
        config={cfg(resourceApiCardConfigSchema, { methods: ['GET', 'POST'] })}
        data={{ row: { name: 'orders', row_count: 10, rls: false, methods: ['DELETE'], requests: [1], per_day: 1 } }}
        instanceId="r2"
        onEvent={noop}
      />,
    );
    expect([...document.querySelectorAll('[data-part="resource-method"]')].map((n) => n.textContent)).toEqual(['DELETE']);
  });

  /** RLS off means the table is world-readable — a warning, not a neutral fact. */
  it('resource-api-card badges a public table as Public', () => {
    render(
      <ResourceApiCardWidget
        config={cfg(resourceApiCardConfigSchema)}
        data={{ row: { name: 'orders', row_count: 10, rls: false, requests: [1], per_day: 1 } }}
        instanceId="r3"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('Public')).toBeTruthy();
  });
});

// ============================================================================
// registry metadata (acceptance #1)
// ============================================================================

describe('domainOpsTrackDefinitions', () => {
  const byId = new Map(domainOpsTrackDefinitions.map((d) => [d.id, d]));

  it('registers exactly the eighteen annex §13 ops ids', () => {
    expect([...byId.keys()].sort()).toEqual(
      [
        'api-keys-panel',
        'api-playground',
        'code-snippet-block',
        'credit-card-tile',
        'experiment-variant-compare',
        'ip-allowlist-card',
        'live-timer',
        'onboarding-checklist',
        'plan-pricing-cards',
        'policy-list',
        'resource-api-card',
        'slo-monitor-card',
        'starter-template-picker',
        'sync-status-card',
        'testimonial-card',
        'trust-badges',
        'uptime-segment-bar',
        'webhook-endpoints-list',
      ].sort(),
    );
  });

  it('is entirely the `domain` family', () => {
    for (const definition of domainOpsTrackDefinitions) expect(definition.family).toBe('domain');
  });

  it('carries the annex sizing in 40px half-units (h = round(annexRows × 2))', () => {
    // annex "min 6×2, default 12×2 rows"
    expect(byId.get('slo-monitor-card')?.sizing).toEqual({ minW: 6, minH: 4, defaultW: 12, defaultH: 4 });
    // annex "min 6×1"
    expect(byId.get('uptime-segment-bar')?.sizing.minH).toBe(2);
    // annex "min 6×3"
    expect(byId.get('experiment-variant-compare')?.sizing.minH).toBe(6);
    // annex "min 3×2"
    expect(byId.get('credit-card-tile')?.sizing).toMatchObject({ minW: 3, minH: 4 });
    // annex "8×5"
    expect(byId.get('api-playground')?.sizing).toMatchObject({ defaultW: 8, defaultH: 10 });
    expect(byId.get('onboarding-checklist')?.sizing).toMatchObject({ defaultW: 8, defaultH: 10 });
    // annex "min 4×2"
    expect(byId.get('policy-list')?.sizing).toMatchObject({ minW: 4, minH: 4 });
  });

  it('declares the §3 contracts the annex data notes imply', () => {
    expect(byId.get('slo-monitor-card')?.dataContract).toBe('record');
    expect(byId.get('uptime-segment-bar')?.dataContract).toBe('record-list');
    expect(byId.get('credit-card-tile')?.dataContract).toBe('record');
    expect(byId.get('api-keys-panel')?.dataContract).toBe('record-list');
  });

  /**
   * The `static` half is load-bearing: `isEmptyData` is an AND over the accepted
   * shapes and `static` is never empty, so listing it is what stops the frame
   * swallowing a legitimate config-only instance into an empty state.
   */
  it('pairs `static` onto every contract that admits a config-only instance', () => {
    expect(byId.get('code-snippet-block')?.dataContract).toEqual(['record', 'static']);
    for (const id of ['starter-template-picker', 'trust-badges', 'onboarding-checklist']) {
      expect(byId.get(id)?.dataContract).toEqual(['record-list', 'static']);
    }
  });

  it('marks editsData on exactly the widgets that emit mutate intents', () => {
    const edits = domainOpsTrackDefinitions.filter((d) => d.capabilities?.editsData === true).map((d) => d.id);
    expect(edits.sort()).toEqual(
      [
        'api-keys-panel',
        'api-playground',
        'credit-card-tile',
        'live-timer',
        'onboarding-checklist',
        'policy-list',
        'starter-template-picker',
        'sync-status-card',
        'webhook-endpoints-list',
      ].sort(),
    );
    // Its CTA only drill-throughs — navigation is not a write.
    expect(byId.get('plan-pricing-cards')?.capabilities?.editsData).toBeUndefined();
  });

  it('places the modal starter picker as an overlay (annex "modal grid")', () => {
    expect(byId.get('starter-template-picker')?.placement).toBe('overlay');
  });

  it('names a widgets.domain.* description key for every id', () => {
    for (const definition of domainOpsTrackDefinitions) {
      expect(definition.descriptionKey).toMatch(/^widgets\.domain\.[a-zA-Z]+\.description$/);
    }
  });

  /**
   * The same seed is byte-identical, forever — the property the whole no-wall-
   * clock discipline in this slice exists to protect (04 §7.7).
   *
   * SEED-SENSITIVITY is deliberately NOT asserted here as "seed A ≠ seed B". Some
   * of these generators vary a small discrete field (`plan-pricing-cards` varies
   * only which of three tiers is current), so any given pair of seeds collides
   * about a third of the time and such a test would be flaky-by-construction.
   * `qa/determinism.test.ts` already asserts threading the sound way — a sweep
   * over six fixed seeds requiring more than one distinct payload — over every
   * delivered definition, these included.
   */
  it('every demoData is byte-identical for a given seed', () => {
    for (const definition of domainOpsTrackDefinitions) {
      expect(definition.demoData(7)).toEqual(definition.demoData(7));
      expect(definition.demoData(0)).toEqual(definition.demoData(0));
    }
  });
});
