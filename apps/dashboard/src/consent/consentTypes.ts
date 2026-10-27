// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record's e-mail consent, as the server answers it (`POST /consent/panel`),
 * and the four calls the panel makes (`ConsentClient`).
 *
 * Types and constants only, and no import of the dashboard's: the panel is
 * drawn by the dashboard's record page and by an app's own screen (the kit's
 * `consent` part), each over its own transport.
 *
 * The server never sends the record's address back: the panel learns only
 * which columns hold the address and the name, and shows the values as the
 * page holds them for this reader, masked or not.
 */
export const CONSENT_PURPOSES = ['newsletter', 'surveys'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_HOWS = ['in-person', 'phone', 'email', 'paper'] as const;
export type ConsentHow = (typeof CONSENT_HOWS)[number];

export type ConsentSource = 'form' | 'import' | 'staff' | 'review' | 'unsubscribe' | 'relay' | 'bounce' | 'system' | 'person';
export type StopReason = 'link' | 'spam' | 'bounce' | 'hand' | 'relay-unsubscribe' | 'old-mark' | 'lead-finder' | 'erased';

/** One record of a table, as the record page names it. */
export interface ConsentRecordRef {
  connectionId: string;
  table: string;
  recordId: string;
}

/** One line of the consent log. */
export interface ConsentEventView {
  id: string;
  purpose: ConsentPurpose | null;
  state: 'yes' | 'no' | 'replied';
  source: ConsentSource;
  detail: string | null;
  how: ConsentHow | null;
  note: string | null;
  staff: { id: string; label: string } | null;
  wordingVersion: string | null;
  /** A sign-up's network address: only for a reader shown the table's personal columns. */
  ip: string | null;
  at: number;
  confirmedAt: number | null;
}

export interface ConsentPanelView {
  /** An installed app declares the table as people: the record page shows the panel only then. */
  declared: boolean;
  /** An erased person's row: nothing is known of them, and nothing more is recorded. */
  erased: boolean;
  /** The columns that hold the address and the name, by name only. */
  columns: { address: string | null; name: string | null };
  addressKnown: boolean;
  purposes: { purpose: ConsentPurpose; state: 'yes' | 'no' | 'not-asked'; event: ConsentEventView | null }[];
  stopped: { since: number; reason: StopReason; origin: string | null } | null;
  lastReplied: number | null;
  /** Newest first. */
  history: ConsentEventView[];
  /** May record consent, press "Replied" and "They said no". */
  mayChange: boolean;
}

export interface RecordConsentInput {
  purpose: ConsentPurpose;
  how: ConsentHow;
  note: string | null;
}

/** The four calls the panel makes: the dashboard's own (`consentApi.ts`), or an app's screen's (the kit). */
export interface ConsentClient {
  panel(record: ConsentRecordRef): Promise<ConsentPanelView>;
  recordConsent(record: ConsentRecordRef, input: RecordConsentInput): Promise<ConsentEventView>;
  replied(record: ConsentRecordRef): Promise<ConsentEventView>;
  saidNo(record: ConsentRecordRef): Promise<{ added: boolean }>;
}
