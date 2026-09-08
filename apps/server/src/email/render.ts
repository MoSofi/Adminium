// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic email renderer: an email document → one MIME-ready
 * `{ subject, html, text, inline }` (39-email-templates-and-campaigns.md §3.4).
 *
 * WHY THIS IS HAND-ROLLED. There is no React on this path and there will not
 * be one: `apps/server` has zero React dependencies, and pulling
 * react + react-dom + @react-email/* onto the server to lay out a closed
 * vocabulary would grow the Docker image and the published npm tarball for a
 * fixed set of kinds. Same taste as the bespoke charts (d3-scale / d3-shape
 * only) and the fetch-only LLM clients. Twenty-six kinds is still closed.
 *
 * WHY EVERY STYLE IS INLINE. Email HTML is not web HTML. Gmail strips
 * `<style>` blocks in forwarded mail, Outlook's Word engine ignores flexbox,
 * grid, and `position`, and no major client resolves CSS custom properties.
 * So: table layout, inline `style` attributes, hex literals — not tokens,
 * because `@adminium/tokens` is a CSS-variable package and a variable that
 * never resolves renders as *nothing*. The `adminium/no-style-prop` and
 * `adminium/no-literal-color-on-token-bg` lint rules target React JSX and
 * Tailwind class strings respectively; neither applies here. This is the one
 * module in the repo where hardcoded colour and inline style are the correct
 * answer — please do not "fix" it. The literals are the COMP'S mail colours
 * (`designs/Email Templates.dc.html` 1407-1457), which the canvas renders
 * inside `adm-always-light` for the same reason: mail has one palette.
 *
 * BLOCK VOCABULARY. Server-owned kinds under an `email.*` prefix — the comp's
 * 24 block types plus two legacy kinds (`email.spacer`, `email.footer`) that
 * stay renderable because seeded rows and every install's edits hold them.
 *
 * THREE COPIES OF THE LIST, AND A GATE HOLDS THEM TOGETHER (39 D16).
 * `apps/dashboard/src/email/model/blocks.ts` declares the same kinds for the
 * editor, and `packages/widgets/.../block-lib.ts` still declares the original
 * six for the generic page-builder canvas. Neither tree may import this one
 * (01-architecture.md §2.3), so the copies are held identical by
 * `scripts/check-email-block-vocab.mjs` in CI: the dashboard registry equals
 * this list, and the widgets' six are a prefix of it. ADD OR RENAME A KIND
 * HERE AND THE DASHBOARD LIST CHANGES IN THE SAME COMMIT, or the gate fails.
 *
 * UNKNOWN KINDS ARE SKIPPED, NEVER THROWN ON. A template row is editable at
 * runtime and round-trips through an editor that deliberately preserves block
 * kinds it does not recognise. If an unknown entry could throw, a stale row
 * would turn a password reset into a 500 and lock the user out of their own
 * account. Skipping degrades one paragraph; throwing degrades the only
 * recovery path the product has.
 *
 * WHAT MAIL CANNOT SEND AS THE COMP DRAWS IT (39 §0.2). The logo mark is an
 * `<img>` over bytes the caller attaches by CID, never an inline SVG; the
 * brand banner is a solid `bgcolor`, never a gradient; a workspace image is a
 * CID part and a pasted URL is used only when it is `https:`. None of that
 * changes what the operator sees on the canvas — it is what the recipient's
 * client can actually render.
 *
 * DETERMINISM. No clock, no randomness, no locale-sensitive formatting: the
 * same document + vars + dir render byte-identically forever, which is what
 * makes the snapshot suite meaningful. Money in the multi-currency block goes
 * through a fixed two-decimal formatter, never `toLocaleString`.
 */

import { tagFromLocaleId } from '@adminium/i18n';
import type { EmailBlockStyle, EmailBrand } from '@adminium/meta';

/**
 * Where the bytes of an inline image come from. The renderer never holds
 * bytes: it emits `cid:` references and reports what it referenced, and
 * delivery resolves each one right before `sendMail` (39 D6, D8, D9) — so
 * the same render serves a test send, a queued job and a campaign run.
 */
export type EmailInlineRef =
  | { cid: string; kind: 'mark'; mark: string }
  | { cid: string; kind: 'file'; fileId: string };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** The inline images the HTML references — the mark and any Files images. Empty when none. */
  inline: EmailInlineRef[];
}

/**
 * The closed set of block kinds this renderer understands. The first six are
 * the original vocabulary (and the generic canvas's whole list); the rest are
 * the comp's 24 types, in its picker order (Content · Commerce & data ·
 * Legal & support), minus the six already present.
 */
export const EMAIL_BLOCK_KINDS = [
  'email.heading',
  'email.text',
  'email.button',
  'email.divider',
  'email.spacer',
  'email.footer',
  'email.image',
  'email.two-col',
  'email.list',
  'email.quote',
  'email.social',
  'email.html',
  'email.box',
  'email.stats',
  'email.product',
  'email.multi-currency',
  'email.tax-breakdown',
  'email.discount-codes',
  'email.payment-history',
  'email.recurring',
  'email.loyalty',
  'email.delivery',
  'email.po-terms',
  'email.legal',
  'email.refund-policy',
  'email.contact',
] as const;

export type EmailBlockKind = (typeof EMAIL_BLOCK_KINDS)[number];

const EMAIL_BLOCK_KIND_SET: ReadonlySet<string> = new Set(EMAIL_BLOCK_KINDS);

export function isEmailBlockKind(value: unknown): value is EmailBlockKind {
  return typeof value === 'string' && EMAIL_BLOCK_KIND_SET.has(value);
}

/**
 * The comp's mail palette (comp 1408-1457) — hex literals, not tokens; see
 * the header. `accent` is the one value that varies per document (39 D6).
 */
const PALETTE = {
  page: '#f6f6f8',
  card: '#ffffff',
  rule: '#ececef',
  ruleStrong: '#e2e2e8',
  soft: '#fafafa',
  softer: '#f1f1f4',
  heading: '#17171c',
  body: '#55555f',
  muted: '#9a9aa5',
  dark: '#17171c',
  pos: '#12805c',
  posSoft: '#e6f5ee',
  onAccent: '#ffffff',
} as const;

/** The comp's default accent (its `accent` prop). */
export const DEFAULT_EMAIL_ACCENT = '#4f46e5';

