// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic email renderer: stored `adminium_email_templates.blocks` →
 * one MIME-ready `{ subject, html, text }` pair.
 *
 * WHY THIS IS HAND-ROLLED. There is no React on this path and there will not
 * be one: `apps/server` has zero React dependencies, and pulling
 * react + react-dom + @react-email/* onto the server to lay out six block
 * kinds would grow the Docker image and the published npm tarball for a
 * fixed, closed vocabulary. Same taste as the bespoke charts (d3-scale /
 * d3-shape only) and the fetch-only LLM clients.
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
 * answer — please do not "fix" it.
 *
 * BLOCK VOCABULARY. Server-owned kinds under an `email.*` prefix. The
 * widgets block registry (`BLOCK_IDS`, `block-line-items` and friends) is
 * invoice-oriented and lives behind a package `apps/server` may not import at
 * all (01-architecture.md §2.3), so the two namespaces are disjoint by
 * construction: nothing there starts with `email.`.
 *
 * UNKNOWN KINDS ARE SKIPPED, NEVER THROWN ON. A template row is editable at
 * runtime and round-trips through an editor that deliberately preserves block
 * kinds it does not recognise (`apps/dashboard/src/pages/builders/emailDoc.ts`
 * — "e.g. a future server-side block kind"). If an unknown entry could throw,
 * a stale row would turn a password reset into a 500 and lock the user out of
 * their own account. Skipping degrades one paragraph; throwing degrades the
 * only recovery path the product has.
 *
 * DETERMINISM. No clock, no randomness, no locale-sensitive formatting: the
 * same template + vars + dir render byte-identically forever, which is what
 * makes the snapshot suite meaningful.
 */

import { tagFromLocaleId } from '@adminium/i18n';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** The closed set of block kinds this renderer understands. */
export const EMAIL_BLOCK_KINDS = [
  'email.heading',
  'email.text',
  'email.button',
  'email.divider',
  'email.spacer',
  'email.footer',
] as const;

export type EmailBlockKind = (typeof EMAIL_BLOCK_KINDS)[number];

const EMAIL_BLOCK_KIND_SET: ReadonlySet<string> = new Set(EMAIL_BLOCK_KINDS);

export function isEmailBlockKind(value: unknown): value is EmailBlockKind {
  return typeof value === 'string' && EMAIL_BLOCK_KIND_SET.has(value);
}

/**
 * Hex literals, not tokens — see the header. Chosen to match the light theme
 * (`@adminium/tokens` accent `indigo` is #4f46e5) without importing it: mail
 * has no `data-theme`, so there is exactly one palette and it must be the
 * light one.
 */
const PALETTE = {
  page: '#f4f4f5',
  card: '#ffffff',
  rule: '#e4e4e7',
  heading: '#18181b',
  body: '#3f3f46',
  muted: '#71717a',
  accent: '#4f46e5',
  onAccent: '#ffffff',
} as const;

/**
 * System stack only. A webfont in email is a remote request most clients
 * block, and the fallback is what nearly everyone sees anyway.
 */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const TEXT_RULE = '--------------------------------';

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

