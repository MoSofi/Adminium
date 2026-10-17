// SPDX-License-Identifier: AGPL-3.0-only
/**
 * People mentioned in a text, as the text is stored and as it is typed.
 *
 * STORED, a mention is `@[Dana Reyes](usr_…)`: the name as it read when it
 * was written, and the id of the person meant — the id is what the server
 * tells by. TYPED and READ, it is `@Dana Reyes`. A box that takes mentions
 * shows the second and keeps, beside it, who each name is; these functions
 * are the two directions, and they know nothing of React.
 */

export interface MentionPerson {
  id: string;
  name: string;
}

const TOKEN = /@\[([^\]\n]{1,120})\]\((usr_[0-9A-Za-z]{6,40})\)/g;

/** A stored text as a person reads it: each mention as `@Name`. */
export function mentionText(stored: string): string {
  return stored.includes('@[') ? stored.replace(TOKEN, '@$1') : stored;
}

/**
 * A stored text as its box shows it, and who each `@Name` in it is. Two
 * people of one name cannot both be shown by it: the second keeps its stored
 * form, so nobody is swapped for a namesake.
 */
export function shownOf(stored: string): { text: string; people: Map<string, string> } {
  const people = new Map<string, string>();
  if (!stored.includes('@[')) return { text: stored, people };
  const text = stored.replace(TOKEN, (whole: string, name: string, id: string) => {
    const known = people.get(name);
    if (known !== undefined && known !== id) return whole;
    people.set(name, id);
    return `@${name}`;
  });
  return { text, people };
}

/** What a box shows, as it is stored: each `@Name` that is somebody becomes their mention. Longest names first, so "Sam Lee" is not read as "Sam". */
export function storedOf(shown: string, people: ReadonlyMap<string, string>): string {
  if (people.size === 0 || !shown.includes('@')) return shown;
  const names = [...people.keys()].sort((a, b) => b.length - a.length);
  let out = '';
  let at = 0;
  while (at < shown.length) {
    if (shown[at] === '@') {
      // A stored mention left as it was (a namesake) is copied whole.
      TOKEN.lastIndex = at;
      const kept = TOKEN.exec(shown);
      if (kept !== null && kept.index === at) {
        out += kept[0];
        at += kept[0].length;
        continue;
      }
      const name = names.find((candidate) => shown.startsWith(candidate, at + 1) && !/[\p{L}\p{N}]/u.test(shown[at + 1 + candidate.length] ?? ''));
      if (name !== undefined) {
        out += `@[${name}](${people.get(name)!})`;
        at += 1 + name.length;
        continue;
      }
    }
    out += shown[at]!;
    at += 1;
  }
  TOKEN.lastIndex = 0;
  return out;
}

/**
 * What is being asked for at the caret: the letters after an `@` that starts
 * a word, up to the caret, with no line break — or null when the caret is not
 * in one. `from` is where the `@` is.
 */
export function mentionQueryAt(text: string, caret: number): { from: number; query: string } | null {
  const before = text.slice(0, caret);
  const from = before.lastIndexOf('@');
  if (from === -1) return null;
  if (from > 0 && /[\p{L}\p{N}]/u.test(before[from - 1]!)) return null;
  const query = before.slice(from + 1);
  if (query.length > 40 || /[\n\][()]/.test(query) || query.startsWith(' ') || query.split(' ').length > 3) return null;
  return { from, query };
}

/** The text with the person picked in place of what was typed after the `@`, and where the caret goes. */
export function withMention(text: string, at: { from: number; query: string }, person: MentionPerson): { text: string; caret: number } {
  const head = `${text.slice(0, at.from)}@${person.name} `;
  return { text: head + text.slice(at.from + 1 + at.query.length).replace(/^ /, ''), caret: head.length };
}