/** The comp's default logo mark (`base().logoIcon`). */
export const DEFAULT_EMAIL_MARK = 'hexagon';

/**
 * The workspace accent as a mail colour — the sixth swatch (39 D6). Mail has
 * one palette, so these are the LIGHT values of `packages/tokens/src/accents.css`,
 * copied rather than imported: that package is CSS, and a variable never
 * resolves in a mail client.
 */
export const WORKSPACE_ACCENT_HEX: Readonly<Record<string, string>> = {
  indigo: '#4f46e5',
  blue: '#1c59e0',
  teal: '#007167',
  violet: '#7936e9',
  rose: '#c40039',
  red: '#c0202f',
  orange: '#b03e00',
  black: '#111111',
};

/**
 * System stack only. A webfont in email is a remote request most clients
 * block, and the fallback is what nearly everyone sees anyway.
 */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace";

const TEXT_RULE = '--------------------------------';

/** The CID the brand mark travels under (39 D6). */
export const MARK_CID = 'mark';

/** The CID a Files image travels under (39 D9). */
export function imageCid(fileId: string): string {
  return `img-${fileId}`;
}

/**
 * `{{name}}` — double braces, deliberately NOT ICU. The stored row is data an
 * admin edits in a WYSIWYG editor; ICU's single-brace grammar would make a
 * stray `{` in prose a parse error, and the built-in copy is produced by
 * running ICU messages through `t()` at seed time (see builtins.ts), so by the
 * time a template reaches this module every ICU construct is already gone.
 */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function strOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

function numOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function identity(value: string): string {
  return value;
}

/**
 * Substitute `{{var}}` from `vars`, escaping LITERAL segments and SUBSTITUTED
 * values with the same function so nothing is escaped twice.
 *
 * The escaping is the security-relevant half: a display name, an inviter's
 * name, and a workspace label are all attacker-influenced, and an unescaped
 * `<img onerror=…>` in an HTML mail body is a live payload in the clients
 * that render it. The plain-text part passes {@link identity} instead — text
 * has no markup to break out of, and `&amp;` in a URL a user has to paste by
 * hand is a broken URL.
 *
 * An UNRESOLVED placeholder is re-emitted verbatim rather than blanked. A
 * reset mail that says "use the link below" followed by nothing is a silent
 * failure; one that shows `{{url}}` is a loud one, and loud is what gets
 * fixed.
 */
function fill(source: string, vars: Record<string, string>, escape: (s: string) => string): string {
  let out = '';
  let cursor = 0;
  for (const match of source.matchAll(PLACEHOLDER_RE)) {
    const at = match.index ?? cursor;
    out += escape(source.slice(cursor, at));
    const name = match[1] ?? '';
    const value = Object.hasOwn(vars, name) ? vars[name] : undefined;
    out += escape(value ?? match[0]);
    cursor = at + match[0].length;
  }
  return out + escape(source.slice(cursor));
}

/**
 * Only `http(s):` and `mailto:` reach an `href`. A template variable can carry
 * whatever the caller was handed, and `javascript:`/`data:` in an anchor is
 * script execution in the handful of clients that still honour it. Rejected
 * URLs collapse to `#` — the plain-text part still carries the raw value, so
 * a legitimate but exotic scheme is degraded rather than lost.
 */
function safeHref(url: string): string {
  const trimmed = url.trim();
  return /^(?:https?:|mailto:)/i.test(trimmed) ? trimmed : '#';
}

/** Subjects are a header, not a body: CR/LF there is header injection. */
function sanitizeSubject(value: string): string {
  return value.replaceAll(/[\r\n]+/g, ' ').trim();
}

/** `#4f46e5` @ 12% over white → a solid hex; `rgba()` is invisible to Word-engine Outlook. */
function mixWithWhite(hex: string, alpha: number): string {
  const h = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? DEFAULT_EMAIL_ACCENT.slice(1);
  const n = Number.parseInt(h, 16);
  const channel = (shift: number): string => {
    const c = (n >> shift) & 255;
    return Math.round(c * alpha + 255 * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** A six-digit hex or the default — the canvas and the mail must agree on the colour. */
export function normalizeAccent(value: string | null | undefined): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : DEFAULT_EMAIL_ACCENT;
}

/** Two decimals with `en-US` thousands separators, without `toLocaleString` (determinism). */
export function fixedMoney(value: number): string {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  const [whole = '0', frac = '00'] = rounded.toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${grouped}.${frac}`;
}

/** Integer with `en-US` thousands separators, without `toLocaleString`. */
function fixedInt(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function stripTags(html: string): string {
  return html
    .replaceAll(/<\s*br\s*\/?>/gi, '\n')
    .replaceAll(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

// --- per-block rendering ---------------------------------------------------------------

interface BlockOut {
  html: string;
  text: string;
}

interface RenderCtx {
  vars: Record<string, string>;
  dir: 'ltr' | 'rtl';
  /** `text-align` for the reading direction. */
  align: 'left' | 'right';
  accent: string;
  /** The Files images delivery can attach by CID, by file id (39 D9). */
  imageFiles: ReadonlySet<string>;
  /** References this render emitted — filled as blocks render. */
  used: EmailInlineRef[];
}

function htmlOf(source: string, ctx: RenderCtx): string {
  return fill(source, ctx.vars, escapeHtml);
}

function textOf(source: string, ctx: RenderCtx): string {
  return fill(source, ctx.vars, identity);
}

/**
 * The block's text after interpolation, or null when there is nothing to
 * render. Emptiness is judged AFTER filling on purpose: a built-in that reads
 * `{{body}}` is structurally non-empty but resolves to nothing whenever the
 * notification it describes carried no body, and an empty `<p>` in an email is
 * a visible gap the recipient reads as a broken message.
 */
function filledOr(source: unknown, ctx: RenderCtx): string | null {
  const raw = str(source);
  if (raw === null) return null;
  return textOf(raw, ctx).trim() === '' ? null : raw;
}

/** `white-space:pre-wrap` in mail: keep the author's line breaks as `<br>`. */
function multiline(source: string, ctx: RenderCtx): string {
  return htmlOf(source, ctx).replaceAll('\n', '<br>');
}

/** The comp's section label (`kickerStyle`, 1431). */
function kickerHtml(text: string | null, ctx: RenderCtx): string {
  if (text === null) return '';
  return (
    `<div style="margin:0 0 8px;font-family:${FONT};font-size:10.5px;font-weight:700;` +
    `text-transform:uppercase;letter-spacing:.05em;color:${PALETTE.muted};">${htmlOf(text, ctx)}</div>`
  );
}

function kickerText(text: string | null, ctx: RenderCtx): string {
  return text === null ? '' : `${textOf(text, ctx).toUpperCase()}\n`;
}

/** A bordered, rounded, soft box (the comp's `tableStyle` / `boxStyle`). */
function boxOpen(extra = ''): string {
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ` +
    `style="width:100%;border:1px solid ${PALETTE.rule};border-radius:10px;border-collapse:separate;${extra}">`
  );
}

function renderHeading(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const text = filledOr(data['text'], ctx);
  if (text === null) return null;
  const level = data['level'] === 2 ? 2 : 1;
  const size = level === 1 ? '1.42em' : '1.15em';
  const style =
    `margin:0;font-family:${FONT};font-size:${size};line-height:1.3;font-weight:800;` +
    `letter-spacing:-.01em;color:${PALETTE.heading};text-align:${ctx.align};`;
  return {
    html: `<h${String(level)} style="${style}">${multiline(text, ctx)}</h${String(level)}>`,
    text: `${textOf(text, ctx)}\n\n`,
  };
}

/** `paras[]` (the comp) or the legacy single `text` — both render, both stay valid. */
function renderText(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const paras = Array.isArray(data['paras']) ? strings(data['paras']) : [strOr(data['text'])];
  const kept = paras.filter((p) => filledOr(p, ctx) !== null);
  if (kept.length === 0) return null;
  const html = kept
    .map(
      (p, i) =>
        `<p style="margin:${i === 0 ? '0' : '12px 0 0'};font-family:${FONT};font-size:1em;line-height:1.65;` +
        `text-align:${ctx.align};">${multiline(p, ctx)}</p>`,
    )
    .join('');
  return { html, text: `${kept.map((p) => textOf(p, ctx)).join('\n\n')}\n\n` };
}

