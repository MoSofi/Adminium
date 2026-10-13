// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's own screen and the kit agree on: the names of the parts, what
 * each takes, and what a mount answers.
 *
 * An app's screen is a bundle of its own (its own React, or none), so it
 * cannot draw the kit's components. It asks for one instead: it imports the
 * kit's entry from the address its side's config names (`kit.entry`) and
 * calls `mount(part, element, props)`. The part is drawn inside `element` by
 * the kit's own React; the app's never meets it.
 *
 * This file is types, two constants and one error class. A change that an app built
 * against an older kit could not live with raises `KIT_CONTRACT`.
 */

/** The contract's number, as the side's config and `kit.json` say it. */
export const KIT_CONTRACT = 1;

export type KitPartName = 'mentions' | 'board' | 'map' | 'import';

/** The parts a mount can draw today. The others are named so that adding one changes no signature. */
export const KIT_PARTS_AVAILABLE: readonly KitPartName[] = ['mentions'];

/** One language's words, part by part: `ns:key` to its text (./words/, written by scripts/gen-kit-words.mjs). */
export type KitWords = Record<KitPartName, Record<string, string>>;

/** What every part takes. */
export interface KitCommonProps {
  /** The person's language as the side's config says it (`locale`), such as `ar-EG`. An unknown one reads as en-US. */
  locale: string;
  /** The direction of that language, from the same config (`dir`). */
  dir: 'ltr' | 'rtl';
  /** Light or dark, for an app that has no colour tokens of its own. Left out, the part follows the page's `color-scheme`. */
  theme?: 'light' | 'dark' | undefined;
}

export interface KitPerson {
  /** The person's id, `usr_…`. */
  id: string;
  name: string;
}

/** The text area in which people are mentioned. */
export interface MentionsProps extends KitCommonProps {
  /** The text as it is stored: each person as `@[Name](usr_…)`. */
  value: string;
  /** Called with the text as it is to be stored, on every change. */
  onChange: (stored: string) => void;
  /** Drawn above the box and tied to it. */
  label?: string | undefined;
  /** The box's name for a screen reader when there is no `label`. */
  ariaLabel?: string | undefined;
  placeholder?: string | undefined;
  /** Default 3. */
  rows?: number | undefined;
  disabled?: boolean | undefined;
  /** Draws the box as wrong and says so to a screen reader. */
  invalid?: boolean | undefined;
  /**
   * Who may be named, for what was typed after the `@`. Left out, the people
   * who sign in to this Adminium, read with the person's own session.
   */
  people?: ((query: string) => Promise<readonly KitPerson[]>) | undefined;
}

/** A part that is named but cannot be mounted yet. */
export type KitPartNotYet = Record<string, never>;

export interface KitPartProps {
  mentions: MentionsProps;
  board: KitPartNotYet;
  map: KitPartNotYet;
  import: KitPartNotYet;
}

/** What a mount answers. */
export interface KitMounted<Props> {
  /** Changes the props named; the others stay as they were. The caret and the focus are kept. */
  update(props: Partial<Props>): void;
  /** Takes the part out of the element and frees what it held. */
  unmount(): void;
}

/** A part was asked for that this kit does not have, or does not have yet. `code` tells the two apart. */
export class KitPartUnavailableError extends Error {
  readonly code: 'KIT_PART_UNKNOWN' | 'KIT_PART_NOT_YET';
  readonly part: string;
  constructor(part: string, code: 'KIT_PART_UNKNOWN' | 'KIT_PART_NOT_YET') {
    super(
      code === 'KIT_PART_NOT_YET'
        ? `The kit part "${part}" is not available in this version of Adminium yet.`
        : `The kit has no part called "${part}". Its parts are: mentions, board, map, import.`,
    );
    this.name = 'KitPartUnavailableError';
    this.code = code;
    this.part = part;
  }
}
