// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of Texts → Marketing: why a run can't go at all, why a person is
 * left out, what a run is doing, and what came of a consent action. Every
 * label is a literal `t()` key. A reason this version does not know reads as
 * a plain "not sent".
 */
import { t } from '../../i18n/t.js';
import type { ConfirmRequestOutcome, InPersonOutcome, RunState } from './marketingApi.js';
import { cnSentence, reasonWords, type StatusTone } from './textsWords.js';

/** What a run-level refusal says, and what to do about it. */
export function runRefusalWords(reason: string, detail: string | null): string {
  switch (reason) {
    case 'off-by-operator':
      return t('studio:texts.mkt.refusal.operatorOff', 'Texts are switched off on this server by whoever runs it.');
    case 'marketing-off-by-operator':
      return t('studio:texts.mkt.refusal.marketingOff', 'Marketing is switched off on this server by whoever runs it.');
    case 'marketing-not-yet-available':
      return t('studio:texts.mkt.locked.body', 'Marketing texts are not yet available in this version. Service texts and conversations work as normal.');
    case 'not-connected':
      return t('studio:texts.mkt.refusal.notConnected', 'No provider is connected, or its key can’t be read. Connect one in Setup.');
    case 'no-sender':
      return t('studio:texts.mkt.refusal.noSender', 'Your provider account has no number to send from. Add one in Setup.');
    case 'marketing-from-name':
      return t('studio:texts.mkt.refusal.fromName', 'Marketing can’t go from a sender name because it can’t receive STOP. Add a number for this country in your provider’s account.');
    case 'marketing-without-replies':
      return t('studio:texts.mkt.refusal.noDoor', 'This server can’t receive STOP, so marketing texts are off.');
    case 'template-off':
      return t('studio:texts.mkt.refusal.templateOff', 'This template has no language switched on.');
    case 'template-refused':
      return detail === 'asks-for-yes'
        ? t('studio:texts.mkt.refusal.asksYes', 'This template asks people to reply YES. A YES reply can lift a stop at the provider. Ask people to agree on a form instead.')
        : t('studio:texts.mkt.refusal.templateRefused', 'This template can’t go as a text: it carries a code, a sign-in or survey link, or a QR value.');
    default:
      return t('studio:texts.mkt.refusal.other', 'Marketing texts can’t go from this server now.');
  }
}

/** What the "no public address" refusal adds: why STOP can't arrive. */
export function noDoorDetail(state: string | null): string | null {
  if (state === null || state === 'reachable' || state === 'not-connected' || state === 'key-unreadable') return null;
  if (state === 'desktop') return t('studio:texts.mkt.refusal.desktop', 'The desktop app can’t receive replies from a provider.');
  if (state === 'network-off' || state === 'operator-off') return t('studio:texts.mkt.refusal.networkOff', 'This server’s network features are switched off, so a STOP reply can’t reach it.');
  return t('studio:texts.mkt.refusal.noDoorDetail', 'It has no public https address, so a STOP reply can’t reach it.');
}

/** Why one group of people is left out: the sentence beside its count. */
export function groupWords(reason: string): string {
  switch (reason) {
    case 'no-phone':
      return t('studio:texts.mkt.skip.noPhone', 'Not sent. Their row has no mobile number.');
    case 'sample':
      return t('studio:texts.mkt.skip.sample', 'Not sent. This is a row of the app’s sample data.');
    case 'found-lead':
      return t('studio:texts.mkt.skip.foundLead', 'Not sent. A lead finder found this person. Marketing never goes to found leads.');
    case 'same-number':
      return t('studio:texts.mkt.skip.sameNumber', 'Not sent again. Another row holds the same number, and it gets one text.');
    case 'out-of-reach':
      return t('studio:texts.mkt.skip.outOfReach', 'Not sent. Their row is gone, or out of your reach now.');
    case 'phone-changed':
      return t('studio:texts.mkt.skip.phoneChanged', 'Not sent. Their row holds another number now.');
    case 'run-failed':
      return t('studio:texts.mkt.skip.runFailed', 'Not sent. The run stopped before their turn.');
    case 'no-template-language':
      return t('studio:texts.mkt.skip.noLanguage', 'Not sent. The template has no language they can be written in.');
    case 'unconfirmed-consent':
      return t('studio:texts.mkt.skip.needsConfirm', 'Not sent. Their country expects them to confirm first, by the e-mail link or in person. Nobody is ever asked to reply YES.');
    default:
      return reasonWords(reason) ?? t('studio:texts.mkt.skip.other', 'Not sent.');
  }
}

/** A reason that the person can't change from here: no override is offered for any of them. */
export const COUNTRY_REASON = 'country-blocked-for-marketing';
export const CN_REASON = 'country-blocked';