/**
 * A "bulletproof" button: a one-cell table with `bgcolor` AND a background in
 * the inline style, because Outlook's Word engine honours the attribute and
 * ignores the shorthand, while some webmail strips the attribute. The padding
 * lives on the anchor so the whole coloured area is clickable.
 */
function renderButton(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const label = filledOr(data['label'], ctx);
  const url = filledOr(data['url'], ctx);
  if (label === null || url === null) return null;
  const href = escapeHtml(safeHref(textOf(url, ctx)));
  const anchorStyle =
    `display:inline-block;padding:12px 24px;font-family:${FONT};font-size:13.5px;` +
    `font-weight:700;line-height:1.2;color:${PALETTE.onAccent};text-decoration:none;` +
    `border-radius:10px;`;
  const html =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${ctx.align}">` +
    `<tr><td bgcolor="${ctx.accent}" style="background-color:${ctx.accent};border-radius:10px;">` +
    `<a href="${href}" style="${anchorStyle}">${htmlOf(label, ctx)}</a>` +
    `</td></tr></table>`;
  // `label: url` — the whole point of the text part. A reset link that exists
  // only inside an anchor's href is a reset a text-only client cannot deliver.
  return { html, text: `${textOf(label, ctx)}: ${textOf(url, ctx)}\n\n` };
}

/** `{ height, line }` (the comp's "Divider / spacer"); a bare `{}` is the legacy 1px rule. */
function renderDivider(data: Record<string, unknown>): BlockOut {
  const height = Math.min(120, Math.max(0, Math.round(numOr(data['height'], 0))));
  const line = data['line'] !== false;
  const border = line ? `border-top:1px solid ${PALETTE.rule};` : '';
  const px = `${String(height)}px`;
  const html =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;">` +
    `<tr><td style="${border}height:${px};line-height:${px};font-size:0;">&nbsp;</td></tr></table>`;
  return { html, text: line ? `${TEXT_RULE}\n\n` : '\n' };
}

function renderSpacer(data: Record<string, unknown>): BlockOut {
  const size = Math.min(64, Math.max(4, Math.round(numOr(data['size'], 16))));
  const px = `${String(size)}px`;
  return {
    html: `<div style="height:${px};line-height:${px};font-size:0;">&nbsp;</div>`,
    text: '\n',
  };
}

/** The legacy footer BLOCK — still rendered for rows never re-saved (39 D5). */
function renderFooterBlock(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const text = filledOr(data['text'], ctx);
  if (text === null) return null;
  return { html: footerHtml(text, ctx), text: `${textOf(text, ctx)}\n\n` };
}

function footerHtml(text: string, ctx: RenderCtx): string {
  const style =
    `margin:0;font-family:${FONT};font-size:11px;line-height:1.6;color:${PALETTE.muted};` +
    `text-align:${ctx.align};word-break:break-word;`;
  return `<p style="${style}">${multiline(text, ctx)}</p>`;
}

function renderBox(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const label = strOr(data['label']);
  const value = strOr(data['value']);
  if (filledOr(label, ctx) === null && filledOr(value, ctx) === null) return null;
  const html =
    boxOpen(`background-color:${PALETTE.soft};`) +
    `<tr><td style="padding:14px 16px;font-family:${FONT};font-size:12.5px;font-weight:600;color:${PALETTE.body};">${htmlOf(label, ctx)}</td>` +
    `<td align="${ctx.dir === 'rtl' ? 'left' : 'right'}" style="padding:14px 16px;font-family:${MONO};font-size:18px;font-weight:800;color:${PALETTE.heading};white-space:nowrap;">${htmlOf(value, ctx)}</td></tr></table>`;
  return { html, text: `${textOf(label, ctx)}: ${textOf(value, ctx)}\n\n` };
}

/**
 * A Files image travels as a CID part the caller resolved (39 D9); a pasted
 * URL is used only when it is `https:`. With neither there is nothing a mail
 * client could show, so the block is omitted rather than sent as a broken
 * image — the canvas's dashed placeholder is an authoring aid, not content.
 */
