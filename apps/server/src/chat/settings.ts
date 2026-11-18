// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CHAT'S SETTINGS: the add-on's one settings row, read into what the door
 * and the answerer need, with the defaults a row not made yet (or a column
 * left empty) stands for.
 *
 * - No hours: always outside hours (`hours.ts`).
 * - No welcome or outside-hours words: the window's stock words.
 * - No `tell`: every reader of the conversations is told (notices), else the
 *   people who may change the settings (alerts).
 * - Automatic answers off, Milo drafting off, no tokens a day, a light window.
 * - Conversations kept 12 months when there is no row; an empty column keeps
 *   them until they are removed.
 *
 * A value that does not read (a JSON column holding something else, a zone
 * this runtime does not know) is read as not set, never as an error: a broken
 * settings row makes the chat quieter, not unavailable.
 */
import { FORM_LANGUAGES, type FormLanguage, type Words } from '@adminium/add-on-contracts/forms';
import { CHAT_THEMES } from '@adminium/manifest';
import { z } from 'zod';

import { readDay } from '../crud/moments.js';
import { jsonOf } from '../forms/catalog.js';
import { weeklyHoursSchema, type WeeklyHours } from './hours.js';

/** How many months conversations are kept when the settings row says nothing. */
export const TRANSCRIPTS_MONTHS_DEFAULT = 12;

export type ChatTheme = (typeof CHAT_THEMES)[number];

/** Whom a chat tells: a role by its slug, or a person by id. */
export interface ChatTold {
  kind: 'role' | 'person';
  id: string;
}

export interface ChatSettings {
  hours: WeeklyHours | null;
  /** The zone the hours are in, as set (null: the business's, else UTC). */
  timeZone: string | null;
  /** `yyyy-mm-dd`: closed on every day before this one. */
  closedUntil: string | null;
  welcome: Words | null;
  outsideWords: Words | null;
  automatic: boolean;
  dailyTokens: number;
  miloDrafts: boolean;
  tell: ChatTold[] | null;
  /** Null: kept until removed. */
  transcriptsMonths: number | null;
  theme: ChatTheme;
}

/** The settings a chat with no settings row has. */
export const CHAT_SETTINGS_DEFAULTS: ChatSettings = {
  hours: null,
  timeZone: null,
  closedUntil: null,
  welcome: null,
  outsideWords: null,
  automatic: false,
  dailyTokens: 0,
  miloDrafts: false,
  tell: null,
  transcriptsMonths: TRANSCRIPTS_MONTHS_DEFAULT,
  theme: 'light',
};

const LANGUAGES: ReadonlySet<string> = new Set(FORM_LANGUAGES);
const tellSchema = z.array(z.object({ kind: z.enum(['role', 'person']), id: z.string().min(1).max(191) })).max(50);

/** A boolean as each engine hands one back: `true`, `1`, `'1'`, `'true'`. */
export function yes(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 't' || (typeof value === 'bigint' && value === 1n);
}

/** A whole number as each engine hands one back, or the fallback. */
export function whole(value: unknown, fallback: number): number {
  const number = typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) ? number : fallback;
}

/** Owner-written words, one text per language, each non-empty; null when none read. */
export function wordsOf(value: unknown): Words | null {
  const read = jsonOf(value);
  if (read === null || typeof read !== 'object' || Array.isArray(read)) return null;
  const out: Words = {};
  for (const [language, text] of Object.entries(read as Record<string, unknown>)) {
    if (LANGUAGES.has(language) && typeof text === 'string' && text.trim() !== '') out[language as FormLanguage] = text;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** The settings row, read (null: no row). */
export function readChatSettings(row: Record<string, unknown> | null | undefined): ChatSettings {
  if (row === null || row === undefined) return { ...CHAT_SETTINGS_DEFAULTS };
  const hours = weeklyHoursSchema.safeParse(jsonOf(row['hours']));
  const tell = tellSchema.safeParse(jsonOf(row['tell']));
  const zone = typeof row['time_zone'] === 'string' && row['time_zone'].trim() !== '' ? row['time_zone'].trim() : null;
  const theme = typeof row['theme'] === 'string' && (CHAT_THEMES as readonly string[]).includes(row['theme']) ? (row['theme'] as ChatTheme) : 'light';
  const months = row['transcripts_months'];
  return {
    hours: hours.success ? (hours.data as WeeklyHours) : null,
    timeZone: zone,
    closedUntil: readDay(row['closed_until']),
    welcome: wordsOf(row['welcome']),
    outsideWords: wordsOf(row['outside_words']),
    automatic: yes(row['automatic']),
    dailyTokens: Math.max(0, whole(row['daily_tokens'], 0)),
    miloDrafts: yes(row['milo_drafts']),
    tell: tell.success ? tell.data : null,
    transcriptsMonths: months === null || months === undefined ? null : Math.max(1, whole(months, TRANSCRIPTS_MONTHS_DEFAULT)),
    theme,
  };
}

/** The workspace's default language as a chat names languages (`en_US` → `en-US`); English when it is not one of the eight. */
export function chatLanguageOf(locale: string | null | undefined): FormLanguage {
  const tag = String(locale ?? '').replace('_', '-');
  return LANGUAGES.has(tag) ? (tag as FormLanguage) : 'en-US';
}

/**
 * The languages a chat's window offers: its default language and every
 * language the owner wrote its welcome or outside-hours words in, in the
 * product's order.
 */
export function chatLanguages(settings: Pick<ChatSettings, 'welcome' | 'outsideWords'>, defaultLanguage: FormLanguage): FormLanguage[] {
  const written = new Set<string>([defaultLanguage, ...Object.keys(settings.welcome ?? {}), ...Object.keys(settings.outsideWords ?? {})]);
  return FORM_LANGUAGES.filter((language) => written.has(language));
}

/** The language a visitor's window uses: the one asked for when the chat offers it, else the default. */
export function visitorLanguage(asked: unknown, languages: readonly FormLanguage[], defaultLanguage: FormLanguage): FormLanguage {
  if (typeof asked !== 'string') return defaultLanguage;
  const exact = languages.find((language) => language.toLowerCase() === asked.toLowerCase());
  if (exact !== undefined) return exact;
  const near = languages.find((language) => language.toLowerCase().split('-')[0] === asked.toLowerCase().split('-')[0]);
  return near ?? defaultLanguage;
}

/** Owner-written words in a language: that language's, else the default language's; null for the stock words. */
export function wordsIn(words: Words | null, language: FormLanguage, defaultLanguage: FormLanguage): string | null {
  if (words === null) return null;
  return words[language] ?? words[defaultLanguage] ?? null;
}
