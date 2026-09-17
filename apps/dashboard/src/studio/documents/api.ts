// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/documents`'s data.
 *
 * ─── EVERY LABEL ON THIS PAGE COMES FROM THE PROVIDER ──────────────────────
 *
 * `kind.label`, `slot.label` and `slot.help` are eight-locale records the
 * add-on carries itself (0.3 trap 19). The editor picks the viewer's locale
 * out of them and renders it. There is no bundle to load, no English
 * fallback, and — the part that matters — no vocabulary for invoices anywhere
 * in this page: a folio provider or a certificate provider appears here
 * unchanged, under its own key, with its own words.
 */

import { api } from '../../app/api.js';

const BASE = '/api/v1/documents';

/** The eight compiled locales, as the contract spells them. */
export type LocalizedText = Record<string, string>;

export interface OutlineSlot {
  id: string;
  label: LocalizedText;
  help?: LocalizedText;
  type:
    | 'text'
    | 'text[]'
    | 'date'
    | 'email'
    | 'money'
    | 'percent'
    | 'currency'
    | 'number'
    | 'collection';
  required: boolean;
  default?: 'sequence' | 'connection' | 'setting' | 'now';
  columns?: readonly OutlineSlot[];
}

export interface DocumentKindOption {
  addOnKey: string;
  kind: string;
  label: LocalizedText;
  formats: string[];
  paper: string[];
  coverage: string;
  outline: { slots: OutlineSlot[] };
}

export interface DocumentProfile {
  id: string;
  addOnKey: string;
  kind: string;
  name: string;
  connectionId: string;
  table: string;
  mapping: Record<string, unknown>;
  options: Record<string, unknown>;
  trigger: { event: string; when?: { column: string; op: string; value?: unknown } | null } | null;
  deliver: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export async function fetchKinds(): Promise<DocumentKindOption[]> {
  const reply = await api.get<{ kinds: DocumentKindOption[] }>(`${BASE}/kinds`);
  return reply.kinds;
}

export async function fetchProfiles(): Promise<DocumentProfile[]> {
  const reply = await api.get<{ profiles: DocumentProfile[] }>(`${BASE}/profiles`);
  return reply.profiles;
}

export interface ProfileDraft {
  addOnKey: string;
  kind: string;
  name: string;
  connectionId: string;
  table: string;
  mapping: Record<string, unknown>;
  options: Record<string, unknown>;
  trigger: DocumentProfile['trigger'];
  deliver: Record<string, unknown>;
  enabled?: boolean;
}

export async function createProfile(draft: ProfileDraft): Promise<DocumentProfile> {
  return await api.post(`${BASE}/profiles`, draft);
}

export async function updateProfile(
  id: string,
  patch: Partial<ProfileDraft>,
): Promise<DocumentProfile> {
  return await api.put(`${BASE}/profiles/${encodeURIComponent(id)}`, patch);
}

export async function deleteProfile(id: string): Promise<void> {
  await api.delete(`${BASE}/profiles/${encodeURIComponent(id)}`);
}

/**
 * The provider's own word for something, in the viewer's language.
 *
 * FALLS BACK ALONG THE LOCALE, then to English, then to the id. The last step
 * is the one worth stating: a provider that shipped an incomplete record fails
 * its own conformance suite, so reaching the id here means something is wrong
 * upstream — and showing the id is how somebody finds out, where showing
 * nothing would look like an empty row.
 */
export function pick(text: LocalizedText | undefined, locale: string, fallback: string): string {
  if (text === undefined) return fallback;
  const exact = text[locale];
  if (typeof exact === 'string' && exact !== '') return exact;
  const language = locale.split(/[-_]/)[0] ?? '';
  const sameLanguage = Object.keys(text).find((tag) => tag.split('-')[0] === language);
  if (sameLanguage !== undefined) return text[sameLanguage]!;
  return text['en-US'] ?? fallback;
}