function renderImage(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const alt = strOr(data['alt']);
  const fileId = typeof data['fileId'] === 'string' ? data['fileId'] : '';
  const url = strOr(data['url']).trim();
  let src: string | null = null;
  if (fileId !== '' && ctx.imageFiles.has(fileId)) {
    const cid = imageCid(fileId);
    ctx.used.push({ cid, kind: 'file', fileId });
    src = `cid:${cid}`;
  } else if (/^https:\/\//i.test(url)) {
    src = url;
  }
  if (src === null) return null;
  const html =
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(textOf(alt, ctx))}" width="100%" ` +
    `style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:10px;">`;
  return { html, text: alt.trim() === '' ? '' : `[${textOf(alt, ctx)}]\n\n` };
}

function renderTwoCol(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const a = strOr(data['a']);
  const b = strOr(data['b']);
  if (filledOr(a, ctx) === null && filledOr(b, ctx) === null) return null;
  const cell = (text: string, first: boolean): string =>
    `<td width="50%" valign="top" style="width:50%;padding:${first ? (ctx.dir === 'rtl' ? '0 0 0 9px' : '0 9px 0 0') : ctx.dir === 'rtl' ? '0 9px 0 0' : '0 0 0 9px'};` +
    `font-family:${FONT};font-size:1em;line-height:1.65;text-align:${ctx.align};">${multiline(text, ctx)}</td>`;
  const html =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;">` +
    `<tr>${cell(a, true)}${cell(b, false)}</tr></table>`;
  return { html, text: `${textOf(a, ctx)}\n\n${textOf(b, ctx)}\n\n` };
}

function renderList(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const items = strings(data['items']).filter((item) => filledOr(item, ctx) !== null);
  if (items.length === 0) return null;
  const rows = items
    .map(
      (item, i) =>
        `<tr><td valign="top" width="14" style="width:14px;padding:${i === 0 ? '0' : '7px'} 0 0;font-family:${FONT};font-size:1em;line-height:1.6;color:${ctx.accent};">&bull;</td>` +
        `<td valign="top" style="padding:${i === 0 ? '0' : '7px'} 0 0;font-family:${FONT};font-size:1em;line-height:1.6;text-align:${ctx.align};">${multiline(item, ctx)}</td></tr>`,
    )
    .join('');
  const html = `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;">${rows}</table>`;
  return { html, text: `${items.map((item) => `• ${textOf(item, ctx)}`).join('\n')}\n\n` };
}

function renderQuote(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const text = filledOr(data['text'], ctx);
  if (text === null) return null;
  const author = str(data['author']);
  const side = ctx.dir === 'rtl' ? 'right' : 'left';
  const html =
    `<div style="border-${side}:3px solid ${ctx.accent};padding-${side}:14px;font-family:${FONT};font-size:1.05em;line-height:1.6;font-style:italic;text-align:${ctx.align};">${multiline(text, ctx)}</div>` +
    (author === null
      ? ''
      : `<div style="margin-top:8px;padding-${side}:17px;font-family:${FONT};font-size:.82em;font-weight:700;color:${PALETTE.muted};text-align:${ctx.align};">${htmlOf(author, ctx)}</div>`);
  return { html, text: `“${textOf(text, ctx)}”${author === null ? '' : `\n— ${textOf(author, ctx)}`}\n\n` };
}

function renderStats(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const stats = records(data['stats']);
  if (stats.length === 0) return null;
  const width = `${String(Math.floor(100 / stats.length))}%`;
  const size = stats.length > 3 ? '15px' : '18px';
  const cells = stats
    .map(
      (s, i) =>
        `<td width="${width}" valign="top" style="width:${width};padding:${i === 0 ? '0' : '0 0 0 9px'};">` +
        boxOpen(`background-color:${PALETTE.soft};`) +
        `<tr><td align="center" style="padding:12px 8px;text-align:center;">` +
        `<div style="font-family:${MONO};font-size:${size};font-weight:800;color:${PALETTE.heading};">${htmlOf(strOr(s['value']), ctx)}</div>` +
        `<div style="margin-top:3px;font-family:${FONT};font-size:10.5px;color:${PALETTE.muted};">${htmlOf(strOr(s['label']), ctx)}</div>` +
        `</td></tr></table></td>`,
    )
    .join('');
  const html = `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr>${cells}</tr></table>`;
  return {
    html,
    text: `${stats.map((s) => `${textOf(strOr(s['value']), ctx)} ${textOf(strOr(s['label']), ctx)}`).join(' · ')}\n\n`,
  };
}

function renderProduct(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const items = records(data['items']);
  if (items.length === 0) return null;
  const rows = items
    .map(
      (p, i) =>
        `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;${i === 0 ? '' : 'margin-top:9px;'}border:1px solid ${PALETTE.rule};border-radius:10px;border-collapse:separate;">` +
        `<tr><td width="34" style="width:34px;padding:10px 0 10px 11px;"><div style="width:34px;height:34px;border-radius:8px;background-color:${PALETTE.softer};font-size:0;">&nbsp;</div></td>` +
        `<td style="padding:10px 11px;"><div style="font-family:${FONT};font-size:12.5px;font-weight:700;color:${PALETTE.heading};">${htmlOf(strOr(p['name']), ctx)}</div>` +
        `<div style="font-family:${FONT};font-size:10.5px;color:${PALETTE.muted};">${htmlOf(strOr(p['meta']), ctx)}</div></td>` +
        `<td align="right" style="padding:10px 6px;font-family:${MONO};font-size:11.5px;color:${PALETTE.muted};white-space:nowrap;">${htmlOf(strOr(p['qty']), ctx)}</td>` +
        `<td align="right" style="padding:10px 11px 10px 6px;font-family:${MONO};font-size:12.5px;font-weight:700;color:${PALETTE.heading};white-space:nowrap;">${htmlOf(strOr(p['price']), ctx)}</td></tr></table>`,
    )
    .join('');
  return {
    html: rows,
    text: `${items
      .map((p) => `${textOf(strOr(p['name']), ctx)} (${textOf(strOr(p['meta']), ctx)}) ${textOf(strOr(p['qty']), ctx)} ${textOf(strOr(p['price']), ctx)}`)
      .join('\n')}\n\n`,
  };
}

