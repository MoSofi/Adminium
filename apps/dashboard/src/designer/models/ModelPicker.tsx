// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model picker: a popover from the model button, 340 wide, opening
 * upward (it flips when there is no room). "Find a model" is a combobox over
 * the list: arrows move, Enter picks, Escape closes and gives focus back to
 * the button. Models are grouped by connection; a connection that could not
 * be reached says so with "Try again" while the others still list. A model
 * known not to build stays pickable, quieter, with a "Cannot build" chip and
 * its hint on hover and on keyboard focus. The last row adds a model.
 *
 * Picking a model whose ability to build is not known yet asks the server
 * once (one small round trip to the model), so the box can say so before
 * anything is made.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Plus, RotateCw, Search, TriangleAlert } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { designerApi, designerKeys, type ModelConnection } from '../api.js';
import { ModelButton, type DesignerModelState } from './ModelButton.js';
import { PROVIDERS, nameParts, providerLabel } from './providers.js';

const ADD = '\u0000add';
const keyOf = (connectionId: string, model: string): string => `${connectionId}\u0000${model}`;

function order(connection: ModelConnection): number {
  const at = (PROVIDERS as readonly string[]).indexOf(connection.provider);
  return (at === -1 ? PROVIDERS.length : at) * 2 + (connection.source === 'environment' ? 0 : 1);
}

function groupLabel(connection: ModelConnection, all: ModelConnection[]): string {
  const name = providerLabel(connection.provider);
  // Two connections to one provider: the one saved in Settings says so.
  const twin = all.some((other) => other !== connection && other.provider === connection.provider);
  return twin && connection.source === 'database' ? t('designer:model.fromSettings', '{provider} · saved in Settings', { provider: name }) : name;
}

