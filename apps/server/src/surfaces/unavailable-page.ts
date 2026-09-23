// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page an app's address answers with while the app, or that side of it,
 * is switched off.
 *
 * ── NO SCRIPT, NO STORE, NO INDEX ──────────────────────────────────────────
 * Rendered here, in one pass, as a whole document: no script of any kind, no
 * external font or icon, `Cache-Control: no-store` (switching the app back on
 * must show at once) and `noindex` (a switched-off page is nothing a search
 * engine should keep). "Sign out" is a plain form post; the identity block is
 * read from the session on the server.
 *
 * ── NOTHING HERE NAMES THE PLATFORM ────────────────────────────────────────
 * This is the venue's address. The mark is the first letter of the venue's
 * name — the workspace's own name, or the app's while the workspace still
 * carries the default one — never a platform logo, plan or price.
 *
 * ── Departures from the comp ───────────────────────────────────────────────
 *  - The comp's guest page is written for one app (booking a table) and has a
 *    call card with a phone number and street address. Neither is stored
 *    anywhere yet, so the guest page says the app's own name and "try again
 *    later", and draws no call card.
 *  - The comp's staff wording names the till ("The till is switched off.").
 *    Any app can be switched off, so the side is named generically.
 *  - The identity block shows the name and email, as the comp's no-role card
 *    does; the role and venue line needs the app roles that come later.
 *  - System fonts: the product's own fonts are served from paths a customer
 *    domain does not answer.
 */
import type { SurfaceSide } from '../cli/surfaces-root.js';

export interface UnavailablePageInput {
  side: SurfaceSide;
  reason: 'app-disabled' | 'side-off' | 'no-access';
  /** The app's display name, in the page's language. */
  appName: string;
  /** The workspace's own name, or null while it still carries the default. */
  venueName: string | null;
  /** The signed-in person, on a staff page; null otherwise. */
  user: { name: string; email: string } | null;
  /** Where Sign out posts, and the session-bound token it carries. Staff only. */
  signOut: { action: string; field: string; token: string } | null;
  /** BCP-47 tag for `lang`; Arabic turns the page right to left. */
  lang: string;
  t: (key: string, fallback: string, args?: Record<string, unknown>) => string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The first letter of a name, for the mark; a code point, not a UTF-16 half. */
function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? '·' : first.toLocaleUpperCase();
}

/** Up to two initials for the identity block. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part !== '');
  return parts
    .slice(0, 2)
    .map((part) => [...part][0]?.toLocaleUpperCase() ?? '')
    .join('');
}

const STYLE = `
:root{--bg:#f7f7f8;--surface:#fff;--surface-2:#fafafa;--surface-3:#f1f1f4;--border:#ececef;--border-strong:#e2e2e8;--fg:#191920;--muted:#6b6b76;--mark:#52525b;--warn:#8a4a07;--warn-soft:#fbf0e2}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f13;--surface:#18181d;--surface-2:#1d1d23;--surface-3:#26262d;--border:#2a2a31;--border-strong:#34343c;--fg:#f4f4f6;--muted:#a1a1ab;--mark:#52525b;--warn:#f0b36a;--warn-soft:#2f2415}}
*{box-sizing:border-box}
body{margin:0;min-block-size:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Arabic","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.5}
.guest{inline-size:100%;max-inline-size:520px;text-align:center;display:flex;flex-direction:column;align-items:center}
.mark{inline-size:64px;block-size:64px;border-radius:19px;background:var(--mark);color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800}
.venue{font-size:15px;font-weight:700;letter-spacing:.02em;margin-block-start:14px;line-height:normal}
h1{margin:16px 0 0;font-size:28px;font-weight:800;letter-spacing:-.03em;line-height:1.25}
.lead{margin:12px 0 0;font-size:15px;color:var(--muted);line-height:1.6;max-inline-size:40ch}
.missing{text-align:center;max-inline-size:420px}
.code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:88px;font-weight:600;letter-spacing:-.04em;line-height:1;color:var(--surface-3)}
.code::before{content:"404"}
.missing h1{margin:14px 0 0;font-size:23px;font-weight:800;letter-spacing:-.025em;line-height:normal}
.missing p{margin:10px 0 0;font-size:14.5px;color:var(--muted);line-height:1.6;text-wrap:pretty}
.card{inline-size:100%;max-inline-size:460px;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:26px}
.power{inline-size:52px;block-size:52px;border-radius:15px;background:var(--surface-3);color:var(--muted);display:flex;align-items:center;justify-content:center;margin-block-end:18px}
.shield{background:var(--warn-soft);color:var(--warn)}
.title{margin:0;font-size:19px;font-weight:800;letter-spacing:-.025em;line-height:1.3}
.advice{font-size:14px;color:var(--muted);margin-block-start:8px;line-height:1.6}
.who{display:flex;align-items:center;gap:11px;margin-block-start:20px;padding:12px 14px;border-radius:13px;background:var(--surface-2);border:1px solid var(--border)}
.avatar{inline-size:36px;block-size:36px;border-radius:11px;background:var(--mark);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
.name{font-size:13.5px;font-weight:700;line-height:normal}
.email{font-size:12px;line-height:normal;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who>div{min-inline-size:0}
form{margin:18px 0 0}
button{inline-size:100%;min-block-size:50px;padding:13px;border-radius:12px;border:1px solid var(--border-strong);background:var(--surface);color:var(--fg);font:inherit;font-size:14.5px;font-weight:700;cursor:pointer}
button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
`;

/** A shield glyph for "this account cannot open it". */
const SHIELD_ICON =
  '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>' +
  '<path d="M12 8v4"/><path d="M12 16h.01"/></svg>';

