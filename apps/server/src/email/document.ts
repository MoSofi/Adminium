// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email document envelope — what one `adminium_email_templates` row
 * MEANS, as opposed to what it stores.
 *
 * Three jobs, all pure:
 *
 *   1. {@link normalizeDocument} — a document arriving on the wire (a `PUT`
 *      body, an import bundle, a starter) or read off a row becomes one shape:
 * a trailing legacy `email.footer` block is lifted into `footer`, every block
 *      carries an id, absent fields get their empty value.
 *   2. {@link validateDocument} — the rules the repo deliberately does NOT
 *      enforce, because they need context the meta store has no business
 *      holding: a known kind's data shape (Appendix C), a `From` that is a
 * configured sender, the attachment cap, `https:` on a pasted image URL.
 *      UNKNOWN KINDS PASS THROUGH UNTOUCHED — a row a newer server wrote must
 *      survive an older one's save, the same forward-compatibility rule the
 *      renderer has always had.
 *   3. {@link mintKey} / {@link documentVars} — a key from a name
 *      (`weekly-digest`, `weekly-digest-2`, never a built-in's key) and the
 *      variables a document may use, which are DERIVED from what it is rather
 * than stored beside it.
 *
 * The block vocabulary itself — the 24 comp types as `email.*` kinds — is
 * declared once in `render.ts` (`EMAIL_BLOCK_KINDS`), because the gate that
 * holds the canvas and the renderer together reads it there.
 */

import { z } from 'zod';
import {
  emailAttachmentsSchema,
  emailBlockStyleSchema,
  emailBrandSchema,
  liftLegacyFooter,
  newEmailBlockId,
  type EmailAttachment,
  type EmailBrand,
  type EmailTemplate,
} from '@adminium/meta';

import { ValidationFailedError } from '../errors.js';
import { BUILTIN_EMAIL_TEMPLATE_KEYS, BUILTIN_EMAIL_TEMPLATE_VARS } from './builtins.js';
import { isEmailBlockKind, type EmailBlockKind } from './render.js';
import { STARTER_VARS, isEmailStarterKey } from './starters.js';
import type { EmailBlock, EmailDocument } from './types.js';

// --- the envelope ---------------------------------------------------------------------

export type { EmailBlock, EmailDocument, EmailRenderSource } from './types.js';

export const SUBJECT_MAX = 300;
export const PREHEADER_MAX = 300;
export const FOOTER_MAX = 2000;
export const BLOCKS_MAX = 200;

/** The wire shape of a document — everything optional but the subject and the blocks. */
export const emailDocumentInputSchema = z.object({
  subject: z.string().max(SUBJECT_MAX),
  preheader: z.string().max(PREHEADER_MAX).optional(),
  blocks: z.array(z.record(z.string(), z.unknown())).max(BLOCKS_MAX),
  footer: z.string().max(FOOTER_MAX).optional(),
  brand: emailBrandSchema.nullable().optional(),
  attachments: emailAttachmentsSchema.optional(),
});
export type EmailDocumentInput = z.infer<typeof emailDocumentInputSchema>;

/** The reply shape — every field present. */
export const emailDocumentSchema = z.object({
  subject: z.string(),
  preheader: z.string(),
  blocks: z.array(
    z.object({
      id: z.string(),
      block: z.string(),
      data: z.record(z.string(), z.unknown()),
      style: emailBlockStyleSchema,
    }),
  ),
  footer: z.string(),
  brand: emailBrandSchema.nullable(),
  attachments: emailAttachmentsSchema,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One block record → {@link EmailBlock}. A missing id is minted (the built-ins
 * name theirs; the comp mints the rest); `data`/`style` default to empty; an
 * unrecognised `style` value is dropped axis by axis rather than failing the
 * block, because a style is cosmetic and a save must never be refused over one.
 */
export function normalizeBlock(raw: Record<string, unknown>): EmailBlock {
  const style = emailBlockStyleSchema.safeParse(isRecord(raw['style']) ? raw['style'] : {});
  return {
    id: typeof raw['id'] === 'string' && raw['id'].length > 0 ? raw['id'] : newEmailBlockId(),
    block: typeof raw['block'] === 'string' ? raw['block'] : '',
    data: isRecord(raw['data']) ? raw['data'] : {},
    style: style.success ? style.data : {},
  };
}

/** A row or a wire body → the one envelope shape (the read side). */
export function normalizeDocument(
  input: EmailDocumentInput | Pick<EmailTemplate, 'subject' | 'preheader' | 'blocks' | 'footer' | 'brand' | 'attachments'>,
): EmailDocument {
  const lifted = liftLegacyFooter(input.blocks, input.footer ?? '');
  return {
    subject: input.subject,
    preheader: input.preheader ?? '',
    blocks: lifted.blocks.map(normalizeBlock),
    footer: lifted.footer,
    brand: input.brand ?? null,
    attachments: input.attachments ?? [],
  };
}

/** The stored halves of a normalized document, for the repo's `patch`/`create`. */
export function documentColumns(doc: EmailDocument): {
  subject: string;
  preheader: string;
  blocks: Record<string, unknown>[];
  footer: string;
  brand: EmailBrand | null;
  attachments: EmailAttachment[];
} {
  return {
    subject: doc.subject,
    preheader: doc.preheader,
    blocks: doc.blocks.map((b) => ({ id: b.id, block: b.block, data: b.data, style: b.style })),
    footer: doc.footer,
    brand: doc.brand,
    attachments: doc.attachments,
  };
}

// --- per-kind data (Appendix C) -------------------------------------------------------

const text = z.string().max(4000);
const short = z.string().max(300);
const num = z.union([z.number(), z.string().max(40)]);
const loose = z.object({}).passthrough();

const rowOf = <T extends z.ZodRawShape>(shape: T) => z.array(z.object(shape).passthrough()).max(100);

/**
 * What each known kind's `data` must look like. LENIENT on purpose: strings
 * may be empty (the comp's defaults are placeholders the author overwrites),
 * every object is `passthrough` (the comp keeps a `file` name beside an
 * image's `url`; the editor may add more), and numbers accept a numeric
 * string because inspector fields are text inputs. What is refused is a SHAPE
 * that would make the renderer or the inspector throw: a `paras` that is not
 * an array, a `steps` row that is a string.
 */
export const EMAIL_BLOCK_DATA_SCHEMAS: Readonly<Record<EmailBlockKind, z.ZodType<Record<string, unknown>>>> = {
  'email.heading': loose.extend({ text: text.optional(), level: z.union([z.literal(1), z.literal(2)]).optional() }),
  'email.text': loose.extend({ paras: z.array(text).max(50).optional(), text: text.optional() }),
  'email.button': loose.extend({ label: short.optional(), url: z.string().max(2000).optional() }),
  'email.divider': loose.extend({ height: num.optional(), line: z.boolean().optional() }),
  'email.spacer': loose.extend({ size: num.optional() }),
  'email.footer': loose.extend({ text: text.optional() }),
  'email.box': loose.extend({ label: short.optional(), value: short.optional() }),
  'email.image': loose.extend({
    alt: short.optional(),
    url: z.string().max(2000).optional(),
    fileId: z.string().max(36).nullable().optional(),
    height: num.optional(),
  }),
  'email.two-col': loose.extend({ a: text.optional(), b: text.optional() }),
  'email.list': loose.extend({ items: z.array(short).max(50).optional() }),
  'email.quote': loose.extend({ text: text.optional(), author: short.optional() }),
  'email.stats': loose.extend({ stats: rowOf({ value: short.optional(), label: short.optional() }).optional() }),
  'email.product': loose.extend({
    items: rowOf({ name: short.optional(), meta: short.optional(), qty: short.optional(), price: short.optional() }).optional(),
  }),
  'email.social': loose.extend({
    links: rowOf({ label: short.optional(), icon: short.optional(), url: z.string().max(2000).optional() }).optional(),
  }),
  'email.html': loose.extend({ code: z.string().max(20_000).optional() }),
  'email.po-terms': loose.extend({ kicker: short.optional(), text: text.optional() }),
  'email.refund-policy': loose.extend({ kicker: short.optional(), text: text.optional() }),
  'email.legal': loose.extend({ kicker: short.optional(), text: text.optional() }),
  'email.multi-currency': loose.extend({
    kicker: short.optional(),
    amount: num.optional(),
    fx: rowOf({ code: short.optional(), sym: short.optional(), rate: num.optional() }).optional(),
  }),
  'email.tax-breakdown': loose.extend({
    kicker: short.optional(),
    lines: rowOf({ label: short.optional(), amount: short.optional() }).optional(),
  }),
  'email.discount-codes': loose.extend({
    kicker: short.optional(),
    codes: rowOf({ code: short.optional(), label: short.optional(), amount: short.optional() }).optional(),
  }),
  'email.payment-history': loose.extend({
    kicker: short.optional(),
    items: rowOf({ date: short.optional(), method: short.optional(), amount: short.optional(), status: short.optional() }).optional(),
  }),
  'email.recurring': loose.extend({ freq: short.optional(), next: short.optional(), note: short.optional() }),
  'email.contact': loose.extend({ kicker: short.optional(), name: short.optional(), email: short.optional(), phone: short.optional() }),
  'email.loyalty': loose.extend({ balance: num.optional(), earned: num.optional(), level: short.optional() }),
  'email.delivery': loose.extend({
    kicker: short.optional(),
    steps: rowOf({ label: short.optional(), status: z.enum(['todo', 'current', 'done']).optional() }).optional(),
  }),
};

// --- validation ------------------------------------------------------------------------

export interface ValidateDocumentContext {
  /** Every address a document may send from — `email.smtp.from` plus
   * `email.senders`. */
  senders: readonly string[];
  /** `email.maxAttachmentBytes`. */
  maxAttachmentBytes: number;
  /** Size of each referenced library file; `null` = missing or trashed. */
  attachmentSizes: ReadonlyMap<string, number | null>;
}

/** `Name <addr@x>` or `addr@x` → the bare address, lowercased. */
export function bareAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  return (angled?.[1] ?? value).trim().toLowerCase();
}

/**
 * Refuses what a save must not persist, with a 422 whose `details.code` names
 * the rule so the editor can point at the field (`PUT`).
 *
 * Attachments: a MISSING file is not refused here — the row may be saved and
 * the editor shows *File missing*; what is refused is a total over the cap,
 * computed over the files that exist.
 */
export function validateDocument(doc: EmailDocument, ctx: ValidateDocumentContext): void {
  for (const [index, block] of doc.blocks.entries()) {
    if (!isEmailBlockKind(block.block)) continue; // forward-compatible: unknown kinds pass through
    const parsed = EMAIL_BLOCK_DATA_SCHEMAS[block.block].safeParse(block.data);
    if (!parsed.success) {
      throw new ValidationFailedError(`Block ${String(index + 1)} (${block.block}) has invalid data.`, {
        code: 'BLOCK_DATA_INVALID',
        index,
        block: block.block,
        issues: parsed.error.issues,
      });
    }
    if (block.block === 'email.image') {
      const url = typeof block.data['url'] === 'string' ? block.data['url'].trim() : '';
      if (url !== '' && !/^https:\/\//i.test(url)) {
        throw new ValidationFailedError('Image URLs must use https.', {
          code: 'IMAGE_URL_NOT_HTTPS',
          index,
          url,
        });
      }
    }
  }

  if (doc.brand !== null && doc.brand.fromEmail.trim() !== '') {
    const wanted = bareAddress(doc.brand.fromEmail);
    const configured = ctx.senders.map(bareAddress);
    if (!configured.includes(wanted)) {
      throw new ValidationFailedError(`${doc.brand.fromEmail} is not a configured sender.`, {
        code: 'SENDER_NOT_CONFIGURED',
        address: doc.brand.fromEmail,
      });
    }
  }

  let total = 0;
  for (const attachment of doc.attachments) {
    if (attachment.kind !== 'file') continue;
    total += ctx.attachmentSizes.get(attachment.fileId) ?? 0;
  }
  if (total > ctx.maxAttachmentBytes) {
    throw new ValidationFailedError(
      `Attachments total ${String(total)} bytes, over the cap of ${String(ctx.maxAttachmentBytes)} bytes.`,
      { code: 'ATTACHMENTS_OVER_CAP', total, cap: ctx.maxAttachmentBytes },
    );
  }
}

// --- keys ------------------------------------------------------------------------------

export const EMAIL_KEY_MAX = 80;
export const EMAIL_KEY_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

const RESERVED_KEYS: ReadonlySet<string> = new Set<string>(BUILTIN_EMAIL_TEMPLATE_KEYS);

/** True for a key the built-ins own (those reset instead of dying). */
export function isBuiltinEmailKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}

/** `Weekly digest — Week 28` → `weekly-digest-week-28`; never empty. */
export function slugKey(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, EMAIL_KEY_MAX)
    .replace(/-+$/g, '');
  return slug === '' ? 'email' : slug;
}

