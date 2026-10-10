// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { AdminiumDesktopApi, DesktopExportResult, DesktopProjectInfo } from '@adminium/desktop/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { ProjectButton } from './DesktopProject.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'adminiumDesktop');
});

const INFO: DesktopProjectInfo = { name: 'Juniper Kitchen', displayPath: '~/Adminium/juniper-kitchen', mode: 'design' };

function app(project: Record<string, unknown>) {
  Object.defineProperty(window, 'adminiumDesktop', { value: { platform: 'darwin', project } as unknown as AdminiumDesktopApi, configurable: true });
}
const mount = (): void => {
  render(
    <AppToastProvider>
      <ProjectButton project={INFO} />
    </AppToastProvider>,
  );
};
const open = async (): Promise<HTMLElement> => {
  await userEvent.click(screen.getByRole('button', { name: 'Project: Juniper Kitchen' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Export this project…' }));
  return screen.findByRole('dialog', { name: 'Export Juniper Kitchen' });
};

describe('"Export this project…"', () => {
  it('cannot be chosen in an app older than the export', async () => {
    app({});
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Project: Juniper Kitchen' }));
    expect((await screen.findByRole('menuitem', { name: 'Export this project…' })).getAttribute('aria-disabled')).toBe('true');
  });

  it('asks what the file holds, with neither chosen for the person, and says what each means', async () => {
    const run = vi.fn<(input: { kind: string; title: string }) => Promise<DesktopExportResult>>(() => Promise.resolve({ status: 'cancelled' }));
    app({ export: run });
    mount();
    const dialog = await open();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect((screen.getByRole('button', { name: 'Export…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.textContent).toContain('Whoever opens it can read all of it, saved database connections included.');
    expect(dialog.textContent).toContain('Your model keys are never included: they stay on this computer.');
    expect(dialog.textContent).toContain('The project stops for a moment while the file is made');

    await userEvent.click(screen.getByRole('radio', { name: /The apps only/ }));
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: /its data and its key/ }).getAttribute('aria-checked')).toBe('true');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
    expect(run).toHaveBeenCalledWith({ kind: 'apps', title: 'Export Juniper Kitchen', from: `${window.location.pathname}${window.location.search}` });
    // Cancelled in the system's dialog: the choice is still there.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Export…' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('says when something is still running, and why a file could not be made', async () => {
    const run = vi.fn<() => Promise<DesktopExportResult>>().mockResolvedValueOnce({ status: 'busy' }).mockResolvedValueOnce({ status: 'failed', detail: 'ENOSPC: no space left on device' }).mockRejectedValueOnce(new Error('UNAVAILABLE: gone'));
    app({ export: run });
    mount();
    await open();
    await userEvent.click(screen.getByRole('radio', { name: /The apps only/ }));
    const go = screen.getByRole('button', { name: 'Export…' });
    await userEvent.click(go);
    expect((await screen.findByRole('alert')).textContent).toBe('Something is still running in this project. Export it when that is done.');
    await userEvent.click(go);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('ENOSPC: no space left on device'));
    await userEvent.click(go);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('gone'));
  });

  it('the page that comes back says where it was saved, once, and shows the file on request', async () => {
    const showExport = vi.fn(() => Promise.resolve());
    app({ exportResult: vi.fn(() => Promise.resolve<DesktopExportResult | null>({ status: 'saved', file: 'juniper-kitchen.zip', megabytes: 48.3 })), showExport });
    mount();
    expect(await screen.findByText('Saved juniper-kitchen.zip, 48.3 MB')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show in Finder' }));
    expect(showExport).toHaveBeenCalledTimes(1);
  });

  it('and says so when it could not be made; with nothing to tell it says nothing', async () => {
    app({ exportResult: vi.fn(() => Promise.resolve<DesktopExportResult | null>({ status: 'failed', detail: 'EACCES' })) });
    mount();
    expect(await screen.findByText('The export could not be made')).toBeTruthy();
    cleanup();
    for (const answer of [() => Promise.resolve(null), () => Promise.reject(new Error('gone'))]) {
      app({ exportResult: vi.fn(answer) });
      mount();
      await Promise.resolve();
      await Promise.resolve();
      expect(screen.queryByText(/Saved|could not be made/)).toBeNull();
      cleanup();
    }
  });
});
