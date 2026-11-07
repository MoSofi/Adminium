// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WARNING LAYER: secrets this server cannot know.
 *
 * A key a person pasted into a page's text, an email or a row was never kept
 * sealed here, so the secret scan cannot find it. This looks for what such a
 * key looks like, in the places a person types: page text, email templates,
 * public endpoint replies, automations (a webhook's body and its header's
 * name, where a pasted provider key usually sits), documents, reports,
 * invoice layouts, scheduled reports, the tables (a column's literal default,
 * its rules and labels), option lists, roles, rows (seeds and sample files)
 * and every other package file:
 *  - a provider's shape: a private key block, a well-known key prefix;
 *  - a high-randomness string: 24 characters or more, letters and digits
 *    mixed, with a Shannon entropy of at least 4 bits a character, that is not
 *    a hash, a ULID or an id the app carries on purpose.
 * A hit is a `choice`: clear the field, or keep it (it is no secret).
 */
import type { CheckItem } from '../check.js';
import type { SaveChoices } from '../types.js';
import { itemTargetOf, targetOf, type GateContent, type Leaf } from './content.js';
import { leafPlace } from './secrets.js';

/** The manifest blocks a person types text into. */
const TYPED_BLOCKS = new Set([
  'pages',
  'emailTemplates',
  'outbox',
  'publicAccess',
  'publicKeys',
  'seeds',
  'instance',
  'automations',
  'documents',
  'reports',
  'invoiceLayouts',
  'scheduledReports',
  'requiredSchema',
  'optionLists',
  'roles',
]);

/** Shapes providers give their secrets. Matched anywhere in a string. */
const PROVIDER_SHAPES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'a private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/ },
  { name: 'a payment provider\'s secret key', pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'a webhook signing secret', pattern: /\bwhsec_[A-Za-z0-9+/=]{16,}/ },
  { name: 'a GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { name: 'a GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { name: 'a Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'a Slack webhook address', pattern: /hooks\.slack\.com\/services\/[A-Za-z0-9/]{16,}/ },
  { name: 'an AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'an AI provider\'s key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'a SendGrid key', pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { name: 'a Mailgun key', pattern: /\bkey-[0-9a-f]{32}\b/ },
  { name: 'an npm token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'a signed token (JWT)', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

export const ENTROPY_MIN_LENGTH = 24;
export const ENTROPY_MIN_BITS = 4;

/** Bits per character. */
export function shannonEntropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** A token the app carries on purpose: a hash, a ULID or an id, a UUID, an integrity string. */
function carriedOnPurpose(token: string): boolean {
  if (/^[0-9a-f]+$/i.test(token)) return true;
  if (/^(?:[a-z]{2,5}_)?[0-9A-HJKMNP-TV-Z]{26}$/.test(token)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return true;
  if (/^sha(?:1|256|384|512)-/.test(token)) return true;
  // A path or a dotted name of words (`seeds/order-lines.json`, `orders.created_at`).
  if (/^[A-Za-z_-]+(?:[./][A-Za-z0-9_-]+)+$/.test(token) && token.split(/[./]/).every((part) => part.length <= 20)) return true;
  return false;
}

/** A high-randomness token in the text, or null. */
export function randomLooking(text: string): string | null {
  // An inline picture is base64 by nature.
  const plain = text.replace(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+/gi, '');
  for (const raw of plain.match(/[A-Za-z0-9+/_\-=.~]{24,}/g) ?? []) {
    const token = raw.replace(/[=.]+$/, '');
    if (token.length < ENTROPY_MIN_LENGTH) continue;
    if (!/[0-9]/.test(token) || !/[A-Za-z]/.test(token)) continue;
    if (carriedOnPurpose(token)) continue;
    if (shannonEntropy(token) >= ENTROPY_MIN_BITS) return token;
  }
  return null;
}

/** What a string looks like, when it looks like a secret. */
export function secretLooking(text: string): string | null {
  for (const shape of PROVIDER_SHAPES) if (shape.pattern.test(text)) return shape.name;
  return randomLooking(text) === null ? null : 'a long random string, like a key';
}

function typed(leaf: Leaf): boolean {
  if (leaf.file !== null) return true;
  const top = leaf.parts[0];
  return typeof top === 'string' && TYPED_BLOCKS.has(top);
}

/**
 * Each place a person typed something that looks like a secret, as a choice.
 * Places already answered, and those the secret scan already named, are left out.
 */
export function secretWarnings(content: GateContent, choices: Pick<SaveChoices, 'clear' | 'keep' | 'leaveOut'>, alreadyNamed: ReadonlySet<string>): CheckItem[] {
  const clear = new Set(choices.clear ?? []);
  const keep = new Set(choices.keep ?? []);
  const leaveOut = new Set(choices.leaveOut ?? []);
  const out: CheckItem[] = [];
  const seen = new Set<string>();
  for (const leaf of content.leaves) {
    if (!typed(leaf)) continue;
    const looks = secretLooking(leaf.value);
    if (looks === null) continue;
    const place = leafPlace(content, leaf);
    const target = targetOf(place);
    if (seen.has(target) || alreadyNamed.has(target) || clear.has(target) || keep.has(target) || leaveOut.has(itemTargetOf(place))) continue;
    seen.add(target);
    out.push({
      group: 'choice',
      code: 'SECRET_LIKELY',
      kind: place.kind,
      item: place.item,
      ...(place.field === '' ? {} : { field: place.field }),
      message: `${place.path} holds what looks like ${looks}. Clear it, or keep it if it is no secret.`,
      answer: { choices: ['clear', 'keep'], target },
    });
  }
  return out;
}
