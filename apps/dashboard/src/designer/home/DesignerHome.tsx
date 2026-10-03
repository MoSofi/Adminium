// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Designer Home: what do you want to build?
 *
 * One prompt box with the model it will use and what to build for; four of
 * twelve examples that fill the box; "Start with an app" (built, and shown
 * once the sheet it opens exists); and the apps of this project, to continue one.
 *
 * Enter sends, Shift+Enter makes a line, here and on the build page. With no model the box is off and
 * says how to add one (frame A); with a model that cannot build, sending is
 * off and the line under the box says why (frame B).
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUp, ChevronDown, Globe, LayoutDashboard, RefreshCw, Sparkles, type LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { useAppToasts } from '../../pages/toasts.js';
import { t } from '../../i18n/t.js';
import { designerApi, yourAppsQuery, type DesignerTarget } from '../api.js';
import { useDesignerModel } from '../models/useModel.js';
import { useModelControl } from '../models/useModelControl.js';
import { TopBar } from '../parts/TopBar.js';
import { StartWithAnApp } from './StartWithAnApp.js';
import { YourApps } from './YourApps.js';
import { examplesAt, nameFromRequest } from './examples.js';

/** "Start with an app" shows once the sheet it opens exists: a card that opens nothing is worse than no card. */
export const SHOW_START_WITH_AN_APP = false;

const MAX_LINES_PX = 216;

function targets(): { id: DesignerTarget; label: string; line: string; icon: LucideIcon }[] {
  return [
    { id: 'auto', label: t('designer:target.auto', 'Auto'), line: t('designer:target.autoLine', 'Adminium decides'), icon: Sparkles },
    { id: 'dashboard', label: t('designer:target.dashboard', 'Dashboard only'), line: t('designer:target.dashboardLine', 'tables and admin pages'), icon: LayoutDashboard },
    { id: 'web', label: t('designer:target.web', 'Web'), line: t('designer:target.webLine', 'a staff or customer side'), icon: Globe },
  ];
}

