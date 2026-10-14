// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture of a part of the previewed page, for the next message.
 *
 * The preview is another site, so this page cannot read what it shows: the
 * person drags over the frame here, and the page inside it is asked to draw
 * that part of itself. What comes back is the word of a screen a model wrote:
 * it is taken only as the answer to an asking of this page's own, only as a
 * JPEG by its first bytes and under its size, and then it is a file like any
 * a person attaches.
 */

/** A part of the frame, in its own pixels from its top left corner. */
export interface ShotArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A drag shorter than this, either way, is a slip of the hand. */
export const SHOT_MIN = 8;
/** How long the page in the frame is given to draw itself. */
export const SHOT_WAIT_MS = 10_000;
const PREFIX = 'data:image/jpeg;base64,';
/** The most the picture may be as it arrives: a little over what the screen itself holds it to. */
const SHOT_MAX_LENGTH = 2_600_000;

/** The box two points span, held inside a frame `width` by `height`; null when it is a slip of the hand. */
export function areaBetween(from: { x: number; y: number }, to: { x: number; y: number }, width: number, height: number): ShotArea | null {
  const hold = (value: number, most: number): number => Math.min(Math.max(0, value), most);
  const left = Math.round(hold(Math.min(from.x, to.x), width));
  const top = Math.round(hold(Math.min(from.y, to.y), height));
  const right = Math.round(hold(Math.max(from.x, to.x), width));
  const bottom = Math.round(hold(Math.max(from.y, to.y), height));
  return right - left < SHOT_MIN || bottom - top < SHOT_MIN ? null : { left, top, width: right - left, height: bottom - top };
}

/**
 * What a previewed screen posted, as its answer to asking number `id`: the
 * picture as a file, `false` when it said it could not draw one, null when it
 * is no answer to that asking at all.
 */
export function shotFrom(data: unknown, appKey: string, side: 'staff' | 'customer', id: number): File | false | null {
  const said = data as { type?: unknown; app?: unknown; side?: unknown; id?: unknown; picture?: unknown } | null;
  if (said === null || typeof said !== 'object' || said.type !== 'adminium:side-shot' || said.app !== appKey || said.side !== side || said.id !== id) return null;
  if (typeof said.picture !== 'string' || !said.picture.startsWith(PREFIX) || said.picture.length > SHOT_MAX_LENGTH) return false;
  try {
    const bytes = Uint8Array.from(atob(said.picture.slice(PREFIX.length)), (mark) => mark.charCodeAt(0));
    // A JPEG by its first bytes: the server reads them again.
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false;
    return new File([bytes], 'screenshot.jpg', { type: 'image/jpeg' });
  } catch {
    return false;
  }
}
