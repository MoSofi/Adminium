// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * AN ADD-ON'S ACTION ON A RECORD PAGE (`record.actions` on a companies table).
 *
 * The button is in the add-on's words; it opens a side sheet holding the
 * fill's code, loaded by the fingerprint the add-ons list gives for its file,
 * and handed exactly the table (as the add-on's tables name it), the row's
 * key, the row as the reader sees it, the reader's grants and a way to close
 * the sheet. The fill runs inside its add-on's key and copy: its calls to the
 * engine's routes for companies name that copy. A reader who may not change
 * the record gets no button; code that does not load says so and runs
 * nothing. Which tables and readers are offered the action at all is the
 * server's (`apps/server/test/lead-record-actions-server.test.ts`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useContext, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecordActionProps } from '@adminium/add-on-contracts';

import { api } from '../../app/api.js';
import type { RecordActionFact } from '../../api/pages.js';
import { AddOnInstallContext, AddOnKeyContext } from '../../add-ons/data-kit/context.js';
import { ADD_ONS_QUERY_KEY } from '../../studio/add-ons/addOnsApi.js';

const loads = vi.hoisted(() => ({ asked: [] as { url: string; integrity: string }[], fail: false, handed: [] as RecordActionProps[] }));

/** What the fill draws: what it was handed, whose key and copy it runs in, and a Close of its own. */
function Sheet({ props }: { props: RecordActionProps }) {
  const key = useContext(AddOnKeyContext);
  const install = useContext(AddOnInstallContext);
  useEffect(() => {
    // A look-up, as the sheet's content asks the engine's route for companies.
    void api.post('/api/v1/leads/company-finder/lookup', { record: props.rowKey }).catch(() => undefined);
  }, [props.rowKey]);
  return (
    <div>
      <p data-testid="fill">{JSON.stringify({ keys: Object.keys(props).sort(), table: props.table, rowKey: props.rowKey, row: props.row, grants: props.grants, key, install })}</p>
      <button type="button" onClick={() => props.close()}>
        Done
      </button>
    </div>
  );
}

vi.mock('../../add-ons/client.js', async (original) => ({
  ...(await original<typeof import('../../add-ons/client.js')>()),
  loadAddOnNamespace: vi.fn(async (ref: { url: string; integrity: string }) => {
    loads.asked.push({ url: ref.url, integrity: ref.integrity });
    if (loads.fail) throw new Error('integrity');
    return {
      register: () => ({
        fills: [
          // A fill for apps' own screens comes first, and is not the one drawn here.
          { slot: 'record.actions', render: () => <p data-testid="apps-fill">wrong fill</p> },
          {
            slot: 'record.actions',
            on: 'companies',
            render: (props: RecordActionProps) => {
              loads.handed.push(props);
              return <Sheet props={props} />;
            },
          },
        ],
      }),
    };
  }),
}));

const { default: AddOnRecordAction, actionFillOf } = await import('./AddOnRecordAction.js');

const ACTION: RecordActionFact = {
  addOn: 'company-finder',
  installId: 'man_finder',
  kind: 'companies',
  table: 'crm:companies',
  label: 'Fill in details',
  labelKey: 'company-finder.fill',
  icon: 'scan-search',
  client: 'dist/client.js',
  order: 10,
};
const LISTED = { path: 'dist/client.js', url: '/api/v1/add-ons/company-finder/bundle/dist/client.js?v=abc', integrity: 'sha256-Y2xpZW50' };
const ROW = { key: 'company-finder', name: 'Company finder', version: '1.0.0', connectKind: 'none', installId: 'man_finder', connectionId: 'conn_1', hostApi: 2, bundles: [LISTED] };
const RECORD = { id: 920, name: 'Ouseburn Studio', town: 'Newcastle upon Tyne', phone: '•••' };

/** The install each call to the engine's routes for companies named. */
const named: (string | null)[] = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (_path: string, init?: RequestInit) => {
    named.push(new Headers(init?.headers).get('x-adminium-install'));
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }),
);

