// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STAND-IN, until the lead source contract and the `addOn.sources` word are
 * in `@adminium/add-on-contracts` and `@adminium/manifest`: the few names the
 * engine's sources code reads, spelled as the contract spells them. Removed,
 * and every import pointed at the packages, once they are.
 */
import { z } from 'zod';

export const LEAD_SOURCE_CONTRACT = 'lead-source';
export const LEAD_SOURCE_VERSION = 1;
export const LEAD_SOURCE_FACTORY = 'createLeadSource';

export type LeadSourceHttpClient = (input: string | URL, init?: Omit<RequestInit, 'redirect' | 'signal'>) => Promise<Response>;

export interface LeadSourceContext {
  readonly source: string;
  readonly key: string | null;
  readonly http: LeadSourceHttpClient;
  readonly signal: AbortSignal;
  readonly locale: string;
}

export const LEAD_SOURCE_ERROR_CODES = ['KEY_REFUSED', 'RATE_LIMITED', 'QUOTA_SPENT', 'NOT_FOUND', 'UNAVAILABLE', 'INVALID_REQUEST'] as const;
export type LeadSourceErrorCode = (typeof LEAD_SOURCE_ERROR_CODES)[number];

export interface LeadSourceError {
  ok: false;
  code: LeadSourceErrorCode;
  message: string;
  retryAfterSeconds?: number | undefined;
}

export interface KeyChecked {
  ok: true;
  account?: string | undefined;
}

export interface LeadSource {
  checkKey(): Promise<KeyChecked | LeadSourceError>;
  findCompanies?(query: unknown): Promise<unknown>;
  fillCompany?(query: unknown): Promise<unknown>;
  fromWebsite?(page: unknown): Promise<unknown>;
  findPeople?(query: unknown): Promise<unknown>;
}

export type CreateLeadSource = (context: LeadSourceContext) => LeadSource;

export const leadSourceErrorSchema = z
  .object({ ok: z.literal(false), code: z.enum(LEAD_SOURCE_ERROR_CODES), message: z.string().max(2000), retryAfterSeconds: z.number().int().min(0).max(86_400).optional() })
  .strict();

export const LEAD_SOURCE_ANSWER_SCHEMAS = {
  checkKey: z.object({ ok: z.literal(true), account: z.string().max(100).optional() }).strict(),
} as const;

export const LEAD_SOURCE_GIVES = ['find', 'fill', 'people'] as const;
export type LeadSourceGives = (typeof LEAD_SOURCE_GIVES)[number];

/** One `addOn.sources` entry, as the manifest word declares it. */
export const leadSourceEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
    hosts: z.array(z.string().min(1).max(253)).max(16).optional(),
    reads: z.literal('website').optional(),
    key: z.string().min(1).max(64).optional(),
    gives: z.array(z.enum(LEAD_SOURCE_GIVES)).min(1).max(3),
    window: z.object({ calls: z.number().int().min(1).max(100_000), seconds: z.number().int().min(1).max(86_400) }).strict().optional(),
    paid: z.boolean().optional(),
  })
  .strict();
export type LeadSourceEntry = z.infer<typeof leadSourceEntrySchema>;

/** A manifest's `addOn.sources`, read off the document; none when it declares none or they do not read. */
export function sourcesOfDocument(manifest: { addOn: object }): LeadSourceEntry[] {
  const parsed = z.array(leadSourceEntrySchema).max(8).safeParse((manifest.addOn as { sources?: unknown }).sources);
  return parsed.success ? parsed.data : [];
}

/** A companies entry's `lead` word: the columns a company's details go in. */
export interface PeopleLead {
  number?: string;
  website?: string;
  phone?: string;
  address?: { lines?: string; town?: string; region?: string; postalCode?: string; country?: string };
  activity?: string;
  about?: string;
  owner?: string;
}

/** A people entry's `lead`, read off the entry; none when it has none. */
export function leadOfEntry(entry: object): PeopleLead | undefined {
  const lead = (entry as { lead?: unknown }).lead;
  return typeof lead === 'object' && lead !== null ? (lead as PeopleLead) : undefined;
}
