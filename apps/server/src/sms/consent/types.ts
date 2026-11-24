// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WORDS OF TEXT CONSENT — what the send path, the inbound route, the
 * console and the erasure say to `createTextConsentService`.
 *
 * Text consent shares the address keys with e-mail and nothing else. Its log
 * and its stop list are stores of their own, so no e-mail yes, no newsletter
 * answer and no "existing customers" basis can ever be read as a text yes, and
 * the do-not-email page never shows a phone.
 */
import type { AddressHash, ConsentHow, ConsentPerson } from '@adminium/meta';

import type { StaffMember } from '../../consent/types.js';
import type { PhoneFailureReason } from '../../phone/index.js';

/** Service and marketing are two answers. Neither one implies the other. */
export const TEXT_PURPOSES = ['text-service', 'text-marketing'] as const;
export type TextPurpose = (typeof TEXT_PURPOSES)[number];

export type TextClass = 'service' | 'marketing';

/**
 * Why a number is on the stop list. `text-stop`: they replied STOP.
 * `provider-opt-out`: the provider refused a send because they had opted out.
 * `staff`: they asked the business, the only way from a sender name.
 * `erased`: the entry of an erased person, which keeps the hash alone.
 */
export const TEXT_STOP_REASONS = ['text-stop', 'provider-opt-out', 'staff', 'erased'] as const;
export type TextStopReason = (typeof TEXT_STOP_REASONS)[number];

/** Where an event came from. `reply` and `provider` are written by the stop list alone. */
export const TEXT_CONSENT_SOURCES = ['form', 'staff', 'person', 'reply', 'provider'] as const;
export type TextConsentSource = (typeof TEXT_CONSENT_SOURCES)[number];

/** `start` records that a person lifted their block. It is never a yes. */
export type TextConsentState = 'yes' | 'no' | 'start';

/** Every reason a text is refused. Each is safe to log: none holds the number. */
export type TextRefusal =
  /** The number cannot be read as one exact E.164 number. */
  | 'unreadable-phone'
  /** It reads, but a text cannot reach it: a landline, a toll-free number, an extension. */
  | 'cannot-receive-text'
  /** Mainland China, for every class of text. */
  | 'country-blocked'
  /** A country where replies do not work, so a marketing opt-out cannot. */
  | 'country-blocked-for-marketing'
  /** A sender name cannot receive STOP. */
  | 'marketing-from-name'
  /** This server cannot read a STOP reply, so it sends no marketing. */
  | 'marketing-without-replies'
  | 'stopped'
  | 'no-consent'
  /** A country that expects double opt-in, and this yes was never confirmed. */
  | 'unconfirmed-consent'
  /** A class this code does not know. */
  | 'unknown-class';

/** How the person can opt out of this text: by replying, or through the business. */
export type TextOptOut = 'reply-stop' | 'through-business';

export type TextDecision =
  | { send: true; e164: string; country: string; optOut: TextOptOut }
  | { send: false; reason: TextRefusal; phoneReason?: PhoneFailureReason | undefined };

export interface TextRequest {
  /** As held: any value, because old rows may hold anything. */
  phone: unknown;
  /** The business's country, to read a local number in; null when none is set. */
  country: string | null;
  class: TextClass;
  sender: { kind: 'number' | 'name' };
  /** Whether a STOP reply can reach this server (a public https address, the inbound route on). */
  repliesReachUs: boolean;
  /** The row the number was read from, when there is one. */
  person?: ConsentPerson | null | undefined;
  /**
   * The person texted this business a moment ago, and this is the answer they
   * asked for. A service text only: it stands in for their yes, never for a
   * marketing yes, and the stop list refuses it as any other.
   */
  answering?: boolean | undefined;
}

export interface TextStopRecord {
  id: string;
  phone: AddressHash;
  /** The number, sealed; null for an entry that keeps the hash alone. */
  phoneEncrypted: string | null;
  reason: TextStopReason;
  origin: string | null;
  addedAt: number;
  addedById: string | null;
  addedByLabel: string | null;
  erasedAt: number | null;
}

export interface TextConsentEvent {
  id: string;
  person: ConsentPerson | null;
  phone: AddressHash | null;
  /** Null only on a `start` row, which is about no purpose. */
  purpose: TextPurpose | null;
  state: TextConsentState;
  source: TextConsentSource;
  detail: string | null;
  how: ConsentHow | null;
  note: string | null;
  staffId: string | null;
  staffLabel: string | null;
  wording: string | null;
  wordingVersion: string | null;
  ip: string | null;
  userAgent: string | null;
  at: number;
  confirmedAt: number | null;
}

/** Who a question is about: a number, a row, or both. */
export interface TextWho {
  phone?: unknown;
  country?: string | null | undefined;
  person?: ConsentPerson | null | undefined;
}

