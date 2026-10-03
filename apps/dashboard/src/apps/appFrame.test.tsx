// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `AppFrame` given a `src` on another origin (the Designer's preview): it
 * starts there, speaks the bridge to that origin only, and ignores a hello
 * from anywhere else. Without them it frames the app's own staff mount and
 * speaks to this page's origin, as before.
 */
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@adminium/ui';

import { AppFrame } from './AppFrame.js';
import { BRIDGE_VERSION, HELLO, INIT } from './bridge.js';

function mount(props: { src?: string; origin?: string }) {
  render(
    <ThemeProvider>
      <AppFrame appKey="repairs" path="" title="Staff" onNavigate={() => undefined} {...props} />
    </ThemeProvider>,
  );
  const frame = document.querySelector('iframe') as HTMLIFrameElement;
  // The test DOM loads no frame: a stand-in for the child's window.
  const post = vi.fn();
  const child = { postMessage: post };
  Object.defineProperty(frame, 'contentWindow', { value: child, configurable: true });
  const hello = (origin: string): void => {
    const event = new Event('message') as MessageEvent;
    Object.defineProperties(event, {
      data: { value: { type: HELLO, v: BRIDGE_VERSION } },
      origin: { value: origin },
      source: { value: child },
    });
    act(() => {
      window.dispatchEvent(event);
    });
  };
  return { frame, post, hello };
}

describe('AppFrame on another origin', () => {
  it('starts at the address it is given and answers that origin’s hello only', () => {
    const { frame, post, hello } = mount({ src: 'http://localhost:4731/designer-preview/enter?ticket=t1&to=%2Fapps%2Frepairs%2Fstaff%2F', origin: 'http://localhost:4731' });
    expect(frame.getAttribute('src')).toBe('http://localhost:4731/designer-preview/enter?ticket=t1&to=%2Fapps%2Frepairs%2Fstaff%2F');
    hello(window.location.origin);
    expect(post).not.toHaveBeenCalled();
    hello('http://localhost:4731');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: INIT }), 'http://localhost:4731');
  });

  it('frames the app’s own staff mount on this origin when given neither', () => {
    const { frame, post, hello } = mount({});
    expect(frame.getAttribute('src')).toBe('/apps/repairs/staff/');
    hello('http://localhost:4731');
    expect(post).not.toHaveBeenCalled();
    hello(window.location.origin);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: INIT }), window.location.origin);
  });
});
