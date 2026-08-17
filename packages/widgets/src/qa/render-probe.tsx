// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loaded-render probe shared by the four-state and config-fuzz harnesses
 * (04-T17). Renders a widget's (lazy) component directly inside a Suspense +
 * error-capturing boundary and classifies the outcome:
 *
 *   - 'ok'             — mounted and rendered without throwing.
 *   - 'barrel-pending' — the lazy component resolved to `undefined` ("Element
 *                        type is invalid …"), i.e. the widget imports a chart
 *                        primitive the GREEN LOOP has not yet exported from the
 *                        `@adminium/charts` / family barrels. Out-of-scope for
 *                        this track; skipped-with-a-warning (ratchet) so the
 *                        pre-assembly tree stays green and the gate auto-activates
 *                        once the barrels are wired.
 *   - 'crash'          — any other thrown error: a GENUINE widget defect the
 *                        harness surfaces.
 *
 * Probing the component directly (rather than through WidgetHost) is deliberate:
 * it exercises "does the loaded body render" without the host's `isEmptyData`
 * routing, and lets us capture + classify the thrown error.
 */
import { act, cleanup, render } from '@testing-library/react';
import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';

import type { WidgetDefinition } from '../registry/types.js';

class CaptureBoundary extends Component<
  { onError: (error: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }
  override componentDidCatch(error: Error): void {
    this.props.onError(error);
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export type LoadedOutcome = 'ok' | 'barrel-pending' | 'crash';

export interface ProbeResult {
  outcome: LoadedOutcome;
  error: Error | null;
}

/** True when the captured error is an unresolved-barrel "undefined component". */
export function isBarrelPending(error: Error | null): boolean {
  return error !== null && /Element type is invalid/.test(error.message);
}

/**
 * Render `definition.component` with the given data + config and classify the
 * result. Cleans up its own DOM before returning.
 */
export async function probeLoaded(
  definition: WidgetDefinition,
  data: unknown,
  config: Record<string, unknown>,
  instanceSuffix = 'probe',
): Promise<ProbeResult> {
  const Component_ = definition.component;
  let captured: Error | null = null;
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <CaptureBoundary onError={(error) => (captured = error)}>
          <Component_
            config={config}
            data={data}
            instanceId={`${definition.id}-${instanceSuffix}`}
            onEvent={() => {}}
          />
        </CaptureBoundary>
      </Suspense>,
    );
  });
  // Flush the lazy chunk + a settle tick.
  await act(async () => {
    await Promise.resolve();
  });
  cleanup();
  const error = captured as Error | null;
  const outcome: LoadedOutcome = error === null ? 'ok' : isBarrelPending(error) ? 'barrel-pending' : 'crash';
  return { outcome, error };
}

/** Parse a widget's config schema to its defaults (a valid baseline config). */
export function defaultConfig(definition: WidgetDefinition): Record<string, unknown> {
  const parsed = definition.configSchema.safeParse({});
  return parsed.success ? (parsed.data as Record<string, unknown>) : {};
}
