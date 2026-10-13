// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { readProviderFailure } from './api.js';
import { failureDetail, failureText } from './TurnView.js';
import type { ThreadTurn } from './thread.js';

const RAW = 'ollama: network request failed ()';
const failed = (error: Record<string, unknown>): ThreadTurn =>
  ({ errorKind: null, providerFailure: readProviderFailure(error), errorMessage: typeof error.message === 'string' ? error.message : null }) as unknown as ThreadTurn;

describe('a failed turn says what a person can do about it', () => {
  it('words a model nothing answers for, and keeps the provider`s own text under it', () => {
    const turn = failed({ kind: 'provider', provider: 'ollama', code: 'network', message: RAW });
    expect(failureText(turn, 'Milo', true)).toBe('Nothing answers at the model’s address. Check that it is running, then try again.');
    expect(failureDetail(turn)).toBe(RAW);
  });

  it('words a model the provider does not have, for who can change it and who cannot', () => {
    const turn = failed({ kind: 'provider', provider: 'ollama', code: 'not_found', message: 'ollama: HTTP 404' });
    expect(failureText(turn, 'Milo', true)).toContain('Choose another model in Settings → AI.');
    expect(failureText(turn, 'Milo', false)).toContain('Ask an administrator');
    expect(failureDetail(turn)).toBe('ollama: HTTP 404');
  });

  it('shows any other provider failure in the provider`s words, once', () => {
    const turn = failed({ kind: 'provider', provider: 'ollama', code: 'server', message: 'ollama: HTTP 500' });
    expect(failureText(turn, 'Milo', true)).toBe('ollama: HTTP 500');
    expect(failureDetail(turn)).toBeNull();
  });
});
