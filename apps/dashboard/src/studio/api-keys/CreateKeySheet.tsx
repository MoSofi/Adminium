// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The create-key sheet: pick the endpoints and the methods one key may call,
 * in two layouts — Panes (a list and a detail) and List (expandable cards).
 * Both edit one draft.
 *
 * The draft lives with the page, not here: Cancel keeps it for the next open
 * (the comp's state outlives its close), a successful create clears it, and a
 * builder save prunes it — a method the endpoint no longer offers leaves the
 * draft too.
 */
import { useQuery } from '@tanstack/react-query';
import { Check, Columns2, Eye, Info, KeyRound, List as ListIcon, Plus, Search, Settings2, Square, CheckCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MethodBadge, METHOD_TONE, Sheet, SheetBar, SheetBody, SheetFooter, SheetHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { customerAppKeys, surfacesQuery } from '../apps/hostedAppsApi.js';
import {
  changedRefsFrom,
  createKey,
  issuesFrom,
  type EndpointDto,
  type KeyKind,
  type KeyWithToken,
  type Method,
  type SourceDto,
} from './apiKeysApi.js';
import { AUTH_TONE, METHOD_COPY, type AuthRole } from './copy.js';
import {
  METHODS,
  bulk,
  expiresAtFor,
  filterEndpoints,
  footerSummary,
  scopeString,
  selectionCounts,
  setMethods,
  toggleAll,
  toggleMethod,
  triState,
  type ExpiryChoice,
  type Selection,
  type TriState,
} from './model.js';

export interface KeyDraft {
  name: string;
  kind: KeyKind;
  expiry: ExpiryChoice;
  appKey: string;
  query: string;
  selection: Selection;
}

/** Nothing selected, on first open and after every create. */
export const EMPTY_DRAFT: KeyDraft = { name: '', kind: 'browser', expiry: 'never', appKey: '', query: '', selection: {} };

const LAYOUT_STORAGE = 'adm.apiKeys.layout';

function readLayout(): 'panes' | 'list' {
  try {
    return window.localStorage.getItem(LAYOUT_STORAGE) === 'list' ? 'list' : 'panes';
  } catch {
    return 'panes';
  }
}

function writeLayout(layout: 'panes' | 'list'): void {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE, layout);
  } catch {
    /* a per-browser convenience; nothing breaks without it */
  }
}

/* --- atoms (Appendix C) --------------------------------------------------- */

const TRAY = 'flex gap-[3px] rounded-[9px] border border-border bg-surface-2 p-[3px]';
const segClass = (on: boolean): string =>
  `flex items-center gap-1.5 rounded-[7px] px-[11px] py-1.5 text-[12px] font-bold [&_svg]:size-3.5 ${
    on ? 'bg-surface text-fg shadow-card' : 'text-fg-subtle'
  }`;
const TOOL_BTN =
  'nb-ib flex items-center gap-1.5 rounded-[9px] border border-border bg-surface px-[11px] py-[7px] text-[12px] font-bold text-fg-muted hover:text-fg [&_svg]:size-3.5';
const FIELD_LABEL = 'text-[11px] font-bold uppercase tracking-[.04em] text-fg-subtle';

