// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pointing at a part of the previewed page.
 *
 * The preview is another site, so the page inside it does the pointing: this
 * page asks it to start, and it says back which element was clicked, as
 * facts (a tag and classes, the words it shows, what it sits in). What
 * arrives here is the word of a screen a model wrote. It is held to a plain
 * shape before it is shown or sent on, and the server holds it again.
 */
import type { DesignerPicked } from '../api.js';
import { tidyPagePath } from './pagePath.js';

/** A tag and a few classes, of the marks those have. */
const PART = /^[a-z][a-z0-9-]{0,20}(?: [\w:./[\]%-]{1,40}){0,6}$/;

const whole = (value: unknown, most: number): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= most ? value : null);
const words = (value: unknown, most: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, most) : '');

/** What a previewed screen posted, as the element a person pointed at on `side`; null when it is not one. */
export function pickedFrom(data: unknown, appKey: string, side: 'staff' | 'customer'): DesignerPicked | null {
  const said = data as { type?: unknown; app?: unknown; side?: unknown; path?: unknown; page?: unknown; element?: unknown } | null;
  if (said === null || typeof said !== 'object' || said.type !== 'adminium:side-picked' || said.app !== appKey || said.side !== side) return null;
  const element = said.element as Record<string, unknown> | null;
  if (element === null || typeof element !== 'object') return null;
  const part = element['part'];
  if (typeof part !== 'string' || !PART.test(part)) return null;
  const of = Math.max(1, whole(element['of'], 9999) ?? 1);
  return {
    side,
    path: (typeof said.path === 'string' && said.path.startsWith('/') ? tidyPagePath(said.path) : null) ?? '/',
    page: whole(said.page, 6000),
    part,
    text: words(element['text'], 160),
    label: words(element['label'], 120),
    within: (Array.isArray(element['within']) ? element['within'] : []).filter((entry): entry is string => typeof entry === 'string' && PART.test(entry)).slice(0, 4),
    nth: Math.min(Math.max(1, whole(element['nth'], 9999) ?? 1), of),
    of,
    width: whole(element['width'], 20_000) ?? 0,
    height: whole(element['height'], 100_000) ?? 0,
  };
}

/** The screen says pointing ended with nothing picked (Escape, pressed inside it). */
export function pickEnded(data: unknown, appKey: string): boolean {
  const said = data as { type?: unknown; app?: unknown } | null;
  return said !== null && typeof said === 'object' && said.type === 'adminium:side-pick-ended' && said.app === appKey;
}