function draw(props: Partial<Parameters<typeof AddOnRecordAction>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(ADD_ONS_QUERY_KEY, [ROW]);
  const onClosed = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AddOnRecordAction action={ACTION} recordId="920" row={RECORD} canUpdate recordName="Ouseburn Studio" onClosed={onClosed} {...props} />
    </QueryClientProvider>,
  );
  return { onClosed };
}

afterEach(() => {
  cleanup();
  named.length = 0;
  loads.asked = [];
  loads.handed = [];
  loads.fail = false;
});

describe('an add-on\'s action on a record', () => {
  it('opens a sheet named by the action, with the add-on\'s fill handed exactly the table, the row, the grants and a close', async () => {
    const user = userEvent.setup();
    const { onClosed } = draw();
    const button = screen.getByRole('button', { name: 'Fill in details' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    // Nothing of the add-on's is fetched until the sheet opens.
    expect(loads.asked).toEqual([]);
    await user.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Fill in details' });
    expect(sheet.textContent).toContain('Ouseburn Studio');
    const drawn = JSON.parse((await screen.findByTestId('fill')).textContent ?? '');
    expect(drawn).toEqual({
      keys: ['close', 'grants', 'row', 'rowKey', 'table'],
      table: 'crm:companies',
      rowKey: '920',
      row: RECORD,
      grants: { update: true },
      key: 'company-finder',
      install: 'man_finder',
    });
    expect(screen.queryByTestId('apps-fill')).toBeNull();
    expect(loads.asked).toEqual([{ url: LISTED.url, integrity: LISTED.integrity }]);
    // Its call to the engine's route for companies names the copy it was opened for.
    await waitFor(() => expect(named).toEqual(['man_finder']));
    // Its own Close closes the sheet, and the page is told to read the record again.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClosed).toHaveBeenCalledTimes(1);
    // Focus goes back to the button.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fill in details' })));
  });

  it('closes on the sheet\'s own close button, a 44 px target', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole('button', { name: 'Fill in details' }));
    const close = await screen.findByRole('button', { name: 'Close' });
    expect(close.className).toContain('size-11');
    await user.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is not offered to a reader who may not change the record, nor before the record is read', () => {
    draw({ canUpdate: false });
    expect(screen.queryByRole('button', { name: 'Fill in details' })).toBeNull();
    cleanup();
    draw({ row: null });
    expect(screen.queryByRole('button', { name: 'Fill in details' })).toBeNull();
  });

  it('says it could not be loaded, and runs nothing, when its code does not load', async () => {
    loads.fail = true;
    draw();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fill in details' }));
    expect(await screen.findByText('This could not be loaded. Nothing from it has been run.')).toBeTruthy();
    expect(loads.handed).toEqual([]);
  });

  it('says so too when the add-ons list names no file for it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(ADD_ONS_QUERY_KEY, [{ ...ROW, bundles: [] }]);
    render(
      <QueryClientProvider client={client}>
        <AddOnRecordAction action={ACTION} recordId="920" row={RECORD} canUpdate recordName={null} />
      </QueryClientProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fill in details' }));
    expect(await screen.findByText('This could not be loaded. Nothing from it has been run.')).toBeTruthy();
    expect(loads.asked).toEqual([]);
  });
});

describe('which fill of a module is drawn', () => {
  const render = () => null;
  it('is the one that names the kind of table, else one that names none', () => {
    const companies = { slot: 'record.actions', on: 'companies', render };
    const apps = { slot: 'record.actions', render };
    expect(actionFillOf({ register: () => ({ fills: [apps, companies] }) }, 'companies')).toBe(companies);
    expect(actionFillOf({ register: () => ({ fills: [apps] }) }, 'companies')).toBe(apps);
    expect(actionFillOf({ register: () => ({ fills: [{ slot: 'record.actions', on: 'people', render }] }) }, 'companies')).toBeNull();
    expect(actionFillOf({ register: () => ({ fills: [{ slot: 'settings.add-on.panel', render }] }) }, 'companies')).toBeNull();
    expect(actionFillOf({}, 'companies')).toBeNull();
  });
});
