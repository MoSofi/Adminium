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
  | {
      id: string;
      type: 'question';
      question: string;
      choices: string[];
      /** The look of the app's screens: the choices are directions (and `surprise`), which the page words in the person's language and shows a swatch for. */
      look?: true;
    }
  | {
      id: string;
      type: 'package';
      name: string;
      version: string;
      why: string;
      /** More packages asked for on the same card, and added with the same yes. */
      also?: { name: string; version: string }[];
    }
  | {
      id: string;
      /** An add-on the app needs and this server does not have. Every word of it is the server's, from its own store or the list adminium.dev gave. */
      type: 'add-on';
      key: string;
      name: string;
      /** Null while the list is off: what it holds is not known yet. */
      version: string | null;
      line: string;
      /** The list of adminium.dev is off here: a yes switches it on (which asks adminium.dev for the list), then gets the add-on. */
      listOff?: true;
      /** Already in this server's store: a yes installs it and nothing is fetched. */
      here?: true;
    }
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
  | { type: 'add-on'; accept: boolean }
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
