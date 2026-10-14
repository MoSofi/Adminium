// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { readProviderFailure } from './api.js';
import { failureDetail, failureText, stepsTitle } from './TurnView.js';
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

describe('the steps card is headed by how the turn ended', () => {
  const PAGE = 'Drafted a new email template';
  const turn = (over: Record<string, unknown>) => ({ status: 'done', result: null, ask: null, answer: null, ...over }) as never;

  it('says the page`s own "Drafted…" only of a turn that drafted', () => {
    expect(stepsTitle(turn({ result: { workTitle: null } }), false, PAGE)).toBe(PAGE);
    expect(stepsTitle(turn({ result: { workTitle: 'Rewrote the welcome mail' } }), false, PAGE)).toBe('Rewrote the welcome mail');
  });

  it('heads a send request, an answer in words, a question back and a failure as what they are', () => {
    // "Send the campaign to the admins": a card to confirm, nothing drafted.
    expect(stepsTitle(turn({ answer: { proposal: { state: 'unchecked' } } }), false, PAGE)).toBe('Worked out what would change');
    // A rule the model declined to draft: words only.
    expect(stepsTitle(turn({}), false, 'Drafted a new rule')).toBe('Looked it up');
    expect(stepsTitle(turn({ ask: { groups: [] } }), false, PAGE)).toBe('Has a question for you');
    expect(stepsTitle(turn({ status: 'failed' }), false, PAGE)).toBe('Could not finish');
    expect(stepsTitle(turn({ status: 'running' }), true, PAGE)).toBe('Working on it');
    // A data page drafts nothing: its own heading is true of an answer in words.
    expect(stepsTitle(turn({}), false, 'Read the data', false)).toBe('Read the data');
  });
});
