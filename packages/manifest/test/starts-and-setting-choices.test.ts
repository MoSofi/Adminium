// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two words a checkout that takes payment needs: a state a new row may be made
 * in besides the first (`states.starts`: an order made already waiting for its
 * payment), and an entry open only while a choice in the settings row holds
 * one of some values (`requireSetting[].in`: a hotel that asks for payment at
 * booking). Each refusal, one break at a time.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS } from '../src/index.js';
import { columnOf, entryOf, issuesText, tableOf, valid, type Doc } from './invoicing-fixture.js';

const states = (m: Doc) => tableOf(m, 'invoices')['states'] as Doc & { moves: Record<string, unknown[]>; initial: string };
const startsIssues = (m: Doc) => issuesText(m).split('\n').filter((line) => line.includes('starts'));

describe('states.starts', () => {
  it('takes a state the row can leave', () => {
    const m = valid();
    const left = Object.keys(states(m).moves).find((state) => state !== states(m).initial && (states(m).moves[state] ?? []).length > 0)!;
    states(m)['starts'] = [left];
    // An Adminium before the word refuses it: the floor says so.
    expect(startsIssues(m)).toEqual([expect.stringContaining('"states.starts" is read by Adminium 0.3.59 and later')]);
    (m['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.59';
    expect(startsIssues(m)).toEqual([]);
    expect(WORD_FLOORS['states.starts']).toBe('0.3.59');
    expect(WORD_FLOORS['publicAccess.requireSettingIn']).toBe('0.3.59');
  });

  it('refuses an unknown state, the first state, a state named twice, and one with no way out', () => {
    let m = valid();
    states(m)['starts'] = ['nope'];
    expect(issuesText(m)).toContain('"nope" is not a value of "invoices.status"');
    m = valid();
    states(m)['starts'] = [states(m).initial];
    expect(issuesText(m)).toContain('is the first state already');
    m = valid();
    const left = Object.keys(states(m).moves).find((state) => state !== states(m).initial && (states(m).moves[state] ?? []).length > 0)!;
    states(m)['starts'] = [left, left];
    expect(issuesText(m)).toContain(`"${left}" is named twice`);
    m = valid();
    const values = (columnOf(m, 'invoices', 'status')['enum'] as string[]) ?? [];
    const stuck = values.find((state) => state !== states(m).initial && (states(m).moves[state] ?? []).length === 0)!;
    expect(stuck).toBeDefined();
    states(m)['starts'] = [stuck];
    expect(issuesText(m)).toContain(`a row made in "${stuck}" would never leave it`);
  });
});

describe('requireSetting with "in"', () => {
  const withChoice = (): Doc => {
    const m = valid();
    (tableOf(m, 'settings')['columns'] as Doc[]).push({ ref: 'pay_mode', type: 'enum', enum: ['nothing', 'optional', 'required'], default: 'nothing' });
    return m;
  };
  const entry = (m: Doc) => entryOf(m, 'invoices');

  it('takes values of a choice in the settings row', () => {
    const m = withChoice();
    entry(m)['requireSetting'] = [{ table: 'settings', column: 'pay_mode', in: ['optional', 'required'] }];
    expect(issuesText(m)).toContain('"publicAccess.requireSettingIn" is read by Adminium 0.3.59');
    (m['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.59';
    expect(issuesText(m)).not.toContain('pay_mode');
  });

  it('refuses a value the choice does not hold, a column that is not a choice, and a choice with no values', () => {
    let m = withChoice();
    entry(m)['requireSetting'] = [{ table: 'settings', column: 'pay_mode', in: ['sometimes'] }];
    expect(issuesText(m)).toContain('"sometimes" is not a value of "settings.pay_mode"');
    m = withChoice();
    entry(m)['requireSetting'] = [{ table: 'settings', column: 'reply_to', in: ['x'] }];
    expect(issuesText(m)).toContain('"settings.reply_to" is not a choice (an enum) of this app');
    m = withChoice();
    // Without "in" the setting is a yes/no, as before.
    entry(m)['requireSetting'] = [{ table: 'settings', column: 'pay_mode' }];
    expect(issuesText(m)).toContain('"settings.pay_mode" is not a bool of this app');
    m = withChoice();
    entry(m)['requireSetting'] = [{ table: 'settings', column: 'pay_mode', in: [] }];
    expect(issuesText(m)).not.toBe('');
  });
});
