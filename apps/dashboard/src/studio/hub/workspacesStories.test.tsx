// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every story of the Workspaces card renders without a server, and a story
 * that presses a row's button opens that row's own dialog: a story that throws
 * would only show up as a VRT timeout, far from its cause.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as stories from './workspaces.stories.js';

type Story = { render: () => ReactNode; play?: (context: { canvasElement: HTMLElement }) => void };

const entries = Object.entries(stories as Record<string, Partial<Story>>).flatMap(([name, story]) =>
  name === 'default' || story.render === undefined ? [] : [[name, story as Story] as [string, Story]],
);

/** What a pressed button opens: the dialog's name. */
const OPENS: Record<string, string> = {
  RowSender: 'Sender for Fernhill Coffee',
  RowSaveWorkspace: 'Save Fernhill Coffee as one file',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Workspaces card stories', () => {
  it('has the row buttons and each one pressed', () => {
    expect(entries.map(([name]) => name)).toEqual(expect.arrayContaining(['CardWithRowButtons', 'RowSender', 'RowSaveWorkspace']));
  });

  it.each(entries)('%s renders', async (name, story) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server in a story'))));
    const { container, baseElement } = render(<>{story.render()}</>);
    expect(baseElement.textContent?.length).toBeGreaterThan(0);
    if (story.play !== undefined) {
      await act(async () => {
        story.play?.({ canvasElement: container });
      });
    }
    const opens = OPENS[name];
    if (opens !== undefined) expect(await screen.findByRole('dialog', { name: opens })).toBeTruthy();
  });

  it('shows Save workspace and Sender on every workspace row to someone who may save apps', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server in a story'))));
    render(<>{stories.CardWithRowButtons.render()}</>);
    for (const id of ['wsp_coffee', 'wsp_kiln']) {
      const row = within(screen.getByTestId(`workspace-row-${id}`));
      expect(row.getByRole('button', { name: 'Save workspace' })).toBeTruthy();
      expect(row.getByRole('button', { name: 'Sender' })).toBeTruthy();
    }
  });
});