export function DesignerHome(): ReactNode {
  const navigate = useNavigate();
  const toasts = useAppToasts();
  const model = useDesignerModel();
  const control = useModelControl(model);
  const yourApps = useQuery(yourAppsQuery());
  const [text, setText] = useState('');
  const [target, setTarget] = useState<DesignerTarget>('auto');
  const [turn, setTurn] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  const noModel = !model.loading && model.picked === null && !model.hasModels;
  const cannotBuild = model.canBuild === false;
  const canSend = text.trim() !== '' && model.picked !== null && !cannotBuild;

  // The box grows with what is written, from two lines to eight, then scrolls.
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    // Empty, it is two lines: measuring then would count a placeholder wrapped before layout settled.
    if (text === '') {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, MAX_LINES_PX))}px`;
  }, [text]);

  const start = useMutation({
    mutationFn: async () => {
      if (model.picked === null) throw new Error('no model');
      return designerApi.createSession({ name: nameFromRequest(text), target, connectionId: model.picked.connectionId, model: model.picked.model, text: text.trim() });
    },
    onSuccess: async ({ session }) => {
      await navigate({ to: '/design/$sessionId', params: { sessionId: session.id } });
    },
    onError: (error) => {
      toasts.push({
        variant: 'error',
        title: t('designer:home.failed', 'The Designer could not start'),
        description: error instanceof ApiError ? error.message : String(error),
      });
    },
  });

  const send = (event?: FormEvent): void => {
    event?.preventDefault();
    if (canSend && !start.isPending) start.mutate();
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  const options = targets();
  const chosen = options.find((entry) => entry.id === target) ?? (options[0] as (typeof options)[number]);
  const noteId = 'designer-home-note';

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <TopBar dashboardLink />
      <main className="flex flex-col items-center px-[clamp(16px,4.5vw,48px)] pb-[clamp(56px,7vw,112px)] pt-[clamp(44px,7.5vw,112px)]">
        <div className="flex w-full max-w-[1040px] flex-col items-center">
          <h1 className="m-0 text-balance text-center text-[clamp(28px,2.9vw,42px)] font-extrabold leading-tight tracking-tight">
            {t('designer:home.title', 'What do you want to build?')}
          </h1>
          <p className="mt-3 max-w-[560px] text-pretty text-center text-[clamp(14px,1.15vw,16px)] leading-normal text-fg-muted">
            {t('designer:home.lead', 'Describe it. Adminium brings the database, the dashboard, sign-in and the API.')}
          </p>

          <form onSubmit={send} className="relative z-20 mt-[clamp(26px,2.6vw,36px)] w-full max-w-[700px]">
            <div
              className={`rounded-[20px] border bg-surface shadow-sm transition-colors focus-within:border-accent ${cannotBuild ? 'border-warn/40' : 'border-border-strong'}`}
            >
              <textarea
                ref={box}
                rows={2}
                value={text}
                disabled={noModel}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKey}
                aria-label={t('designer:home.promptLabel', 'Describe your app')}
                aria-describedby={noModel || cannotBuild ? noteId : undefined}
                placeholder={noModel ? t('designer:home.placeholderNoModel', 'Add a model to start') : t('designer:home.placeholder', 'Describe your app…')}
                className="block max-h-[216px] min-h-[72px] w-full resize-none rounded-t-[20px] bg-transparent px-[18px] pt-4 text-[15px] leading-normal text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed"
              />
              <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-2">
                {control.element}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger
                    disabled={noModel}
                    aria-label={t('designer:target.label', 'What to build: {target}', { target: chosen.label })}
                    className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-bold text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <chosen.icon aria-hidden="true" className="size-3.5 text-fg-subtle" />
                    <span className="whitespace-nowrap">{chosen.label}</span>
                    <ChevronDown aria-hidden="true" className="size-3.5 text-fg-subtle" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[268px]" aria-label={t('designer:target.menu', 'What to build')}>
                    <DropdownMenuRadioGroup value={target} onValueChange={(value) => setTarget(value as DesignerTarget)}>
                      {options.map((entry) => (
                        <DropdownMenuRadioItem key={entry.id} value={entry.id} icon={<entry.icon />} description={entry.line}>
                          {entry.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="submit"
                  disabled={!canSend || start.isPending}
                  aria-label={t('designer:home.send', 'Send')}
                  title={t('designer:home.send', 'Send')}
                  className="ms-auto flex size-[38px] shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm transition-[filter] hover:brightness-105 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-subtle disabled:shadow-none"
                >
                  <ArrowUp aria-hidden="true" className="size-[18px]" />
                </button>
              </div>
            </div>
            {noModel ? (
              <p id={noteId} className="mt-3 flex items-start justify-center gap-2 px-2 text-center text-[13px] leading-normal text-fg-muted">
                <Sparkles aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
                <span>
                  {t('designer:home.noModel', 'Adminium Designer uses your own AI model. Add one to begin.')}{' '}
                  <button type="button" onClick={control.openAdd} className="whitespace-nowrap font-bold text-accent hover:underline">
                    {t('designer:model.add', 'Add a model')}
                  </button>
                </span>
              </p>
            ) : null}
            {cannotBuild ? (
              <p id={noteId} role="alert" className="mt-3 flex items-start justify-center gap-2 px-2 text-center text-[13px] font-semibold leading-normal text-warn">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
                <span>{t('designer:home.cannotBuild', 'This model cannot build apps: it does not support tools. Pick another model.')}</span>
              </p>
            ) : null}
          </form>

          <div role="group" aria-label={t('designer:examples.label', 'Examples')} className="mt-5 flex max-w-[700px] flex-wrap items-center justify-center gap-2">
            {examplesAt(turn).map((example) => (
              <button
                key={example.key}
                type="button"
                disabled={noModel}
                onClick={() => {
                  setText(example.text());
                  box.current?.focus();
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold text-fg-muted hover:border-accent/40 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <example.icon aria-hidden="true" className="size-3.5 text-fg-subtle" />
                {example.label()}
              </button>
            ))}
            <button
              type="button"
              disabled={noModel}
              onClick={() => setTurn((value) => value + 1)}
              aria-label={t('designer:examples.refresh', 'Show other examples')}
              title={t('designer:examples.refresh', 'Show other examples')}
              className="flex size-[30px] items-center justify-center rounded-full border border-border bg-surface text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
            </button>
          </div>

          {SHOW_START_WITH_AN_APP ? <StartWithAnApp /> : null}
          {(yourApps.data?.apps.length ?? 0) > 0 ? <YourApps apps={yourApps.data?.apps ?? []} model={model.picked} target={target} /> : null}
        </div>
      </main>
    </div>
  );
}