/**
 * A free key for `name`: the slug, or `slug-2`, `slug-3`, … past every key in
 * `taken` (the repo's `keysLike(slug)`) and every built-in key — an operator
 * naming a template "Password reset" gets `password-reset-2`, never the row
 * the forgot-password flow renders from.
 */
export function mintKey(name: string, taken: readonly string[]): string {
  const base = slugKey(name);
  const used = new Set<string>([...taken, ...RESERVED_KEYS]);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${String(n)}`;
    const candidate = `${base.slice(0, EMAIL_KEY_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

// --- variables ---------------------------------------------------------------

/** What a workspace-user send fills per recipient. */
export const WORKSPACE_USER_VARS = ['appName', 'name', 'first_name', 'email'] as const;

/**
 * The variables a document may use — from what it IS, never stored: a
 * built-in key reads its enqueue contract; a starter family reads the
 * workspace-user set plus the starter's own; a blank document the workspace
 * set alone.
 */
export function documentVars(key: string, starter: string | null = null): readonly string[] {
  if (isBuiltinEmailKey(key)) {
    return BUILTIN_EMAIL_TEMPLATE_VARS[key as keyof typeof BUILTIN_EMAIL_TEMPLATE_VARS];
  }
  if (isEmailStarterKey(starter)) {
    return [...new Set<string>([...WORKSPACE_USER_VARS, ...STARTER_VARS[starter]])];
  }
  return WORKSPACE_USER_VARS;
}

/** `{{name}}` chips the way the comp shows them (`insertVar`, comp 1040). */
export function varTokens(vars: readonly string[]): string[] {
  return vars.map((v) => `{{${v}}}`);
}
