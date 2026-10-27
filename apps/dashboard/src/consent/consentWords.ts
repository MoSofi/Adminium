// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The consent panel's sentences: one per kind of log line, its icon and its
 * tone, and the dates in the reader's language.
 *
 * Takes the translator as an argument rather than importing the dashboard's:
 * the same words are drawn by the record page and by an app's own screen
 * (the kit), each with its own words. Every key is under `common:consent.*`.
 */
import type { ConsentEventView, ConsentHow, ConsentPurpose, StopReason } from './consentTypes.js';

export type Translate = (key: string, fallback: string, args?: Record<string, unknown>) => string;

export type LineTone = 'pos' | 'neutral' | 'danger' | 'accent';
export type LineIcon = 'mail-x' | 'mail-check' | 'file-check' | 'file-pen' | 'square-check' | 'reply' | 'upload' | 'user' | 'settings';

/** One line of the history: what happened, its tile, and what follows the time in quiet type. */
export interface ConsentLine {
  key: string;
  text: string;
  icon: LineIcon;
  tone: LineTone;
  at: number;
  extra: string | null;
}

export function purposeName(t: Translate, purpose: ConsentPurpose): string {
  return purpose === 'surveys' ? t('common:consent.purpose.surveys', 'Surveys') : t('common:consent.purpose.newsletter', 'Newsletter');
}

export function howName(t: Translate, how: ConsentHow): string {
  switch (how) {
    case 'in-person':
      return t('common:consent.how.inPerson', 'In person');
    case 'phone':
      return t('common:consent.how.phone', 'By phone');
    case 'email':
      return t('common:consent.how.email', 'By e-mail');
    case 'paper':
      return t('common:consent.how.paper', 'On paper');
  }
}

/** Why an address is on the do-not-email list, as the banner's aside says it. */
export function stopWhy(t: Translate, reason: StopReason): string {
  switch (reason) {
    case 'link':
      return t('common:consent.why.link', 'unsubscribed');
    case 'spam':
      return t('common:consent.why.spam', 'marked as spam');
    case 'bounce':
      return t('common:consent.why.bounce', 'their mail bounced');
    case 'hand':
      return t('common:consent.why.hand', 'added by hand');
    case 'relay-unsubscribe':
      return t('common:consent.why.relayUnsubscribe', 'unsubscribed through the mail service');
    case 'old-mark':
      return t('common:consent.why.oldMark', 'unsubscribed before records were kept');
    case 'lead-finder':
      return t('common:consent.why.leadFinder', 'objected through Lead finder');
    case 'erased':
      return t('common:consent.why.erased', 'erased on request');
  }
}

/** A day, in the reader's language: "12 Jun 2026". */
export function day(locale: string, at: number): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(at);
}

/** A day and a time: "12 Jun 2026, 14:02". */
export function dayTime(locale: string, at: number): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at);
}

/** The words of a form's wording version (`v3 en-US`): its number alone. */
function versionOf(stored: string | null): string | null {
  if (stored === null) return null;
  const first = stored.trim().split(/\s+/)[0] ?? '';
  return first === '' ? null : first;
}

/** A staff member's note, in the language's own quotation marks; none when there is none. */
function quoted(t: Translate, note: string | null): string | null {
  return note === null || note.trim() === '' ? null : t('common:consent.line.note', '“{note}”', { note });
}

/** A yes a staff member recorded, by how the person gave it: one sentence each, so every language words it whole. */
function recordedLine(t: Translate, how: ConsentHow, name: string): string {
  switch (how) {
    case 'in-person':
      return t('common:consent.line.recorded.inPerson', 'Agreed in person, recorded by {name}', { name });
    case 'phone':
      return t('common:consent.line.recorded.phone', 'Agreed by phone, recorded by {name}', { name });
    case 'email':
      return t('common:consent.line.recorded.email', 'Agreed by e-mail, recorded by {name}', { name });
    case 'paper':
      return t('common:consent.line.recorded.paper', 'Agreed on paper, recorded by {name}', { name });
  }
}

