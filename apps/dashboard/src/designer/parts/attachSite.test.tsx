// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A page or a stylesheet of a site template, attached to a Designer message: its chip says what
 * it is after its name, a sent one says so too, and one too large is refused naming the file.
 */
import { act, render, renderHook, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { AttachTray, kindOf, SentFiles, useAttach } from './attach.js';

beforeAll(() => installTestI18n());

const file = (name: string, size = 10, type = ''): File => new File([new Uint8Array(size)], name, { type });

describe('a page or a stylesheet with a message', () => {
  it('is known by its name or its type, as the server will read it', () => {
    expect(kindOf(file('index.html'))).toBe('html');
    expect(kindOf(file('about.HTM'))).toBe('html');
    expect(kindOf(file('page', 10, 'text/html'))).toBe('html');
    expect(kindOf(file('style.css'))).toBe('css');
    expect(kindOf(file('theme', 10, 'text/css'))).toBe('css');
    expect(kindOf(file('site.zip'))).toBeNull();
  });

  it('waits as a chip that says "page" or "stylesheet", and one too large is refused by its name', () => {
    const { result } = renderHook(() => useAttach());
    act(() => result.current.add([file('index.html'), file('style.css'), file('photo.png', 10, 'image/png')]));
    const tray = render(<AttachTray state={result.current} modelName={null} readsImages={null} />);
    const chips = within(screen.getByRole('list', { name: 'Attached files' })).getAllByRole('listitem');
    expect(chips.map((chip) => chip.textContent)).toEqual(['index.html· page', 'style.css· stylesheet', 'photo.png']);
    tray.unmount();

    act(() => result.current.add([file('huge.html', 512 * 1024 + 1)]));
    expect(result.current.refused).toBe('huge.html is over 512 KB, larger than a page of a site template is.');
    act(() => result.current.add([file('huge.css', 1024 * 1024 + 1)]));
    expect(result.current.refused).toBe('huge.css is over 1 MB, larger than a stylesheet of a site template is.');
    expect(result.current.files).toHaveLength(3);
  });

  it('is shown on the sent message as a chip with its kind, never as a picture or a link to the file', () => {
    render(
      <SentFiles
        sessionId="ds_000000000000000000000001"
        files={[
          { id: 'att_00000000000000000001', label: 'index.html', kind: 'html' },
          { id: 'att_00000000000000000002', label: 'style.css', kind: 'css' },
        ]}
      />,
    );
    const chips = within(screen.getByRole('list', { name: 'Attached files' })).getAllByRole('listitem');
    expect(chips.map((chip) => chip.textContent)).toEqual(['index.html· page', 'style.css· stylesheet']);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
