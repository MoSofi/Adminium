// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api-docs` — the public API explorer, ported from the SPLIT layout of the
 * API & Backend design comp: a topbar, the resources rail, the endpoint
 * cards, and the playground with its response and code samples. Drawn with
 * NO session and no dashboard shell.
 *
 * ── WHAT IS REAL ───────────────────────────────────────────────────────────
 * Everything. The list is the catalogue — what live keys can call; "Send
 * request" makes a real request with the key the visitor pastes, and the
 * response area shows the real status, a measured time and the real body.
 * Nothing is simulated.
 *
 * ── THE KEY ────────────────────────────────────────────────────────────────
 * Held in component state only: never in a URL, in storage, in the query
 * cache or in a code sample, and gone on reload. The request is sent with
 * `credentials: 'omit'`, so a signed-in admin's cookie never rides along.
 * Only a BROWSER key can work here: the server refuses a server key from a
 * page, and that refusal is what renders.
 *
 * Off — or on a server that never had it — the catalogue answers 404 and this
 * route renders the ordinary not-found screen.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Globe,
  Lock,
  Play,
  Search,
  Send,
  Shield,
  Table2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn, METHOD_TONE, MethodBadge, Skeleton } from '@adminium/ui';

import { ThemeToggleButton } from '../auth/AuthScreenLayout.js';
import { t } from '../i18n/t.js';
import { docsUrl } from '../kb/docsLinks.js';
import { BrandMark } from '../shell/BrandMark.js';
import { useDocumentPageTitle } from '../shell/documentTitle.js';
import { SystemStateScreen } from '../states/StatePage.js';
import { apiDocsQuery, type ApiDocs, type CatalogueEndpoint } from './apiDocsApi.js';
import { useApiDocsMessages } from './apiDocsMessages.js';
import {
  authBadge,
  cardsFor,
  nounFor,
  requestUrl,
  sampleBody,
  schemaColumns,
  statusLine,
  statusTone,
  takesBody,
  takesId,
  type AuthBadge,
  type Card,
  type CardId,
  type RequestParams,
} from './model.js';
import { LANGUAGES, snippet, type Language } from './snippets.js';
import { codeLines, jsonLines, TONE_CLASS, type Line } from './tokenize.js';

/** The guide a caller of this API reads next. */
export const API_REFERENCE_PATH = 'guides/public-api/endpoints-and-keys/';

export interface ApiDocsSearch {
  resource?: string;
  endpoint?: string;
}

/* ------------------------------------------------------------------ route */

export function ApiDocsPage(): ReactNode {
  useApiDocsMessages();
  const docs = useQuery(apiDocsQuery());
  useDocumentPageTitle(t('apiDocs:crumb', 'API'));

  if (docs.isPending) return <Loading />;
  // A failed read and "this deployment has none" look the same to a visitor.
  if (docs.isError || docs.data === null) return <SystemStateScreen stateId="not-found" />;
  return <Explorer docs={docs.data} />;
}

function Loading(): ReactNode {
  return (
    <div className="flex h-screen min-h-[640px] flex-col bg-bg leading-[normal]">
      <div className="h-[60px] shrink-0 border-b border-border bg-surface" />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[236px] shrink-0 flex-col gap-2 border-e border-border bg-surface p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[33px] w-full" />
          ))}
        </div>
        <div className="flex-1 p-[22px_24px]">
          <Skeleton className="h-[26px] w-48" />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

/** A copy button's "Copied" state, for 1.4 s. */
function useCopied(): [string | null, (what: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    if (timer.current !== null) clearTimeout(timer.current);
    setCopied(what);
    timer.current = setTimeout(() => setCopied(null), 1_400);
  };
  return [copied, copy];
}

interface Located {
  group: number;
  endpoint: CatalogueEndpoint;
}

