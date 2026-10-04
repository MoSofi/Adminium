// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Something the Designer needs a person to decide before it goes on.
 *
 * A card pauses the turn; it does not end it. The tool that raised it waits
 * for the answer, and Stop ends the wait. A data-loss card is the stored
 * removal question of a folder app (it is answered the same way Studio
 * answers it); the Designer only shows it where the person is looking.
 */
import type { NeedItem } from './needs.js';

export type DesignerCard =
  | {
      id: string;
      /**
       * Everything a step needs from outside the project, on one card: npm
       * packages, fonts, sites pictures are shown from. Each has a checkbox.
       * What each thing is, the page says in its own words from the item's
       * kind and role; a model's reason rides along as data.
       */
      type: 'needs';
      items: NeedItem[];
    }
  | {
      id: string;
      /**
       * Free pictures the Designer found, to tick the ones to use. A picture
       * is named by an id of this server's; its small copy is served by this
       * server (`shelf` and the id), so the page calls no other site. The
       * maker's name and the licence are the source's words, cut and cleaned.
       */
      type: 'pictures';
      shelf: string;
      /** A site some of these pictures are shown from, never copied: a tick lets the app's pages load pictures from it. */
      site?: string;
      groups: { id: string; label: string; shape: 'wide' | 'tall' | 'square'; pictures: { id: string; title: string; creator: string; licence: string; source: string }[] }[];
    }
  | {
      id: string;
      type: 'question';
      question: string;
      choices: string[];
      /** The look of the app's screens: the choices are directions (and `surprise`), which the page words in the person's language and shows a swatch for. */
      look?: true;
      /** The style of the app's screens: the choices are styles' keys (and `surprise`), drawn with their previews. `more` are the rest, behind "Show all". */
      style?: { key: string; title: string; description: string; swatch?: { bg: string; text: string; accent: string }; origin: 'built-in' | 'project' }[];
      more?: string[];
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
      /** Rows of a CSV the person attached, into a table of the app. Every word is the server's: the file's label, the table, the counts. */
      type: 'rows';
      attachment: string;
      file: string;
      table: string;
      rows: number;
      /** Rows the check already refuses; they are left out. */
      left: number;
      reasons: string[];
      mapping: { from: string; to: string }[];
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
  /** The ids of the items ticked; none is "do without all of it". */
  | { type: 'needs'; accept: string[] }
  /** The ids of the pictures ticked. */
  | { type: 'pictures'; accept: string[] }
  | { type: 'add-on'; accept: boolean }
  | { type: 'rows'; accept: boolean }
  | { type: 'removal'; accept: boolean };

/** A card's answer, checked against the card it is for; null when it does not fit. */
export function answerFor(card: DesignerCard, value: unknown): CardAnswer | null {
  const given = (value ?? {}) as Record<string, unknown>;
  if (card.type === 'question') {
    const text = typeof given['text'] === 'string' ? given['text'].trim() : '';
    return text.length > 0 && text.length <= 4000 ? { type: 'question', text } : null;
  }
  if (card.type === 'needs') {
    if (!Array.isArray(given['accept'])) return null;
    // Only what the card offered: an id it does not have is nobody's yes.
    const offered = new Set(card.items.map((item) => item.id));
    return { type: 'needs', accept: [...new Set(given['accept'].filter((id): id is string => typeof id === 'string' && offered.has(id)))] };
  }
  if (card.type === 'pictures') {
    if (!Array.isArray(given['accept'])) return null;
    const offered = new Set(card.groups.flatMap((group) => group.pictures.map((picture) => picture.id)));
    return { type: 'pictures', accept: [...new Set(given['accept'].filter((id): id is string => typeof id === 'string' && offered.has(id)))] };
  }
  return typeof given['accept'] === 'boolean' ? { type: card.type, accept: given['accept'] } : null;
}