function escapeHtml(value: string): string {
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

interface BlockOut {
  html: string;
  text: string;
}

interface RenderCtx {
  vars: Record<string, string>;
  align: 'left' | 'right';
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

function renderHeading(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const text = filledOr(data['text'], ctx);
  if (text === null) return null;
  const level = data['level'] === 2 ? 2 : 1;
  const size = level === 1 ? '22px' : '17px';
  const style =
    `margin:0 0 12px;font-family:${FONT};font-size:${size};line-height:1.3;` +
    `font-weight:700;color:${PALETTE.heading};text-align:${ctx.align};`;
  return {
    html: `<h${String(level)} style="${style}">${htmlOf(text, ctx)}</h${String(level)}>`,
    text: `${textOf(text, ctx)}\n\n`,
  };
}

function renderText(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const text = filledOr(data['text'], ctx);
  if (text === null) return null;
  const style =
    `margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;` +
    `color:${PALETTE.body};text-align:${ctx.align};`;
  return {
    html: `<p style="${style}">${htmlOf(text, ctx)}</p>`,
    text: `${textOf(text, ctx)}\n\n`,
  };
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
    `display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;` +
    `font-weight:600;line-height:1.2;color:${PALETTE.onAccent};text-decoration:none;` +
    `border-radius:8px;`;
  const html =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" ` +
    `align="${ctx.align}" style="margin:4px 0 20px;">` +
    `<tr><td bgcolor="${PALETTE.accent}" ` +
    `style="background-color:${PALETTE.accent};border-radius:8px;">` +
    `<a href="${href}" style="${anchorStyle}">${htmlOf(label, ctx)}</a>` +
    `</td></tr></table>`;
  // `label: url` — the whole point of the text part. A reset link that exists
  // only inside an anchor's href is a reset a text-only client cannot deliver.
  return { html, text: `${textOf(label, ctx)}: ${textOf(url, ctx)}\n\n` };
}

function renderDivider(): BlockOut {
  const html =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ` +
    `style="width:100%;margin:0 0 20px;">` +
    `<tr><td style="border-top:1px solid ${PALETTE.rule};font-size:0;line-height:0;` +
    `height:1px;">&nbsp;</td></tr></table>`;
  return { html, text: `${TEXT_RULE}\n\n` };
}

function renderSpacer(data: Record<string, unknown>): BlockOut {
  const raw = typeof data['size'] === 'number' ? data['size'] : 16;
  const size = Math.min(64, Math.max(4, Math.round(raw)));
  const px = `${String(size)}px`;
  return {
    html: `<div style="height:${px};line-height:${px};font-size:0;">&nbsp;</div>`,
    text: '\n',
  };
}

function renderFooter(data: Record<string, unknown>, ctx: RenderCtx): BlockOut | null {
  const text = filledOr(data['text'], ctx);
  if (text === null) return null;
  const style =
    `margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.5;` +
    `color:${PALETTE.muted};text-align:${ctx.align};word-break:break-word;`;
  return {
    html: `<p style="${style}">${htmlOf(text, ctx)}</p>`,
    text: `${textOf(text, ctx)}\n\n`,
  };
}

function renderBlock(
  kind: EmailBlockKind,
  data: Record<string, unknown>,
  ctx: RenderCtx,
): BlockOut | null {
  switch (kind) {
    case 'email.heading':
      return renderHeading(data, ctx);
    case 'email.text':
      return renderText(data, ctx);
    case 'email.button':
      return renderButton(data, ctx);
    case 'email.divider':
      return renderDivider();
    case 'email.spacer':
      return renderSpacer(data);
    case 'email.footer':
      return renderFooter(data, ctx);
  }
}

export interface RenderEmailInput {
  template: { subject: string; blocks: readonly unknown[] };
  /** Canonical locale id (`en_US`, `ar_EG`, …) — becomes the `lang` attribute. */
  locale: string;
  vars: Record<string, string>;
  /** Derived from the locale by the caller (`dirForLocale`), never guessed here. */
  dir: 'ltr' | 'rtl';
}

/**
 * Render one stored template into the HTML and plain-text parts of a message.
 *
 * `dir: 'rtl'` sets `dir` on `<html>` and on the content cell AND flips every
 * block's text alignment — Arabic laid out flush-left reads as broken even
 * when the direction attribute is right (10-T18).
 */
export function renderEmail(input: RenderEmailInput): RenderedEmail {
  const ctx: RenderCtx = {
    vars: input.vars,
    align: input.dir === 'rtl' ? 'right' : 'left',
  };

  const parts: BlockOut[] = [];
  for (const entry of input.template.blocks) {
    if (!isRecord(entry)) continue;
    const kind = entry['block'];
    if (!isEmailBlockKind(kind)) continue; // forward-compatible: skip, never throw
    const data = isRecord(entry['data']) ? entry['data'] : {};
    const out = renderBlock(kind, data, ctx);
    if (out !== null) parts.push(out);
  }

  const subject = sanitizeSubject(fill(input.template.subject, input.vars, identity));
  const lang = escapeHtml(tagFromLocaleId(input.locale));
  const body = parts.map((part) => part.html).join('\n            ');

  const html = [
    '<!DOCTYPE html>',
    `<html lang="${lang}" dir="${input.dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(subject)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background-color:${PALETTE.page};">`,
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ` +
      `style="width:100%;background-color:${PALETTE.page};">`,
    '  <tr>',
    '    <td align="center" style="padding:24px 12px;">',
    `      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" ` +
      `style="width:600px;max-width:100%;background-color:${PALETTE.card};` +
      `border:1px solid ${PALETTE.rule};border-radius:12px;">`,
    '        <tr>',
    `          <td dir="${input.dir}" style="padding:32px;font-family:${FONT};">`,
    `            ${body}`,
    '          </td>',
    '        </tr>',
    '      </table>',
    '    </td>',
    '  </tr>',
    '</table>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  const text = parts
    .map((part) => part.text)
    .join('')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

  return { subject, html, text: text === '' ? '' : `${text}\n` };
}
