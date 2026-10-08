// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How much the work bar folds away as it narrows, and when the chat and the
 * work area stop fitting side by side.
 *
 * The bar is measured, never reckoned: its words change with the language
 * and with the names of an app's roles. It is drawn at a level; when it
 * overflows, what that level needs is written down and the next level is
 * tried. It comes back down only once the bar is wider than what the level
 * below was seen to need, with a few pixels over so it does not flap at the
 * edge. Anything that changes a width (the language, the sides, the chip's
 * words, the tab) is the `key`: a new key forgets what was measured.
 *
 *   0  everything in the bar
 *   1  the camera switch is in "More"
 *   2  the side and the size are each one menu button
 *   3  "seen as" is its icon alone
 *   4  two rows, as on a phone: the tabs, then reload, the address and "More"
 *
 * Level 4 is where a phone-wide window starts. A wider bar reaches it only
 * when level 3 itself does not fit, which English never does and a language
 * with longer words can.
 */
export type BarLevel = 0 | 1 | 2 | 3 | 4;

export interface LevelState {
  level: BarLevel;
  /** What each level was seen to need, in pixels; null until it has overflowed once. */
  need: readonly [number | null, number | null, number | null, number | null];
  key: string;
}

/** The slack a level must have before the bar unfolds to it again. */
export const LEVEL_SLACK = 8;

export function firstLevel(key: string): LevelState {
  return { level: 0, need: [null, null, null, null], key };
}

/** The bar as it is after a layout: its own width, and how wide its content wants to be. */
export interface BarMeasure {
  width: number;
  scrollWidth: number;
  clientWidth: number;
  key: string;
}

export function nextLevel(state: LevelState, measure: BarMeasure): LevelState {
  if (measure.key !== state.key) return firstLevel(measure.key);
  const { level } = state;
  if (measure.scrollWidth > measure.clientWidth + 1) {
    // Two rows always fit: there is nothing past them to try.
    if (level === 4) return state;
    const need = [...state.need] as [number | null, number | null, number | null, number | null];
    need[level] = measure.scrollWidth;
    return { level: (level + 1) as BarLevel, need, key: state.key };
  }
  const below = level === 0 ? null : state.need[level - 1];
  if (below !== null && below !== undefined && measure.width >= below + LEVEL_SLACK) return { ...state, level: (level - 1) as BarLevel };
  return state;
}

/** What the work bar at its most folded needs in English, as the design reckons it: the guess until the page has measured its own. */
export const FOLDED_NEED_GUESS = 752;

export const CHAT_WIDTH = { min: 340, max: 600, start: 380, step: 20 } as const;
/** The rule between the chat and the work area. */
export const DIVIDER = 1;

export interface ViewsInput {
  /** The window's width. */
  window: number;
  /** What the work bar at its most folded needs. */
  need: number;
  /** The width the person gave the chat. */
  wanted: number;
  /** Whether the page is in two views now. */
  two: boolean;
}

/**
 * One view or two, and the chat's real width in one.
 *
 * The chat gives its width up by itself as the window narrows, down to its
 * least, and gets it back when there is room. Only when the most folded bar
 * does not fit beside the narrowest chat do the two become views a switch
 * moves between; they come back side by side with the same few pixels over.
 */
export function views(input: ViewsInput): { two: boolean; chat: number; most: number } {
  const room = input.window - DIVIDER - input.need;
  const two = input.two ? room < CHAT_WIDTH.min + LEVEL_SLACK : room < CHAT_WIDTH.min;
  // The widest the chat may be dragged to now: its own most, or less when the bar needs the room.
  const most = Math.max(CHAT_WIDTH.min, Math.min(CHAT_WIDTH.max, Math.floor(room)));
  return { two, chat: Math.max(CHAT_WIDTH.min, Math.min(input.wanted, most)), most };
}
