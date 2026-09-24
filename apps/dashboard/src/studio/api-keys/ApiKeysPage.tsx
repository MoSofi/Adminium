// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/public-api` — API keys & tokens, built to the API Keys design
 * comp, mapped line by line.
 *
 * ── WHAT CHANGED FROM THE PAGE THIS REPLACES ───────────────────────────────
 * The page before this one refused a scope BUILDER in writing: a builder
 * "reads as safer than it is", and the operator would stop seeing the
 * predicate they rely on. This page answers that rather than ignoring it:
 * the builder's pane shows the stored definition itself, the form is a second
 * way to edit the same document, and the predicate is both a form card and a
 * line of that document. A key is a selection of endpoints × methods, and
 * Adminium writes its scope.
 *
 * ── A SECRET NEVER ENTERS THE QUERY CACHE ──────────────────────────────────
 * The token a create returns and the token a reveal returns live in this
 * component's state and nowhere else — see `apiKeysApi.ts`.
 *
 * ── LINE-HEIGHT ────────────────────────────────────────────────────────────
 * The comp states no line-height on any atom, so every atom is `normal`; the
 * column below resets it once. Never `leading-normal`: in Tailwind v4 that is
 * 1.5.
 */
import { useQuery, useQueryClient, useSuspenseQueries } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  Activity,
  BookOpen,
  CircleCheckBig,
  Compass,
  Copy as CopyIcon,
  Check,
  Eye,
  Info,
  KeyRound,
  Plus,
  Route,
  Settings2,
  Table2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, ConfirmModal, MethodBadge, Skeleton } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { studioApi } from '../api.js';
import {
  endpointsQuery,
  keysQuery,
  publicApiStateQuery,
  revealKey,
  revokeKey,
  statsQuery,
  ENDPOINTS_QUERY_KEY,
  KEYS_QUERY_KEY,
  STATS_QUERY_KEY,
  type EndpointDto,
  type KeyDto,
  type KeyWithToken,
  type SourceDto,
} from './apiKeysApi.js';
import { AUTH_TONE, type AuthRole } from './copy.js';
import { CreateKeySheet, EMPTY_DRAFT, type KeyDraft } from './CreateKeySheet.js';
import { EndpointBuilder } from './EndpointBuilder.js';
import { accessCounts, maskKey, pruneSelection, rateLabel, relativeTime, unionMethods } from './model.js';

const CONNECTIONS_QUERY = {
  queryKey: ['studio', 'connections'] as const,
  queryFn: () => studioApi.listConnections(),
};

function locale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

/** The head-row atom: `text-micro` IS 10.5 / 700 / .05em. */
const HEAD =
  'border-b border-border bg-surface-2 px-3.5 py-[11px] text-micro uppercase leading-[normal] text-fg-subtle';
/** The cell atom: hover per cell, not per row. */
const CELL = 'flex min-w-0 items-center border-b border-border px-3.5 py-[13px] transition-colors duration-[120ms] group-hover:bg-surface-2';

function summaryText(endpoints: number, methods: number): string {
  return t(
    'studio:apiKeys.summary',
    '{endpoints, plural, one {# endpoint} other {# endpoints}} · {methods, plural, one {# method} other {# methods}}',
    { endpoints, methods },
  );
}