/** Text chip links — the comp's icons do not travel in mail. */
function renderSocial(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const links = records(data['links']).filter((l) => str(l['label']) !== null);
  if (links.length === 0) return null;
  const chips = links
    .map((l, i) => {
      const href = escapeHtml(safeHref(textOf(strOr(l['url']), ctx)));
      return (
        `<td style="padding:${i === 0 ? '0' : '0 0 0 8px'};">` +
        `<a href="${href}" style="display:inline-block;padding:6px 11px;border:1px solid ${PALETTE.rule};border-radius:20px;` +
        `font-family:${FONT};font-size:11.5px;font-weight:700;color:${PALETTE.body};text-decoration:none;white-space:nowrap;">${htmlOf(strOr(l['label']), ctx)}</a></td>`
      );
    })
    .join('');
  const html = `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${ctx.align}"><tr>${chips}</tr></table>`;
  return {
    html,
    text: `${links.map((l) => `${textOf(strOr(l['label']), ctx)}: ${textOf(strOr(l['url']), ctx)}`).join('\n')}\n\n`,
  };
}

/** Verbatim — the author's own markup, filled but never escaped; the text part is the tags stripped. */
function renderHtml(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const code = str(data['code']);
  if (code === null) return null;
  const html = fill(code, ctx.vars, identity);
  return { html, text: `${stripTags(html).trim()}\n\n` };
}

/** PO terms / refund policy: kicker + paragraph (the comp's `TitledText`). */
function renderTitledText(data: Record<string, unknown>, ctx: RenderCtx, fine: boolean): BlockOut | null {
  const body = filledOr(data['text'], ctx);
  if (body === null) return null;
  const kicker = str(data['kicker']);
  const style =
    `margin:0;font-family:${FONT};font-size:${fine ? '.76em' : '.9em'};line-height:1.65;` +
    `${fine ? `color:${PALETTE.muted};` : ''}text-align:${ctx.align};`;
  return {
    html: `${kickerHtml(kicker, ctx)}<p style="${style}">${multiline(body, ctx)}</p>`,
    text: `${kickerText(kicker, ctx)}${textOf(body, ctx)}\n\n`,
  };
}

function rowsTable(rows: { label: string; amount: string }[], ctx: RenderCtx): string {
  const cells = rows
    .map(
      (r, i) =>
        `<tr><td style="padding:9px 13px;${i < rows.length - 1 ? `border-bottom:1px solid ${PALETTE.rule};` : ''}font-family:${FONT};font-size:12px;color:${PALETTE.body};">${r.label}</td>` +
        `<td align="${ctx.dir === 'rtl' ? 'left' : 'right'}" style="padding:9px 13px;${i < rows.length - 1 ? `border-bottom:1px solid ${PALETTE.rule};` : ''}font-family:${MONO};font-size:12.5px;font-weight:700;color:${PALETTE.heading};white-space:nowrap;">${r.amount}</td></tr>`,
    )
    .join('');
  return `${boxOpen()}${cells}</table>`;
}

function renderMultiCurrency(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const fx = records(data['fx']);
  if (fx.length === 0) return null;
  const amount = numOr(data['amount'], 0);
  const kicker = str(data['kicker']);
  const rows = fx.map((x) => ({
    label: htmlOf(strOr(x['code']), ctx),
    amount: `${htmlOf(strOr(x['sym']), ctx)}${fixedMoney(amount * numOr(x['rate'], 0))}`,
    plain: `${textOf(strOr(x['code']), ctx)}: ${textOf(strOr(x['sym']), ctx)}${fixedMoney(amount * numOr(x['rate'], 0))}`,
  }));
  return {
    html: `${kickerHtml(kicker, ctx)}${rowsTable(rows, ctx)}`,
    text: `${kickerText(kicker, ctx)}${rows.map((r) => r.plain).join('\n')}\n\n`,
  };
}

function renderTaxBreakdown(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const lines = records(data['lines']);
  if (lines.length === 0) return null;
  const kicker = str(data['kicker']);
  const rows = lines.map((l) => ({ label: htmlOf(strOr(l['label']), ctx), amount: htmlOf(strOr(l['amount']), ctx) }));
  return {
    html: `${kickerHtml(kicker, ctx)}${rowsTable(rows, ctx)}`,
    text: `${kickerText(kicker, ctx)}${lines.map((l) => `${textOf(strOr(l['label']), ctx)}: ${textOf(strOr(l['amount']), ctx)}`).join('\n')}\n\n`,
  };
}

function renderDiscountCodes(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const codes = records(data['codes']);
  if (codes.length === 0) return null;
  const kicker = str(data['kicker']);
  const rows = codes
    .map(
      (c, i) =>
        `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;${i === 0 ? '' : 'margin-top:7px;'}border:1px solid ${PALETTE.rule};border-radius:9px;border-collapse:separate;">` +
        `<tr><td width="1" style="padding:8px 0 8px 11px;white-space:nowrap;"><span style="display:inline-block;padding:3px 8px;border-radius:6px;background-color:${mixWithWhite(ctx.accent, 0.12)};font-family:${MONO};font-size:11px;font-weight:800;color:${ctx.accent};">${htmlOf(strOr(c['code']), ctx)}</span></td>` +
        `<td style="padding:8px 10px;font-family:${FONT};font-size:12px;color:${PALETTE.body};">${htmlOf(strOr(c['label']), ctx)}</td>` +
        `<td align="right" style="padding:8px 11px 8px 0;font-family:${MONO};font-size:12.5px;font-weight:700;color:${PALETTE.pos};white-space:nowrap;">${htmlOf(strOr(c['amount']), ctx)}</td></tr></table>`,
    )
    .join('');
  return {
    html: `${kickerHtml(kicker, ctx)}${rows}`,
    text: `${kickerText(kicker, ctx)}${codes.map((c) => `${textOf(strOr(c['code']), ctx)} ${textOf(strOr(c['label']), ctx)} ${textOf(strOr(c['amount']), ctx)}`).join('\n')}\n\n`,
  };
}