export const cnWords = cnSentence;

export const RUN_TONE: Readonly<Record<RunState, StatusTone>> = {
  scheduled: 'info',
  running: 'info',
  waiting: 'warn',
  done: 'pos',
  cancelled: 'neutral',
  failed: 'danger',
};

export function runStateLabel(state: RunState): string {
  switch (state) {
    case 'scheduled':
      return t('studio:texts.mkt.state.scheduled', 'Scheduled');
    case 'running':
      return t('studio:texts.mkt.state.running', 'Sending');
    case 'waiting':
      return t('studio:texts.mkt.state.waiting', 'Waiting for tomorrow’s limit');
    case 'done':
      return t('studio:texts.mkt.state.done', 'Handed over');
    case 'cancelled':
      return t('studio:texts.mkt.state.cancelled', 'Cancelled');
    case 'failed':
      return t('studio:texts.mkt.state.failed', 'Stopped');
  }
}

export function audienceRefusalWords(reason: string): string {
  switch (reason) {
    case 'not-people':
      return t('studio:texts.mkt.audience.notPeople', 'This table is not a people table an app declares with a mobile number.');
    case 'cannot-send':
      return t('studio:texts.mkt.audience.cannotSend', 'You may no longer send marketing.');
    case 'cannot-read':
      return t('studio:texts.mkt.audience.cannotRead', 'You can’t read this table.');
    case 'phones-hidden':
    case 'phones-masked':
      return t('studio:texts.mkt.audience.phones', 'Your role doesn’t show this table’s mobile numbers in full, so you can’t text its people.');
    case 'view-gone':
      return t('studio:texts.mkt.audience.viewGone', 'That saved view is gone, or isn’t yours to use.');
    case 'view-search':
      return t('studio:texts.mkt.audience.viewSearch', 'A saved view with a search can’t choose who gets a text. Use one with filters only.');
    case 'view-hidden-column':
      return t('studio:texts.mkt.audience.viewHidden', 'That saved view filters on a column your role can’t read.');
    default:
      return t('studio:texts.mkt.audience.other', 'This table can’t be texted.');
  }
}

export function confirmRequestWords(outcome: ConfirmRequestOutcome): string {
  switch (outcome) {
    case 'sent':
    case 'held':
      return t('studio:texts.mkt.confirm.sent', 'A confirmation e-mail is on its way. They get marketing texts once they confirm.');
    case 'not-needed':
      return t('studio:texts.mkt.confirm.notNeeded', 'Their country needs no confirmation.');
    case 'already-confirmed':
      return t('studio:texts.mkt.confirm.already', 'They have confirmed already.');
    case 'no-consent':
      return t('studio:texts.mkt.confirm.noConsent', 'They have no marketing yes to confirm. Record their yes first.');
    case 'stopped':
      return t('studio:texts.reason.stopped', 'Not sent. This person asked for no more texts.');
    case 'no-phone':
    case 'no-row':
      return t('studio:texts.mkt.confirm.noRow', 'Their row or its mobile number is gone.');
    case 'no-email':
      return t('studio:texts.mkt.confirm.noEmail', 'Can’t be confirmed yet: they have no e-mail address. Ask them in person.');
    case 'no-public-origin':
      return t('studio:texts.mkt.confirm.noOrigin', 'This server has no public address, so the link in the e-mail couldn’t open. Ask them in person.');
    case 'no-mail-server':
      return t('studio:texts.mkt.confirm.noMail', 'No mail server is set up, so no e-mail can go. Ask them in person.');
    default:
      return t('studio:texts.mkt.confirm.notSent', 'No confirmation e-mail went. Ask them in person.');
  }
}

export function inPersonWords(outcome: InPersonOutcome): string {
  switch (outcome) {
    case 'confirmed':
      return t('studio:texts.mkt.inPerson.confirmed', 'Recorded under your name: they confirmed.');
    case 'already':
      return t('studio:texts.mkt.confirm.already', 'They have confirmed already.');
    case 'not-needed':
      return t('studio:texts.mkt.confirm.notNeeded', 'Their country needs no confirmation.');
    case 'no-consent':
      return t('studio:texts.mkt.confirm.noConsent', 'They have no marketing yes to confirm. Record their yes first.');
    case 'stopped':
      return t('studio:texts.reason.stopped', 'Not sent. This person asked for no more texts.');
    case 'superseded':
      return t('studio:texts.mkt.inPerson.superseded', 'A newer answer replaced that yes. Record their yes again first.');
    default:
      return t('studio:texts.mkt.confirm.noRow', 'Their row or its mobile number is gone.');
  }
}