function Seg<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: { value: V; label: string; icon?: ReactNode }[];
  onChange: (value: V) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={TRAY}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={segClass(value === o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The tri-state box: 19 × 19, r6, 1.5 px — off `surface` + `border-strong`;
 * some / all `accent`, with a 9 × 2 dash or a 9 × 5 check drawn in CSS. A
 * real checkbox to assistive technology.
 */
function TriBox({ state, onToggle, label }: { state: TriState; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
      aria-label={label}
      title={t('studio:apiKeys.sheet.toggleAll', 'Toggle all methods')}
      onClick={onToggle}
      className={`flex size-[19px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px] p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        state === 'none' ? 'border-border-strong bg-surface' : 'border-accent bg-accent text-accent-fg'
      }`}
    >
      {state === 'some' ? <span aria-hidden="true" className="h-0.5 w-[9px] rounded-[1px] bg-current" /> : null}
      {state === 'all' ? (
        <span aria-hidden="true" className="h-[5px] w-[9px] -translate-y-px translate-x-px -rotate-45 border-b-2 border-s-2 border-current" />
      ) : null}
    </button>
  );
}

/** A method row: box, `md` badge, title + description, scope string. */
function MethodRow({
  method,
  endpointRef,
  on,
  compact,
  onToggle,
}: {
  method: Method;
  endpointRef: string;
  on: boolean;
  compact: boolean;
  onToggle: () => void;
}) {
  const copy = METHOD_COPY[method];
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onToggle}
      className={`flex min-w-0 items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-start transition-[border-color,background-color] duration-[120ms] hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        on ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-soft' : 'border-border bg-surface'
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] ${
          on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong bg-transparent text-transparent'
        }`}
      >
        <Check className="size-3" />
      </span>
      <MethodBadge method={method} size="md" />
      {compact ? (
        <span className="min-w-0 text-[11.5px] text-fg-muted">{t(copy.desc.key, copy.desc.fallback)}</span>
      ) : (
        <>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[12.5px] font-bold text-fg">{t(copy.title.key, copy.title.fallback)}</span>
            <span className="text-[11.5px] text-fg-muted">{t(copy.desc.key, copy.desc.fallback)}</span>
          </span>
          <span dir="ltr" className="ms-auto whitespace-nowrap font-mono text-[11px] text-fg-subtle">
            {scopeString(endpointRef, method)}
          </span>
        </>
      )}
    </button>
  );
}

function roleOf(endpoint: EndpointDto): { role: AuthRole; limit: number | null; order: string | null } {
  try {
    const doc = JSON.parse(endpoint.definition) as {
      auth?: { role?: AuthRole };
      pagination?: { default_limit?: number; order?: string };
    };
    return { role: doc.auth?.role ?? 'anon', limit: doc.pagination?.default_limit ?? null, order: doc.pagination?.order ?? null };
  } catch {
    return { role: 'anon', limit: null, order: null };
  }
}

export interface CreateKeySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  endpoints: EndpointDto[];
  sources: SourceDto[];
  draft: KeyDraft;
  onDraft: (update: (draft: KeyDraft) => KeyDraft) => void;
  /** The endpoint the Panes detail shows; set by the page after a builder save. */
  focusRef: string | null;
  onFocusRef: (ref: string | null) => void;
  onNewEndpoint: () => void;
  onEditEndpoint: (endpoint: EndpointDto) => void;
  onCreated: (result: KeyWithToken, summary: string) => void;
}

