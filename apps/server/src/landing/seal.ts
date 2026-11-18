// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PUBLISH SEAL OF A LANDING PAGES ADD-ON'S PAGES.
 *
 * The add-on writes its own tables through the kit, as the forms add-on does,
 * and publishing a page is a write of its row: its state goes `live`, and its
 * `published` copy is written. The engine's write service seals that write
 * (whatever door it came through: a save, a bulk change, a file brought in, a
 * rule's step, an API key):
 *
 *  - A write that sets the state to `live`, writes `published` or
 *    `published_at`, or changes the slug of a live page, leaves a row whose
 *    `published` copy parses whole as a page document
 *    (`@adminium/add-on-contracts/landing`), carries none of the assistant's
 *    marks, and whose slug keeps the landing slug rule and names no other
 *    page of the table. Else it is refused (422) with `landing-unparsable`,
 *    `landing-marked` or `landing-slug`.
 *  - `published_at` is the engine's: a client's value is dropped, and a write
 *    that changes `published` sets it to now.
 *  - The assistant never publishes: a write that came through its door (a
 *    proposal tried, or confirmed) may not name the state, the published copy
 *    or when it was published, whatever the person's own rights (403
 *    `landing-assistant`).
 *
 * Switching a page off (`state: 'off'`), or back to a draft, is always let
 * through: it publishes nothing. Pure but for the reads it is handed.
 */
import { hasMiloMarks, isLandingSlug, parseLandingPage } from '@adminium/add-on-contracts/landing';
import { landingOf } from '@adminium/manifest';

import type { AddOnInstalls } from '../apps/table-ref.js';
import { ForbiddenError, ValidationFailedError } from '../errors.js';

type Row = Record<string, unknown>;

/** The columns of a page that publish it: the assistant writes none of them. */
export const LANDING_SEALED_COLUMNS = ['state', 'published', 'published_at'] as const;

/** Why a publish was refused, as `details.reason` says it. */
export type LandingSealReason = 'landing-unparsable' | 'landing-marked' | 'landing-slug' | 'landing-assistant';

/** Whether a table is the pages table of a landing pages add-on installed on this database. */
export function landingPagesTable(installs: AddOnInstalls, connectionId: string, tableId: string): boolean {
  for (const key of installs.keys?.(connectionId) ?? []) {
    const installed = installs.installed(connectionId, key);
    const block = installed === null ? null : landingOf(installed.manifest);
    if (block !== null && installs.tableOf(connectionId, key, block.pages) === tableId) return true;
  }
  return false;
}

export interface LandingSealInput {
  action: 'create' | 'update';
  /** The table, for a refusal's details. */
  table: string;
  /** What the write sends. */
  values: Row;
  /** The row as it stands; null for a create. Read only when the write publishes. */
  stored: () => Promise<Row | null>;
  /** The write came through the assistant's door. */
  assistant: boolean;
  /** `published_at`'s value now, as the column takes it. */
  now: () => unknown;
  /** Whether a row of the table other than this one (`own`, its stored row) holds the slug. */
  slugTaken: (slug: string, own: Row | null) => Promise<boolean>;
}

/** A JSON value as stored (an object, or its text on SQLite), written out with its keys in order, to tell a change. */
function canonical(value: unknown): string {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return `text:${value}`;
    }
  }
  const sorted = (one: unknown): unknown =>
    Array.isArray(one) ? one.map(sorted) : one !== null && typeof one === 'object' ? Object.fromEntries(Object.keys(one).sort().map((key) => [key, sorted((one as Row)[key])])) : one;
  return JSON.stringify(sorted(parsed ?? null));
}

const has = (values: Row, column: string): boolean => Object.prototype.hasOwnProperty.call(values, column);

function refused(reason: Exclude<LandingSealReason, 'landing-assistant'>, column: string, message: string, table: string): never {
  throw new ValidationFailedError(message, { reason, table, fields: { [column]: { code: reason } } });
}

/** The values a write of a page may make, sealed: `published_at` set by the engine, or a refusal. */
export async function sealLandingWrite(input: LandingSealInput): Promise<Row> {
  const { values, table } = input;
  if (input.assistant) {
    const named = LANDING_SEALED_COLUMNS.find((column) => has(values, column));
    if (named !== undefined) {
      throw new ForbiddenError('Milo can write a page’s draft, never publish it or change whether it is live.', 'TABLE_FORBIDDEN', { table, reason: 'landing-assistant', column: named });
    }
    return values;
  }
  const out: Row = { ...values };
  // When it was published is the engine's to say.
  delete out['published_at'];
  const writesPublished = has(values, 'published');
  const goesLive = values['state'] === 'live';
  if (!goesLive && !writesPublished && !has(values, 'published_at') && !has(values, 'slug')) return out;

  const stored = input.action === 'create' ? null : await input.stored();
  const after: Row = { ...(stored ?? {}), ...out };
  // A slug changed on a page that stays a draft or off publishes nothing: it is judged when the page goes live.
  if (!goesLive && !writesPublished && !has(values, 'published_at') && after['state'] !== 'live') return out;

  const parsed = parseLandingPage(after['published']);
  if (!parsed.ok) refused('landing-unparsable', 'published', 'This page cannot be published: its published copy is not a page Adminium can draw.', table);
  if (hasMiloMarks(parsed.page)) refused('landing-marked', 'published', 'This page cannot be published while a section still carries Milo’s mark. Look at each one first.', table);
  const slug = after['slug'];
  if (!isLandingSlug(slug)) refused('landing-slug', 'slug', 'This page cannot be published at that address: use lower-case letters, digits and dashes, and not a word the addresses use.', table);
  if (await input.slugTaken(slug, stored)) refused('landing-slug', 'slug', 'Another page already has this address.', table);

  if (writesPublished && (stored === null || canonical(stored['published']) !== canonical(values['published']))) out['published_at'] = input.now();
  return out;
}