/** A parsed definition's few fields the table shows. */
function endpointFacts(e: EndpointDto): { role: AuthRole; rate: string | null } {
  try {
    const doc = JSON.parse(e.definition) as {
      auth?: { role?: AuthRole };
      rate_limit?: { requests?: number; window?: string };
    };
    const rate = doc.rate_limit?.requests === undefined ? null : rateLabel(doc.rate_limit.requests, doc.rate_limit.window ?? '1m');
    return { role: doc.auth?.role ?? 'anon', rate };
  } catch {
    return { role: 'anon', rate: null };
  }
}

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { connection?: string };
  const toasts = useAppToasts();
  const [{ data: state }, { data: keys }, { data: connections }] = useSuspenseQueries({
    queries: [publicApiStateQuery(), keysQuery(), CONNECTIONS_QUERY],
  });

  // With two or more connections the page is scoped to one, by `?connection=`.
  const connectionId =
    connections.find((c) => c.id === search.connection)?.id ?? connections[0]?.id ?? null;
  const endpointsLookup = useQuery({ ...endpointsQuery(connectionId ?? ''), enabled: connectionId !== null });
  const statsLookup = useQuery({ ...statsQuery(connectionId ?? ''), enabled: connectionId !== null });
  const endpoints: EndpointDto[] = endpointsLookup.data?.endpoints ?? [];
  const sources: SourceDto[] = endpointsLookup.data?.sources ?? [];

  const now = Date.now();
  const live = keys.filter(
    (k) =>
      (connectionId === null || k.connectionId === connectionId) &&
      k.revokedAt === null &&
      (k.expiresAt === null || k.expiresAt > now),
  );

  const [created, setCreated] = useState<{ result: KeyWithToken; summary: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; token: string } | null>(null);
  const [revoking, setRevoking] = useState<KeyDto | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<KeyDraft>(EMPTY_DRAFT);
  const [builder, setBuilder] = useState<{ endpoint: EndpointDto | null; fromSheet: boolean } | null>(null);
  const [focusRef, setFocusRef] = useState<string | null>(null);

  const refreshEndpoints = async (): Promise<EndpointDto[]> => {
    await queryClient.invalidateQueries({ queryKey: ENDPOINTS_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
    const fresh = connectionId === null ? null : await queryClient.fetchQuery(endpointsQuery(connectionId));
    return fresh?.endpoints ?? [];
  };

  const openSheet = (): void => {
    setCreated(null); // Opening the sheet clears the banner
    setSheetOpen(true);
  };

  const confirmRevoke = async (key: KeyDto): Promise<void> => {
    // The row leaves at once; it comes back with a toast if the call fails.
    queryClient.setQueryData(KEYS_QUERY_KEY, (rows: KeyDto[] | undefined) => rows?.filter((r) => r.id !== key.id));
    setRevoking(null);
    if (revealed?.id === key.id) setRevealed(null);
    try {
      await revokeKey(key.id);
    } catch {
      toasts.push({
        variant: 'error',
        title: t('studio:apiKeys.keys.revokeFailed', 'That key could not be revoked. It is still active.'),
      });
    } finally {
      await queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY });
    }
  };

  const toggleReveal = async (key: KeyDto): Promise<void> => {
    if (revealed?.id === key.id) {
      setRevealed(null);
      return;
    }
    // A fresh, audited read every time — never cached.
    const { token } = await revealKey(key.id);
    setRevealed({ id: key.id, token });
  };

  const copyToken = async (token: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* the token stays on screen, selectable */
    }
  };

  const docsEnabled = state.docsEnabled === true;
  const firstRef = endpoints.find((e) => e.methods.length > 0)?.ref ?? endpoints[0]?.ref ?? 'customers';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <PageSurface className="pb-10">
      <PageActions
        title={t('studio:apiKeys.title', 'API keys & tokens')}
        subtitle={t('studio:apiKeys.subtitle', 'Manage programmatic access to your workspace')}
      >
        {connections.length > 1 && connectionId !== null ? (
          <label className="flex items-center">
            <span className="sr-only">{t('studio:apiKeys.connection.label', 'Connection')}</span>
            <select
              value={connectionId}
              onChange={(event) => {
                void navigate({ to: '/studio/public-api', search: { connection: event.target.value } as never });
              }}
              className="h-[34px] w-[200px] rounded-[10px] border border-border-strong bg-surface-2 px-2.5 text-[12.5px] text-fg outline-none"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button size="topbar" className="gap-[7px] pe-[13px]" iconLeft={<Plus aria-hidden="true" />} onClick={openSheet} disabled={connectionId === null}>
          {t('studio:apiKeys.create', 'Create key')}
        </Button>
      </PageActions>

      <div className="flex max-w-[1040px] animate-[nb-fade_.28s_cubic-bezier(.2,.7,.3,1)] flex-col gap-[18px] leading-[normal]">
        {!state.registered ? (
          <Note>
            {t(
              'studio:apiKeys.note.notRegistered',
              'The public API is not enabled on this server. Set ADMINIUM_PUBLIC_API_ORIGINS and restart — keys made here will work from then on.',
            )}
          </Note>
        ) : !state.enabled ? (
          <Note>
            {t('studio:apiKeys.note.off', 'The public API is switched off, so no key works right now.')}{' '}
            <a href="/studio/settings" className="font-bold underline">
              {t('studio:apiKeys.note.offLink', 'Open Workspace settings')}
            </a>
          </Note>
        ) : null}

        {created !== null ? (
          <div
            role="status"
            className="rounded-[14px] border border-[color-mix(in_srgb,var(--pos)_30%,transparent)] bg-pos-soft px-[18px] py-4"
          >
            <div className="mb-2.5 flex items-center gap-[9px]">
              <CircleCheckBig aria-hidden="true" className="size-[17px] text-pos" />
              <span className="text-[13.5px] font-extrabold text-pos">
                {t('studio:apiKeys.banner.titleNamed', '{name} created', { name: created.result.key.name })}
              </span>
            </div>
            <div className="mb-2.5 text-[12px] text-fg-muted">
              {created.result.key.kind === 'server'
                ? t(
                    'studio:apiKeys.banner.bodyOnce',
                    "Copy it now — you won't be able to see it again. Scoped to {summary}.",
                    { summary: created.summary },
                  )
                : t(
                    'studio:apiKeys.banner.bodyRevealable',
                    'Copy it now — you can reveal it again from the list below. Scoped to {summary}.',
                    { summary: created.summary },
                  )}
            </div>
            <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-surface px-[13px] py-[11px]">
              <span dir="ltr" className="min-w-0 flex-1 select-all truncate font-mono text-[12.5px] text-fg">
                {created.result.token}
              </span>
              <button
                type="button"
                onClick={() => void copyToken(created.result.token)}
                className="nb-ib flex items-center gap-1.5 rounded-[8px] bg-accent-soft px-3 py-[7px] text-[12px] font-bold text-accent hover:text-fg"
              >
                {copied ? <Check aria-hidden="true" className="size-3.5" /> : <CopyIcon aria-hidden="true" className="size-3.5" />}
                {copied ? t('studio:apiKeys.banner.copied', 'Copied') : t('studio:apiKeys.banner.copy', 'Copy')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-4">
          <Stat icon={<KeyRound />} primary value={String(live.length)} label={t('studio:apiKeys.stats.keys', 'Active keys')} />
          <Stat icon={<Route />} value={String(endpoints.length)} label={t('studio:apiKeys.stats.endpoints', 'Endpoints')} />
          <Stat
            icon={<Activity />}
            value={new Intl.NumberFormat(locale(), { notation: 'compact' }).format(statsLookup.data?.requests24h ?? 0)}
            label={t('studio:apiKeys.stats.requests', 'Requests · 24h')}
          />
        </div>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex items-center border-b border-border px-[18px] py-[15px]">
            <h2 className="flex-1 text-[15px] font-extrabold tracking-[-.01em] text-fg">
              {t('studio:apiKeys.keys.title', 'Active keys')}
            </h2>
            <span className="text-[12px] text-fg-subtle">
              {t('studio:apiKeys.keys.count', '{n, plural, one {# key} other {# keys}}', { n: live.length })}
            </span>
          </div>
          <div role="table" className="grid grid-cols-[1.25fr_1.3fr_1.25fr_.85fr_90px] px-2">
            <div role="row" className="contents">
              <div role="columnheader" className={HEAD}>{t('studio:apiKeys.keys.col.name', 'Name')}</div>
              <div role="columnheader" className={HEAD}>{t('studio:apiKeys.keys.col.key', 'Key')}</div>
              <div role="columnheader" className={HEAD}>{t('studio:apiKeys.keys.col.access', 'Access')}</div>
              <div role="columnheader" className={HEAD}>{t('studio:apiKeys.keys.col.lastUsed', 'Last used')}</div>
              <div role="columnheader" className={HEAD}>
                <span className="sr-only">{t('studio:apiKeys.keys.col.actions', 'Actions')}</span>
              </div>
            </div>
            {live.map((key) => {
              const counts = accessCounts(key.access);
              const shown = revealed?.id === key.id ? revealed.token : null;
              const last = relativeTime(key.lastUsedAt, now, locale());
              return (
                <div key={key.id} role="row" className="group contents">
                  <div role="cell" className={CELL}>
                    <span className="flex min-w-0 items-center gap-[9px]">
                      <span
                        className={
                          key.kind === 'server'
                            ? 'shrink-0 rounded-[5px] bg-surface-3 px-1.5 py-0.5 text-[9px] font-extrabold tracking-[.04em] text-fg-muted'
                            : 'shrink-0 rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[9px] font-extrabold tracking-[.04em] text-accent'
                        }
                      >
                        {key.kind === 'server'
                          ? t('studio:apiKeys.keys.kind.server', 'SERVER')
                          : t('studio:apiKeys.keys.kind.browser', 'BROWSER')}
                      </span>
                      <span className="truncate text-[13px] font-bold text-fg">{key.name}</span>
                      {key.requiresStaff != null ? (
                        <span
                          className="shrink-0 rounded-[5px] bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted"
                          title={t('studio:apiKeys.keys.staffOnlyHint', 'Answers only on a screen where a staff member holding {role} is signed in.', { role: key.requiresStaff.roleSlug })}
                        >
                          {t('studio:apiKeys.keys.staffOnly', 'Staff screen only')}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div role="cell" className={CELL}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span dir="ltr" className={`truncate font-mono text-[12px] text-fg-muted ${shown === null ? '' : 'select-all'}`}>
                        {shown ?? maskKey(key.prefix)}
                      </span>
                      {key.kind === 'browser' ? (
                        <button
                          type="button"
                          aria-label={shown === null ? t('studio:apiKeys.keys.reveal', 'Reveal key') : t('studio:apiKeys.keys.hide', 'Hide key')}
                          title={shown === null ? t('studio:apiKeys.keys.reveal', 'Reveal key') : t('studio:apiKeys.keys.hide', 'Hide key')}
                          aria-pressed={shown !== null}
                          onClick={() => void toggleReveal(key)}
                          className={`nb-ib flex size-6 shrink-0 items-center justify-center rounded-[6px] hover:text-fg ${
                            shown === null ? 'text-fg-subtle' : 'bg-accent-soft text-accent'
                          }`}
                        >
                          <Eye aria-hidden="true" className="size-3.5" />
                        </button>
                      ) : null}
                    </span>
                  </div>
                  <div role="cell" className={CELL}>
                    <span className="flex min-w-0 flex-col gap-[5px]">
                      <span className="text-[11.5px] text-fg-muted">{summaryText(counts.endpoints, counts.methods)}</span>
                      <span className="flex flex-wrap gap-1">
                        {unionMethods(key.access).map((m) => (
                          <MethodBadge key={m} method={m} />
                        ))}
                      </span>
                    </span>
                  </div>
                  <div role="cell" className={CELL}>
                    <span className="text-[12px] text-fg-muted">{last ?? t('studio:apiKeys.keys.never', 'Never')}</span>
                  </div>
                  <div role="cell" className={`${CELL} justify-end`}>
                    <button
                      type="button"
                      onClick={() => setRevoking(key)}
                      className="nb-ib rounded-[8px] bg-danger-soft px-[11px] py-1.5 text-[11.5px] font-bold text-danger hover:text-fg"
                    >
                      {t('studio:apiKeys.keys.revoke', 'Revoke')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {live.length === 0 ? (
            <div className="p-11 text-center text-[13px] text-fg-subtle">
              {t('studio:apiKeys.keys.empty', 'No active keys. Create one to get started.')}
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex items-center gap-3 border-b border-border px-[18px] py-[15px]">
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-extrabold tracking-[-.01em] text-fg">
                {t('studio:apiKeys.endpoints.title', 'Endpoints')}
              </h2>
              <div className="mt-0.5 text-[12px] text-fg-muted">
                {t('studio:apiKeys.endpoints.subtitle', 'Generated from your schema. Keys are scoped to these.')}
              </div>
            </div>
            {docsEnabled ? (
              <a
                href="/api-docs"
                className="nb-ib flex items-center gap-1.5 rounded-[9px] border border-border px-[11px] py-[7px] text-[12px] font-bold text-fg-muted hover:text-fg"
              >
                <Compass aria-hidden="true" className="size-3.5" />
                {t('studio:apiKeys.endpoints.explore', 'Explore API')}
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setBuilder({ endpoint: null, fromSheet: false })}
              disabled={connectionId === null}
              className="flex items-center gap-1.5 rounded-[9px] border border-[color-mix(in_srgb,var(--accent)_34%,transparent)] bg-accent-soft py-[7px] pe-3 ps-2.5 text-[12.5px] font-bold text-accent"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              {t('studio:apiKeys.endpoints.new', 'New endpoint')}
            </button>
          </div>
          <div role="table" className="grid grid-cols-[1.6fr_1.5fr_1fr_.8fr_40px] px-2">
            <div role="row" className="contents">
              <div role="columnheader" className={HEAD}>{t('studio:apiKeys.endpoints.col.route', 'Route')}</div>
              <div role="columnheader" className={HEAD}>{t('studio:apiKeys.endpoints.col.methods', 'Methods')}</div>
              <div role="columnheader" className={HEAD}>{t('studio:apiKeys.endpoints.col.auth', 'Auth')}</div>
              <div role="columnheader" className={HEAD}>{t('studio:apiKeys.endpoints.col.rate', 'Rate limit')}</div>
              <div role="columnheader" className={HEAD}>
                <span className="sr-only">{t('studio:apiKeys.keys.col.actions', 'Actions')}</span>
              </div>
            </div>
            {endpointsLookup.isPending && connectionId !== null
              ? [0, 1, 2].map((i) => (
                  <div key={i} className="contents">
                    {[0, 1, 2, 3, 4].map((j) => (
                      <div key={j} className={CELL}>
                        <Skeleton className="h-4 w-full" />
                      </div>
                    ))}
                  </div>
                ))
              : endpoints.map((endpoint) => {
                  const facts = endpointFacts(endpoint);
                  const RowIcon = endpoint.origin === 'custom' ? Route : Table2;
                  return (
                    <div key={endpoint.ref} role="row" className="group contents">
                      <div role="cell" className={CELL}>
                        <span className="flex min-w-0 items-center gap-[9px]">
                          <RowIcon aria-hidden="true" className="size-[15px] shrink-0 text-fg-subtle" />
                          <span
                            dir="ltr"
                            title={`/api/v1/public/records${endpoint.path}`}
                            className="truncate font-mono text-[12.5px] font-semibold text-fg"
                          >
                            /api/v1/public/records{endpoint.path}
                          </span>
                          {endpoint.issues.length > 0 ? (
                            <span className="shrink-0 rounded-[5px] bg-danger-soft px-[5px] py-0.5 text-[9.5px] font-extrabold tracking-[.04em] text-danger">
                              {t('studio:apiKeys.endpoints.unavailable', 'UNAVAILABLE')}
                            </span>
                          ) : endpoint.origin === 'custom' ? (
                            <span className="shrink-0 rounded-[5px] bg-surface-3 px-[5px] py-0.5 text-[9.5px] font-extrabold tracking-[.04em] text-fg-muted">
                              {t('studio:apiKeys.endpoints.custom', 'CUSTOM')}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div role="cell" className={CELL}>
                        <span className="flex flex-wrap gap-1">
                          {endpoint.methods.map((m) => (
                            <MethodBadge key={m} method={m} />
                          ))}
                        </span>
                      </div>
                      <div role="cell" className={CELL}>
                        <span className={`whitespace-nowrap rounded-[6px] px-2 py-[3px] text-[10.5px] font-bold ${AUTH_TONE[facts.role]}`}>
                          {facts.role}
                        </span>
                      </div>
                      <div role="cell" className={CELL}>
                        <span className="font-mono text-[12px] text-fg-muted">{facts.rate ?? ''}</span>
                      </div>
                      <div role="cell" className={`${CELL} justify-end`}>
                        <button
                          type="button"
                          aria-label={t('studio:apiKeys.endpoints.edit', 'Edit endpoint')}
                          title={t('studio:apiKeys.endpoints.edit', 'Edit endpoint')}
                          onClick={() => setBuilder({ endpoint, fromSheet: false })}
                          className="nb-ib flex size-7 items-center justify-center rounded-[8px] text-fg-subtle hover:text-fg"
                        >
                          <Settings2 aria-hidden="true" className="size-[15px]" />
                        </button>
                      </div>
                    </div>
                  );
                })}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="mb-1.5 flex items-center gap-[9px]">
            <BookOpen aria-hidden="true" className="size-4 text-accent" />
            <h2 className="text-[14px] font-extrabold text-fg">{t('studio:apiKeys.quick.title', 'Quick start')}</h2>
          </div>
          <div className="mb-3 text-[12.5px] text-fg-muted">
            {t('studio:apiKeys.quick.body', 'Authenticate requests with your key in the Authorization header.')}
          </div>
          <div dir="ltr" className="adm-always-dark overflow-x-auto rounded-[11px] bg-bg px-[17px] py-[15px] font-mono text-[12px] leading-[1.7] text-fg">
            <div>
              <span className="text-code-blue">curl</span> {origin}/api/v1/public/records/{firstRef} \
            </div>
            <div className="ps-4">
              <span className="text-code-blue">-H</span>{' '}
              <span className="text-code-green">&quot;Authorization: Bearer adm_srv_••••&quot;</span>
            </div>
          </div>
        </section>
      </div>

      {connectionId !== null ? (
        <CreateKeySheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          connectionId={connectionId}
          endpoints={endpoints}
          sources={sources}
          draft={draft}
          onDraft={setDraft}
          focusRef={focusRef}
          onFocusRef={setFocusRef}
          onNewEndpoint={() => setBuilder({ endpoint: null, fromSheet: true })}
          onEditEndpoint={(endpoint) => setBuilder({ endpoint, fromSheet: true })}
          onCreated={(result, summary) => {
            setSheetOpen(false);
            setCreated({ result, summary });
            setDraft(EMPTY_DRAFT); // The next open starts from nothing
            queryClient.setQueryData(KEYS_QUERY_KEY, (rows: KeyDto[] | undefined) => [
              result.key,
              ...(rows ?? []).filter((r) => r.id !== result.key.id),
            ]);
            void queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: ENDPOINTS_QUERY_KEY });
          }}
        />
      ) : null}

      {builder !== null && connectionId !== null ? (
        <EndpointBuilder
          open
          onOpenChange={(open) => {
            if (!open) setBuilder(null);
          }}
          connectionId={connectionId}
          endpoint={builder.endpoint}
          sources={sources}
          onSaved={async (saved) => {
            const fresh = await refreshEndpoints();
            // A method the endpoint no longer offers leaves the draft.
            setDraft((d) => ({ ...d, selection: pruneSelection(d.selection, fresh) }));
            if (builder.fromSheet) setFocusRef(saved.ref);
            setBuilder(null);
          }}
          onDeleted={async () => {
            const fresh = await refreshEndpoints();
            setDraft((d) => ({ ...d, selection: pruneSelection(d.selection, fresh) }));
            setBuilder(null);
          }}
        />
      ) : null}

      {revoking !== null ? (
        <ConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setRevoking(null);
          }}
          title={t('studio:apiKeys.keys.revokeConfirm.title', 'Revoke {name}?', { name: revoking.name })}
          body={t(
            'studio:apiKeys.keys.revokeConfirm.body',
            'Anything using this key stops working at once. This cannot be undone.',
          )}
          confirmWord={revoking.name}
          promptLabel={t('studio:apiKeys.keys.revokeConfirm.prompt', 'Type “{name}” to confirm', { name: revoking.name })}
          confirmLabel={t('studio:apiKeys.keys.revokeConfirm.confirm', 'Revoke key')}
          cancelLabel={t('studio:apiKeys.sheet.cancel', 'Cancel')}
          closeLabel={t('studio:apiKeys.sheet.close', 'Close')}
          onConfirm={() => confirmRevoke(revoking)}
        />
      ) : null}
    </PageSurface>
  );
}

/** The warning shown above the stats when the API is unregistered or switched off. */
function Note({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="flex items-start gap-[9px] rounded-[10px] bg-warn-soft px-[13px] py-[11px] text-[11.5px] leading-[1.55] text-warn">
      <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** A stat tile. */
function Stat({ icon, value, label, primary = false }: { icon: ReactNode; value: string; label: string; primary?: boolean }) {
  return (
    <div className="flex items-center gap-[13px] rounded-[14px] border border-border bg-surface px-[18px] py-4 shadow-card">
      <div
        aria-hidden="true"
        className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px] ${
          primary ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-fg-muted'
        }`}
      >
        {icon}
      </div>
      <div>
        {/* 800 in the comp, which renders at 600: it loads the mono face to 600. */}
        <div className="font-mono text-[22px] font-semibold text-fg">{value}</div>
        <div className="mt-[3px] text-[12px] text-fg-muted">{label}</div>
      </div>
    </div>
  );
}
