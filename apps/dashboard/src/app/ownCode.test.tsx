// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Own code the server's operator keeps off: every control that leads there
 * stays in view and in the tab order, `aria-disabled`, says why, and does
 * nothing when used. And a Designer step the server refused reads in the
 * page's own fixed words, whatever the tool.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from './query.js';
import { systemInfoQuery, type SystemInfo } from './capabilities.js';
import { ownCodeOff } from './ownCode.js';
import { installTestI18n } from '../i18n/testing.js';
import { AppCard } from '../designer/home/StartWithAnApp.js';
import { CodeBarEnd } from '../designer/build/CodeBar.js';
import { lockLine } from '../designer/build/CodeTab.js';
import { stepLine } from '../designer/build/stepLine.js';
import type { CodeFiles } from '../designer/build/useCodeFiles.js';
import { AddStyleDialog } from '../designer/parts/styles.js';
import { useAttach } from '../designer/parts/attach.js';
import type { CatalogApp } from '../designer/api.js';

const OFF = { allowed: false, reason: 'trial-mode' };
const OPEN = { allowed: true, reason: null };
const info = (allowed: boolean): Pick<SystemInfo, 'offByOperator'> => {
  const own = allowed ? OPEN : OFF;
  return { offByOperator: { sqliteSources: OPEN, storageDestinations: OPEN, webhooks: OPEN, metaStoreRoutes: OPEN, packageUploads: own, designerUploads: own, ownBuilds: own } };
};

/** A query client that already holds the server's answer. */
function withInfo(allowed: boolean) {
  const client = createQueryClient();
  client.setQueryData(systemInfoQuery().queryKey, info(allowed) as SystemInfo);
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('ownCodeOff', () => {
  it('is off only when the server says so; a server older than the switch takes everything', () => {
    expect(ownCodeOff(info(false), 'ownBuilds')).toBe(true);
    expect(ownCodeOff(info(true), 'ownBuilds')).toBe(false);
    expect(ownCodeOff({}, 'packageUploads')).toBe(false);
    expect(ownCodeOff(undefined, 'designerUploads')).toBe(false);
  });
});

const APP: CatalogApp = { key: 'shop', version: '1.0.0', name: 'Shop', tagline: 'A shop.', category: null, sides: ['staff'], copyable: true, iconTint: null, iconPaths: [], monogram: 'S', picture: null, site: null };

describe('"Start with this"', () => {
  it('stays, off, with the operator’s reason, and starts nothing', async () => {
    const onStart = vi.fn();
    render(<AppCard app={APP} onStart={onStart} off />, { wrapper: withInfo(false) });
    const button = screen.getByRole('button', { name: 'Start with this: Shop' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await userEvent.setup().click(button);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('starts a copy where own builds are allowed', async () => {
    const onStart = vi.fn();
    render(<AppCard app={APP} onStart={onStart} />, { wrapper: withInfo(true) });
    const button = screen.getByRole('button', { name: 'Start with this: Shop' });
    expect(button.getAttribute('aria-disabled')).toBeNull();
    await userEvent.setup().click(button);
    expect(onStart).toHaveBeenCalledWith(APP);
  });
});

function codeFiles(lock: CodeFiles['lock'], save = vi.fn(async () => true)): CodeFiles {
  return { list: [], open: null, marks: new Set(['apps/shop/x.ts']), count: 1, lock, saving: false, canSave: lock === null, canDiscard: false, save, discard: () => undefined } as unknown as CodeFiles;
}

describe('the Code tab', () => {
  it('Save stays in place, off, and saves nothing while the operator keeps hand edits off', async () => {
    const save = vi.fn(async () => true);
    render(<CodeBarEnd code={codeFiles('operator', save)} />, { wrapper: withInfo(false) });
    const button = screen.getByRole('button', { name: /Save/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await userEvent.setup().click(button);
    expect(save).not.toHaveBeenCalled();
    expect(lockLine('operator')).toBe('Hand edits are turned off on this server by its operator. Ask the Designer for the change.');
  });

  it('saves as before otherwise', async () => {
    const save = vi.fn(async () => true);
    render(<CodeBarEnd code={codeFiles(null, save)} />, { wrapper: withInfo(true) });
    await userEvent.setup().click(screen.getByRole('button', { name: /Save/ }));
    expect(save).toHaveBeenCalledOnce();
  });
});

describe('a Designer step the server refused', () => {
  it('reads in fixed words, whatever the tool and whatever the model said', () => {
    for (const tool of ['write_file', 'run_tests', 'request_package', 'add_side']) {
      expect(stepLine({ id: 's', tool, label: 'anything at all', state: 'failed', ms: 1, detail: null, folded: 1, outcome: 'refused', operator: 'trial-mode' }), tool).toBe('Turned off on this server by its operator');
    }
    // Without it, as before.
    expect(stepLine({ id: 's', tool: 'run_tests', label: 'Tests failed', state: 'failed', ms: 1, detail: null, folded: 1 })).toBe('Tests failed');
  });
});

describe('a style of one’s own', () => {
  it('the dialog says why, and its button is off', () => {
    render(<AddStyleDialog open onClose={() => undefined} />, { wrapper: withInfo(false) });
    const choose = screen.getByRole('button', { name: 'Choose a file' });
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Styles of your own are turned off on this server by its operator.').id).toBe(choose.getAttribute('aria-describedby'));
  });

  it('takes a file where uploads are allowed', () => {
    render(<AddStyleDialog open onClose={() => undefined} />, { wrapper: withInfo(true) });
    expect(screen.getByRole('button', { name: 'Choose a file' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('Styles of your own are turned off on this server by its operator.')).toBeNull();
  });
});

describe('a site template', () => {
  const zip = new File([new Uint8Array([80, 75])], 'site.zip', { type: 'application/zip' });

  it('a zip is refused with the operator’s reason, and nothing waits to be sent', () => {
    const { result } = renderHook(() => useAttach({ siteOff: true }), { wrapper: withInfo(false) });
    expect(result.current.siteOff).toBe(true);
    act(() => result.current.add([zip]));
    expect(result.current.refused).toBe('Site templates are turned off on this server by its operator.');
    expect(result.current.site.current).toBeNull();
  });

  it('a zip waits to be sent where uploads are allowed', () => {
    const { result } = renderHook(() => useAttach(), { wrapper: withInfo(true) });
    act(() => result.current.add([zip]));
    expect(result.current.refused).toBeNull();
    expect(result.current.siteOff).toBe(false);
  });
});
