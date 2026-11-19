// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The People switch's refusal as data: one entry per stable code, a missing
 * purpose naming every language it is missing in (sorted), each with its
 * English sentence; the refusal itself carries them in `details.problems`
 * beside its hook, which `more` can never overwrite.
 */
import { describe, expect, it } from 'vitest';

import { HookRejectedError } from '../src/crud/write-service.js';
import { PEOPLE_SWITCH_CODES, peopleSwitchProblemsData, type PeopleSwitchProblem } from '../src/leads/people.js';

describe('the People switch’s problems as data', () => {
  it('merges a missing purpose into one entry naming its languages, and keeps every other code once, in order', () => {
    const problems: PeopleSwitchProblem[] = [
      { code: 'tell-outbox', message: 'No tell mail.' },
      { code: 'purpose-missing', language: 'fr-FR', message: 'Write the French version of why you keep them.' },
      { code: 'purpose-missing', language: 'en-US', message: 'Write the English version of why you keep them.' },
      { code: 'keep-time', message: 'Choose how long.' },
      { code: 'smtp', message: 'E-mail isn’t set up.' },
      { code: 'mail-door', message: 'The page can’t be reached.' },
      { code: 'privacy-notice', message: 'Set the notice.' },
    ];
    expect(peopleSwitchProblemsData(problems)).toEqual([
      { code: 'tell-outbox', message: 'No tell mail.' },
      { code: 'purpose-missing', languages: ['en-US', 'fr-FR'], message: 'Write the French version of why you keep them. Write the English version of why you keep them.' },
      { code: 'keep-time', message: 'Choose how long.' },
      { code: 'smtp', message: 'E-mail isn’t set up.' },
      { code: 'mail-door', message: 'The page can’t be reached.' },
      { code: 'privacy-notice', message: 'Set the notice.' },
    ]);
  });

  it('keeps every code it is given, and the codes are the stable list', () => {
    expect(PEOPLE_SWITCH_CODES).toEqual(['purpose-missing', 'keep-time', 'smtp', 'public-origin', 'mail-door', 'privacy-notice', 'tell-outbox', 'tables']);
    const every = PEOPLE_SWITCH_CODES.map((code): PeopleSwitchProblem => (code === 'purpose-missing' ? { code, language: 'de-DE', message: code } : { code, message: code }));
    expect(peopleSwitchProblemsData(every).map((one) => one.code)).toEqual([...PEOPLE_SWITCH_CODES]);
  });

  it('nothing missing is an empty list', () => {
    expect(peopleSwitchProblemsData([])).toEqual([]);
  });

  it('a refusal carries the problems in its details beside its hook, which they cannot replace', () => {
    const refused = new HookRejectedError('Lead finder can’t keep people yet: E-mail isn’t set up.', 'leads.people-switch', { problems: [{ code: 'smtp', message: 'E-mail isn’t set up.' }], hook: 'other', rejected: false });
    expect(refused.statusCode).toBe(422);
    expect(refused.details).toEqual({ problems: [{ code: 'smtp', message: 'E-mail isn’t set up.' }], hook: 'leads.people-switch', rejected: true });
    expect(new HookRejectedError('No.', 'some.hook').details).toEqual({ hook: 'some.hook', rejected: true });
  });
});
