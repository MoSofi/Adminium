// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * AN ADD-ON'S OWN SCREEN ON A RECORD PAGE.
 *
 * The panel's code is fetched from its own address, which names the record
 * it is drawn on, and pinned to the fingerprint the add-ons list gives for
 * it; it is handed the record and the key of the add-on's row it links to
 * (null when the link is empty), inside its add-on's key. A panel the list
 * names no file for (the reader lacks its permission) draws nothing; one
 * whose code cannot be loaded says so, and runs nothing.
 *
 * Which readers are offered a panel at all is the server's (three gates,
 * asked as the reader: `apps/server/test/design-kit-panels.test.ts`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecordPanelFact } from '../api/pages.js';
import { ADD_ONS_QUERY_KEY } from '../studio/add-ons/addOnsApi.js';
import { AddOnKeyContext } from './data-kit/context.js';

const loads = vi.hoisted(() => ({ asked: [] as { url: string; integrity: string }[], fail: false }));

/** What the panel draws: everything it was handed, and whose key it runs in. */
function Panel(props: { connectionId: string; table: string; row: string; linked: string | null }) {
  const key = useContext(AddOnKeyContext);
  return <p data-testid="panel">{JSON.stringify({ ...props, key })}</p>;
}

vi.mock('./client.js', async (original) => ({
  ...(await original<typeof import('./client.js')>()),
  loadAddOnModule: vi.fn(async (ref: { url: string; integrity: string }) => {
    loads.asked.push({ url: ref.url, integrity: ref.integrity });
    if (loads.fail) throw new Error('integrity');
    return Panel;
  }),
}));

const { default: RecordPanelHost } = await import('./RecordPanelHost.js');

const PANEL: RecordPanelFact = { addOn: 'design-kit', id: 'design-kit-editor', title: 'Design', titleKey: 'design-kit.panel.title', column: 'design_id', order: 0 };
const LISTED = { path: 'dist/panel.js', url: '/api/v1/add-ons/design-kit/panels/design-kit-editor/bundle', integrity: 'sha256-cGFuZWw=', panel: 'design-kit-editor' };

function draw(row: Record<string, unknown> | null, bundles: unknown[] = [LISTED]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(ADD_ONS_QUERY_KEY, [{ key: 'design-kit', name: 'Design kit', version: '1.0.0', connectKind: 'none', enabled: true, hostApi: 2, bundles }]);
  return render(
    <QueryClientProvider client={client}>
      <RecordPanelHost panel={PANEL} connectionId="conn_1" table="main.printing_order_lines" recordId="1" row={row} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  loads.asked = [];
  loads.fail = false;
});

describe('a record panel', () => {
  it('is fetched for this record, pinned to the listed fingerprint, and handed the record and the row it links to', async () => {
    draw({ id: 1, design_id: 7 });
    const drawn = await screen.findByTestId('panel');
    expect(JSON.parse(drawn.textContent ?? '')).toEqual({ connectionId: 'conn_1', table: 'main.printing_order_lines', row: '1', linked: '7', key: 'design-kit' });
    expect(loads.asked).toEqual([{ url: `${LISTED.url}?connection=conn_1&table=main.printing_order_lines&row=1`, integrity: LISTED.integrity }]);
  });

  it('is handed no linked row when the record\'s link is empty', async () => {
    draw({ id: 1, design_id: null });
    expect(JSON.parse((await screen.findByTestId('panel')).textContent ?? '').linked).toBeNull();
  });

  it('draws nothing, and fetches nothing, when the list names no file for it', async () => {
    const { container } = draw({ id: 1, design_id: 7 }, [{ ...LISTED, panel: undefined, path: 'dist/client.js' }]);
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(loads.asked).toEqual([]);
  });

  it('says it could not be loaded, and runs nothing, when its code does not load', async () => {
    loads.fail = true;
    draw({ id: 1, design_id: 7 });
    expect(await screen.findByText('This panel could not be loaded. Nothing from it has been run.')).toBeTruthy();
    expect(screen.queryByTestId('panel')).toBeNull();
  });
});