export interface TextConsentInput extends TextWho {
  purpose: TextPurpose;
  /** `form` or `staff` for a yes; `form`, `staff` or `person` for a no. */
  source: 'form' | 'staff' | 'person';
  /** A form's name or a fixed word. Any phone in it is masked before it is kept. */
  detail?: string | null | undefined;
  how?: ConsentHow | null | undefined;
  /** Any phone in it is masked before it is kept. */
  note?: string | null | undefined;
  staff?: StaffMember | null | undefined;
  /** The words the person was shown, and their version. Required for a yes. */
  wording?: { text: string; version: string } | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  confirmedAt?: number | null | undefined;
  at?: number | undefined;
}

export interface TextStanding {
  purpose: TextPurpose;
  state: 'yes' | 'no' | 'not-asked';
  event: TextConsentEvent | null;
}

/** A stop-list entry as the console shows it. */
export interface TextStopView {
  id: string;
  /** The number; null once its person was erased. */
  phone: string | null;
  /** The form to show or log, `+49 ••• 789`; null once erased. */
  masked: string | null;
  reason: TextStopReason;
  origin: string | null;
  addedAt: number;
  addedBy: StaffMember | null;
  erasedAt: number | null;
}

export interface TextStopAddInput {
  phone: unknown;
  /** To read a local number a staff member typed. A provider's number is already E.164. */
  country?: string | null | undefined;
  reason: Exclude<TextStopReason, 'erased'>;
  origin?: string | null | undefined;
  staff?: StaffMember | null | undefined;
  person?: ConsentPerson | null | undefined;
  at?: number | undefined;
}

/**
 * What a START did. `lifted`: the entry is gone, and consent is still needed.
 * `kept`: a staff-recorded or erased entry, which a text cannot lift.
 */
export type TextStartResult = 'lifted' | 'not-on-list' | 'kept' | 'unreadable';

export type TextStopRemoveResult = 'removed' | 'missing' | 'erased';

export interface TextEraseInput {
  /** The number on their row, if any. One that cannot be read still erases the row's own events. */
  phone?: unknown;
  country?: string | null | undefined;
  person?: ConsentPerson | null | undefined;
  at?: number | undefined;
}

export interface TextEraseResult {
  /** `none`: no number was given. `unreadable`: one was, and it names no exact number. */
  stopList: 'erased' | 'added' | 'none' | 'unreadable';
  consentRows: number;
}

/** A marketing yes confirmed (double opt-in): by the link in a mail, or by a named staff member who asked them in person. */
export interface TextConfirmInput {
  /** The yes of the log being confirmed. */
  eventId: string;
  /** The number that yes was given for, as the person's row holds it now. */
  phone: unknown;
  country?: string | null | undefined;
  source: 'form' | 'staff';
  /** A fixed word: `confirmed-by-email`, `confirmed-in-person`. */
  detail: string;
  how?: ConsentHow | null | undefined;
  staff?: StaffMember | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  at?: number | undefined;
}

/**
 * What a confirmation did. `superseded`: a later answer stands for that number
 * (a no, a STOP, or another yes), so this yes can no longer be confirmed.
 * `missing`: no such yes, or it was given for another number.
 */
export type TextConfirmResult = { outcome: 'confirmed'; event: TextConsentEvent } | { outcome: 'already' | 'superseded' | 'stopped' | 'missing' };

export interface TextConsentService {
  /** May this text go? Reads the stop list and the log; throws rather than answers when they cannot be read. */
  decide(request: TextRequest): Promise<TextDecision>;
  /** Add a yes or a no. A yes needs an exact number, its wording, and a form or a named staff member. */
  record(input: TextConsentInput & { state: 'yes' | 'no' }): Promise<TextConsentEvent>;
  /** Confirms a marketing yes that still stands: a copy of it with `confirmedAt`, so the log keeps both. */
  confirm(input: TextConfirmInput): Promise<TextConfirmResult>;
  /** Their standing for one purpose on this exact number. */
  standing(who: TextWho, purpose: TextPurpose): Promise<TextStanding>;
  /** Their events, newest first. */
  history(who: TextWho, opts?: { limit?: number | undefined }): Promise<TextConsentEvent[]>;
  /** The erasure: events deleted, and the stop entry kept as a hash alone. */
  erase(input: TextEraseInput): Promise<TextEraseResult>;
  stop: {
    /** STOP, a provider's opt-out, or a staff record: on the list, and a no for both purposes, in one transaction. */
    add(input: TextStopAddInput): Promise<{ entry: TextStopView; added: boolean }>;
    /** A START reply: lifts a STOP or a provider's opt-out. It never records a yes. */
    start(input: { phone: unknown; at?: number | undefined }): Promise<TextStartResult>;
    /** Staff take an entry off. An erased person's stays. Consent is not restored. */
    remove(id: string): Promise<TextStopRemoveResult>;
    /** Whether this number is stopped. A value that names no exact number answers true. */
    has(phone: unknown, country: string | null): Promise<boolean>;
    entryFor(phone: unknown, country: string | null): Promise<TextStopView | null>;
    /** Newest first. */
    list(opts: { limit: number; cursor?: string | null | undefined; reason?: TextStopReason | undefined }): Promise<{ entries: TextStopView[]; next: string | null }>;
  };
}