function cardTitle(endpoint: CatalogueEndpoint, card: Card): string {
  const { singular, article } = nounFor(endpoint, t('apiDocs:ep.rowWord', 'row'));
  const ref = endpoint.ref;
  switch (card.id) {
    case 'list':
      return t('apiDocs:ep.list.title', 'List {ref}', { ref });
    case 'one':
      return t('apiDocs:ep.one.title', 'Retrieve {article, select, an {an} other {a}} {singular}', { article, singular });
    case 'create':
      return t('apiDocs:ep.create.title', 'Create {article, select, an {an} other {a}} {singular}', { article, singular });
    case 'update':
      return t('apiDocs:ep.update.title', 'Update {article, select, an {an} other {a}} {singular}', { article, singular });
    case 'replace':
      return t('apiDocs:ep.replace.title', 'Replace {article, select, an {an} other {a}} {singular}', { article, singular });
    case 'delete':
      return t('apiDocs:ep.delete.title', 'Delete {article, select, an {an} other {a}} {singular}', { article, singular });
    case 'batch':
      return t('apiDocs:ep.batch.title', 'Create many {ref}', { ref });
  }
}

function cardDescription(card: Card): string {
  switch (card.id) {
    case 'list':
      return t('apiDocs:ep.list.desc', 'Return a filtered, ordered, paginated set of rows.');
    case 'one':
      return t('apiDocs:ep.one.desc', 'Fetch a single row by primary key.');
    case 'create':
      return t('apiDocs:ep.create.desc', 'Insert one row. Returns the created record.');
    case 'update':
      return t('apiDocs:ep.update.desc', 'Patch columns on the row with this primary key.');
    case 'replace':
      return t('apiDocs:ep.replace.desc', 'Replace a full row by primary key.');
    case 'delete':
      return t('apiDocs:ep.delete.desc', 'Remove the row with this primary key.');
    case 'batch':
      return t('apiDocs:ep.batch.desc', 'Bulk insert or upsert, up to 500 rows.');
  }
}

const BADGE: Readonly<Record<AuthBadge, { icon: ReactNode; className: string }>> = {
  anon: { icon: <Globe aria-hidden="true" className="size-[11px]" />, className: 'bg-warn-soft-solid text-warn' },
  public: { icon: <Globe aria-hidden="true" className="size-[11px]" />, className: 'bg-warn-soft-solid text-warn' },
  authenticated: { icon: <Shield aria-hidden="true" className="size-[11px]" />, className: 'bg-pos-soft-solid text-pos' },
  service: { icon: <Lock aria-hidden="true" className="size-[11px]" />, className: 'bg-danger-soft-solid text-danger' },
};

function badgeLabel(badge: AuthBadge): string {
  switch (badge) {
    case 'anon':
      return t('apiDocs:badge.anon', 'Public read');
    case 'public':
      return t('apiDocs:badge.public', 'Public');
    case 'authenticated':
      return t('apiDocs:badge.authenticated', 'Sign-in required');
    case 'service':
      return t('apiDocs:badge.service', 'Service role');
  }
}

const TAG_CLASS = {
  pk: 'bg-accent-soft-solid text-accent',
  unique: 'bg-info-soft-solid text-info',
  fk: 'bg-warn-soft-solid text-warn',
} as const;

function tagLabel(tag: keyof typeof TAG_CLASS): string {
  if (tag === 'pk') return t('apiDocs:tag.pk', 'PK');
  if (tag === 'unique') return t('apiDocs:tag.unique', 'UNIQUE');
  return t('apiDocs:tag.fk', 'FK');
}

function languageLabel(language: Language): string {
  if (language === 'curl') return t('apiDocs:code.curl', 'cURL');
  if (language === 'js') return t('apiDocs:code.js', 'JavaScript');
  return t('apiDocs:code.python', 'Python');
}

function Lines({ lines, className }: { lines: Line[]; className: string }): ReactNode {
  return lines.map((line, i) => (
    // Lines have no identity beyond their position in an immutable print.
    <div key={i} className={cn('whitespace-pre font-mono text-[11.5px]', className)}>
      {line.map((token, j) => (
            <span key={j} className={TONE_CLASS[token.tone]}>
          {token.text}
        </span>
      ))}
    </div>
  ));
}

/* --------------------------------------------------------------- explorer */

interface Sent {
  status: number;
  ms: number;
  /** Parsed JSON, or the raw text when it was not JSON; undefined for no body. */
  body: unknown;
}