export function CreateKeySheet({
  open,
  onOpenChange,
  connectionId,
  endpoints,
  sources,
  draft,
  onDraft,
  focusRef,
  onFocusRef,
  onNewEndpoint,
  onEditEndpoint,
  onCreated,
}: CreateKeySheetProps) {
  const [layout, setLayout] = useState<'panes' | 'list'>(readLayout);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // An app binding is offered only when a hosted app has a customer surface. Not in the
  // suspense set: the surfaces namespace sits behind another permission.
  const surfaces = useQuery({ ...surfacesQuery(), retry: false, throwOnError: false, enabled: open });
  const apps = surfaces.data === undefined ? [] : customerAppKeys(surfaces.data);

  const grantable = useMemo(() => endpoints.filter((e) => e.methods.length > 0), [endpoints]);
  const visible = filterEndpoints(grantable, draft.query);
  const sourceOf = (e: EndpointDto): SourceDto | undefined => sources.find((s) => s.id === e.source);

  // A focused endpoint hidden by the filter hands focus to the first visible one.
  const focused = visible.find((e) => e.ref === focusRef) ?? visible[0] ?? null;
  useEffect(() => {
    // The List layout starts with its first card open.
    const first = grantable[0];
    if (layout === 'list' && first !== undefined) {
      setExpanded((current) => (Object.keys(current).length === 0 ? { [first.ref]: true } : current));
    }
  }, [layout, grantable]);

  const counts = selectionCounts(draft.selection);
  const summary = footerSummary(draft.selection, grantable);
  const select = (update: (selection: Selection) => Selection): void => {
    setRefusal(null);
    onDraft((d) => ({ ...d, selection: update(d.selection) }));
  };

  const metaOf = (e: EndpointDto): string => {
    const source = sourceOf(e);
    const rows = source?.rowCountEstimate ?? null;
    const name = e.source ?? '';
    // The row count is dropped when it is unknown.
    return rows === null
      ? t('studio:apiKeys.sheet.rowMetaNoRows', '{source}', { source: name })
      : t('studio:apiKeys.sheet.rowMeta', '{source} · {rows} rows', { source: name, rows });
  };

  const submit = async (): Promise<void> => {
    if (counts.permissions === 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      const access = grantable
        .filter((e) => (draft.selection[e.ref] ?? []).length > 0)
        .map((e) => ({
          ref: e.ref,
          methods: [...(draft.selection[e.ref] ?? [])],
          // What the sheet showed, so a re-introspected default is refused, not silently widened.
          ...(e.stored || e.source === null ? {} : { source: e.source }),
          ...(e.stored || e.selectHash === null ? {} : { selectHash: e.selectHash }),
        }));
      const result = await createKey({
        name: draft.name.trim() === '' ? t('studio:apiKeys.keys.untitled', 'Untitled key') : draft.name.trim(),
        connectionId,
        kind: draft.kind,
        access,
        ...(expiresAtFor(draft.expiry, Date.now()) === undefined ? {} : { expiresAt: expiresAtFor(draft.expiry, Date.now()) as number }),
        ...(draft.kind === 'browser' && draft.appKey !== '' ? { appKey: draft.appKey } : {}),
      });
      onCreated(
        result,
        t(
          'studio:apiKeys.summary',
          '{endpoints, plural, one {# endpoint} other {# endpoints}} · {methods, plural, one {# method} other {# methods}}',
          { endpoints: counts.endpoints, methods: counts.permissions },
        ),
      );
    } catch (error) {
      const changed = changedRefsFrom(error);
      const issues = issuesFrom(error);
      // The refusal takes the footer's summary slot.
      const first = changed !== null ? changed.join(', ') : issues[0]?.message ?? (error instanceof Error ? error.message : String(error));
      setRefusal(first);
    } finally {
      setBusy(false);
    }
  };

  const unsupported = focused === null ? [] : METHODS.filter((m) => !focused.methods.includes(m));
  const focusFacts = focused === null ? null : roleOf(focused);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetHeader
        icon={<KeyRound />}
        title={t('studio:apiKeys.sheet.title', 'Create API key')}
        subtitle={t('studio:apiKeys.sheet.subtitle', 'Pick the endpoints and methods this key may call')}
        closeLabel={t('studio:apiKeys.sheet.close', 'Close')}
        actions={
          <Seg
            label={t('studio:apiKeys.sheet.layout.label', 'Layout')}
            value={layout}
            onChange={(next) => {
              setLayout(next);
              writeLayout(next);
            }}
            options={[
              { value: 'panes', label: t('studio:apiKeys.sheet.layout.panes', 'Panes'), icon: <Columns2 aria-hidden="true" /> },
              { value: 'list', label: t('studio:apiKeys.sheet.layout.list', 'List'), icon: <ListIcon aria-hidden="true" /> },
            ]}
          />
        }
      />

      <SheetBar variant="fields" className="max-[760px]:flex-wrap">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={FIELD_LABEL}>{t('studio:apiKeys.sheet.name.label', 'Key name')}</span>
          <input
            value={draft.name}
            maxLength={80}
            onChange={(event) => onDraft((d) => ({ ...d, name: event.target.value }))}
            placeholder={t('studio:apiKeys.sheet.name.placeholder', 'e.g. Orders sync worker')}
            className="w-full rounded-[10px] border border-border-strong bg-surface-2 px-[11px] py-[9px] text-[13px] text-fg outline-none placeholder:text-fg-subtle focus-visible:border-accent"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>{t('studio:apiKeys.sheet.kind.label', 'Used from')}</span>
          <Seg
            label={t('studio:apiKeys.sheet.kind.label', 'Used from')}
            value={draft.kind}
            onChange={(kind) => onDraft((d) => ({ ...d, kind }))}
            options={[
              { value: 'browser', label: t('studio:apiKeys.sheet.kind.browser', 'Browser') },
              { value: 'server', label: t('studio:apiKeys.sheet.kind.server', 'Server') },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>{t('studio:apiKeys.sheet.expires.label', 'Expires')}</span>
          <Seg
            label={t('studio:apiKeys.sheet.expires.label', 'Expires')}
            value={draft.expiry}
            onChange={(expiry) => onDraft((d) => ({ ...d, expiry }))}
            options={[
              { value: 'd30', label: t('studio:apiKeys.sheet.expires.d30', '30 days') },
              { value: 'd90', label: t('studio:apiKeys.sheet.expires.d90', '90 days') },
              { value: 'never', label: t('studio:apiKeys.sheet.expires.never', 'Never') },
            ]}
          />
        </div>
        {apps.length > 0 && draft.kind === 'browser' ? (
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>{t('studio:apiKeys.sheet.app.label', 'App')}</span>
            <select
              value={draft.appKey}
              onChange={(event) => onDraft((d) => ({ ...d, appKey: event.target.value }))}
              className="w-[180px] rounded-[10px] border border-border-strong bg-surface-2 px-2.5 py-[9px] text-[12.5px] text-fg outline-none"
            >
              <option value="">{t('studio:apiKeys.sheet.app.none', 'None')}</option>
              {apps.map((app) => (
                <option key={app} value={app}>
                  {app}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </SheetBar>

      <SheetBar variant="tools">
        <div className="flex min-w-[230px] items-center gap-2 rounded-[9px] border border-border bg-surface px-[11px] py-[7px]">
          <Search aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
          <input
            value={draft.query}
            onChange={(event) => onDraft((d) => ({ ...d, query: event.target.value }))}
            placeholder={t('studio:apiKeys.sheet.filter', 'Filter endpoints')}
            aria-label={t('studio:apiKeys.sheet.filter', 'Filter endpoints')}
            // `px-0.5 py-px`: the browser's own input padding, which the comp keeps and
            // Tailwind's reset removes — 2 px of the toolbar's height.
            className="w-full border-none bg-transparent px-0.5 py-px text-[12.5px] text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <button type="button" className={TOOL_BTN} onClick={() => select((s) => bulk(s, visible, 'all'))}>
          <CheckCheck aria-hidden="true" />
          {t('studio:apiKeys.sheet.selectAll', 'Select all')}
        </button>
        <button type="button" className={TOOL_BTN} onClick={() => select((s) => bulk(s, visible, 'none'))}>
          <Square aria-hidden="true" />
          {t('studio:apiKeys.sheet.deselectAll', 'Deselect all')}
        </button>
        <button type="button" className={TOOL_BTN} onClick={() => select((s) => bulk(s, visible, 'read'))}>
          <Eye aria-hidden="true" />
          {t('studio:apiKeys.sheet.readOnly', 'Read-only preset')}
        </button>
        <div aria-live="polite" className="ms-auto flex items-center gap-2 text-[12px] text-fg-muted">
          <span
            className={`rounded-[7px] px-2 py-[3px] font-mono text-[11.5px] font-semibold ${
              counts.permissions === 0 ? 'bg-surface-3 text-fg-subtle' : 'bg-accent-soft text-accent'
            }`}
          >
            {counts.permissions}
          </span>
          {t(
            'studio:apiKeys.sheet.count',
            '{permissions, plural, one {permission} other {permissions}} on {endpoints, plural, one {# endpoint} other {# endpoints}}',
            { permissions: counts.permissions, endpoints: counts.endpoints },
          )}
        </div>
      </SheetBar>

      <SheetBody>
        {layout === 'panes' ? (
          <div className="flex min-h-0 flex-1 max-[760px]:flex-col">
            <div className="nb-scroll w-[320px] shrink-0 overflow-auto border-e border-border bg-surface p-2.5 max-[760px]:w-full">
              {visible.map((e) => {
                const selected = draft.selection[e.ref];
                const n = (selected ?? []).length;
                return (
                  <div
                    key={e.ref}
                    className={`mb-0.5 flex items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] ${focused?.ref === e.ref ? 'bg-surface-3' : ''}`}
                  >
                    <TriBox
                      state={triState(selected, e.methods)}
                      onToggle={() => select((s) => toggleAll(s, e))}
                      label={`/${e.ref}`}
                    />
                    <button
                      type="button"
                      onClick={() => onFocusRef(e.ref)}
                      aria-current={focused?.ref === e.ref ? 'true' : undefined}
                      className="flex min-w-0 flex-1 flex-col gap-[3px] text-start"
                    >
                      <span dir="ltr" className="truncate font-mono text-[12.5px] font-semibold text-fg">
                        /{e.ref}
                      </span>
                      <span className="text-[11px] text-fg-subtle">{metaOf(e)}</span>
                    </button>
                    <span className={`shrink-0 font-mono text-[11px] font-semibold ${n > 0 ? 'text-accent' : 'text-fg-subtle'}`}>
                      {n}/{e.methods.length}
                    </span>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={onNewEndpoint}
                className="mt-2 flex w-full items-center gap-[7px] rounded-[10px] border border-dashed border-border-strong px-[11px] py-2.5 text-[12.5px] font-bold text-fg-muted [&_svg]:size-3.5"
              >
                <Plus aria-hidden="true" />
                {t('studio:apiKeys.sheet.newEndpoint', 'New endpoint')}
              </button>
            </div>
            <div className="nb-scroll min-w-0 flex-1 overflow-auto px-[22px] py-[18px]">
              {focused !== null && focusFacts !== null ? (
                <>
                  <div className="mb-1 flex items-center gap-2.5">
                    <h3 dir="ltr" className="m-0 font-mono text-[15px] font-semibold tracking-[-.01em] text-fg">
                      /{focused.ref}
                    </h3>
                    <span className={`whitespace-nowrap rounded-[6px] px-2 py-[3px] text-[10.5px] font-bold ${AUTH_TONE[focusFacts.role]}`}>
                      {focusFacts.role}
                    </span>
                  </div>
                  <div className="mb-3.5 text-[12.5px] text-fg-muted">
                    {(sourceOf(focused)?.rowCountEstimate ?? null) === null
                      ? t('studio:apiKeys.sheet.focusMetaNoRows', '{source} · limit {limit}, order {order}', {
                          source: focused.source ?? '',
                          limit: focusFacts.limit ?? '',
                          order: focusFacts.order ?? '',
                        })
                      : t('studio:apiKeys.sheet.focusMeta', '{source} · {rows} rows · limit {limit}, order {order}', {
                          source: focused.source ?? '',
                          rows: sourceOf(focused)?.rowCountEstimate ?? 0,
                          limit: focusFacts.limit ?? '',
                          order: focusFacts.order ?? '',
                        })}
                  </div>
                  <div className="mb-3.5 flex gap-2">
                    <button type="button" className={TOOL_BTN} onClick={() => select((s) => setMethods(s, focused.ref, focused.methods))}>
                      {t('studio:apiKeys.sheet.allMethods', 'Select all methods')}
                    </button>
                    <button type="button" className={TOOL_BTN} onClick={() => select((s) => setMethods(s, focused.ref, []))}>
                      {t('studio:apiKeys.sheet.clear', 'Clear')}
                    </button>
                    <button type="button" className={TOOL_BTN} onClick={() => onEditEndpoint(focused)}>
                      <Settings2 aria-hidden="true" />
                      {t('studio:apiKeys.sheet.edit', 'Edit endpoint')}
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {focused.methods.map((m) => (
                      <MethodRow
                        key={m}
                        method={m}
                        endpointRef={focused.ref}
                        on={(draft.selection[focused.ref] ?? []).includes(m)}
                        compact={false}
                        onToggle={() => select((s) => toggleMethod(s, focused.ref, m))}
                      />
                    ))}
                  </div>
                  {unsupported.length > 0 ? (
                    <div role="note" className="mt-3.5 flex items-start gap-[9px] rounded-[10px] bg-warn-soft px-[13px] py-[11px] text-[11.5px] leading-[1.55] text-warn">
                      <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                      <span>
                        {t(
                          'studio:apiKeys.sheet.unsupported',
                          '{count, plural, one {{methods} is not exposed on this route. Edit the endpoint to enable it.} other {{methods} are not exposed on this route. Edit the endpoint to enable them.}}',
                          { count: unsupported.length, methods: unsupported.join(', ') },
                        )}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="nb-scroll flex-1 overflow-auto px-5 py-4">
            <div className="flex max-w-[860px] flex-col gap-[9px]">
              {visible.map((e) => {
                const selected = draft.selection[e.ref] ?? [];
                const open = expanded[e.ref] === true;
                return (
                  <div key={e.ref} className="overflow-hidden rounded-[12px] border border-border bg-surface shadow-card">
                    <div className="flex items-center gap-[11px] px-3.5 py-3">
                      <TriBox state={triState(selected, e.methods)} onToggle={() => select((s) => toggleAll(s, e))} label={`/${e.ref}`} />
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpanded((x) => ({ ...x, [e.ref]: !open }))}
                        className="flex min-w-0 flex-1 items-center gap-[9px] text-start"
                      >
                        <span
                          aria-hidden="true"
                          className={`me-0.5 size-1.5 shrink-0 border-b-[1.6px] border-e-[1.6px] border-fg-subtle transition-transform duration-[140ms] ${
                            open ? 'rotate-45' : '-rotate-45'
                          }`}
                        />
                        <span dir="ltr" className="truncate font-mono text-[13px] font-semibold text-fg">
                          /{e.ref}
                        </span>
                        <span className="whitespace-nowrap text-[11.5px] text-fg-subtle">{metaOf(e)}</span>
                      </button>
                      <span className="flex flex-wrap justify-end gap-1">
                        {e.methods.map((m) => {
                          const on = selected.includes(m);
                          const tone = METHOD_TONE[m];
                          return (
                            <button
                              key={m}
                              type="button"
                              aria-pressed={on}
                              onClick={() => select((s) => toggleMethod(s, e.ref, m))}
                              className={`rounded-[7px] border px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[.03em] transition-[filter] duration-[120ms] hover:brightness-[.97] ${
                                on ? `${tone.text} ${tone.solid} ${tone.border}` : 'border-border bg-transparent text-fg-subtle'
                              }`}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                    {open ? (
                      <div className="border-t border-border bg-surface-2 px-3.5 pb-3.5 pt-3">
                        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
                          {e.methods.map((m) => (
                            <MethodRow
                              key={m}
                              method={m}
                              endpointRef={e.ref}
                              on={selected.includes(m)}
                              compact
                              onToggle={() => select((s) => toggleMethod(s, e.ref, m))}
                            />
                          ))}
                        </div>
                        <div className="mt-[11px] flex gap-2">
                          <button type="button" className={TOOL_BTN} onClick={() => select((s) => setMethods(s, e.ref, e.methods))}>
                            {t('studio:apiKeys.sheet.selectAllShort', 'Select all')}
                          </button>
                          <button type="button" className={TOOL_BTN} onClick={() => select((s) => setMethods(s, e.ref, []))}>
                            {t('studio:apiKeys.sheet.clear', 'Clear')}
                          </button>
                          <button type="button" className={TOOL_BTN} onClick={() => onEditEndpoint(e)}>
                            <Settings2 aria-hidden="true" />
                            {t('studio:apiKeys.sheet.edit', 'Edit endpoint')}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={onNewEndpoint}
                className="flex items-center justify-center gap-[7px] rounded-[12px] border border-dashed border-border-strong p-3 text-[12.5px] font-bold text-fg-muted [&_svg]:size-[15px]"
              >
                <Plus aria-hidden="true" />
                {t('studio:apiKeys.sheet.newEndpoint', 'New endpoint')}
              </button>
            </div>
          </div>
        )}
      </SheetBody>

      <SheetFooter>
        <div className={`min-w-0 text-[12px] ${refusal === null ? 'text-fg-muted' : 'text-danger'}`}>
          {refusal !== null
            ? t('studio:apiKeys.sheet.footer.refused', 'This key cannot be created yet: {issue}', { issue: refusal })
            : summary === null
              ? t('studio:apiKeys.sheet.footer.empty', 'Select at least one method to create a key.')
              : `${t('studio:apiKeys.sheet.footer.summary', 'This key will be able to call {paths}', {
                  paths: summary.paths.join(', '),
                })}${summary.more > 0 ? ` ${t('studio:apiKeys.sheet.footer.more', '+{n} more', { n: summary.more })}` : ''}`}
        </div>
        <div className="ms-auto flex gap-[9px]">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="nb-ib rounded-[10px] border border-border bg-surface px-[15px] py-[9px] text-[13px] font-bold text-fg-muted hover:text-fg"
          >
            {t('studio:apiKeys.sheet.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={counts.permissions === 0 || busy}
            aria-busy={busy}
            className="flex items-center gap-[7px] rounded-[10px] bg-accent px-4 py-[9px] text-[13px] font-bold text-accent-fg shadow-glow disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-subtle disabled:shadow-none [&_svg]:size-[15px]"
          >
            <KeyRound aria-hidden="true" />
            {t('studio:apiKeys.sheet.submit', 'Create key')}
          </button>
        </div>
      </SheetFooter>
    </Sheet>
  );
}
