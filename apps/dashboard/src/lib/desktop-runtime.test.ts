// SPDX-License-Identifier: AGPL-3.0-only
/**
 * §4's detection contract, from the SPA's side.
 *
 * The absence case is the one that matters: this same bundle is what self-host
 * and Cloud serve, where `window.adminiumDesktop` genuinely does not exist. A
 * helper that assumed the bridge would be a `TypeError` in a browser tab, in
 * code paths (About, reveal-in-folder) that nobody clicks during a Cloud demo.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { AdminiumDesktopApi } from '@adminium/desktop/api';

import { desktopErrorCode, getDesktopApi, isDesktopRuntime } from './desktop-runtime.js';

/** Enough of the §4 bridge to be recognised as one. */
const fakeBridge = (): AdminiumDesktopApi =>
  ({ platform: 'darwin', versions: { app: '1.0.0' } }) as unknown as AdminiumDesktopApi;

function installBridge(api: AdminiumDesktopApi | undefined): void {
  // `adminiumDesktop` is `readonly` in the api.d.ts global augmentation — the
  // SPA must never assign it, only the preload does. Hence defineProperty.
  Object.defineProperty(window, 'adminiumDesktop', {
    value: api,
    configurable: true,
    writable: false,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'adminiumDesktop');
});

describe('isDesktopRuntime', () => {
  it('is false with no bridge — self-host and Cloud run this same bundle', () => {
    expect(isDesktopRuntime()).toBe(false);
    expect(getDesktopApi()).toBeNull();
  });

  it('is true exactly when the preload exposed the bridge', () => {
    installBridge(fakeBridge());
    expect(isDesktopRuntime()).toBe(true);
    expect(getDesktopApi()?.platform).toBe('darwin');
  });

  it('treats an explicitly undefined bridge as absent', () => {
    installBridge(undefined);
    expect(isDesktopRuntime()).toBe(false);
    expect(getDesktopApi()).toBeNull();
  });
});

describe('desktopErrorCode', () => {
  it('reads the code property when it survived the context bridge', () => {
    const error = Object.assign(new Error('CAPABILITY_STUB: no driver'), {
      code: 'CAPABILITY_STUB',
    });
    expect(desktopErrorCode(error)).toBe('CAPABILITY_STUB');
  });

  it('falls back to the message prefix when it did not', () => {
    // What contextBridge can leave behind: the message, no custom property.
    expect(desktopErrorCode(new Error('CAPABILITY_NOT_GRANTED: ask first'))).toBe(
      'CAPABILITY_NOT_GRANTED',
    );
    expect(desktopErrorCode(new Error('UNAVAILABLE: updates are disabled'))).toBe('UNAVAILABLE');
  });

  it('is null for anything that is not a bridge rejection', () => {
    expect(desktopErrorCode(new Error('TypeError: x is not a function'))).toBeNull();
    expect(desktopErrorCode(new Error('boom'))).toBeNull();
    expect(desktopErrorCode('CAPABILITY_STUB: a string, not an error')).toBeNull();
    expect(desktopErrorCode(null)).toBeNull();
    expect(desktopErrorCode(undefined)).toBeNull();
  });

  it('does not mistake a lookalike prefix for a code', () => {
    expect(desktopErrorCode(new Error('NOT_A_CODE: nope'))).toBeNull();
    expect(desktopErrorCode(new Error('Error invoking remote method: INTERNAL'))).toBeNull();
  });
});
