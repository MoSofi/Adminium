// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Looking for some words in a file's text: the places the editor marks, and
 * the lines the search of every file lists.
 *
 * The words are looked for as they are, never as a pattern of the person's
 * own. The server looks through the files on disk the same way
 * (`searchText`), and the two must agree: a file that was typed in and not
 * saved is searched here, in the text the editor holds.
 */
export interface FindSpec {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
}

/** One place: its line (from 1), where in the line, how long, and the line as it is shown. */
export interface FindHit {
  line: number;
  col: number;
  len: number;
  /** The line, or the part of a long one around the place. */
  text: string;
  /** Where the place is in `text`. */
  at: number;
}

/** The most places the editor marks in one file, and the most of one file a list names. */
export const FIND_MARKS_MAX = 5000;
export const FIND_HITS_MAX = 100;
const LINE_SHOWN = 240;

export function findPattern(spec: FindSpec): RegExp {
  const words = spec.query.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  const whole = spec.wholeWord ? `(?<![\\p{L}\\p{N}_])${words}(?![\\p{L}\\p{N}_])` : words;
  return new RegExp(whole, spec.matchCase ? 'gu' : 'giu');
}

/** Every place in a text, line by line, up to `max`; `more` when there were others. */
export function findHits(text: string, spec: FindSpec, max = FIND_HITS_MAX): { hits: FindHit[]; more: boolean } {
  const hits: FindHit[] = [];
  if (spec.query === '') return { hits, more: false };
  const pattern = findPattern(spec);
  for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
    pattern.lastIndex = 0;
    for (let found = pattern.exec(line); found !== null; found = pattern.exec(line)) {
      if (hits.length >= max) return { hits, more: true };
      const col = found.index;
      const from = line.length <= LINE_SHOWN ? 0 : Math.max(0, Math.min(col - 40, line.length - LINE_SHOWN));
      hits.push({ line: index + 1, col, len: found[0].length, text: line.slice(from, from + LINE_SHOWN), at: col - from });
    }
  }
  return { hits, more: false };
}

export interface FindRange {
  from: number;
  to: number;
}

/** The same places as offsets into a text whose line ends are all `\n` (the editor's). */
export function findRanges(text: string, spec: FindSpec, max = FIND_MARKS_MAX): { ranges: FindRange[]; more: boolean } {
  const ranges: FindRange[] = [];
  if (spec.query === '') return { ranges, more: false };
  const pattern = findPattern(spec);
  let start = 0;
  for (const line of text.split('\n')) {
    pattern.lastIndex = 0;
    for (let found = pattern.exec(line); found !== null; found = pattern.exec(line)) {
      if (ranges.length >= max) return { ranges, more: true };
      ranges.push({ from: start + found.index, to: start + found.index + found[0].length });
    }
    start += line.length + 1;
  }
  return { ranges, more: false };
}
