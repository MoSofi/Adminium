// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Something the Designer needs a person to decide before it goes on.
 *
 * A card pauses the turn; it does not end it. The tool that raised it waits
 * for the answer, and Stop ends the wait. A data-loss card is the stored
 * removal question of a folder app (it is answered the same way Studio
 * answers it); the Designer only shows it where the person is looking.
 */
export type DesignerCard =
  | { id: string; type: 'question'; question: string; choices: string[] }
  | { id: string; type: 'package'; name: string; version: string; why: string }
  | {
      id: string;
      type: 'removal';
      appKey: string;
      changes: { kind: 'table' | 'column' | 'narrow'; table: string; tableName: string; column?: string; rows: number; detail?: string }[];
    };

/** A card before it has an id: what a tool asks with. */
export type CardRequest = DesignerCard extends infer Card ? (Card extends DesignerCard ? Omit<Card, 'id'> : never) : never;

/** What each kind of card is answered with. */
export type CardAnswer =
  | { type: 'question'; text: string }
  | { type: 'package'; accept: boolean }
  | { type: 'removal'; accept: boolean };

/** A card's answer, checked against the card it is for; null when it does not fit. */
export function answerFor(card: DesignerCard, value: unknown): CardAnswer | null {
  const given = (value ?? {}) as Record<string, unknown>;
  if (card.type === 'question') {
    const text = typeof given['text'] === 'string' ? given['text'].trim() : '';
    return text.length > 0 && text.length <= 4000 ? { type: 'question', text } : null;
  }
  return typeof given['accept'] === 'boolean' ? { type: card.type, accept: given['accept'] } : null;
}