/** What a yes or a no says, by where it came from. */
function sentence(t: Translate, event: ConsentEventView): { text: string; icon: LineIcon; tone: LineTone; extra: string | null } {
  const yes = event.state === 'yes';
  const name = event.staff?.label ?? '';
  const purpose = event.purpose === null ? '' : purposeName(t, event.purpose);
  const detail = event.detail ?? '';
  switch (event.source) {
    case 'form': {
      const version = versionOf(event.wordingVersion);
      const text =
        version === null
          ? t('common:consent.line.form', 'Agreed on the form ‘{form}’', { form: detail })
          : t('common:consent.line.formVersion', 'Agreed on the form ‘{form}’ (wording {version})', { form: detail, version });
      return { text, icon: 'file-check', tone: 'pos', extra: event.ip === null ? null : t('common:consent.line.from', 'from {ip}', { ip: event.ip }) };
    }
    case 'staff':
      if (yes && event.how !== null) return { text: recordedLine(t, event.how, name), icon: 'file-pen', tone: 'pos', extra: quoted(t, event.note) };
      return yes
        ? { text: t('common:consent.line.ticked', 'Ticked by {name}', { name }), icon: 'square-check', tone: 'neutral', extra: quoted(t, event.note) }
        : { text: t('common:consent.line.unticked', 'Unticked by {name}', { name }), icon: 'mail-x', tone: 'neutral', extra: quoted(t, event.note) };
    case 'review':
      return yes
        ? { text: t('common:consent.line.reviewYes', 'Confirmed by {name}', { name }), icon: 'square-check', tone: 'neutral', extra: t('common:consent.line.reviewYesExtra', '(ticked before records were kept)') }
        : { text: t('common:consent.line.reviewNo', 'Left out by {name} at the send review', { name }), icon: 'mail-x', tone: 'neutral', extra: null };
    case 'import':
      return yes
        ? { text: t('common:consent.line.import', 'Brought in from a file'), icon: 'upload', tone: 'neutral', extra: null }
        : { text: t('common:consent.line.importNo', 'Brought in from a file as a no'), icon: 'upload', tone: 'neutral', extra: null };
    case 'person':
      if (detail === 'forget') return { text: t('common:consent.line.forget', 'Asked for their details to be forgotten'), icon: 'user', tone: 'danger', extra: null };
      return yes
        ? { text: t('common:consent.line.ownPageYes', 'Said yes on their own page'), icon: 'user', tone: 'pos', extra: null }
        : { text: t('common:consent.line.ownPageNo', 'Said no on their own page'), icon: 'user', tone: 'danger', extra: null };
    case 'unsubscribe': {
      // `link`, `link-all`, `one-click`, `one-click-all`, each perhaps followed by `:<why>` (the mail door's codes).
      const via = detail.split(':')[0] ?? '';
      const text = via.endsWith('-all')
        ? t('common:consent.line.unsubscribedAll', 'Unsubscribed from all marketing mail by the e-mail link')
        : via.startsWith('one-click')
          ? t('common:consent.line.oneClick', "Unsubscribed with their mail app's unsubscribe button")
          : event.purpose === 'surveys'
            ? t('common:consent.line.unsubscribed.surveys', 'Unsubscribed from Surveys by the e-mail link')
            : t('common:consent.line.unsubscribed.newsletter', 'Unsubscribed from the Newsletter by the e-mail link');
      return { text, icon: 'mail-x', tone: 'danger', extra: null };
    }
    case 'relay':
    case 'bounce':
      return { text: t('common:consent.line.mailService', 'Stopped by the mail service'), icon: 'mail-x', tone: 'danger', extra: null };
    case 'system':
      if (detail === 'rule') {
        return yes
          ? { text: t('common:consent.line.ruleYes', 'Set to yes by an automation'), icon: 'settings', tone: 'neutral', extra: null }
          : { text: t('common:consent.line.ruleNo', 'Set to no by an automation'), icon: 'settings', tone: 'neutral', extra: null };
      }
      if (detail === 'api-key') {
        return yes
          ? { text: t('common:consent.line.apiYes', 'Set to yes through the API'), icon: 'settings', tone: 'neutral', extra: null }
          : { text: t('common:consent.line.apiNo', 'Set to no through the API'), icon: 'settings', tone: 'neutral', extra: null };
      }
      return yes
        ? { text: t('common:consent.line.systemYes', 'Set to yes'), icon: 'settings', tone: 'neutral', extra: null }
        : { text: t('common:consent.line.systemNo', 'Set to no'), icon: 'settings', tone: 'neutral', extra: null };
  }
}

/**
 * The history as the panel draws it, newest first: one line per log row, a
 * "Confirmed by e-mail" line of its own where a sign-up was confirmed, and
 * "Replied" with the staff member who pressed it.
 */
export function historyLines(t: Translate, history: readonly ConsentEventView[]): ConsentLine[] {
  const lines: ConsentLine[] = [];
  for (const event of history) {
    if (event.state === 'replied') {
      lines.push({
        key: event.id,
        text: t('common:consent.line.replied', 'Replied — e-mail sequences stopped'),
        icon: 'reply',
        tone: 'accent',
        at: event.at,
        extra: event.staff === null ? null : t('common:consent.line.by', 'by {name}', { name: event.staff.label }),
      });
      continue;
    }
    if (event.confirmedAt !== null) {
      lines.push({ key: `${event.id}-confirmed`, text: t('common:consent.line.confirmed', 'Confirmed by e-mail'), icon: 'mail-check', tone: 'pos', at: event.confirmedAt, extra: null });
    }
    lines.push({ key: event.id, at: event.at, ...sentence(t, event) });
  }
  return lines.sort((a, b) => b.at - a.at);
}

/** The quiet line under a purpose's name: how its answer was given, when, and when it was confirmed. */
export function purposeDetail(t: Translate, locale: string, event: ConsentEventView | null): string {
  if (event === null) return '';
  const said = sentence(t, event).text;
  const parts = [said, day(locale, event.at)];
  if (event.confirmedAt !== null) parts.push(t('common:consent.line.confirmedOn', 'confirmed by e-mail {date}', { date: dayTime(locale, event.confirmedAt) }));
  return parts.join(' · ');
}

/** The badge of a purpose: its words and tone. */
export function purposeBadge(t: Translate, state: 'yes' | 'no' | 'not-asked', event: ConsentEventView | null): { text: string; tone: 'pos' | 'neutral' | 'danger'; icon: 'check' | 'minus' | 'mail-x' } {
  if (state === 'yes') return { text: t('common:consent.state.yes', 'May be e-mailed'), tone: 'pos', icon: 'check' };
  if (state === 'not-asked') return { text: t('common:consent.state.notAsked', 'Not asked'), tone: 'neutral', icon: 'minus' };
  const unsubscribed = event !== null && (event.source === 'unsubscribe' || event.source === 'relay' || event.source === 'bounce');
  return unsubscribed ? { text: t('common:consent.state.unsubscribed', 'Unsubscribed'), tone: 'danger', icon: 'mail-x' } : { text: t('common:consent.state.no', 'Said no'), tone: 'danger', icon: 'mail-x' };
}