function Explorer({ docs }: { docs: ApiDocs }): ReactNode {
  const search: ApiDocsSearch = useSearch({ strict: false });
  const navigate = useNavigate();
  const [copied, copy] = useCopied();
  const [filter, setFilter] = useState('');
  const [key, setKey] = useState('');
  const [language, setLanguage] = useState<Language>('curl');
  const [params, setParams] = useState<Record<string, RequestParams>>({});
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const all: Located[] = useMemo(
    () => docs.connections.flatMap((c, group) => c.endpoints.map((endpoint) => ({ group, endpoint }))),
    [docs],
  );
  const selected = all.find((l) => l.endpoint.ref === search.resource) ?? all[0] ?? null;
  const cards = selected === null ? [] : cardsFor(selected.endpoint);
  const card = cards.find((c) => c.id === search.endpoint) ?? cards[0] ?? null;

  const live = docs.registered && docs.apiEnabled;
  const baseUrl = `${docs.baseUrl}/api/v1/public`;

  const go = (next: ApiDocsSearch) => {
    inFlight.current?.abort();
    setSending(false);
    setSent(null);
    setFailed(false);
    void navigate({ to: '/api-docs', search: next as never, replace: true });
  };

  const needle = filter.trim().toLowerCase();
  const groups = docs.connections.map((connection, group) => ({
    label: connection.label,
    rows: all.filter((l) => l.group === group && (needle.length === 0 || l.endpoint.ref.toLowerCase().includes(needle))),
  }));
  const anyRow = groups.some((g) => g.rows.length > 0);

  const sig = selected === null || card === null ? '' : `${selected.endpoint.ref}:${card.id}`;
  const cardParams: RequestParams =
    params[sig] ?? { id: '', limit: selected === null ? '' : String(selected.endpoint.limit), order: '' };
  const setParam = (field: keyof RequestParams, value: string) =>
    setParams((p) => ({ ...p, [sig]: { ...cardParams, [field]: value } }));
  const bodyText =
    selected === null || card === null
      ? ''
      : (bodies[sig] ?? JSON.stringify(sampleBody(selected.endpoint, card), null, 2));
  const url = selected === null || card === null ? '' : requestUrl(docs.baseUrl, card, cardParams);
  const code = selected === null || card === null ? '' : snippet(language, docs.baseUrl, selected.endpoint, card);

  async function send(): Promise<void> {
    if (card === null || key.trim().length === 0) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setSending(true);
    setSent(null);
    setFailed(false);
    const started = performance.now();
    try {
      const withBody = takesBody(card);
      const response = await fetch(url, {
        method: card.http,
        headers: {
          authorization: `Bearer ${key.trim()}`,
          accept: 'application/json',
          ...(withBody ? { 'content-type': 'application/json' } : {}),
        },
        ...(withBody ? { body: bodyText } : {}),
        // Never the admin's cookie, never a cached answer.
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = undefined;
      if (text.length > 0) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = text;
        }
      }
      if (inFlight.current !== controller) return;
      setSent({ status: response.status, ms: Math.max(1, Math.round(performance.now() - started)), body });
    } catch {
      if (inFlight.current !== controller || controller.signal.aborted) return;
      setFailed(true);
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setSending(false);
      }
    }
  }

  const hasKey = key.trim().length > 0;

  return (
    <div className="flex h-screen min-h-[640px] flex-col overflow-hidden bg-bg font-sans leading-[normal] text-fg max-[760px]:h-auto max-[760px]:min-h-screen max-[760px]:overflow-visible">
      {/* ================= topbar =================
          `min-h-[60px]`: the comp's bar is as tall as its REST/GraphQL tray, which
          this product does not port (there is no GraphQL support). Without it the
          bar loses 3 px and every column below starts higher than drawn. */}
      <header className="flex min-h-[60px] shrink-0 items-center gap-[11px] border-b border-border bg-surface px-5 py-[11px] max-[760px]:flex-wrap">
        <BrandMark size="topbar" />
        <div className="flex items-center gap-1.5 text-[12.5px] text-fg-subtle">
          <ChevronRight aria-hidden="true" className="size-3.5" />
          <span className="font-bold text-fg-muted">{t('apiDocs:crumb', 'API')}</span>
        </div>
        <button
          type="button"
          title={t('apiDocs:copyBase', 'Copy base URL')}
          aria-label={t('apiDocs:copyBase', 'Copy base URL')}
          onClick={() => copy('base', baseUrl)}
          className="ms-2.5 flex min-w-0 max-w-[340px] items-center gap-2 rounded-[9px] border border-border bg-surface-2 px-[11px] py-1.5"
        >
          <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', live ? 'bg-pos' : 'bg-fg-subtle')} />
          <span dir="ltr" className="truncate font-mono text-[12px] text-fg-muted">
            {baseUrl}
          </span>
          {copied === 'base' ? (
            <Check aria-hidden="true" className="size-[13px] shrink-0 text-fg-subtle" />
          ) : (
            <Copy aria-hidden="true" className="size-[13px] shrink-0 text-fg-subtle" />
          )}
        </button>
        <div className="flex-1" />
        {/* A status, not a control: a visitor cannot flip this switch. */}
        <span
          role="status"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[9px] border px-[11px] py-1.5 text-[12px] font-bold',
            live
              ? 'border-[color-mix(in_srgb,var(--pos)_30%,transparent)] bg-pos-soft text-pos'
              : 'border-border-strong bg-surface text-fg-muted',
          )}
        >
          <span aria-hidden="true" className={cn('size-1.5 rounded-full', live ? 'bg-pos' : 'bg-fg-subtle')} />
          {live ? t('apiDocs:status.live', 'API live') : t('apiDocs:status.off', 'Disabled')}
        </span>
        <ThemeToggleButton className="size-[34px] rounded-[9px] border-border bg-surface hover:bg-surface [&_svg]:size-4" />
      </header>

      <div className="flex min-h-0 flex-1 animate-[nb-fade_.26s_cubic-bezier(.2,.7,.3,1)] max-[760px]:flex-col">
        {/* ================= rail ================= */}
        <aside className="nb-scroll-comp flex w-[236px] shrink-0 flex-col overflow-auto border-e border-border bg-surface max-[760px]:w-full max-[760px]:border-e-0 max-[760px]:border-b">
          <div className="px-4 pb-[9px] pt-[15px] text-[10.5px] font-bold uppercase tracking-[.06em] text-fg-subtle">
            {t('apiDocs:rail.heading', 'Resources')}
          </div>
          <label className="mx-3 mb-2 flex items-center gap-2 rounded-[9px] border border-border bg-surface-2 px-2.5 py-[7px]">
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('apiDocs:rail.filter', 'Filter tables…')}
              aria-label={t('apiDocs:rail.filter', 'Filter tables…')}
              // `px-0.5 py-px`: the comp leaves the browser's own input padding in
              // place, which Tailwind's reset removes; the box is 2 px taller in
              // the comp because of it.
              className="w-full border-none bg-transparent px-0.5 py-px text-[12.5px] text-fg outline-none placeholder:text-fg-subtle"
            />
          </label>
          <nav aria-label={t('apiDocs:rail.heading', 'Resources')} className="flex flex-col gap-0.5 px-2 pb-3 pt-0.5">
            {groups.map((group, g) =>
              group.rows.length === 0 ? null : (
                // Groups are positional: the reply never names a connection by id.
                            <div key={g} className="flex flex-col gap-0.5">
                  {group.label === null ? null : (
                    <div className="px-2 pb-[9px] pt-[15px] text-[10.5px] font-bold uppercase tracking-[.06em] text-fg-subtle">
                      {group.label}
                    </div>
                  )}
                  {group.rows.map((row) => {
                    const on = row.endpoint.ref === selected?.endpoint.ref && row.group === selected.group;
                    return (
                      <button
                        key={row.endpoint.ref}
                        type="button"
                        aria-current={on ? 'true' : undefined}
                        onClick={() => go({ resource: row.endpoint.ref })}
                        className={cn(
                          'flex w-full items-center gap-[9px] rounded-[9px] px-2.5 py-2 text-start',
                          on ? 'bg-accent-soft' : 'bg-transparent',
                        )}
                      >
                        <Table2 aria-hidden="true" className="size-[15px] shrink-0 text-fg-subtle" />
                        <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono text-[12.5px] font-semibold text-fg">
                          {row.endpoint.ref}
                        </span>
                        <span aria-hidden="true" className="flex shrink-0 gap-[3px]">
                          {row.endpoint.methods.map((m) => (
                            <span key={m} className={cn('size-1.5 rounded-[2px]', METHOD_TONE[m].dot)} />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ),
            )}
            {all.length > 0 && !anyRow ? (
              <p className="px-2.5 py-2 text-[12px] text-fg-subtle">{t('apiDocs:rail.empty', 'Nothing matches that filter.')}</p>
            ) : null}
          </nav>
          <a
            href={docsUrl(API_REFERENCE_PATH)}
            className="mt-auto flex items-center gap-[7px] border-t border-border px-4 py-[13px] text-[12px] font-semibold text-fg-muted hover:text-fg"
          >
            <BookOpen aria-hidden="true" className="size-3.5" />
            {t('apiDocs:rail.reference', 'API reference')}
          </a>
        </aside>

        {selected === null || card === null ? (
          <section className="min-w-0 flex-1 p-[22px_24px] compact:p-[14px_18px]">
            {/* The page's empty state. */}
            <h1 className="m-0 text-[19px] font-extrabold tracking-[-.02em]">{t('apiDocs:empty.title', 'No endpoints yet')}</h1>
            <p className="mt-[5px] text-[12.5px] text-fg-muted">
              {t('apiDocs:empty.body', 'This deployment has not published any endpoints.')}
            </p>
          </section>
        ) : (
          <>
            {/* ================= explorer ================= */}
            <section className="nb-scroll-comp min-w-0 flex-1 overflow-auto p-[22px_24px] compact:p-[14px_18px]">
              <div className="mb-[5px] flex items-center gap-2.5">
                <h1 dir="ltr" className="m-0 font-mono text-[19px] font-bold tracking-[-.02em]">
                  {selected.endpoint.ref}
                </h1>
                {(() => {
                  const badge = authBadge(selected.endpoint);
                  return (
                    <span
                      className={cn(
                        'inline-flex items-center gap-[5px] rounded-[20px] px-2 py-0.5 text-[10.5px] font-bold',
                        BADGE[badge].className,
                      )}
                    >
                      {BADGE[badge].icon}
                      {badgeLabel(badge)}
                    </span>
                  );
                })()}
              </div>
              <p className="mb-[18px] mt-0 text-[12.5px] text-fg-muted">
                {t('apiDocs:meta', '{endpoints, plural, one {# endpoint} other {# endpoints}} · limit {limit}, order {order}', {
                  endpoints: cards.length,
                  limit: selected.endpoint.limit,
                  order: selected.endpoint.order,
                })}
              </p>

              <div className="flex flex-col gap-[9px]">
                {cards.map((c) => (
                  <EndpointCard
                    key={c.id}
                    endpoint={selected.endpoint}
                    card={c}
                    open={c.id === card.id}
                    onOpen={() => go({ resource: selected.endpoint.ref, endpoint: c.id })}
                  />
                ))}
              </div>
            </section>

            {/* ================= playground + code ================= */}
            <aside className="nb-scroll-comp flex w-[432px] shrink-0 flex-col overflow-auto border-s border-border bg-surface max-[760px]:w-full max-[760px]:border-s-0 max-[760px]:border-t">
              <div className="border-b border-border px-[18px] pb-3.5 pt-4">
                <div className="mb-[11px] flex items-center gap-2">
                  <Play aria-hidden="true" className="size-[15px] text-accent" />
                  <span className="text-[13px] font-extrabold tracking-[-.01em]">{t('apiDocs:pg.title', 'Playground')}</span>
                </div>
                <div className="flex items-center gap-2 rounded-[10px] border border-border-strong bg-surface-2 px-2.5 py-2">
                  <MethodBadge method={card.method} size="md" radius={6} className="font-bold" />
                  <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-muted">
                    {url}
                  </span>
                </div>

                {/* The comp's labelled-field pattern: a label above a full-width
                    input, not a param row. */}
                <div className="mt-2.5">
                  <label htmlFor="api-docs-key" className="mb-[5px] block text-[11px] font-semibold text-fg-muted">
                    {t('apiDocs:pg.auth', 'Authorization')}
                  </label>
                  <input
                    id="api-docs-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    dir="ltr"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder={t('apiDocs:pg.authPlaceholder', 'Paste a key')}
                    aria-describedby="api-docs-key-help"
                    className="w-full rounded-[8px] border border-border-strong bg-surface-2 px-[9px] py-1.5 font-mono text-[11.5px] text-fg outline-none"
                  />
                  <p id="api-docs-key-help" className="mt-1 text-[11px] text-fg-subtle">
                    {t('apiDocs:pg.authHelper', 'A browser key. It stays in this tab and is gone when you reload.')}
                  </p>
                </div>

                {/* `id` for one row; `limit` and `order` for a list — the server ignores `select`. */}
                {takesId(card) || card.id === 'list' ? (
                  <div className="mt-2.5 flex flex-col gap-[7px]">
                    {(takesId(card) ? (['id'] as const) : (['limit', 'order'] as const)).map((field) => (
                      <div key={field} className="flex items-center gap-2">
                        <label htmlFor={`api-docs-${field}`} className="w-16 shrink-0 font-mono text-[11.5px] text-fg-muted">
                          {field}
                        </label>
                        <input
                          id={`api-docs-${field}`}
                          dir="ltr"
                          value={cardParams[field]}
                          onChange={(event) => setParam(field, event.target.value)}
                          placeholder={field === 'order' ? selected.endpoint.order : undefined}
                          className="min-w-0 flex-1 rounded-[8px] border border-border-strong bg-surface-2 px-[9px] py-1.5 font-mono text-[11.5px] text-fg outline-none"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}

                {takesBody(card) ? (
                  <div className="mt-2.5">
                    <label htmlFor="api-docs-body" className="mb-[5px] block text-[11px] font-semibold text-fg-muted">
                      {t('apiDocs:pg.body', 'Request body')}
                    </label>
                    <textarea
                      id="api-docs-body"
                      rows={5}
                      dir="ltr"
                      spellCheck={false}
                      value={bodyText}
                      onChange={(event) => setBodies((b) => ({ ...b, [sig]: event.target.value }))}
                      className="w-full resize-none rounded-[10px] border border-border-strong bg-surface-2 px-[11px] py-[9px] font-mono text-[11.5px] leading-[1.5] text-fg outline-none"
                    />
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={!hasKey || sending}
                  title={hasKey ? undefined : t('apiDocs:pg.needKey', 'Paste a key first')}
                  onClick={() => void send()}
                  className={cn(
                    'mt-3 flex w-full items-center justify-center gap-2 rounded-[10px] p-2.5 text-[13px] font-bold',
                    hasKey
                      ? 'bg-accent text-accent-fg shadow-glow'
                      : 'cursor-not-allowed bg-surface-3 text-fg-subtle shadow-none',
                  )}
                >
                  {sending ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="inline-block size-3.5 animate-[spin_.7s_linear_infinite] rounded-full border-2 border-accent-fg/45 border-t-accent-fg"
                      />
                      {t('apiDocs:pg.sending', 'Sending…')}
                    </>
                  ) : (
                    <>
                      <Send aria-hidden="true" className="size-3.5" />
                      {t('apiDocs:pg.send', 'Send request')}
                    </>
                  )}
                </button>
              </div>

              {/* response */}
              <div className="border-b border-border px-[18px] py-3.5" aria-live="polite">
                <div className="mb-2.5 flex items-center gap-[9px]">
                  <span className="text-[11px] font-bold uppercase tracking-[.05em] text-fg-subtle">
                    {t('apiDocs:res.title', 'Response')}
                  </span>
                  {sent === null ? null : (
                    <>
                      <span
                        className={cn(
                          'rounded-[6px] px-[7px] py-0.5 text-center font-mono text-[11px] font-bold',
                          statusTone(sent.status) === 'pos'
                            ? 'bg-pos-soft-solid text-pos'
                            : statusTone(sent.status) === 'muted'
                              ? 'bg-surface-3 text-fg-muted'
                              : 'bg-danger-soft-solid text-danger',
                        )}
                      >
                        {statusLine(sent.status)}
                      </span>
                      <span className="font-mono text-[11px] text-fg-subtle">
                        {t('apiDocs:res.ms', '{ms} ms', { ms: sent.ms })}
                      </span>
                    </>
                  )}
                </div>
                {sending ? null : sent !== null && (sent.body !== undefined || sent.status !== 204) ? (
                  <div className="adm-always-dark nb-scroll-comp max-h-[220px] overflow-auto rounded-[11px] border border-border bg-bg px-3.5 py-3" dir="ltr">
                    <Lines lines={sent.body === undefined ? [[{ text: ' ', tone: 'base' }]] : jsonLines(sent.body)} className="leading-[1.6]" />
                  </div>
                ) : (
                  <div className="adm-always-dark rounded-[11px] border border-border bg-bg p-4 font-mono text-[12px] text-code-gray">
                    {failed
                      ? t('apiDocs:res.network', 'The request did not reach the server.')
                      : sent !== null
                        ? t('apiDocs:res.noBody', '204 No Content — row deleted')
                        : t('apiDocs:res.idle', 'Send a request to see the response.')}
                  </div>
                )}
              </div>

              {/* code */}
              <div className="px-[18px] pb-5 pt-3.5">
                <div className="mb-2.5 flex items-center justify-between">
                  <div
                    role="tablist"
                    aria-label={t('apiDocs:code.languages', 'Code sample language')}
                    className="flex gap-[3px] rounded-[8px] border border-border bg-surface-2 p-[3px]"
                  >
                    {LANGUAGES.map((l) => (
                      <button
                        key={l}
                        type="button"
                        role="tab"
                        aria-selected={language === l}
                        aria-controls="api-docs-code"
                        onClick={() => setLanguage(l)}
                        className={cn(
                          'rounded-[6px] px-[11px] py-[5px] font-mono text-[11.5px] font-bold',
                          language === l ? 'bg-surface text-fg shadow-card' : 'bg-transparent text-fg-subtle',
                        )}
                      >
                        {languageLabel(l)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => copy('code', code)}
                    className="nb-ib flex items-center gap-[5px] rounded-[8px] border border-border bg-surface px-2.5 py-[5px] text-[11.5px] font-semibold text-fg-muted hover:text-fg"
                  >
                    {copied === 'code' ? (
                      <Check aria-hidden="true" className="size-[13px]" />
                    ) : (
                      <Copy aria-hidden="true" className="size-[13px]" />
                    )}
                    {copied === 'code' ? t('apiDocs:code.copied', 'Copied') : t('apiDocs:code.copy', 'Copy')}
                  </button>
                </div>
                <div
                  id="api-docs-code"
                  role="tabpanel"
                  tabIndex={0}
                  dir="ltr"
                  className="adm-always-dark nb-scroll-comp overflow-auto rounded-[11px] border border-border bg-bg px-[15px] py-[13px]"
                >
                  <Lines lines={codeLines(code)} className="leading-[1.62]" />
                </div>
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ one card */

function EndpointCard({
  endpoint,
  card,
  open,
  onOpen,
}: {
  endpoint: CatalogueEndpoint;
  card: Card;
  open: boolean;
  onOpen: () => void;
}): ReactNode {
  const columns = schemaColumns(endpoint, card);
  const bodyId = `api-docs-card-${card.id}`;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[12px] border bg-surface shadow-card',
        open ? 'border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]' : 'border-border',
      )}
    >
      {/* Clicking the open card does not close it: one is always open. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onOpen}
        className="flex w-full items-center gap-3 bg-transparent px-[15px] py-3 text-start"
      >
        <MethodBadge method={card.method} size="md" radius={6} className="font-bold" />
        <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono text-[12.5px] font-semibold text-fg">
          {card.path}
        </span>
        <span className="shrink-0 text-[12px] text-fg-subtle">{cardTitle(endpoint, card)}</span>
        {open ? (
          <ChevronDown aria-hidden="true" className="size-[15px] shrink-0 text-fg-subtle" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-[15px] shrink-0 text-fg-subtle rtl:rotate-180" />
        )}
      </button>
      {open ? (
        <div id={bodyId} className="border-t border-border px-[15px] pb-[15px] pt-0.5">
          <p className="mb-3.5 mt-3 text-[12.5px] leading-[1.55] text-fg-muted">{cardDescription(card)}</p>
          {columns.length === 0 ? null : (
            <>
              <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
                {card.http === 'GET' ? t('apiDocs:schema.response', 'Response columns') : t('apiDocs:schema.body', 'Body schema')}
              </div>
              <div className="flex flex-col gap-px">
                {columns.map((column) => (
                  <div key={column.name} className="flex items-center gap-2.5 border-b border-border py-[7px]">
                    <span dir="ltr" className="w-[130px] shrink-0 truncate font-mono text-[12.5px] font-semibold">
                      {column.name}
                    </span>
                    <span dir="ltr" className="flex-1 font-mono text-[11.5px] text-fg-subtle">
                      {column.type}
                    </span>
                    {column.tags.map((tag) => (
                      <span key={tag} className={cn('rounded-[5px] px-1.5 py-px font-mono text-[9.5px] font-bold', TAG_CLASS[tag])}>
                        {tagLabel(tag)}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export type { CardId };
