// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How the chat window writes things down.
 *
 * TEXT. Every line the window draws (its own words, the business's, a
 * visitor's or a person's message) is cut into runs: a time, a count, an
 * e-mail address or a web address is set in the mono face, left to right
 * inside `<bdi>`, so a time stays "17:30" in an Arabic sentence; a web
 * address in an answer or a person's reply is a link that opens in a new
 * tab, and only an http(s) one. Anything else is plain text.
 *
 * TIMES. A message's time is the visitor's own clock ("09:31"). The hours
 * are the business's: "Open today until 17:30", "Opens tomorrow at 9:00",
 * "Opens Monday at 9:00", "Opens on 3 August at 9:00". Digits are always
 * Latin, as the rest of the product writes them.
 */
import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

import type { NextOpen } from './api.js';

/** A time, an e-mail, a web address or a run of digits: what is set in the mono face. */
const RUN = /(https?:\/\/[^\s]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|www\.[^\s,)]+|\d[\d:.,–-]*\d|\d)/g;

export interface Run {
  text: string;
  kind: 'plain' | 'mono' | 'link';
}

/** A line cut into its runs. A full stop or comma closing a run is the sentence's, not the run's. */
export function runsOf(text: string): Run[] {
  const out: Run[] = [];
  let last = 0;
  for (const found of text.matchAll(RUN)) {
    const at = found.index;
    if (at > last) out.push({ text: text.slice(last, at), kind: 'plain' });
    let token = found[0];
    let tail = '';
    if (token.length > 1 && /[.,]$/.test(token)) {
      tail = token.slice(-1);
      token = token.slice(0, -1);
    }
    out.push({ text: token, kind: /^https?:\/\//.test(token) ? 'link' : 'mono' });
    if (tail !== '') out.push({ text: tail, kind: 'plain' });
    last = at + found[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'plain' });
  return out;
}

/** A line as the window draws it; `links` makes web addresses links (answers and a person's replies only). */
export function Said({ text, links = false, newTab }: { text: string; links?: boolean; newTab: string }): ReactNode {
  return runsOf(text).map((run, index) => {
    if (run.kind === 'plain') return <span key={index}>{run.text}</span>;
    if (run.kind === 'link' && links) {
      return (
        <a key={index} className="xc-link x-mono" href={run.text} target="_blank" rel="noopener noreferrer" dir="ltr">
          {run.text}
          <ExternalLink className="xc-link-icon" size={13} strokeWidth={2} aria-hidden="true" />
          <span className="x-sr">{newTab}</span>
        </a>
      );
    }
    return (
      <bdi key={index} dir="ltr" className="x-mono">
        {run.text}
      </bdi>
    );
  });
}

/** The length of a message as the door counts it: code points, after NFC. */
export function lengthOf(text: string): number {
  return [...text.normalize('NFC')].length;
}

/** A message's time on the visitor's own clock: "09:31". */
export function clockOf(iso: string, tag: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', numberingSystem: 'latn' }).format(at);
}

/** A business time as the hours line says it: "9:00", "17:30" (no leading zero). */
export function hourOf(clock: string): string {
  const found = /^(\d{1,2}):(\d{2})$/.exec(clock);
  return found === null ? clock : `${String(Number(found[1]))}:${found[2]!}`;
}

/** When today's hours end, on the business's clock. */
export function closingOf(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  let zone: string | undefined = timeZone;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
  } catch {
    zone = undefined;
  }
  const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).formatToParts(at);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
  return hourOf(`${hour}:${minute}`);
}

/** What fills a "when" in the hours words: which day, and its weekday, date and time in the window's language. */
export interface OpensWords extends Record<string, string> {
  day: string;
  time: string;
  weekday: string;
  date: string;
}

export function opensWords(next: NextOpen, tag: string): OpensWords {
  // The business's own day, read at noon UTC so no zone moves it.
  const noon = new Date(`${next.date}T12:00:00Z`);
  const valid = !Number.isNaN(noon.getTime());
  // English days are written the British way the product writes ("3 August").
  const dateTag = tag === 'en-US' ? 'en-GB' : tag;
  return {
    day: next.day === 'today' || next.day === 'tomorrow' || next.day === 'date' ? next.day : 'weekday',
    time: hourOf(next.time),
    weekday: valid ? new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' }).format(noon) : '',
    date: valid ? new Intl.DateTimeFormat(dateTag, { day: 'numeric', month: 'long', timeZone: 'UTC', numberingSystem: 'latn' }).format(noon) : '',
  };
}

/** A language's name in the window's language: "Englisch" in a German window. */
export function languageName(language: string, tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(language.split('-')[0]!) ?? language;
  } catch {
    return language;
  }
}

/** The code on the language button: "EN", or the whole tag when two offered languages share it. */
export function codeOf(language: string, offered: readonly string[]): string {
  const base = language.split('-')[0]!;
  const shared = offered.filter((one) => one.split('-')[0] === base).length > 1;
  return (shared ? language : base).toUpperCase();
}