/** A power glyph drawn inline — no icon font, no request. */
const POWER_ICON =
  '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v10"/>' +
  '<path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>';

export function renderUnavailablePage(input: UnavailablePageInput): string {
  const { t } = input;
  const app = input.appName;
  const venue = input.venueName ?? app;
  const dir = input.lang.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';

  let title: string;
  let body: string;
  if (input.side === 'customer') {
    title = t('studio:surfacePages.guest.title', '{app} isn’t available right now.', { app });
    body = `<main class="guest">
<div class="mark" aria-hidden="true">${escapeHtml(initialOf(venue))}</div>
${input.venueName === null ? '' : `<div class="venue">${escapeHtml(input.venueName)}</div>`}
<h1>${escapeHtml(title)}</h1>
<p class="lead">${escapeHtml(t('studio:surfacePages.guest.body', 'Please try again later.'))}</p>
</main>`;
  } else {
    title =
      input.reason === 'app-disabled'
        ? t('studio:surfacePages.staff.appOff', '{app} is switched off for now.', { app })
        : input.reason === 'no-access'
          ? t('studio:surfacePages.staff.noAccess', 'This account can’t open {app}.', { app })
          : t('studio:surfacePages.staff.sideOff', 'The staff screens of {app} are switched off.', { app });
    const advice =
      input.reason === 'no-access'
        ? t('studio:surfacePages.staff.noAccessAdvice', 'Ask your manager for a role that opens {app}.', { app })
        : t('studio:surfacePages.staff.advice', 'Ask your manager to switch it on in {app} → Settings.', { app });
    const who =
      input.user === null
        ? ''
        : `<div class="who"><div class="avatar" aria-hidden="true">${escapeHtml(initialsOf(input.user.name))}</div>
<div><div class="name">${escapeHtml(input.user.name)}</div><div class="email">${escapeHtml(input.user.email)}</div></div></div>`;
    const signOut =
      input.signOut === null
        ? ''
        : `<form method="post" action="${escapeHtml(input.signOut.action)}" enctype="text/plain">
<input type="hidden" name="${escapeHtml(input.signOut.field)}" value="${escapeHtml(input.signOut.token)}">
<button type="submit">${escapeHtml(t('studio:surfacePages.staff.signOut', 'Sign out'))}</button>
</form>`;
    body = `<main class="card">
<div class="${input.reason === 'no-access' ? 'power shield' : 'power'}">${input.reason === 'no-access' ? SHIELD_ICON : POWER_ICON}</div>
<h1 class="title">${escapeHtml(title)}</h1>
<p class="advice">${escapeHtml(advice)}</p>
${who}
${signOut}
</main>`;
  }

  return `<!doctype html>
<html lang="${escapeHtml(input.lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export interface NotFoundPageInput {
  /** BCP-47 tag for `lang`; Arabic turns the page right to left. */
  lang: string;
  t: (key: string, fallback: string, args?: Record<string, unknown>) => string;
}

/**
 * "Address not found" — what a guest's browser gets for a path the app's
 * customer domain does not serve (App Address Pages, row 15, 271-277). As the
 * comp draws it: a large faint mono "404" (generated content, so it stays the
 * decoration it is — the comp's faint grey is no text contrast, and the heading
 * says the same thing in words), one heading and one line — no
 * search, no links back, no request id, and no venue mark (DP-AP11 suggested
 * one; the comp has none) — the venue's domain says nothing about what else
 * runs behind it. An API call to the same path still gets the
 * JSON envelope; only a page load gets this.
 */
export function renderNotFoundPage(input: NotFoundPageInput): string {
  const { t } = input;
  const dir = input.lang.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
  const title = t('studio:surfacePages.notFound.title', 'Page not found');
  return `<!doctype html>
<html lang="${escapeHtml(input.lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="missing">
<div class="code" aria-hidden="true"></div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(t('studio:surfacePages.notFound.body', 'There’s nothing at this address. Check the link and try again.'))}</p>
</main>
</body>
</html>
`;
}
