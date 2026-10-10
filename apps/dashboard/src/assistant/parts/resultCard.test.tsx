// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "What I left out, and why": a row of the draft's card, under the preview.
 * On a page where a draft that quietly does less would be taken for one that
 * does all of it (a rule), the row is always there and says "Nothing." when
 * nothing was left out; elsewhere it is there only when the draft names
 * something. What would give the part left out is drawn under it.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { readResult, type AssistantResult } from '../api.js';
import { ResultCard } from './ResultCard.js';

const result = (leftOut: unknown): AssistantResult =>
  readResult({ title: 'Thank customers after delivery', meta: 'New rule', artefact: {}, leftOut, diff: { against: null, adds: 0, dels: 0, lines: [], truncated: false } }) as AssistantResult;
const card = (leftOut: unknown, props: { always?: boolean; under?: React.ReactNode } = {}) =>
  render(<ResultCard result={result(leftOut)} preview={<div>the flow</div>} kind="rule" tokensIn={0} tokensOut={0} footer={<div>the actions</div>} alwaysLeftOut={props.always} under={props.under} />);

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(cleanup);

describe('what a draft left out', () => {
  it('is read from the stored result: each part with its why, anything else dropped', () => {
    expect(result([{ what: 'The discount code.', why: 'Nothing installed here can issue one.' }, { what: '', why: 'no what' }, 'not a part', { why: 'no what at all' }]).leftOut).toEqual([{ what: 'The discount code.', why: 'Nothing installed here can issue one.' }]);
    expect(result(undefined).leftOut).toEqual([]);
  });

  it('is its own row under the preview, with what would give it under that', () => {
    card([{ what: 'The discount code.', why: 'Nothing installed here can issue one.' }], { under: <div>Offers &amp; gift cards</div> });
    const row = screen.getByTestId('assistant-left-out');
    expect(within(row).getByText('What I left out, and why')).toBeDefined();
    expect(row.textContent).toContain('The discount code. Nothing installed here can issue one.');
    expect(screen.getByText('Offers & gift cards')).toBeDefined();
    // After the preview and before the card's own actions.
    const order = screen.getByTestId('assistant-result').textContent ?? '';
    expect(order.indexOf('the flow')).toBeLessThan(order.indexOf('What I left out'));
    expect(order.indexOf('Offers & gift cards')).toBeLessThan(order.indexOf('the actions'));
  });

  it('on a page that always shows it, says "Nothing." when the draft does all that was asked', () => {
    card([], { always: true });
    expect(screen.getByTestId('assistant-left-out').textContent).toBe('What I left out, and whyNothing.');
  });

  it('elsewhere is not there when nothing was left out', () => {
    card([]);
    expect(screen.queryByTestId('assistant-left-out')).toBeNull();
  });
});
