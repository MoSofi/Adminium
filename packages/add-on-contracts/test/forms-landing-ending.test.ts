// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A form's `landing` ending: one of the business's own landing pages, named
 * by its row key in a pages add-on. It is added beside `words` and `page`, so
 * every form stored before it reads exactly as it did (the forms add-on's own
 * sample forms, as stored, are the proof), and only a well-made one is taken.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FORM_ENDING_KINDS, formDefinitionSchema, formEndingSchema, parseForm } from '../src/forms/index.js';

interface Sample {
  forms: { slug: string; definition: Record<string, unknown>; settings: unknown }[];
}

const sample = JSON.parse(readFileSync(new URL('./fixtures/forms-sample.json', import.meta.url), 'utf8')) as Sample;
const withEnding = (definition: Record<string, unknown>, ending: unknown) => ({ ...definition, ending });

describe('the landing ending of a form', () => {
  it('reads the forms add-on\'s stored sample forms exactly as before', () => {
    expect(sample.forms.length).toBeGreaterThan(0);
    for (const stored of sample.forms) {
      const parsed = parseForm(stored.definition, stored.settings);
      expect(parsed.ok, stored.slug).toBe(true);
      if (!parsed.ok) continue;
      // The ending is the stored one, untouched, and the definition reads the same a second time.
      expect(parsed.form.definition.ending).toEqual(stored.definition['ending']);
      expect(formDefinitionSchema.parse(parsed.form.definition)).toEqual(parsed.form.definition);
    }
  });

  it('takes an ending that names a landing page by its key in a pages add-on', () => {
    const [first] = sample.forms;
    const ending = { kind: 'landing', page: '12', addOn: 'landing-pages' };
    const parsed = parseForm(withEnding(first!.definition, ending), first!.settings);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.form.definition.ending).toEqual(ending);
    expect(FORM_ENDING_KINDS).toEqual(['words', 'page', 'landing']);
  });

  it('refuses a landing ending with no page, a page that is not a key, an address, or anything more', () => {
    for (const ending of [
      { kind: 'landing', addOn: 'landing-pages' },
      { kind: 'landing', page: '12' },
      { kind: 'landing', page: '../admin', addOn: 'landing-pages' },
      { kind: 'landing', page: 'https://evil.example/', addOn: 'landing-pages' },
      { kind: 'landing', page: '12', addOn: 'Landing Pages' },
      { kind: 'landing', page: '', addOn: 'landing-pages' },
      { kind: 'landing', page: 'x'.repeat(65), addOn: 'landing-pages' },
      { kind: 'landing', page: '12', addOn: 'landing-pages', url: 'https://www.meridian.example/thanks' },
      { kind: 'landing', slug: 'thanks', addOn: 'landing-pages' },
    ]) {
      expect(formEndingSchema.safeParse(ending).success, JSON.stringify(ending)).toBe(false);
    }
  });
});
