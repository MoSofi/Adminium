// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Forms for the forms door's tests: a showroom form with every kind of
 * question a stranger can be shown, an anonymous survey and a named one, each
 * as the builder stores it (`published`: the definition and the settings).
 */
import type { FormDefinitionInput, FormSettingsInput } from '@adminium/add-on-contracts/forms';

/** A text in the three languages these forms are written in. */
export const words = (en: string) => ({ 'en-US': en, 'de-DE': `${en} (DE)`, 'ar-EG': `${en} (AR)` });

export const SHOWROOM: FormDefinitionInput = {
  v: 1,
  kind: 'form',
  languages: ['en-US', 'de-DE', 'ar-EG'],
  defaultLanguage: 'en-US',
  title: words('Book a showroom visit'),
  intro: words('See the new booths and desks in our Leeds showroom.'),
  sections: [{ id: 'sfiles', title: words('Your space') }],
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, label: words('Your name') },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, label: words('Work e-mail') },
    { id: 'qday', kind: 'date', from: 'tomorrow', label: words('Which day suits you?') },
    { id: 'qcount', kind: 'number', min: 1, max: 20, whole: true, label: words('How many of you?') },
    {
      id: 'qsee',
      kind: 'several',
      label: words('What would you like to see?'),
      choices: [
        { id: 'booths', label: words('Acoustic booths') },
        { id: 'seating', label: words('Seating') },
      ],
    },
    { id: 'qseats', kind: 'number', label: words('Roughly how many seats?'), showIf: { question: 'qsee', includes: 'seating' } },
    {
      id: 'qtopic',
      kind: 'one',
      label: words('What is it for?'),
      choices: [
        { id: 'office', label: words('An office') },
        { id: 'home', label: words('A home') },
      ],
    },
    { id: 'qnote', kind: 'long', label: words('Anything else?'), help: words('A line or two is plenty.') },
    { id: 'qfrom', kind: 'hidden', param: 'from', label: words('Source') },
    { id: 'qnews', kind: 'tick', purpose: 'newsletter', wordingVersion: 2, wordingChangedAt: '2026-10-01', label: words("Send me Meridian's newsletter.") },
    { id: 'qfiles', kind: 'file', section: 'sfiles', maxMb: 10, kinds: ['pdf', 'jpg', 'png'], many: true, label: words('Drawings of your space') },
  ],
  ending: { kind: 'words', words: words("We'll confirm your visit within one working day.") },
};

/** What the showroom form becomes and who is told: never shown to a stranger. */
export const SHOWROOM_SETTINGS: FormSettingsInput = {
  becomes: { table: 'enquiries', map: { qname: 'name', qemail: 'email' }, source: { column: 'source', value: 'Showroom form' } },
  tell: [{ kind: 'role', id: 'sales' }],
  limits: { perHour: 57, harder: false },
};

export const FIT_OUT: FormDefinitionInput = {
  v: 1,
  kind: 'survey',
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  title: { 'en-US': 'How did your fit-out go?' },
  questions: [
    { id: 'qnps', kind: 'score', recommend: true, required: true, label: { 'en-US': 'How likely are you to recommend Meridian?' } },
    { id: 'qday', kind: 'stars', label: { 'en-US': 'How was the install day?' } },
    { id: 'qdiff', kind: 'long', label: { 'en-US': 'Anything we should do differently?' } },
  ],
  ending: { kind: 'words', words: { 'en-US': 'Thank you.' } },
};

export const ANONYMOUS: FormSettingsInput = { survey: { mode: 'anonymous', linkNames: false }, limits: { perHour: 200, harder: true } };
export const NAMED: FormSettingsInput = { survey: { mode: 'named', linkNames: true } };

/** A form row's `published` value: the definition and the settings frozen at publish. */
export const published = (definition: unknown, settings: unknown): string => JSON.stringify({ definition, settings });
