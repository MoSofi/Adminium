// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The endpoint builder: a form and, beside it, the definition it edits.
 *
 * ── ONE DOCUMENT, TWO WAYS TO EDIT IT ──────────────────────────────────────
 * The builder holds the PARSED definition. A form control patches its own key
 * and leaves every other key alone, so a key the form does not draw (`claim`,
 * `writable`, `defaults`…) survives any form edit. The pane prints the
 * document; editing the pane makes a DRAFT, and while a draft exists the form
 * is locked and Save waits for Apply or Revert: the comp silently drops a
 * draft on Save, which would lose hand-written authorization text without a
 * word.
 */
import { Braces, Plus, Route, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CodePane, CodePaneButton, METHOD_TONE, Sheet, SheetBody, SheetFooter, SheetHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import {
  checkEndpoint,
  deleteEndpoint,
  issuesFrom,
  keysFrom,
  renameEndpoint,
  saveEndpoint,
  type EndpointDto,
  type Issue,
  type Method,
  type SourceDto,
} from './apiKeysApi.js';
import { AUTH_COPY, DRAWN_OPS, METHOD_COPY, OP_COPY, VALUELESS_OPS, type AuthRole } from './copy.js';
import {
  METHODS,
  blankDefinition,
  coerceRef,
  defaultColumns,
  orderParts,
  parseDefinitionText,
  patchDefinition,
  patchNested,
  printDefinition,
  responseFor,
  shapeOf,
  supportedMethods,
  type Definition,
} from './model.js';

/* --- atoms (Appendix C) --------------------------------------------------- */

const FIELD_CARD = 'flex flex-col gap-[9px] rounded-[13px] border border-border bg-surface px-[15px] py-3.5 shadow-card';
const FIELD_LABEL = 'text-[11px] font-bold uppercase tracking-[.04em] text-fg-subtle';
const SUB_LABEL = 'text-[10.5px] font-bold text-fg-subtle';
const MINI_BTN =
  'nb-ib flex items-center gap-1 rounded-[7px] border border-border bg-surface-2 px-[9px] py-1 text-[11px] font-bold text-fg-muted hover:text-fg disabled:opacity-60 [&_svg]:size-3';
const SELECT = 'w-full rounded-[10px] border border-border-strong bg-surface-2 px-2.5 py-[9px] text-[12.5px] text-fg outline-none disabled:opacity-60';
const INPUT_MONO =
  'w-full rounded-[10px] border border-border-strong bg-surface-2 px-2.5 py-[7px] font-mono text-[11.5px] text-fg outline-none disabled:opacity-60';
const TRAY = 'flex flex-wrap gap-[3px] border border-border bg-surface-2 p-[3px]';
const segClass = (on: boolean): string =>
  `flex items-center gap-1.5 rounded-[7px] px-[11px] py-1.5 text-[12px] font-bold disabled:opacity-60 ${
    on ? 'bg-surface text-fg shadow-card' : 'text-fg-subtle'
  }`;

type Filter = { column: string; op: string; value?: unknown; days?: number };

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export interface EndpointBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  /** Null for "New endpoint". */
  endpoint: EndpointDto | null;
  sources: SourceDto[];
  onSaved: (endpoint: EndpointDto) => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}