function renderPaymentHistory(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const items = records(data['items']);
  if (items.length === 0) return null;
  const kicker = str(data['kicker']);
  const rows = items
    .map((p, i) => {
      const status = strOr(p['status'], 'paid') || 'paid';
      return (
        `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;${i === 0 ? '' : 'margin-top:7px;'}border:1px solid ${PALETTE.rule};border-radius:9px;border-collapse:separate;">` +
        `<tr><td style="padding:9px 11px;"><div style="font-family:${FONT};font-size:12px;font-weight:700;color:${PALETTE.heading};">${htmlOf(strOr(p['date']), ctx)}</div>` +
        `<div style="font-family:${FONT};font-size:10.5px;color:${PALETTE.muted};">${htmlOf(strOr(p['method']), ctx)}</div></td>` +
        `<td align="right" style="padding:9px 6px;font-family:${MONO};font-size:12.5px;font-weight:700;color:${PALETTE.heading};white-space:nowrap;">${htmlOf(strOr(p['amount']), ctx)}</td>` +
        `<td width="1" style="padding:9px 11px 9px 5px;white-space:nowrap;"><span style="display:inline-block;padding:2px 9px;border-radius:20px;background-color:${PALETTE.posSoft};font-family:${FONT};font-size:10px;font-weight:700;color:${PALETTE.pos};text-transform:capitalize;">${htmlOf(status, ctx)}</span></td></tr></table>`
      );
    })
    .join('');
  return {
    html: `${kickerHtml(kicker, ctx)}${rows}`,
    text: `${kickerText(kicker, ctx)}${items.map((p) => `${textOf(strOr(p['date']), ctx)} · ${textOf(strOr(p['method']), ctx)} · ${textOf(strOr(p['amount']), ctx)} (${textOf(strOr(p['status'], 'paid') || 'paid', ctx)})`).join('\n')}\n\n`,
  };
}

function renderRecurring(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const freq = str(data['freq']);
  if (freq === null) return null;
  const next = strOr(data['next']);
  const note = strOr(data['note']);
  const html =
    boxOpen(`background-color:${PALETTE.soft};`) +
    `<tr><td width="32" style="width:32px;padding:13px 0 13px 15px;"><div style="width:32px;height:32px;border-radius:8px;background-color:${ctx.accent};color:${PALETTE.onAccent};font-family:${FONT};font-size:16px;line-height:32px;text-align:center;">&#8635;</div></td>` +
    `<td style="padding:13px 15px 13px 11px;"><div style="font-family:${FONT};font-size:12.5px;font-weight:800;color:${PALETTE.heading};">Recurring — ${htmlOf(freq, ctx)}</div>` +
    `<div style="margin-top:2px;font-family:${FONT};font-size:11.5px;color:${PALETTE.body};">Next on ${htmlOf(next, ctx)} · ${htmlOf(note, ctx)}</div></td></tr></table>`;
  return { html, text: `Recurring — ${textOf(freq, ctx)}\nNext on ${textOf(next, ctx)} · ${textOf(note, ctx)}\n\n` };
}

/** The comp's three icon lines, with text glyphs standing in for the icons. */
function renderContact(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const name = str(data['name']);
  const email = str(data['email']);
  const phone = str(data['phone']);
  if (name === null && email === null && phone === null) return null;
  const kicker = str(data['kicker']);
  const line = (glyph: string, value: string, mono: boolean, strong: boolean, first: boolean): string =>
    `<tr><td width="18" style="width:18px;padding:${first ? '0' : '7px'} 0 0;font-family:${FONT};font-size:12px;color:${PALETTE.muted};">${glyph}</td>` +
    `<td style="padding:${first ? '0' : '7px'} 0 0;font-family:${mono ? MONO : FONT};font-size:12.5px;${strong ? `font-weight:700;color:${PALETTE.heading};` : `color:${PALETTE.body};`}">${htmlOf(value, ctx)}</td></tr>`;
  const rows: string[] = [];
  if (name !== null) rows.push(line('&#9679;', name, false, true, rows.length === 0));
  if (email !== null) rows.push(line('&#9993;', email, true, false, rows.length === 0));
  if (phone !== null) rows.push(line('&#9742;', phone, true, false, rows.length === 0));
  const html =
    `${kickerHtml(kicker, ctx)}<table role="presentation" border="0" cellpadding="0" cellspacing="0">${rows.join('')}</table>`;
  const text = [name, email, phone].filter((v): v is string => v !== null).map((v) => textOf(v, ctx)).join('\n');
  return { html, text: `${kickerText(kicker, ctx)}${text}\n\n` };
}

/** Accent-soft banner: `{balance} pts · {level}` and `+{earned}` (the comp's `Loyalty`). */
function renderLoyalty(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const balance = fixedInt(numOr(data['balance'], 0));
  const earned = fixedInt(numOr(data['earned'], 0));
  const level = strOr(data['level']);
  const html =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-radius:11px;background-color:${mixWithWhite(ctx.accent, 0.1)};border-collapse:separate;">` +
    `<tr><td width="36" style="width:36px;padding:13px 0 13px 15px;"><div style="width:36px;height:36px;border-radius:10px;background-color:${ctx.accent};color:${PALETTE.onAccent};font-family:${FONT};font-size:18px;line-height:36px;text-align:center;">&#9733;</div></td>` +
    `<td style="padding:13px 13px;"><div style="font-family:${FONT};font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${ctx.accent};">Loyalty balance</div>` +
    `<div style="font-family:${MONO};font-size:16px;font-weight:800;color:${PALETTE.heading};">${balance} pts · ${htmlOf(level, ctx)}</div></td>` +
    `<td align="right" style="padding:13px 15px 13px 0;font-family:${MONO};font-size:12.5px;font-weight:800;color:${PALETTE.pos};white-space:nowrap;">+${earned}</td></tr></table>`;
  return { html, text: `Loyalty balance: ${balance} pts · ${textOf(level, ctx)} (+${earned})\n\n` };
}

/** Four-column stepper with coloured dots (the comp's `Delivery`). */
function renderDelivery(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const steps = records(data['steps']);
  if (steps.length === 0) return null;
  const kicker = str(data['kicker']);
  const width = `${String(Math.floor(100 / steps.length))}%`;
  const cells = steps
    .map((s) => {
      const status = s['status'];
      const done = status === 'done';
      const current = status === 'current';
      const dot = done
        ? `background-color:${ctx.accent};color:${PALETTE.onAccent};border:2px solid ${ctx.accent};`
        : `background-color:${PALETTE.card};color:${current ? ctx.accent : PALETTE.muted};border:2px solid ${current ? ctx.accent : PALETTE.ruleStrong};`;
      return (
        `<td width="${width}" align="center" valign="top" style="width:${width};text-align:center;">` +
        `<div style="display:inline-block;width:18px;height:18px;border-radius:50%;${dot}font-family:${FONT};font-size:11px;font-weight:700;line-height:18px;text-align:center;">${done ? '&#10003;' : '&nbsp;'}</div>` +
        `<div style="margin-top:8px;font-family:${FONT};font-size:10.5px;font-weight:${done || current ? '700' : '600'};color:${done || current ? PALETTE.heading : PALETTE.muted};">${htmlOf(strOr(s['label']), ctx)}</div></td>`
      );
    })
    .join('');
  const html = `${kickerHtml(kicker, ctx)}<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;"><tr>${cells}</tr></table>`;
  const text = steps
    .map((s) => `${s['status'] === 'done' ? '[x]' : s['status'] === 'current' ? '[>]' : '[ ]'} ${textOf(strOr(s['label']), ctx)}`)
    .join('\n');
  return { html, text: `${kickerText(kicker, ctx)}${text}\n\n` };
}

