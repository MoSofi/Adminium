// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every card × language, pinned. A sample is what people paste into their own
 * code, so a change to one is a change to the product's contract and must be
 * seen in review, not discovered by a caller.
 */
import { describe, expect, it } from 'vitest';

import { makeEndpoint } from './fixtures.js';
import { cardsFor } from './model.js';
import { LANGUAGES, snippet } from './snippets.js';

const BASE = 'https://admin.northwind.test';

describe('code samples', () => {
  const ep = makeEndpoint();
  for (const card of cardsFor(ep)) {
    for (const language of LANGUAGES) {
      it(`${card.id} × ${language}`, () => {
        expect(snippet(language, BASE, ep, card)).toMatchSnapshot();
      });
    }
  }

  it('never carries a real key: only the $ADMINIUM_KEY / ADMINIUM_KEY placeholder', () => {
    for (const card of cardsFor(ep)) {
      for (const language of LANGUAGES) {
        const text = snippet(language, BASE, ep, card);
        expect(text).toMatch(/ADMINIUM_KEY/);
        expect(text).not.toMatch(/adm_(pub|srv|sk)_/);
        expect(text).not.toMatch(/apikey|\/rest\/v1|@adminium\/js|\$USER_TOKEN/);
      }
    }
  });

  it('adds the session header only where a signed-in customer is required', () => {
    const authed = makeEndpoint({ auth: 'authenticated', methods: ['GET'] });
    const [list] = cardsFor(authed);
    expect(snippet('curl', BASE, authed, list!)).toContain('X-Adminium-Public-Session: $SESSION');
    expect(snippet('python', BASE, authed, list!)).toContain('"X-Adminium-Public-Session": SESSION');
    expect(snippet('curl', BASE, ep, cardsFor(ep)[0]!)).not.toContain('X-Adminium-Public-Session');
  });

  it('writes Python literals, not JSON ones', () => {
    const create = cardsFor(ep).find((c) => c.id === 'create')!;
    const text = snippet('python', BASE, ep, create);
    expect(text).toContain('"shipped": False');
    expect(text).toContain('"order_date": None');
  });
});