export function EndpointBuilder({ open, onOpenChange, connectionId, endpoint, sources, onSaved, onDeleted }: EndpointBuilderProps) {
  const initial = useMemo<Definition>(() => {
    if (endpoint !== null) {
      const parsed = parseDefinitionText(endpoint.definition);
      if (parsed.ok) return parsed.doc;
    }
    return blankDefinition(sources[0]);
  }, [endpoint, sources]);

  const [doc, setDoc] = useState<Definition>(initial);
  const [ref, setRef] = useState<string>(endpoint?.ref ?? '');
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(endpoint !== null && endpoint.issues.length > 0 ? firstOf(endpoint.issues) : null);
  const [busy, setBusy] = useState(false);

  const locked = draft !== null || busy;
  const withPath = (d: Definition): Definition => ({ ...d, path: `/${ref}` });
  const printed = printDefinition(withPath(doc));
  const text = draft ?? printed;

  const source = sources.find((s) => s.id === doc['source']);
  const supported = supportedMethods(source);
  const methods = arr(doc['methods']).filter((m): m is Method => METHODS.includes(m as Method));
  const select = arr(doc['select']).filter((c): c is string => typeof c === 'string');
  const filters = arr(doc['filters']).map((f) => rec(f) as unknown as Filter);
  const paging = rec(doc['pagination']);
  const order = orderParts(paging['order']);
  const rate = rec(doc['rate_limit']);
  const role = (rec(doc['auth'])['role'] as AuthRole | undefined) ?? 'anon';
  const columns = source?.columns ?? select.map((name) => ({ name, type: '', primaryKey: false, pii: false }));
  const opsShown = [...new Set([...DRAWN_OPS, ...filters.map((f) => f.op)])];

  const edit = (next: Definition): void => {
    setDoc(next);
    setError(null);
  };

  function firstOf(issues: readonly Issue[]): string {
    const first = issues[0]?.message ?? '';
    return issues.length > 1 ? t('studio:apiKeys.builder.pane.more', '{first} (+{n} more)', { first, n: issues.length - 1 }) : first;
  }

  const apply = async (): Promise<void> => {
    if (draft === null) return;
    const parsed = parseDefinitionText(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const nextRef = coerceRef(String(parsed.doc['path'] ?? '').replace(/^\//, ''));
    setBusy(true);
    try {
      const check = await checkEndpoint({ connectionId, ref: nextRef, definition: printDefinition(parsed.doc) });
      // Applied either way: the form shows what the document says, and the
      // strip says what is wrong with it.
      setDoc(parsed.doc);
      setRef(nextRef);
      setDraft(null);
      setError(check.issues.length > 0 ? firstOf(check.issues) : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    if (draft !== null) return;
    setBusy(true);
    setError(null);
    try {
      // A rename of a stored endpoint is its own request.
      if (endpoint !== null && endpoint.stored && ref !== endpoint.ref) {
        await renameEndpoint(connectionId, endpoint.ref, ref);
      }
      const reply = await saveEndpoint(connectionId, ref, printed);
      await onSaved(reply.endpoint);
    } catch (caught) {
      const keys = keysFrom(caught);
      const issues = issuesFrom(caught);
      if (keys.length > 0) {
        setError(
          `${t('studio:apiKeys.builder.refused.keys', 'Saving this would break {count, plural, one {# key} other {# keys}}: {names}.', {
            count: keys.length,
            names: keys.map((k) => k.name).join(', '),
          })} ${issues.length > 0 ? firstOf(issues) : ''}`.trim(),
        );
      } else {
        setError(issues.length > 0 ? firstOf(issues) : caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (endpoint === null) return;
    setBusy(true);
    try {
      await deleteEndpoint(connectionId, endpoint.ref);
      await onDeleted();
    } catch (caught) {
      const keys = keysFrom(caught);
      setError(
        keys.length > 0
          ? t('studio:apiKeys.builder.deleteRefused', '{count, plural, one {# key still uses} other {# keys still use}} this endpoint: {names}.', {
              count: keys.length,
              names: keys.map((k) => k.name).join(', '),
            })
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
    } finally {
      setBusy(false);
    }
  };

  const isNew = endpoint === null || !endpoint.stored;
  const saveable = ref !== '' && draft === null && !busy;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetHeader
        icon={<Route />}
        title={
          endpoint === null
            ? t('studio:apiKeys.builder.titleNew', 'New endpoint')
            : t('studio:apiKeys.builder.titleEdit', 'Edit endpoint')
        }
        subtitle={t('studio:apiKeys.builder.subtitle', 'Configure it visually — Adminium writes the route definition for you')}
        closeLabel={t('studio:apiKeys.sheet.close', 'Close')}
      />
      <SheetBody className="max-[760px]:flex-col">
        <fieldset disabled={locked} className="nb-scroll flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-5 pb-6 pt-[18px]">
          <div className={FIELD_CARD}>
            <label htmlFor="builder-route" className={FIELD_LABEL}>
              {t('studio:apiKeys.builder.route', 'Route')}
            </label>
            <div dir="ltr" className="flex items-center overflow-hidden rounded-[10px] border border-border-strong bg-surface-2">
              <span className="whitespace-nowrap border-e border-border px-2.5 py-[9px] font-mono text-[12px] text-fg-subtle">/api/v1/public/records/</span>
              <input
                id="builder-route"
                value={ref}
                onChange={(event) => {
                  setRef(coerceRef(event.target.value));
                  setError(null);
                }}
                placeholder={t('studio:apiKeys.builder.routePlaceholder', 'customers')}
                className="min-w-0 flex-1 border-none bg-transparent px-[11px] py-[9px] font-mono text-[12.5px] text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
            {endpoint !== null && endpoint.stored && ref !== endpoint.ref ? (
              <span className={SUB_LABEL}>{t('studio:apiKeys.builder.routeRename', 'Callers must switch to the new path.')}</span>
            ) : null}
          </div>

          <div className={FIELD_CARD}>
            <span className={FIELD_LABEL}>{t('studio:apiKeys.builder.methods', 'Methods')}</span>
            <div className="flex flex-wrap gap-[7px]">
              {METHODS.map((m) => {
                const on = methods.includes(m);
                const can = supported.includes(m);
                const Icon = METHOD_COPY[m].icon;
                const tone = METHOD_TONE[m];
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    disabled={!can && !on}
                    title={can ? undefined : t('studio:apiKeys.builder.methodUnsupported', 'This source cannot support {method}: it has no primary key.', { method: m })}
                    onClick={() => edit(patchDefinition(doc, { methods: on ? methods.filter((x) => x !== m) : [...methods, m] }))}
                    className={`flex items-center gap-1.5 rounded-[9px] border px-[11px] py-[7px] font-mono text-[11.5px] font-semibold transition-[filter] duration-[120ms] hover:brightness-[.97] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[13px] ${
                      on ? `${tone.text} ${tone.solid} ${tone.border}` : 'border-border-strong bg-transparent text-fg-subtle'
                    }`}
                  >
                    <Icon aria-hidden="true" />
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3.5">
            <label className={FIELD_CARD}>
              <span className={FIELD_LABEL}>{t('studio:apiKeys.builder.source', 'Source table or view')}</span>
              <select
                value={String(doc['source'] ?? '')}
                onChange={(event) => {
                  const next = sources.find((s) => s.id === event.target.value);
                  const cols = next === undefined ? [] : defaultColumns(next);
                  const key = next?.columns.find((c) => c.primaryKey)?.name ?? cols[0] ?? '';
                  // A new source resets to its DEFAULT columns, no filters, and its first order column.
                  edit(
                    patchNested(
                      patchDefinition(doc, {
                        source: event.target.value,
                        select: cols,
                        filters: [],
                        methods: methods.filter((m) => supportedMethods(next).includes(m)),
                      }),
                      'pagination',
                      { order: `${key}.desc` },
                    ),
                  );
                }}
                className={SELECT}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label === s.id ? s.id : `${s.label} (${s.id})`}
                  </option>
                ))}
              </select>
            </label>
            <div className={FIELD_CARD}>
              <span className={FIELD_LABEL}>{t('studio:apiKeys.builder.auth.label', 'Auth requirement')}</span>
              <div role="radiogroup" aria-label={t('studio:apiKeys.builder.auth.label', 'Auth requirement')} className={`${TRAY} rounded-[10px]`}>
                {(['anon', 'authenticated', 'service_role'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={role === r}
                    onClick={() => {
                      let next = patchNested(doc, 'auth', { role: r });
                      // Authenticated needs a claim; the pane is where it is set.
                      if (r === 'authenticated' && doc['claim'] === undefined && doc['identity'] === undefined) {
                        next = patchDefinition(next, { claim: { column: '' } });
                      }
                      edit(next);
                    }}
                    className={segClass(role === r)}
                  >
                    {t(AUTH_COPY[r].key, AUTH_COPY[r].fallback)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={FIELD_CARD}>
            <div className="flex items-center gap-2.5">
              <span className={FIELD_LABEL}>{t('studio:apiKeys.builder.columns.label', 'Exposed columns')}</span>
              <button type="button" className={MINI_BTN} onClick={() => edit(patchDefinition(doc, { select: columns.map((c) => c.name) }))}>
                {t('studio:apiKeys.builder.columns.all', 'All')}
              </button>
              <button type="button" className={MINI_BTN} onClick={() => edit(patchDefinition(doc, { select: [] }))}>
                {t('studio:apiKeys.builder.columns.none', 'None')}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((c) => {
                const on = select.includes(c.name);
                return (
                  <button
                    key={c.name}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      edit(patchDefinition(doc, { select: on ? select.filter((x) => x !== c.name) : [...select, c.name] }))
                    }
                    className={`flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 font-mono text-[11.5px] font-semibold transition-[filter] duration-[120ms] hover:brightness-[.97] ${
                      on ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-soft text-accent' : 'border-border text-fg-subtle'
                    }`}
                  >
                    {c.name}
                    {/* The comp dims the type to .6, which measures under AA on both
                        grounds. On a selected chip it wears `fg-muted`; on an unselected
                        one it keeps the chip's own tone, a weight lighter. */}
                    {c.type === '' ? null : (
                      <span className={on ? 'font-semibold text-fg-muted' : 'font-normal'}>{c.type}</span>
                    )}
                    {c.pii ? <span className="rounded-[4px] bg-warn-soft px-1 text-[9px] font-extrabold text-warn">PII</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={FIELD_CARD}>
            <div className="flex items-center gap-2.5">
              <span className={FIELD_LABEL}>{t('studio:apiKeys.builder.filters.label', 'Default filters')}</span>
              <button
                type="button"
                className={MINI_BTN}
                onClick={() => edit(patchDefinition(doc, { filters: [...filters, { column: columns[0]?.name ?? '', op: 'eq', value: '' }] }))}
              >
                <Plus aria-hidden="true" />
                {t('studio:apiKeys.builder.filters.add', 'Add')}
              </button>
            </div>
            <div className="flex flex-col gap-[7px]">
              {filters.map((f, index) => {
                const setFilter = (patch: Partial<Filter>): void => {
                  const next = filters.map((x, i) => {
                    if (i !== index) return x;
                    const merged: Filter = { ...x, ...patch };
                    if (VALUELESS_OPS.has(merged.op)) delete merged.value;
                    // A count of days belongs to `from-today` alone.
                    if (merged.op !== 'from-today') delete merged.days;
                    return merged;
                  });
                  edit(patchDefinition(doc, { filters: next }));
                };
                return (
                  <div key={index} className="flex items-center gap-[7px]">
                    <select value={f.column} onChange={(e) => setFilter({ column: e.target.value })} className={`${SELECT} w-[150px] px-[9px] py-[7px] font-mono text-[11.5px]`}>
                      {columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select value={f.op} onChange={(e) => setFilter({ op: e.target.value })} className={`${SELECT} w-[130px] px-[9px] py-[7px] text-[11.5px]`}>
                      {opsShown.map((op) => (
                        <option key={op} value={op}>
                          {OP_COPY[op] === undefined ? op : t(OP_COPY[op].key, OP_COPY[op].fallback)}
                        </option>
                      ))}
                    </select>
                    {VALUELESS_OPS.has(f.op) ? (
                      <span className="flex-1" />
                    ) : (
                      <input
                        value={Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? '')}
                        onChange={(e) =>
                          setFilter({ value: f.op === 'in' ? e.target.value.split(',').map((v) => v.trim()) : e.target.value })
                        }
                        placeholder={t('studio:apiKeys.builder.filters.value', 'value')}
                        className={`${INPUT_MONO} flex-1`}
                      />
                    )}
                    <button
                      type="button"
                      aria-label={t('studio:apiKeys.builder.filters.remove', 'Remove filter')}
                      onClick={() => edit(patchDefinition(doc, { filters: filters.filter((_, i) => i !== index) }))}
                      className="nb-ib flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-fg-subtle hover:text-fg"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                );
              })}
              {filters.length === 0 ? (
                <div className="text-[11.5px] text-fg-subtle">
                  {t('studio:apiKeys.builder.filters.empty', 'No filters — every row of the source is reachable.')}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3.5">
            <div className={FIELD_CARD}>
              <span className={FIELD_LABEL}>{t('studio:apiKeys.builder.paging.label', 'Pagination & sorting')}</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-[5px]">
                  <span className={SUB_LABEL}>{t('studio:apiKeys.builder.paging.defaultLimit', 'Default limit')}</span>
                  <input
                    inputMode="numeric"
                    value={String(paging['default_limit'] ?? '')}
                    onChange={(e) => edit(patchNested(doc, 'pagination', { default_limit: Number(e.target.value) || 0 }))}
                    className={INPUT_MONO}
                  />
                </label>
                <label className="flex flex-col gap-[5px]">
                  <span className={SUB_LABEL}>{t('studio:apiKeys.builder.paging.maxLimit', 'Max limit')}</span>
                  <input
                    inputMode="numeric"
                    value={String(paging['max_limit'] ?? '')}
                    onChange={(e) => edit(patchNested(doc, 'pagination', { max_limit: Number(e.target.value) || 0 }))}
                    className={INPUT_MONO}
                  />
                </label>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <span className={SUB_LABEL}>{t('studio:apiKeys.builder.paging.orderBy', 'Order by')}</span>
                  <select
                    value={order.column}
                    onChange={(e) => edit(patchNested(doc, 'pagination', { order: `${e.target.value}.${order.dir}` }))}
                    className={SELECT}
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div role="radiogroup" aria-label={t('studio:apiKeys.builder.paging.orderBy', 'Order by')} className={`${TRAY} rounded-[9px]`}>
                  {(['desc', 'asc'] as const).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      role="radio"
                      aria-checked={order.dir === dir}
                      onClick={() => edit(patchNested(doc, 'pagination', { order: `${order.column}.${dir}` }))}
                      className={segClass(order.dir === dir)}
                    >
                      {dir === 'desc' ? t('studio:apiKeys.builder.paging.desc', 'Desc') : t('studio:apiKeys.builder.paging.asc', 'Asc')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className={FIELD_CARD}>
              <span className={FIELD_LABEL}>{t('studio:apiKeys.builder.rate.label', 'Rate limit & response')}</span>
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <span className={SUB_LABEL}>{t('studio:apiKeys.builder.rate.requests', 'Requests')}</span>
                  <input
                    inputMode="numeric"
                    value={String(rate['requests'] ?? '')}
                    onChange={(e) => edit(patchNested(doc, 'rate_limit', { requests: Number(e.target.value) || 0 }))}
                    className={INPUT_MONO}
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
                  <span className={SUB_LABEL}>{t('studio:apiKeys.builder.rate.per', 'Per')}</span>
                  <select value={String(rate['window'] ?? '1m')} onChange={(e) => edit(patchNested(doc, 'rate_limit', { window: e.target.value }))} className={SELECT}>
                    <option value="1s">{t('studio:apiKeys.builder.rate.second', 'second')}</option>
                    <option value="1m">{t('studio:apiKeys.builder.rate.minute', 'minute')}</option>
                    <option value="1h">{t('studio:apiKeys.builder.rate.hour', 'hour')}</option>
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-[5px]">
                <span className={SUB_LABEL}>{t('studio:apiKeys.builder.shape.label', 'Response shape')}</span>
                <select
                  value={shapeOf(doc)}
                  onChange={(e) => edit(patchDefinition(doc, { response: responseFor(e.target.value as 'wrapped' | 'array' | 'single') }))}
                  className={SELECT}
                >
                  <option value="wrapped">{t('studio:apiKeys.builder.shape.wrapped', "Wrapped in '{' data '}'")}</option>
                  <option value="array">{t('studio:apiKeys.builder.shape.array', 'Bare array')}</option>
                  <option value="single">{t('studio:apiKeys.builder.shape.single', 'Single object')}</option>
                </select>
              </label>
            </div>
          </div>
        </fieldset>

        <CodePane
          className="min-w-[280px] flex-[0_1_430px] border-s border-border max-[760px]:min-h-[360px]"
          icon={<Braces />}
          title={t('studio:apiKeys.builder.pane.title', 'Route definition')}
          dirty={draft !== null}
          stateLabel={
            draft !== null
              ? t('studio:apiKeys.builder.pane.dirty', 'edited — not applied')
              : t('studio:apiKeys.builder.pane.synced', 'synced with form')
          }
          value={text}
          onValueChange={(value) => {
            // Editing back to the printed text is not a draft.
            setDraft(value === printed ? null : value);
          }}
          textareaLabel={t('studio:apiKeys.builder.pane.label', 'Route definition, JSON')}
          action={
            <CodePaneButton
              variant="format"
              onClick={() => {
                const parsed = parseDefinitionText(text);
                if (!parsed.ok) {
                  setError(parsed.error);
                  return;
                }
                const formatted = printDefinition(parsed.doc);
                // Formatting the stored document leaves the pane clean.
                setDraft(formatted === printed ? null : formatted);
              }}
            >
              {t('studio:apiKeys.builder.pane.format', 'Format')}
            </CodePaneButton>
          }
          error={error}
          footer={
            <>
              <CodePaneButton variant="apply" disabled={draft === null || busy} onClick={() => void apply()}>
                {t('studio:apiKeys.builder.pane.apply', 'Apply to form')}
              </CodePaneButton>
              <CodePaneButton
                variant="revert"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
              >
                {t('studio:apiKeys.builder.pane.revert', 'Revert')}
              </CodePaneButton>
            </>
          }
        />
      </SheetBody>
      <SheetFooter>
        <div dir={draft === null ? 'ltr' : undefined} className="min-w-0 truncate font-mono text-[12px] text-fg-muted">
          {draft !== null
            ? t('studio:apiKeys.builder.footer.applyFirst', 'Apply or revert the edited definition first.')
            : `${methods.join(' ')}  /api/v1/public/records/${ref === '' ? '…' : ref}`}
        </div>
        <div className="ms-auto flex gap-[9px]">
          {endpoint !== null && endpoint.stored ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="nb-ib flex items-center gap-1.5 rounded-[10px] bg-danger-soft px-[15px] py-[9px] text-[13px] font-bold text-danger hover:text-fg [&_svg]:size-[15px]"
            >
              <X aria-hidden="true" />
              {t('studio:apiKeys.builder.delete', 'Delete endpoint')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="nb-ib rounded-[10px] border border-border bg-surface px-[15px] py-[9px] text-[13px] font-bold text-fg-muted hover:text-fg"
          >
            {t('studio:apiKeys.builder.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!saveable}
            aria-busy={busy}
            className="flex items-center gap-[7px] rounded-[10px] bg-accent px-4 py-[9px] text-[13px] font-bold text-accent-fg shadow-glow disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-subtle disabled:shadow-none [&_svg]:size-[15px]"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {isNew ? t('studio:apiKeys.builder.create', 'Create endpoint') : t('studio:apiKeys.builder.save', 'Save changes')}
          </button>
        </div>
      </SheetFooter>
    </Sheet>
  );
}
