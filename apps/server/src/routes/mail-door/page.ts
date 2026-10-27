// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The mail door's pages, drawn here in one pass as whole documents: the
 * unsubscribe page and its endings, and "This page isn't available".
 *
 * ── NO SCRIPT ──────────────────────────────────────────────────────────────
 * A stranger opens these from a mail, often in a mail app's own browser. So
 * nothing on them runs: the buttons are a plain form post, the "Why?"
 * answers are radio buttons in the same form, and the language menu is a
 * `<details>` list of links. The content policy ({@link mailDoorPolicy})
 * allows no script at all, no frame, no outside file, and this page's one
 * style block by its hash.
 *
 * ── NOTHING HERE NAMES THE PLATFORM ────────────────────────────────────────
 * The page speaks for the business that sent the mail: its name in the
 * header and the footer, its contact address. Never Adminium's name or mark.
 *
 * ── Departures from the design comp (Public Pages) ─────────────────────────
 *  1. No script, so no "One moment…" busy state on the buttons: the browser
 *     shows its own loading while the form posts, and the next page is the
 *     ending itself.
 *  2. The language menu is a `<details>` list of links: it opens and closes
 *     with no script, but has no arrow keys and Escape does not close it.
 *  3. The header shows the business's initial in the accent colour, not an
 *     uploaded logo, and no city line; the footer has no legal name or city.
 *     Its "Privacy notice" link shows only once the privacy settings name
 *     the notice's address (Studio → Privacy & public pages).
 *  4. System fonts: Manrope and the mono face are served from the
 *     dashboard's own files, which a customer domain does not answer.
 *  5. A mail sent on the "existing customers" basis has no purpose, so its
 *     page has the one button (the do-not-email list), and no "Why?": that
 *     answer is kept on the consent log's row, and that page writes none.
 *  6. "This link doesn't work" names the business when it has no contact
 *     address to write to.
 */
import { createHash } from 'node:crypto';

/** The eight languages, each named in itself, in the comp's order. */
export const MAIL_DOOR_LANGUAGES: readonly { tag: string; name: string }[] = [
  { tag: 'en-US', name: 'English' },
  { tag: 'ar-EG', name: 'العربية' },
  { tag: 'cs-CZ', name: 'Čeština' },
  { tag: 'da-DK', name: 'Dansk' },
  { tag: 'de-DE', name: 'Deutsch' },
  { tag: 'fr-FR', name: 'Français' },
  { tag: 'zh-CN', name: '简体中文' },
  { tag: 'zh-TW', name: '繁體中文' },
];

/** The "Why?" answers, as the consent log keeps them. */
export const UNSUBSCRIBE_REASONS = ['too-many', 'not-useful', 'never-signed-up', 'other'] as const;
export type UnsubscribeReason = (typeof UNSUBSCRIBE_REASONS)[number];

const REASON_KEYS: Readonly<Record<UnsubscribeReason, [string, string]>> = {
  'too-many': ['mailDoor:reason.tooMany', 'Too many e-mails'],
  'not-useful': ['mailDoor:reason.notUseful', 'Not useful to me'],
  'never-signed-up': ['mailDoor:reason.neverSignedUp', 'I never signed up'],
  other: ['mailDoor:reason.other', 'Something else'],
};

/** The install's accent, light and dark, as `packages/tokens/src/accents.css` pairs them. */
const ACCENTS: Readonly<Record<string, [string, string]>> = {
  indigo: ['#4f46e5', '#99a5ff'],
  blue: ['#1c59e0', '#7fabff'],
  teal: ['#007167', '#49bbae'],
  violet: ['#7936e9', '#b39dff'],
  rose: ['#c40039', '#ff848c'],
  red: ['#c0202f', '#ff8582'],
  orange: ['#b03e00', '#ff885b'],
  black: ['#111111', '#c9c9d4'],
};

export type Translate = (key: string, fallback: string, args?: Record<string, unknown>) => string;