function renderBlock(kind: EmailBlockKind, data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  switch (kind) {
    case 'email.heading':
      return renderHeading(data, ctx);
    case 'email.text':
      return renderText(data, ctx);
    case 'email.button':
      return renderButton(data, ctx);
    case 'email.divider':
      return renderDivider(data);
    case 'email.spacer':
      return renderSpacer(data);
    case 'email.footer':
      return renderFooterBlock(data, ctx);
    case 'email.image':
      return renderImage(data, ctx);
    case 'email.two-col':
      return renderTwoCol(data, ctx);
    case 'email.list':
      return renderList(data, ctx);
    case 'email.quote':
      return renderQuote(data, ctx);
    case 'email.social':
      return renderSocial(data, ctx);
    case 'email.html':
      return renderHtml(data, ctx);
    case 'email.box':
      return renderBox(data, ctx);
    case 'email.stats':
      return renderStats(data, ctx);
    case 'email.product':
      return renderProduct(data, ctx);
    case 'email.multi-currency':
      return renderMultiCurrency(data, ctx);
    case 'email.tax-breakdown':
      return renderTaxBreakdown(data, ctx);
    case 'email.discount-codes':
      return renderDiscountCodes(data, ctx);
    case 'email.payment-history':
      return renderPaymentHistory(data, ctx);
    case 'email.recurring':
      return renderRecurring(data, ctx);
    case 'email.loyalty':
      return renderLoyalty(data, ctx);
    case 'email.delivery':
      return renderDelivery(data, ctx);
    case 'email.po-terms':
      return renderTitledText(data, ctx, false);
    case 'email.legal':
      return renderTitledText(data, ctx, true);
    case 'email.refund-policy':
      return renderTitledText(data, ctx, false);
    case 'email.contact':
      return renderContact(data, ctx);
  }
}

// --- the style wrapper (comp 1407-1419) ------------------------------------------------

const PAD: Record<string, string> = { none: '0', s: '10px 12px', m: '16px 18px', l: '24px 26px' };
const SIZE: Record<string, string> = { s: '12px', m: '13.5px', l: '15.5px' };
const BORDER: Record<string, string | null> = {
  none: null,
  thin: `1px solid ${PALETTE.rule}`,
  dashed: `1.5px dashed ${PALETTE.ruleStrong}`,
};
const RADIUS: Record<string, string> = { none: '0', md: '10px', lg: '16px' };

/** The card's horizontal padding (the comp's `padding:26px 28px`). */
const CARD_X = 28;

/**
 * One block in its style cell. Every axis is the comp's map, with three
 * translations mail forces: `align` is resolved LOGICALLY (`start` is right
 * in an RTL document), the accent tint is a solid mix (Word-engine Outlook
 * ignores `rgba`), and `full` bleeds by dropping the cell's own padding
 * rather than by negative margins, which no client honours reliably.
 */
function wrapBlock(out: BlockOut, style: EmailBlockStyle, first: boolean, ctx: RenderCtx): string {
  const bg =
    style.bg === 'soft'
      ? PALETTE.soft
      : style.bg === 'tint'
        ? mixWithWhite(ctx.accent, 0.12)
        : style.bg === 'accent'
          ? ctx.accent
          : style.bg === 'dark'
            ? PALETTE.dark
            : null;
  const fg =
    style.fg === 'strong'
      ? PALETTE.heading
      : style.fg === 'muted'
        ? PALETTE.muted
        : style.fg === 'accent'
          ? ctx.accent
          : style.fg === 'white'
            ? PALETTE.onAccent
            : PALETTE.body;
  const align =
    style.align === 'center'
      ? 'center'
      : style.align === 'end'
        ? ctx.dir === 'rtl'
          ? 'left'
          : 'right'
        : ctx.align;
  const full = style.full === true;
  const border = BORDER[style.border ?? 'none'] ?? null;
  const inner =
    `padding:${full && (style.pad ?? 'none') === 'none' ? `0 ${String(CARD_X)}px` : (PAD[style.pad ?? 'none'] ?? '0')};` +
    (full && (style.pad ?? 'none') !== 'none' ? `padding-left:${String(CARD_X)}px;padding-right:${String(CARD_X)}px;` : '') +
    (bg === null ? '' : `background-color:${bg};`) +
    `color:${fg};font-family:${FONT};font-size:${SIZE[style.size ?? 'm'] ?? SIZE['m']};line-height:1.6;` +
    `text-align:${align};` +
    (border === null ? '' : `border:${border};`) +
    `border-radius:${full ? '0' : (RADIUS[style.radius ?? 'md'] ?? '10px')};`;
  const cellPad = `${first ? '26' : '30'}px ${full ? '0' : String(CARD_X)}px 0 ${full ? '0' : String(CARD_X)}px`;
  return (
    `<tr><td style="padding:${cellPad};">` +
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:separate;">` +
    `<tr><td${bg === null ? '' : ` bgcolor="${bg}"`} style="${inner}">${out.html}</td></tr></table>` +
    `</td></tr>`
  );
}

// --- the document ----------------------------------------------------------------------

/** The brand as the renderer needs it — resolved by the caller from the row and the workspace (39 D6). */
export interface EffectiveBrand {
  name: string;
  accent: string;
}

/** What the renderer takes: a normalized document minus the attachments, which delivery owns. */
export interface RenderableDocument {
  subject: string;
  preheader?: string | undefined;
  blocks: readonly unknown[];
  footer?: string | undefined;
}