export function ModelPicker({
  model,
  open,
  onOpenChange,
  onAdd,
}: {
  model: DesignerModelState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: () => void;
}): ReactNode {
  const base = useId();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Closing into the dialog: it opens once the popover has let go, and focus does not go back to the
  // button — a dialog opened while the popover is still dismissing reads that as "focus left" and closes.
  const toDialog = useRef(false);
  const connections = useMemo(() => [...(model.models?.connections ?? [])].sort((a, b) => order(a) - order(b)), [model.models]);
  const selected = model.picked === null ? null : keyOf(model.picked.connectionId, model.picked.model);

  const q = query.trim().toLowerCase();
  const groups = connections
    .map((connection) => ({
      connection,
      rows: connection.models.filter((entry) => q === '' || entry.label.toLowerCase().includes(q) || entry.id.toLowerCase().includes(q)),
    }))
    .filter((group) => group.rows.length > 0 || group.connection.state === 'unreachable');
  // Where a model cannot be added (a live server), the list does not offer it.
  const canAdd = model.canAdd;
  const nav = [...groups.flatMap((group) => group.rows.map((row) => keyOf(group.connection.id, row.id))), ...(canAdd ? [ADD] : [])];
  const active = highlight !== null && nav.includes(highlight) ? highlight : (nav[0] ?? ADD);
  const optionId = (key: string): string => `${base}-opt-${String(nav.indexOf(key))}`;
  const cannot = (connectionId: string, id: string): boolean =>
    model.models?.verdicts.some((verdict) => verdict.connectionId === connectionId && verdict.model === id && !verdict.canBuild) ?? false;

  const pick = (key: string): void => {
    if (key === ADD) {
      toDialog.current = true;
      onOpenChange(false);
      return;
    }
    const [connectionId = '', id = ''] = key.split('\u0000');
    model.pick({ connectionId, model: id });
    onOpenChange(false);
    const known = model.models?.verdicts.some((verdict) => verdict.connectionId === connectionId && verdict.model === id) ?? false;
    if (!known) {
      void designerApi
        .checkModel(connectionId, id)
        .catch(() => undefined)
        .then(() => queryClient.invalidateQueries({ queryKey: designerKeys.models }));
    }
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const at = nav.indexOf(active);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (at + 1) % nav.length;
    else if (event.key === 'ArrowUp') next = at <= 0 ? nav.length - 1 : at - 1;
    else if (event.key === 'Home' && query === '') next = 0;
    else if (event.key === 'End' && query === '') next = nav.length - 1;
    else if (event.key === 'Enter') {
      event.preventDefault();
      pick(active);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      setHighlight(nav[next] ?? null);
    }
  };

  const retry = async (): Promise<void> => {
    setRetrying(true);
    try {
      await queryClient.invalidateQueries({ queryKey: designerKeys.models });
    } finally {
      setRetrying(false);
    }
  };

  // No model at all: the button opens the dialog itself.
  if (model.loading || (model.picked === null && !model.hasModels)) return <ModelButton model={model} onAdd={canAdd ? onAdd : undefined} />;

  const empty = connections.length === 0;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuery('');
          setHighlight(selected);
        }
        onOpenChange(next);
      }}
    >
      <PopoverTrigger asChild>
        <ModelButton model={model} aria-controls={open ? `${base}-list` : undefined} />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        onCloseAutoFocus={(event) => {
          if (!toDialog.current) return;
          toDialog.current = false;
          event.preventDefault();
          onAdd();
        }}
        className="flex max-h-[min(440px,70vh)] w-[340px] max-w-[calc(100vw-32px)] flex-col p-0">
        {empty ? (
          <div className="flex flex-col items-center gap-3 px-5 py-6 text-center">
            <p className="m-0 text-[13px] text-fg-muted">{t('designer:model.empty', 'No models yet.')}</p>
            {canAdd ? (
              <button type="button" onClick={() => pick(ADD)} className="inline-flex items-center gap-1.5 rounded-[10px] bg-accent px-3 py-2 text-[12.5px] font-bold text-accent-fg">
                <Plus aria-hidden="true" className="size-3.5" />
                {t('designer:model.add', 'Add a model')}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
              <Search aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
              <input
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={`${base}-list`}
                aria-activedescendant={optionId(active)}
                aria-label={t('designer:model.find', 'Find a model')}
                placeholder={t('designer:model.find', 'Find a model')}
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlight(null);
                }}
                onKeyDown={onKey}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
            <div id={`${base}-list`} role="listbox" aria-label={t('designer:model.list', 'Models')} className="nb-scroll min-h-0 flex-1 overflow-y-auto py-1.5">
              {groups.map((group) => {
                const headingId = `${base}-g-${group.connection.id}`;
                return (
                  <div key={group.connection.id} role="group" aria-labelledby={headingId} className="pb-1">
                    <div id={headingId} className="px-3.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-fg-subtle">
                      {groupLabel(group.connection, connections)}
                    </div>
                    {group.connection.state === 'unreachable' && group.rows.length === 0 ? (
                      <div className="flex items-center gap-2 px-3.5 py-2 text-[12.5px] text-fg-muted">
                        <span className="flex-1">{t('designer:model.unreachable', 'Could not reach this connection')}</span>
                        <button
                          type="button"
                          disabled={retrying}
                          onClick={() => void retry()}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold text-accent hover:bg-accent-soft disabled:opacity-60"
                        >
                          <RotateCw aria-hidden="true" className={`size-3.5 ${retrying ? 'animate-spin' : ''}`} />
                          {t('designer:model.retry', 'Try again')}
                        </button>
                      </div>
                    ) : null}
                    {group.rows.map((row) => {
                      const key = keyOf(group.connection.id, row.id);
                      const no = cannot(group.connection.id, row.id);
                      const parts = nameParts(row.label);
                      const lit = key === active;
                      const hintId = `${optionId(key)}-hint`;
                      return (
                        <div
                          key={key}
                          id={optionId(key)}
                          role="option"
                          aria-selected={key === selected}
                          aria-describedby={no ? hintId : undefined}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => pick(key)}
                          onMouseEnter={() => setHighlight(key)}
                          className={`relative mx-1.5 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 ${lit ? 'bg-surface-2' : ''}`}
                        >
                          <span className={`min-w-0 flex-1 truncate text-[13px] ${no ? 'font-semibold text-fg-muted' : 'font-bold text-fg'}`}>
                            {parts.pre}
                            <span className="font-mono">{parts.ver}</span>
                          </span>
                          {no ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[10.5px] font-bold text-warn">
                              <TriangleAlert aria-hidden="true" className="size-3" />
                              {t('designer:model.cannotBuild', 'Cannot build')}
                            </span>
                          ) : null}
                          {key === selected ? <Check aria-hidden="true" className="size-4 shrink-0 text-accent" /> : <span aria-hidden="true" className="size-4 shrink-0" />}
                          {no ? (
                            <span
                              id={hintId}
                              className={`${lit ? 'block' : 'sr-only'} absolute inset-x-1 top-full z-10 mt-1 rounded-md border border-border bg-surface px-2.5 py-2 text-[12px] font-semibold leading-normal text-fg-muted shadow-menu`}
                            >
                              {t('designer:model.cannotBuildHint', 'This model does not support tools, so it cannot build apps.')}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {canAdd ? (
                <div className="mt-1 border-t border-border pt-1.5">
                  <div
                    id={optionId(ADD)}
                    role="option"
                    aria-selected={false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(ADD)}
                    onMouseEnter={() => setHighlight(ADD)}
                    className={`mx-1.5 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-bold text-accent ${active === ADD ? 'bg-accent-soft' : ''}`}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    {t('designer:model.add', 'Add a model')}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