/** Who the page speaks for. */
export interface MailDoorBusiness {
  name: string;
  /** Where a person writes to; null when the business has not said. */
  email: string | null;
  /** The business's privacy notice (an https address); null while it is not set: then no link. */
  privacyNotice: string | null;
}

/** What the page shows in its main column. */
export type MailDoorView =
  | {
      kind: 'unsubscribe';
      address: string;
      /** Null: a mail on the existing-customers basis (one button, the do-not-email list). */
      purpose: 'newsletter' | 'surveys' | null;
      /** Where the form posts (the page's own address, its language kept). */
      action: string;
    }
  | { kind: 'done'; which: 'newsletter' | 'surveys' | 'all' }
  | { kind: 'already' }
  | { kind: 'dead' }
  | { kind: 'unavailable' };

export interface MailDoorPageInput {
  view: MailDoorView;
  business: MailDoorBusiness;
  /** BCP 47 (`de-DE`); Arabic turns the page right to left. */
  lang: string;
  /** The install's accent name (`appearance.accent`). */
  accent: string;
  /** The page's own path, for the language links (`?lang=` is added). */
  path: string;
  t: Translate;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** The first letter of a name, for the mark; a code point, not a UTF-16 half. */
function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? '·' : first.toLocaleUpperCase();
}

/** Lucide icons (stroke 2), drawn inline: no icon font, no request. */
const ICONS = {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  link2Off: '<path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 4 8"/><line x1="8" x2="12" y1="12" y2="12"/><line x1="2" x2="22" y1="2" y2="22"/>',
  searchX: '<path d="m13.5 8.5-5 5"/><path d="m8.5 8.5 5 5"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
} as const;

