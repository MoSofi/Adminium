// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a chat window keeps while the visitor moves round the website: the
 * conversation's token, the last message read, the name and e-mail they
 * saved, the language they picked, and whether the window was open. In the
 * tab's `sessionStorage` only (gone when the tab closes, never a cookie),
 * under the chat's own key: this host's storage is this install's, so the
 * key names the add-on.
 *
 * A browser that keeps nothing (storage off, a private window that refuses
 * it) loses the chat on the next page, as if it had lapsed.
 */
export interface Kept {
  token: string;
  cursor: string;
  name: string;
  email: string;
  /** The name and e-mail were saved, and the card shows "Thanks". */
  saved: boolean;
  open: boolean;
  language: string | null;
}

const keyOf = (addOn: string): string => `adminium:chat:${addOn}`;

export function readKept(addOn: string): Partial<Kept> | null {
  try {
    const raw = window.sessionStorage.getItem(keyOf(addOn));
    if (raw === null) return null;
    const read = JSON.parse(raw) as unknown;
    if (typeof read !== 'object' || read === null) return null;
    const kept = read as Record<string, unknown>;
    const text = (name: string): string | undefined => (typeof kept[name] === 'string' ? (kept[name] as string) : undefined);
    return {
      ...(text('token') === undefined ? {} : { token: text('token')! }),
      cursor: text('cursor') ?? '0',
      name: text('name') ?? '',
      email: text('email') ?? '',
      saved: kept['saved'] === true,
      open: kept['open'] === true,
      language: text('language') ?? null,
    };
  } catch {
    return null;
  }
}

export function writeKept(addOn: string, kept: Partial<Kept>): void {
  try {
    window.sessionStorage.setItem(keyOf(addOn), JSON.stringify(kept));
  } catch {
    // Nothing kept: the next page starts afresh.
  }
}
