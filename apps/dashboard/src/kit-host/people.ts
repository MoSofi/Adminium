// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who a mention may name when the app gives no list of its own: the people
 * who sign in to this Adminium, found by name, read with the session the
 * person already holds (a same-origin GET; nothing to sign).
 *
 * Some people may not read that list: someone whose roles open only an app's
 * screens is refused it. The box then offers nobody and stays a text box, and
 * the list is not asked again until the page is loaded again.
 */
import type { KitPerson } from './contract.js';

export function sessionPeople(fetcher: typeof fetch = (input, init) => fetch(input, init)): (query: string) => Promise<readonly KitPerson[]> {
  let refused = false;
  return async (query) => {
    if (refused) return [];
    const reply = await fetcher(`/api/v1/people?limit=8&q=${encodeURIComponent(query)}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (reply.status === 401 || reply.status === 403) {
      refused = true;
      return [];
    }
    if (!reply.ok) return [];
    const body = (await reply.json()) as { people?: unknown };
    if (!Array.isArray(body.people)) return [];
    return body.people.flatMap((person: unknown) => {
      const { id, name } = (person ?? {}) as { id?: unknown; name?: unknown };
      return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : [];
    });
  };
}