export interface RenderEmailInput {
  /** The document (39 §3.3). `template` is the pre-39 name of the same thing and still accepted. */
  document?: RenderableDocument | undefined;
  template?: { subject: string; blocks: readonly unknown[] } | undefined;
  /** Canonical locale id (`en_US`, `ar_EG`, …) — becomes the `lang` attribute. */
  locale: string;
  vars: Record<string, string>;
  /** Derived from the locale by the caller (`dirForLocale`), never guessed here. */
  dir: 'ltr' | 'rtl';
  /**
   * Brand name and accent. Absent: the comp's default accent and the
   * `appName` var as the name, so a legacy call renders the same banner the
   * canvas shows.
   */
  brand?: EffectiveBrand | undefined;
  /**
   * The mark delivery will attach under `cid:mark` (39 D6) — one of the
   * twelve shipped PNGs or the workspace logo's file id. Absent: the banner
   * carries the name only.
   */
  mark?: Omit<Extract<EmailInlineRef, { kind: 'mark' }>, 'cid'> | Omit<Extract<EmailInlineRef, { kind: 'file' }>, 'cid'> | undefined;
  /** The Files images delivery can attach by CID (39 D9); an image block naming any other id falls back to its URL. */
  imageFiles?: ReadonlySet<string> | undefined;
}

/** `brand` from a row + the workspace defaults → what {@link renderEmail} takes. */
export function effectiveBrand(
  brand: EmailBrand | null,
  defaults: { appName: string; accent?: string | null | undefined },
): EffectiveBrand {
  const workspace = defaults.accent === null || defaults.accent === undefined ? undefined : (WORKSPACE_ACCENT_HEX[defaults.accent] ?? defaults.accent);
  return {
    name: brand !== null && brand.name.trim() !== '' ? brand.name : defaults.appName,
    accent: normalizeAccent(brand?.accent ?? workspace),
  };
}

/**
 * Render one document into the HTML and plain-text parts of a message.
 *
 * Order (39 §3.4): hidden preheader → brand header → blocks, each in its
 * style cell → the fixed footer → any legacy footer block met on the way is
 * rendered in place. `dir: 'rtl'` sets `dir` on `<html>` and on every cell
 * AND flips every block's text alignment — Arabic laid out flush-left reads
 * as broken even when the direction attribute is right (10-T18).
 */
export function renderEmail(input: RenderEmailInput): RenderedEmail {
  const document: RenderableDocument = input.document ?? {
    subject: input.template?.subject ?? '',
    blocks: input.template?.blocks ?? [],
  };
  const accent = normalizeAccent(input.brand?.accent);
  const ctx: RenderCtx = {
    vars: input.vars,
    dir: input.dir,
    align: input.dir === 'rtl' ? 'right' : 'left',
    accent,
    imageFiles: input.imageFiles ?? new Set(),
    used: [],
  };

  const rows: string[] = [];
  const texts: string[] = [];
  let first = true;
  for (const entry of document.blocks) {
    if (!isRecord(entry)) continue;
    const kind = entry['block'];
    if (!isEmailBlockKind(kind)) continue; // forward-compatible: skip, never throw
    const data = isRecord(entry['data']) ? entry['data'] : {};
    const out = renderBlock(kind, data, ctx);
    if (out === null) continue;
    const style = isRecord(entry['style']) ? (entry['style'] as EmailBlockStyle) : {};
    rows.push(wrapBlock(out, style, first, ctx));
    texts.push(out.text);
    first = false;
  }

  const subject = sanitizeSubject(fill(document.subject, input.vars, identity));
  const preheader = sanitizeSubject(fill(document.preheader ?? '', input.vars, identity));
  const lang = escapeHtml(tagFromLocaleId(input.locale));

  // --- the brand header (39 D6): bgcolor, never a gradient; the mark by CID ---
  const brandName = input.brand?.name ?? input.vars['appName'] ?? '';
  let markHtml = '';
  if (input.mark !== undefined) {
    ctx.used.unshift({ ...input.mark, cid: MARK_CID } as EmailInlineRef);
    markHtml =
      `<td width="30" style="width:30px;padding:0 10px 0 0;"><table role="presentation" border="0" cellpadding="0" cellspacing="0">` +
      `<tr><td width="30" height="30" bgcolor="${mixWithWhite(accent, 0.78)}" style="width:30px;height:30px;border-radius:8px;text-align:center;vertical-align:middle;">` +
      `<img src="cid:${MARK_CID}" width="17" height="17" alt="" style="display:inline-block;width:17px;height:17px;border:0;vertical-align:middle;"></td></tr></table></td>`;
  }
  const header =
    brandName.trim() === '' && markHtml === ''
      ? ''
      : `<tr><td bgcolor="${accent}" style="background-color:${accent};padding:18px 24px;border-radius:12px 12px 0 0;">` +
        `<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>${markHtml}` +
        `<td style="font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:-.01em;color:${PALETTE.onAccent};">${escapeHtml(brandName)}</td></tr></table></td></tr>`;

  const footerText = fill(document.footer ?? '', input.vars, identity).trim();
  const footer =
    footerText === ''
      ? `<tr><td style="padding:0 0 26px;font-size:0;line-height:0;">&nbsp;</td></tr>`
      : `<tr><td style="padding:24px ${String(CARD_X)}px 26px;"><div style="padding-top:18px;border-top:1px solid ${PALETTE.rule};">${footerHtml(document.footer ?? '', ctx)}</div></td></tr>`;

  const preheaderHtml =
    preheader === ''
      ? ''
      : `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PALETTE.page};">${escapeHtml(preheader)}</div>`;

  const html = [
    '<!DOCTYPE html>',
    `<html lang="${lang}" dir="${input.dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(subject)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background-color:${PALETTE.page};">`,
    ...(preheaderHtml === '' ? [] : [preheaderHtml]),
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ` +
      `style="width:100%;background-color:${PALETTE.page};">`,
    '  <tr>',
    '    <td align="center" style="padding:24px 12px;">',
    `      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" dir="${input.dir}" ` +
      `style="width:600px;max-width:100%;background-color:${PALETTE.card};` +
      `border:1px solid ${PALETTE.rule};border-radius:12px;border-collapse:separate;font-family:${FONT};color:${PALETTE.body};">`,
    ...(header === '' ? [] : [header]),
    ...rows,
    footer,
    '      </table>',
    '    </td>',
    '  </tr>',
    '</table>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  const text = [...texts, footerText === '' ? '' : `${TEXT_RULE}\n${footerText}\n`]
    .join('')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

  return { subject, html, text: text === '' ? '' : `${text}\n`, inline: ctx.used };
}
