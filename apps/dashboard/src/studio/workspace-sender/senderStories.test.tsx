// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every story of the sender sheet and of "Send as" renders without a server:
 * a story that throws would only show up as a VRT timeout.
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as sendAs from '../../email/editor/inspector/panels/sendAs.stories.js';
import * as sender from './workspaceSender.stories.js';

type Story = { render: () => ReactElement };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the stories', () => {
  it.each(Object.entries(sender).filter(([name]) => name !== 'default') as [string, Story][])('sender sheet: %s', (name, story) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server in a story'))));
    render(story.render());
    expect(screen.getByRole('dialog', { name: 'Sender for Kiln Street Pottery' })).toBeTruthy();
    if (name === 'RefusedFrom') expect(screen.getByTestId('workspace-sender-from-error').textContent).toContain('This server can only send from');
    if (name === 'NoMailOnServer') expect(screen.getByTestId('workspace-sender-no-mail')).toBeTruthy();
  });

  it.each(Object.entries(sendAs).filter(([name]) => name !== 'default') as [string, Story][])('send as: %s', (_name, story) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server in a story'))));
    render(story.render());
    expect(screen.getByTestId('email-send-as')).toBeTruthy();
  });
});
