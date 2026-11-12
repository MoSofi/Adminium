// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every trial and operator string is operator-neutral (plan 17 §2 rule 1, plan
 * 75 §5.1): the engine runs for whoever operates it, so none of its words, in
 * any of the 8 locales, names adminium.app, a company or a domain, or quotes a
 * price. The banners say "This is a test environment"; the Upgrade link is the
 * operator's.
 *
 * Which strings: those whose key names an operator, a trial or the operator's
 * connect hand-off, and those whose English says "operator" or "trial". Picked
 * from en-US and read at the same key in every locale, so a translation is
 * held to the same rule as its source.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
const LOCALES = readdirSync(LOCALES_DIR).filter((name) => /^[a-z]{2}-[A-Z]{2}$/.test(name));

type Tree = { [key: string]: Tree | string };

function strings(tree: Tree, prefix: string[] = []): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') out.set([...prefix, key].join('.'), value);
    else for (const [path, text] of strings(value, [...prefix, key])) out.set(path, text);
  }
  return out;
}

function namespace(locale: string, file: string): Map<string, string> {
  return strings(JSON.parse(readFileSync(join(LOCALES_DIR, locale, file), 'utf8')) as Tree);
}

const OPERATOR_KEY = /operator|trial|connectProvider/i;
const OPERATOR_WORDS = /\b(operator|trial)/i;

/** The en-US keys, per namespace file, that hold a trial or operator string. */
function operatorKeys(): Map<string, string[]> {
  const picked = new Map<string, string[]>();
  for (const file of readdirSync(join(LOCALES_DIR, 'en-US')).filter((name) => name.endsWith('.json'))) {
    const keys = [...namespace('en-US', file)].filter(([key, text]) => OPERATOR_KEY.test(key) || OPERATOR_WORDS.test(text)).map(([key]) => key);
    if (keys.length > 0) picked.set(file, keys);
  }
  return picked;
}

/** What an operator-neutral string never holds. */
const NEVER: readonly [string, RegExp][] = [
  ['adminium.app', /adminium\s*\.\s*app/i],
  ['a domain name', /\b[a-z0-9-]+\.(?:app|com|dev|io|net|org|cloud|co|ai|shop)\b/i],
  ['a company or a hosting offer', /adminium\s+(?:cloud|hosting|inc|ltd|gmbh)|\bMoSofi\b|DigitalOcean|Hetzner|\bHosted by\b/i],
  ['a price', /[$€£¥]\s?\d|\d\s?[$€£¥]|\d\s?(?:USD|EUR|GBP|Kč|kr)\b|\/\s?(?:mo|month)\b/i],
];

describe('operator-neutral strings', () => {
  const picked = operatorKeys();

  it('finds the operator strings it is meant to guard', () => {
    // A selection that found nothing would pass every locale and guard nothing.
    expect(picked.get('common.json')).toEqual(expect.arrayContaining(['operatorLock.chip', 'operatorLock.lockedOff', 'onboarding.connectProvider.existing.help']));
    expect(picked.get('errors.json')).toContain('SET_BY_OPERATOR');
    expect(picked.get('studio.json')).toContain('settingsHub.localDatabases.lockedHosts');
  });

  for (const locale of LOCALES) {
    it(`${locale}: names no company, domain or price`, () => {
      const found: string[] = [];
      for (const [file, keys] of picked) {
        const texts = namespace(locale, file);
        for (const key of keys) {
          const text = texts.get(key);
          if (text === undefined) continue;
          for (const [what, pattern] of NEVER) if (pattern.test(text)) found.push(`${file} ${key} names ${what}: ${text}`);
        }
      }
      expect(found).toEqual([]);
    });
  }

  it('catches what it is meant to catch', () => {
    for (const bad of ['Upgrade at adminium.app', 'Hosted by Adminium Cloud', 'Run by try.example.com', 'Upgrade for $9/mo', 'Nur 9 € im Monat']) {
      expect(NEVER.some(([, pattern]) => pattern.test(bad)), bad).toBe(true);
    }
    for (const fine of ['Set by the operator', 'The operator allows only these hosts:', 'This is a test environment.', '{count, plural, one {# day} other {# days}} left']) {
      expect(NEVER.some(([, pattern]) => pattern.test(fine)), fine).toBe(false);
    }
  });
});
