// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { AdminiumDesktopApi, DesktopProjectApi, DesktopProjectInfo } from '@adminium/desktop/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { BuildShare, DesktopBuildShare, ProjectButton, forgetDesktopProject, showInFolderLabel, useDesktopProject } from './DesktopProject.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => {
  cleanup();
  forgetDesktopProject();
  Reflect.deleteProperty(window, 'adminiumDesktop');
});

const INFO: DesktopProjectInfo = { name: 'Juniper Kitchen', displayPath: '~/Adminium/juniper-kitchen', mode: 'design' };

function bridge(project: Partial<DesktopProjectApi> | undefined, platform = 'darwin'): DesktopProjectApi {
  const api: DesktopProjectApi = {
    info: vi.fn(() => Promise.resolve<DesktopProjectInfo | null>(INFO)),
    showInFolder: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve(true)),
    ...project,
  };
  Object.defineProperty(window, 'adminiumDesktop', { value: { platform, ...(project === undefined ? {} : { project: api }) } as unknown as AdminiumDesktopApi, configurable: true });
  return api;
}

function Probe() {
  const project = useDesktopProject();
  return <p>{project === null ? 'none' : project.name}</p>;
}

describe('the project a window holds', () => {
  it('is none in a browser, in an app older than the call, and in the classic workspace', async () => {
    render(<Probe />);
    expect(screen.getByText('none')).toBeTruthy();
    cleanup();

    bridge(undefined);
    render(<Probe />);
    await Promise.resolve();
    expect(screen.getByText('none')).toBeTruthy();
    cleanup();

    const classic = bridge({ info: vi.fn(() => Promise.resolve(null)) });
    render(<Probe />);
    await waitFor(() => {
      expect(classic.info).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('none')).toBeTruthy();
  });

  it('is asked of the app once for a page, however many bars read it', async () => {
    const api = bridge({});
    render(
      <>
        <Probe />
        <Probe />
      </>,
    );
    expect(await screen.findAllByText('Juniper Kitchen')).toHaveLength(2);
    expect(api.info).toHaveBeenCalledTimes(1);
  });

  it('is none when the app could not say', async () => {
    const api = bridge({ info: vi.fn(() => Promise.reject(new Error('UNTRUSTED_SENDER: no'))) });
    render(<Probe />);
    await waitFor(() => {
      expect(api.info).toHaveBeenCalled();
    });
    expect(screen.getByText('none')).toBeTruthy();
  });
});

describe('the project’s button', () => {
  it('opens a menu of what is done with a project as a whole; the two that are built call the app', async () => {
    const api = bridge({});
    render(
      <AppToastProvider>
        <ProjectButton project={INFO} />
      </AppToastProvider>,
    );
    const button = screen.getByRole('button', { name: 'Project: Juniper Kitchen' });
    expect(button.textContent).toBe('Juniper Kitchen');
    await userEvent.click(button);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Export this project…', 'Show in Finder', 'Close project']);
    // The ZIP is not built yet.
    expect(screen.getByRole('menuitem', { name: 'Export this project…' }).getAttribute('aria-disabled')).toBe('true');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Show in Finder' }));
    expect(api.showInFolder).toHaveBeenCalledTimes(1);
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close project' }));
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it('names the place folders are looked at as the system does', () => {
    expect(showInFolderLabel('darwin')).toBe('Show in Finder');
    expect(showInFolderLabel('win32')).toBe('Show in File Explorer');
    expect(showInFolderLabel('linux')).toBe('Show in the file manager');
    expect(showInFolderLabel(undefined)).toBe('Show in the file manager');
  });
});

describe('Build | Share', () => {
  it('is a choice of two with Build chosen while the project is being built; in an app older than sharing, Share cannot be chosen', () => {
    render(<BuildShare project={INFO} />);
    const group = screen.getByRole('radiogroup', { name: 'Build or share' });
    const [build, share] = screen.getAllByRole('radio') as [HTMLButtonElement, HTMLButtonElement];
    expect(group.contains(build)).toBe(true);
    expect([build.textContent, build.getAttribute('aria-checked'), build.tabIndex]).toEqual(['Build', 'true', 0]);
    expect([share.textContent, share.getAttribute('aria-checked'), share.tabIndex, share.disabled]).toEqual(['Share', 'false', -1, true]);
  });

  it('shows Share chosen for a project that is shared', () => {
    render(<BuildShare project={{ ...INFO, mode: 'serve' }} />);
    const [build, share] = screen.getAllByRole('radio') as [HTMLButtonElement, HTMLButtonElement];
    expect(build.getAttribute('aria-checked')).toBe('false');
    expect([share.getAttribute('aria-checked'), share.disabled, share.tabIndex]).toEqual(['true', false, 0]);
  });

  it('draws nothing in a bar outside a desktop project', async () => {
    const { container } = render(<DesktopBuildShare />);
    expect(container.innerHTML).toBe('');
    cleanup();
    bridge({});
    render(<DesktopBuildShare />);
    expect(await screen.findByRole('radiogroup')).toBeTruthy();
  });
});