function icon(name: keyof typeof ICONS, size: number): string {
  return `<svg width="${String(size)}" height="${String(size)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

/** A private-use character standing for a value inside a translated sentence, replaced once the sentence is escaped. */
const SLOT = '';

/**
 * A translated sentence with one value drawn as markup of its own (an
 * address as an isolated left-to-right run, an e-mail link): the sentence is
 * translated around a stand-in, escaped, and the stand-in replaced.
 */
function withSlot(t: Translate, key: string, fallback: string, args: Record<string, unknown>, slotName: string, markup: string): string {
  const text = t(key, fallback, { ...args, [slotName]: SLOT });
  return escapeHtml(text).split(SLOT).join(markup);
}

function styleOf(accent: string): string {
  const [light, dark] = ACCENTS[accent] ?? ACCENTS['indigo']!;
  return `
:root{color-scheme:light;--page:#f6f6f8;--surface:#fff;--surface-3:#f1f1f4;--border:#ececef;--border-strong:#e2e2e8;--text:#191920;--muted:#4a4a54;--subtle:#5a5a65;--pos:#0b7d59;--pos-bg:#e6f5ee;--accent:${light};--on-accent:#fff;--shadow:0 1px 2px rgba(20,20,35,.04),0 1px 3px rgba(20,20,35,.05);--menu-shadow:0 1px 2px rgba(20,20,35,.04),0 12px 28px rgba(20,20,35,.12)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--page:#0a0a0d;--surface:#141419;--surface-3:#24242c;--border:rgba(255,255,255,.07);--border-strong:rgba(255,255,255,.13);--text:#f4f4f6;--muted:#b7b7c3;--subtle:#a1a1ad;--pos:#3ecf8e;--pos-bg:rgba(62,207,142,.14);--accent:${dark};--on-accent:#0f0f14;--shadow:0 1px 2px rgba(0,0,0,.4)}}
*{box-sizing:border-box}
body{margin:0;min-block-size:100vh;display:flex;flex-direction:column;background:var(--page);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;font-size:13px;line-height:1.5}
[lang^="ar"] body{font-family:"IBM Plex Sans Arabic","Noto Sans Arabic","Segoe UI",Tahoma,sans-serif}
[lang^="zh"] body{font-family:system-ui,-apple-system,"PingFang SC","Noto Sans SC","Microsoft YaHei","PingFang TC","Noto Sans TC",sans-serif}
[lang^="ar"] *,[lang^="zh"] *{letter-spacing:0!important}
a{color:var(--accent)}
a:hover{color:var(--text)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,"IBM Plex Sans Arabic",monospace}
.head{background:var(--surface);border-block-end:1px solid var(--border)}
.bar{max-inline-size:960px;margin-inline:auto;padding-block:12px;padding-inline:max(16px,3vw);display:flex;align-items:center;gap:12px;position:relative}
.mark{inline-size:40px;block-size:40px;border-radius:10px;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;letter-spacing:-.02em;flex:0 0 auto}
.name{font-size:14px;font-weight:700;line-height:1.3;min-inline-size:0;overflow-wrap:anywhere}
.lang{margin-inline-start:auto}
.lang>summary{list-style:none;block-size:44px;padding-inline:12px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;cursor:pointer}
.lang>summary::-webkit-details-marker{display:none}
.menu{position:absolute;inset-block-start:calc(100% - 4px);inset-inline-end:max(16px,3vw);z-index:5;inline-size:208px;margin:0;padding:6px;border-radius:14px;background:var(--surface);border:1px solid var(--border-strong);box-shadow:var(--menu-shadow);display:flex;flex-direction:column;gap:2px;list-style:none}
.menu a{min-block-size:40px;padding-inline:10px;border-radius:10px;color:var(--text);display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;text-decoration:none}
.menu a:hover{background:var(--surface-3)}
.menu a span{flex:1}
main{flex:1;inline-size:100%;max-inline-size:600px;margin-inline:auto;padding-inline:max(16px,3vw);padding-block:max(20px,3vw);display:grid;gap:20px;align-content:start}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:20px;min-inline-size:0}
h1.title{margin:0;font-size:20px;font-weight:800;letter-spacing:-.02em;line-height:1.3;text-wrap:pretty}
.addr{font-size:16px;font-weight:700;letter-spacing:-.01em;overflow-wrap:anywhere}
form{display:flex;flex-direction:column;gap:20px;margin:0}
fieldset{margin:0;padding:0;border:none;display:flex;flex-direction:column;gap:2px;min-inline-size:0}
legend{padding:0;margin-block-end:4px;font-size:13px;font-weight:700;display:flex;gap:8px;align-items:baseline}
.opt{font-size:11.5px;font-weight:500;color:var(--subtle)}
fieldset label{min-block-size:44px;display:flex;align-items:center;gap:10px;cursor:pointer}
input[type=radio]{inline-size:18px;block-size:18px;margin:0;accent-color:var(--accent);flex:0 0 auto}
.buttons{display:flex;flex-direction:column;gap:10px}
button{font:inherit;font-size:14px;font-weight:700;inline-size:100%;min-block-size:48px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
.primary{border:none;background:var(--accent);color:var(--on-accent)}
.secondary{padding:10px 14px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);line-height:1.35;text-wrap:balance}
.secondary:hover{border-color:var(--subtle)}
.status{gap:14px}
.row{display:flex;align-items:flex-start;gap:12px}
.tile{inline-size:36px;block-size:36px;border-radius:10px;background:var(--surface-3);color:var(--muted);display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.positive .tile{background:var(--pos-bg);color:var(--pos)}
.words{display:flex;flex-direction:column;gap:6px;min-inline-size:0;padding-block-start:7px}
h1.status-title{margin:0;font-size:14px;font-weight:700;line-height:1.4;text-wrap:pretty}
.para{margin:0;font-size:13px;line-height:1.5;color:var(--muted);text-wrap:pretty}
.para a{font-weight:700}
.small{margin:0;font-size:12px;line-height:1.5;color:var(--subtle);text-wrap:pretty}
.contact{display:flex;flex-direction:column;padding-block-start:6px;border-block-start:1px solid var(--border)}
.contact a{min-block-size:44px;display:flex;align-items:center;gap:10px;font-weight:700;text-decoration:none}
.foot{border-block-start:1px solid var(--border);background:var(--surface)}
.foot .bar{padding-block:16px;flex-wrap:wrap;gap:4px 20px;font-size:11.5px;line-height:1.5;color:var(--subtle)}
`;
}

/** The style block's hash, as the content policy names it. */
function styleHash(style: string): string {
  return `'sha256-${createHash('sha256').update(style, 'utf8').digest('base64')}'`;
}

/**
 * The content policy every mail door page carries: nothing but this page's
 * own style block (by its hash), forms posting to this host, and no script,
 * frame, picture or font from anywhere.
 */
export function mailDoorPolicy(styleSource: string | null): string {
  return [
    "default-src 'none'",
    styleSource === null ? "style-src 'none'" : `style-src ${styleHash(styleSource)}`,
    "img-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
}

function languageMenu(input: MailDoorPageInput): string {
  const { t } = input;
  const current = MAIL_DOOR_LANGUAGES.find((one) => one.tag === input.lang) ?? MAIL_DOOR_LANGUAGES[0]!;
  const label = t('mailDoor:language', 'Language');
  const items = MAIL_DOOR_LANGUAGES.map((one) => {
    const here = one.tag === current.tag;
    const dir = one.tag.startsWith('ar') ? 'rtl' : 'ltr';
    return `<li><a href="${escapeHtml(`${input.path}?lang=${one.tag}`)}" hreflang="${one.tag}" lang="${one.tag}" dir="${dir}"${here ? ' aria-current="true"' : ''}><span>${escapeHtml(one.name)}</span>${here ? icon('check', 16) : ''}</a></li>`;
  }).join('');
  return `<details class="lang"><summary aria-label="${escapeHtml(`${label}: ${current.name}`)}">${icon('globe', 16)}<span>${escapeHtml(current.name)}</span>${icon('chevronDown', 14)}</summary><ul class="menu" aria-label="${escapeHtml(label)}">${items}</ul></details>`;
}

function mailLink(email: string, withIcon: boolean): string {
  return `<a href="mailto:${escapeHtml(email)}">${withIcon ? icon('mail', 16) : ''}<bdi dir="ltr">${escapeHtml(email)}</bdi></a>`;
}

function statusCard(tone: 'positive' | 'neutral', iconName: keyof typeof ICONS, title: string, paras: string[], small: string | null, contact: string | null): string {
  return `<section class="card status ${tone}"><div class="row"><span class="tile">${icon(iconName, 18)}</span><div class="words"><h1 class="status-title">${escapeHtml(title)}</h1>${paras.map((p) => `<p class="para">${p}</p>`).join('')}${small === null ? '' : `<p class="small">${escapeHtml(small)}</p>`}</div></div>${contact === null ? '' : `<div class="contact">${mailLink(contact, true)}</div>`}</section>`;
}

function mainOf(input: MailDoorPageInput): string {
  const { t, view, business } = input;
  const named = { business: business.name };
  switch (view.kind) {
    case 'unsubscribe': {
      const addressMarkup = `<bdi dir="ltr" class="mono addr">${escapeHtml(view.address)}</bdi>`;
      const titleKey =
        view.purpose === 'newsletter'
          ? (['mailDoor:unsubscribe.titleNewsletter', 'Unsubscribe {address} from {business}’s newsletter?'] as const)
          : view.purpose === 'surveys'
            ? (['mailDoor:unsubscribe.titleSurveys', 'Unsubscribe {address} from {business}’s surveys?'] as const)
            : (['mailDoor:unsubscribe.titleAll', 'Unsubscribe {address} from all {business} marketing mail?'] as const);
      const title = withSlot(t, titleKey[0], titleKey[1], named, 'address', addressMarkup);
      const allLabel = escapeHtml(t('mailDoor:unsubscribe.all', 'Unsubscribe from all {business} marketing mail', named));
      let body: string;
      if (view.purpose === null) {
        body = `<div class="buttons"><button type="submit" name="act" value="all" class="primary">${allLabel}</button></div>`;
      } else {
        const reasons = UNSUBSCRIBE_REASONS.map((reason, index) => {
          const [key, fallback] = REASON_KEYS[reason];
          return `<label for="why-${String(index)}"><input id="why-${String(index)}" type="radio" name="why" value="${reason}"><span>${escapeHtml(t(key, fallback))}</span></label>`;
        }).join('');
        body =
          `<fieldset><legend><span>${escapeHtml(t('mailDoor:why', 'Why?'))}</span><span class="opt">${escapeHtml(t('mailDoor:optional', 'Optional'))}</span></legend>${reasons}</fieldset>` +
          `<div class="buttons"><button type="submit" name="act" value="one" class="primary">${escapeHtml(t('mailDoor:unsubscribe.one', 'Unsubscribe'))}</button>` +
          `<button type="submit" name="act" value="all" class="secondary">${allLabel}</button></div>`;
      }
      return `<section class="card"><h1 class="title">${title}</h1><form method="post" action="${escapeHtml(view.action)}">${body}</form></section>`;
    }
    case 'done': {
      const line =
        view.which === 'newsletter'
          ? t('mailDoor:unsubscribe.doneNewsletter', 'You won’t get {business}’s newsletter again.', named)
          : view.which === 'surveys'
            ? t('mailDoor:unsubscribe.doneSurveys', 'You won’t get {business}’s surveys again.', named)
            : t('mailDoor:unsubscribe.doneAll', 'You won’t get {business}’s marketing mail again.', named);
      const title = t('mailDoor:unsubscribe.done', 'You’re unsubscribed.');
      return statusCard('positive', 'circleCheck', title, [escapeHtml(line)], t('mailDoor:unsubscribe.stillService', 'Mails about your own orders and visits still reach you.'), null);
    }
    case 'already': {
      const title = t('mailDoor:unsubscribe.already', 'You’re already unsubscribed.');
      return statusCard('neutral', 'circleCheck', title, [], null, null);
    }
    case 'dead': {
      const title = t('mailDoor:unsubscribe.dead', 'This link doesn’t work.');
      const para =
        business.email === null
          ? escapeHtml(t('mailDoor:unsubscribe.deadAsk', 'Write to {business} and they’ll take you off the list.', named))
          : withSlot(t, 'mailDoor:unsubscribe.deadWrite', 'Write to {email} and we’ll take you off the list.', named, 'email', mailLink(business.email, false));
      return statusCard('neutral', 'link2Off', title, [para], null, null);
    }
    case 'unavailable': {
      const title = t('mailDoor:unavailable.title', 'This page isn’t available.');
      return statusCard('neutral', 'searchX', title, [], null, business.email);
    }
  }
}

/** A whole page, and the content policy it must be sent with. */
export function renderMailDoorPage(input: MailDoorPageInput): { html: string; policy: string } {
  const { t, business } = input;
  const dir = input.lang.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
  const style = styleOf(input.accent);
  const main = mainOf(input);
  const questions =
    business.email === null ? '' : `<span>${escapeHtml(t('mailDoor:questions', 'Questions? Write to'))} ${mailLink(business.email, false)}</span>`;
  // The notice opens on the business's own site: no referrer, and no hold on this page.
  const notice =
    business.privacyNotice === null ? '' : `<a href="${escapeHtml(business.privacyNotice)}" rel="noopener noreferrer">${escapeHtml(t('mailDoor:privacyNotice', 'Privacy notice'))}</a>`;
  const html = `<!doctype html>
<html lang="${escapeHtml(input.lang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(business.name)}</title>
<style>${style}</style>
</head>
<body>
<header class="head"><div class="bar"><span class="mark" aria-hidden="true" dir="ltr">${escapeHtml(initialOf(business.name))}</span><bdi class="name">${escapeHtml(business.name)}</bdi>${languageMenu(input)}</div></header>
<main>${main}</main>
<footer class="foot"><div class="bar"><bdi>${escapeHtml(business.name)}</bdi>${questions}${notice}</div></footer>
</body>
</html>
`;
  return { html, policy: mailDoorPolicy(style) };
}
