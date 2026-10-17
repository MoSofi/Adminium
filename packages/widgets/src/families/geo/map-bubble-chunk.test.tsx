// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The map whose code cannot be fetched at all: `import('maplibre-gl')` itself
 * rejects (a failed chunk fetch, a blocked build). The map promises a list
 * and a notice then, never a blank frame and never a throw into the
 * WidgetFrame error boundary. Delete the catch around the import in
 * MapBubble.tsx and this file goes red — which is the point.
 *
 * A file of its own because a module once imported stays imported: the fake
 * library `geo-widgets.test.tsx` drives could never be made to reject again.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', () => {
  throw new Error('maplibre chunk unavailable');
});

import { MapBubble } from './MapBubble.js';
import { WidgetRuntimeProvider } from '../../frame/WidgetRuntimeContext.js';
import type { WidgetRuntimeEnv } from '../../registry/offline.js';

afterEach(cleanup);

const MAPS_ON: WidgetRuntimeEnv = { runtime: 'browser', offlineAssets: false, maps: { server: 'https://maps.example.test', routing: false } };
const CITY_POINTS = [
  { name: 'Tokyo', lat: 35.7, lng: 139.7, values: { users: 900 } },
  { name: 'Lagos', lat: 6.5, lng: 3.4, values: { users: 200 } },
];
const statusOf = (container: HTMLElement): string | null | undefined => container.querySelector('[data-widget="map-bubble"]')?.getAttribute('data-map-status');

describe('map-bubble, when the map code cannot be fetched', () => {
  /**
   * The assertion the header's "never a blank frame" rests on: the import
   * rejects, the widget flips to `unavailable`, and it SAYS SO over the list
   * that carries the same data. `await`ed, not synchronous: the status flips
   * a microtask later, when the rejected import settles.
   */
  it('shows the list and the notice when the map chunk cannot be fetched', async () => {
    const { container } = render(<WidgetRuntimeProvider env={MAPS_ON}><MapBubble points={CITY_POINTS} /></WidgetRuntimeProvider>);
    await waitFor(() => expect(statusOf(container)).toBe('unavailable'));
    // The notice is put in the page empty and its words right after, so a screen reader says them.
    await waitFor(() => expect(container.querySelector('[data-part="map-unavailable"]')?.textContent).toBe('The map could not be reached. Here is the list.'));
    expect(container.querySelectorAll('[data-part="geo-ranking-row"]')).toHaveLength(2);
    // The frame is given to the list: no empty canvas is left standing.
    expect(container.querySelector('[data-part="map-canvas"]')).toBeNull();
  });

  /**
   * The empty→populated path. The mount effect early-returns when the container
   * is absent, and the empty branch renders `EmptyState` INSTEAD of the canvas —
   * so a mount-only effect would never see the container appear and the widget
   * would sit at `idle` forever.
   */
  it('builds the map when points arrive after an empty first render', async () => {
    const { container, rerender } = render(<WidgetRuntimeProvider env={MAPS_ON}><MapBubble points={[]} /></WidgetRuntimeProvider>);
    expect(container.querySelector('[data-part="map-canvas"]')).toBeNull();
    rerender(<WidgetRuntimeProvider env={MAPS_ON}><MapBubble points={CITY_POINTS} /></WidgetRuntimeProvider>);
    // Reaches a RESOLVED status (here `unavailable`, since the chunk is stubbed
    // as failing) rather than being stuck at the initial `idle`.
    await waitFor(() => expect(statusOf(container)).toBe('unavailable'));
  });
});
