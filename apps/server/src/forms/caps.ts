// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S CAPS: how many answers a form takes, so a bot filling it a
 * hundred times is stopped and its owner told.
 *
 *  - per network address: at most {@link FORM_PER_ADDRESS_HOUR} answers an
 *    hour from one address, to any form of the install (the public door's
 *    own number, `ANONYMOUS_PER_IP_HOUR`), an IPv6 address counted by its
 *    /64 as the public door counts it (`rateAddress`);
 *  - per form: at most the form's own hourly cap (`settings.limits.perHour`),
 *    counted across every stranger;
 *  - per e-mail address: at most {@link FORM_PER_EMAIL_DAY} answers a day to
 *    one form naming one mailbox (`mailboxOf`: `+tags` and Gmail's dots do
 *    not make another).
 * Each is counted as the public door counts: a mark is made first, then the
 * window counted, so two answers at the same moment cannot both slip under a
 * cap. A refused answer gives its marks back but the address's: an address
 * that keeps sending answers that are refused is still counted.
 *
 * A tripped cap says how long to wait: until the oldest answer in its window
 * leaves it (an hour's cap), or the day's (an e-mail address's).
 *
 * Every subject is a keyed hash or a form's id, never an address in clear.
 */
import { createHash, createHmac } from 'node:crypto';

import { formMarksRepo, type MetaDb } from '@adminium/meta';

import { ANONYMOUS_PER_IP_HOUR, HOUR_MS, mailboxOf } from '../public-api/anonymous-caps.js';
import { DAY_MS } from '../public-api/claim-code.js';
import { rateAddress } from '../public-api/limiter.js';

/** Answers an hour from one network address, to every form. */
export const FORM_PER_ADDRESS_HOUR = ANONYMOUS_PER_IP_HOUR;
/** Answers a day naming one e-mail address, to one form. */
export const FORM_PER_EMAIL_DAY = 5;

/** Which cap an answer met. */
export type FormCap = 'address' | 'form' | 'email' | 'entry';

/** The marks' purposes. */
const PURPOSE = { address: 'answer-ip', form: 'answer-form', email: 'answer-mail' } as const;

/** What a form is, for its caps. */
export interface CappedForm {
  addOn: string;
  id: string;
  perHour: number;
}

export type CapCharge = { ok: true; release: () => Promise<void> } | { ok: false; cap: FormCap; retryAfter: number; window: 'hour' | 'day' };

/** A form's own subject: its id, hashed to a fixed width. */
export function formSubject(form: Pick<CappedForm, 'addOn' | 'id'>): string {
  return `form:${createHash('sha256').update(JSON.stringify([form.addOn, form.id])).digest('hex')}`;
}

/** One network address's subject, under the caps' key. */
export function addressSubject(key: Buffer, ip: string): string {
  return `form-ip:${createHmac('sha256', key).update(rateAddress(ip)).digest('hex')}`;
}

/** One mailbox's subject for one form, under the caps' key. */
export function emailSubject(key: Buffer, form: Pick<CappedForm, 'addOn' | 'id'>, email: string): string {
  return `form-mail:${createHmac('sha256', key).update(JSON.stringify([form.addOn, form.id, mailboxOf(email.trim().toLowerCase())])).digest('hex')}`;
}

export function createFormCaps(meta: MetaDb, key: Buffer) {
  const marks = formMarksRepo(meta);

  /** Seconds until the oldest mark of a window leaves it. */
  async function waitOf(subject: string, purpose: string, since: number, window: number, at: number): Promise<number> {
    const oldest = await marks.oldestSince(subject, since, purpose);
    return Math.max(1, Math.ceil(((oldest ?? at) + window - at) / 1000));
  }

  /** Marks each charge, then counts it: over any, every mark of this call goes back. */
  async function charge(
    charges: readonly { cap: FormCap; subject: string; purpose: string; limit: number; window: number }[],
    at: number,
  ): Promise<{ ok: true; ids: Map<FormCap, string> } | { ok: false; cap: FormCap; retryAfter: number }> {
    const ids = new Map<FormCap, string>();
    for (const one of charges) ids.set(one.cap, await marks.mark({ subject: one.subject, purpose: one.purpose }, at));
    for (const one of charges) {
      const since = at - one.window;
      if ((await marks.sentSince(one.subject, since, one.purpose)) > one.limit) {
        await marks.unmark([...ids.values()]);
        return { ok: false, cap: one.cap, retryAfter: await waitOf(one.subject, one.purpose, since, one.window, at) };
      }
    }
    return { ok: true, ids };
  }

  return {
    /**
     * The address's hour and the form's hour, charged before the answer is
     * read. `release` gives back the form's mark (an answer refused); the
     * address's is kept whatever happens.
     */
    async chargeAnswer(form: CappedForm, ip: string, at: number): Promise<CapCharge> {
      const out = await charge(
        [
          { cap: 'address', subject: addressSubject(key, ip), purpose: PURPOSE.address, limit: FORM_PER_ADDRESS_HOUR, window: HOUR_MS },
          { cap: 'form', subject: formSubject(form), purpose: PURPOSE.form, limit: form.perHour, window: HOUR_MS },
        ],
        at,
      );
      if (!out.ok) return { ok: false, cap: out.cap, retryAfter: out.retryAfter, window: 'hour' };
      const formMark = out.ids.get('form');
      return {
        ok: true,
        release: async () => {
          if (formMark !== undefined) await marks.unmark([formMark]);
        },
      };
    },

    /** The e-mail address's day, charged once the answer names one. `release` gives it back. */
    async chargeEmail(form: CappedForm, email: string, at: number): Promise<CapCharge> {
      const out = await charge([{ cap: 'email', subject: emailSubject(key, form, email), purpose: PURPOSE.email, limit: FORM_PER_EMAIL_DAY, window: DAY_MS }], at);
      if (!out.ok) return { ok: false, cap: out.cap, retryAfter: out.retryAfter, window: 'day' };
      const mark = out.ids.get('email');
      return {
        ok: true,
        release: async () => {
          if (mark !== undefined) await marks.unmark([mark]);
        },
      };
    },

    /**
     * Whether a mark of `purpose` for `subject` may be made now, at most
     * `limit` in `window`: made when it may (one confirmation mail a day to
     * an address, one alert an hour about a form).
     */
    async once(subject: string, purpose: string, limit: number, window: number, at: number): Promise<boolean> {
      const id = await marks.mark({ subject, purpose }, at);
      if ((await marks.sentSince(subject, at - window, purpose)) > limit) {
        await marks.unmark([id]);
        return false;
      }
      return true;
    },

    /** The sweep: marks older than any window a cap reads. */
    prune: (at: number) => marks.prune(at - 2 * DAY_MS),
  };
}

export type FormCaps = ReturnType<typeof createFormCaps>;
