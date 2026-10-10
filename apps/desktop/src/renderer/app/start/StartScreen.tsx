// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Start: what the app opens on. Four things a person can do, and under them
 * the projects they were last in.
 */
import { useLocale, useT } from '@adminium/i18n/react';
import { tagForLocale } from '@adminium/i18n';
import { Database, Folder, FolderOpen, Hammer, MonitorSmartphone, RadioTower, Sparkles, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { DesktopRecentProject, DesktopStartState } from '../../../preload/api.js';
import { startApi } from '../bridge.js';
import { PackagesDialog, type PackagesQuestion } from './PackagesDialog.js';
import { TrustDialog, type TrustQuestion } from './TrustDialog.js';

type Say = (title: string, variant?: 'success' | 'error' | 'info') => void;

/** "yesterday", "3 days ago", "today": the system's own words for how long ago, never ours. */
export function openedWhen(iso: string, now: Date, tag: string): string {
  const then = new Date(iso);
  const day = 24 * 60 * 60 * 1000;
  const startOf = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(then) - startOf(now)) / day);
  const format = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  if (days > -31) return format.format(Math.min(days, 0), 'day');
  if (days > -365) return format.format(Math.round(days / 30), 'month');
  return format.format(Math.round(days / 365), 'year');
}

interface Choice {
  key: 'build' | 'open' | 'connect' | 'db';
  icon: LucideIcon;
  primary?: boolean;
}

const CHOICES: readonly Choice[] = [
  { key: 'build', icon: Sparkles, primary: true },
  { key: 'open', icon: FolderOpen },
  { key: 'connect', icon: MonitorSmartphone },
  { key: 'db', icon: Database },
];

function ChoiceCard({ choice, title, line, disabled, onChoose }: { choice: Choice; title: string; line: string; disabled?: boolean; onChoose: () => void }): ReactNode {
  const Icon = choice.icon;
  return (
    <button
      type="button"
      data-choice={choice.key}
      disabled={disabled}
      onClick={onChoose}
      className={[
        // A narrow window: a row. From 1200 wide (1144 inside the shell's padding): a card, the tile above the words.
        'flex cursor-pointer flex-row items-center gap-3.5 rounded-[14px] px-4 py-3 text-start text-fg transition-[border-color,background-color,box-shadow] duration-150',
        '@[1144px]:min-h-[156px] @[1144px]:flex-col @[1144px]:items-start @[1144px]:p-5',
        'hover:border-accent disabled:cursor-not-allowed disabled:opacity-45',
        choice.primary === true
          ? 'border border-accent bg-[color-mix(in_srgb,var(--accent)_6%,var(--surface))] shadow-[0_0_0_1px_var(--accent),var(--shadow)]'
          : 'border border-border bg-surface',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'flex size-[34px] shrink-0 items-center justify-center rounded-[11px] @[1144px]:size-10',
          choice.primary === true ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-fg-muted',
        ].join(' ')}
      >
        <Icon className="size-[19px]" />
      </span>
      <span className="flex min-w-0 flex-col gap-[5px]">
        <span className="text-[15px] font-extrabold tracking-[-0.015em]">{title}</span>
        <span className="text-[13px] font-medium leading-[1.5] text-fg-muted [text-wrap:pretty]">{line}</span>
      </span>
    </button>
  );
}

function RecentRow({
  project,
  first,
  when,
  onOpen,
  onDashboard,
  onLocate,
  onRemove,
}: {
  project: DesktopRecentProject;
  first: boolean;
  when: string;
  onOpen: () => void;
  onDashboard: () => void;
  onLocate: () => void;
  onRemove: () => void;
}): ReactNode {
  const t = useT();
  const shared = project.state === 'shared';
  const ChipIcon = shared ? RadioTower : Hammer;
  return (
    <div
      data-recent={project.path}
      // The whole row opens the project, for a pointer: the name is the same thing for a keyboard, and the two buttons
      // at its end say where it opens. A row whose folder is gone opens nothing.
      onClick={project.missing ? undefined : onOpen}
      className={`flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-[18px] py-3.5 ${first ? '' : 'border-t border-border'} ${project.missing ? '' : 'cursor-pointer hover:bg-surface-2'}`}
    >
      <span
        aria-hidden="true"
        className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${project.missing ? 'bg-surface-3 text-fg-subtle' : 'bg-accent-soft text-accent'}`}
      >
        <Folder className="size-[17px]" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {project.missing ? (
          <span className="text-[14px] font-bold text-fg-muted">{project.name}</span>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            aria-label={t('desktop:start.recent.open', 'Open {name}', { name: project.name })}
            className="cursor-pointer self-start border-0 bg-transparent p-0 text-start text-[14px] font-bold text-fg hover:text-accent"
          >
            {project.name}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-subtle">
          <span
            dir="ltr"
            className={`font-mono text-[11.5px] font-medium [unicode-bidi:isolate] ${project.missing ? 'line-through' : 'text-fg-muted'}`}
          >
            {project.displayPath}
          </span>
          <span aria-hidden="true">·</span>
          <span>{project.missing ? t('desktop:start.recent.gone', 'This folder was moved or deleted') : when}</span>
        </div>
      </div>
      {project.missing ? (
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onLocate}
            className="cursor-pointer rounded-[9px] border border-border bg-surface px-[11px] py-[7px] text-[12.5px] font-bold text-fg hover:border-border-strong"
          >
            {t('desktop:start.recent.locate', 'Locate…')}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="cursor-pointer rounded-[9px] border border-transparent bg-transparent px-[11px] py-[7px] text-[12.5px] font-bold text-fg-muted hover:border-border-strong"
          >
            {t('desktop:start.recent.remove', 'Remove')}
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[20px] px-2.5 py-1 text-[11px] font-bold ${shared ? 'bg-pos-soft text-pos' : 'bg-accent-soft text-accent'}`}
          >
            <ChipIcon className="size-3" aria-hidden="true" />
            {shared ? t('desktop:start.recent.shared', 'Shared') : t('desktop:start.recent.building', 'Building')}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            aria-label={t('desktop:start.recent.openDesignerOf', 'Open {name} in the Designer', { name: project.name })}
            className="ms-1.5 cursor-pointer whitespace-nowrap rounded-[9px] border-0 bg-accent px-[11px] py-[7px] text-[12.5px] font-bold text-accent-fg hover:brightness-105"
          >
            {t('desktop:start.recent.openDesigner', 'Open in Designer')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDashboard();
            }}
            aria-label={t('desktop:start.recent.openDashboardOf', 'Open the dashboard of {name}', { name: project.name })}
            className="cursor-pointer whitespace-nowrap rounded-[9px] border border-border bg-surface px-[11px] py-[7px] text-[12.5px] font-bold text-fg hover:border-border-strong"
          >
            {t('desktop:start.recent.openDashboard', 'Open dashboard')}
          </button>
        </div>
      )}
    </div>
  );
}

export function StartScreen({ initial, onBuild, say }: { initial: DesktopStartState; onBuild: () => void; say: Say }): ReactNode {
  const t = useT();
  const tag = tagForLocale(useLocale());
  const recentHead = useId();
  const [recent, setRecent] = useState<readonly DesktopRecentProject[]>(initial.recent);
  const [question, setQuestion] = useState<TrustQuestion | null>(null);
  const [opening, setOpening] = useState(false);
  const now = new Date();

  // Where the project asked about is to land, kept across the question about its code.
  const landing = useRef<'designer' | 'dashboard'>('designer');
  const open = async (path: string, agreed: boolean, land: 'designer' | 'dashboard' = agreed ? landing.current : 'designer'): Promise<void> => {
    landing.current = land;
    setOpening(true);
    try {
      const result = await startApi().openProject({ path, ...(agreed ? { agreed: true } : {}), ...(land === 'dashboard' ? { land } : {}) });
      if (result.status === 'trust-needed') {
        setQuestion({ path: result.path, displayPath: result.displayPath, changed: result.changed });
        return;
      }
      setQuestion(null);
      if (result.status === 'missing') say(t('desktop:start.recent.gone', 'This folder was moved or deleted'), 'error');
      else if (result.status === 'not-a-project') say(t('desktop:start.open.notAProject', 'This folder is not an Adminium project.'), 'error');
      else if (result.status === 'needs-packages') setPackages({ path: result.path, displayPath: result.displayPath, land, since: null, failure: null });
      // 'opened': main is already taking the window to the project.
    } catch (error) {
      setQuestion(null);
      say(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setOpening(false);
    }
  };

  // The packages of a project that is there without them: asked for, fetched with a clock on the wait, then it opens.
  const [packages, setPackages] = useState<PackagesQuestion | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const fetching = packages !== null && packages.since !== null;
  useEffect(() => {
    if (!fetching) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [fetching]);
  const getPackages = async (): Promise<void> => {
    if (packages === null) return;
    const asked = packages;
    setTick(Date.now());
    setPackages({ ...asked, since: Date.now(), failure: null });
    try {
      const result = await startApi().getPackages({ path: asked.path, ...(asked.land === 'dashboard' ? { land: asked.land } : {}) });
      // 'opened': main is already taking the window to the project; the wait stays shown until this page is gone.
      if (result.status === 'opened') return;
      if (result.status === 'failed') {
        setPackages({ ...asked, since: null, failure: result.detail });
        return;
      }
      setPackages(null);
      // The folder changed under the question: asked again from the start, which says what is wrong with it now.
      await open(asked.path, false, asked.land);
    } catch (error) {
      setPackages(null);
      say(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const choose = async (key: Choice['key']): Promise<void> => {
    if (key === 'build') {
      onBuild();
      return;
    }
    if (key === 'db') {
      await startApi().useClassic();
      return;
    }
    if (key === 'open') {
      const picked = await startApi().chooseFolder({ title: t('desktop:start.choice.open.title', 'Open a folder') });
      if (picked !== null) await open(picked.path, false);
    }
  };

  const locate = async (project: DesktopRecentProject): Promise<void> => {
    const result = await startApi().locateProject({ path: project.path, title: t('desktop:start.recent.locateTitle', 'Where is {name} now?', { name: project.name }) });
    if (result.status === 'located') setRecent(result.recent);
    else if (result.status === 'not-a-project') say(t('desktop:start.recent.notThatProject', 'That folder is not an Adminium project.'), 'error');
    else if (result.status === 'already-listed') say(t('desktop:start.recent.alreadyListed', 'That folder is already in the list.'), 'info');
  };

  const remove = async (project: DesktopRecentProject): Promise<void> => {
    setRecent(await startApi().forgetProject(project.path));
    say(t('desktop:start.recent.removed', 'Removed from the recent projects'), 'success');
  };

  const words: Record<Choice['key'], [string, string]> = {
    build: [t('desktop:start.choice.build.title', 'Build an app'), t('desktop:start.choice.build.line', 'Describe it, and the Designer builds it on this computer.')],
    open: [t('desktop:start.choice.open.title', 'Open a folder'), t('desktop:start.choice.open.line', 'Go on with an app that is already in a folder, or one someone sent you.')],
    connect: [t('desktop:start.choice.connect.title', 'Connect to another Adminium'), t('desktop:start.choice.connect.line', 'Use an Adminium that runs on another computer.')],
    db: [t('desktop:start.choice.db.title', 'Use my own database'), t('desktop:start.choice.db.line', 'Make screens for a database you already have.')],
  };

  return (
    <div className="flex w-full flex-col pt-1 @[1144px]:pt-10">
      {initial.firstLaunch ? <p className="m-0 mb-2.5 text-[15px] font-bold text-accent">{t('desktop:start.welcome', 'Welcome to Adminium.')}</p> : null}
      <h1 className="m-0 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em]">{t('desktop:start.heading', 'What would you like to do?')}</h1>
      <div className="mt-5 grid grid-cols-1 gap-2 @[1144px]:mt-7 @[1144px]:grid-cols-2 @[1144px]:gap-3.5">
        {CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.key}
            choice={choice}
            title={words[choice.key][0]}
            line={words[choice.key][1]}
            // Connecting to another Adminium has no screen yet.
            disabled={choice.key === 'connect'}
            onChoose={() => {
              void choose(choice.key);
            }}
          />
        ))}
      </div>

      {recent.length === 0 ? null : (
        <section aria-labelledby={recentHead} className="mt-9">
          <h2 id={recentHead} className="m-0 mb-3 text-[15px] font-extrabold tracking-[-0.015em]">
            {t('desktop:start.recent.heading', 'Recent projects')}
          </h2>
          <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-card">
            {recent.map((project, index) => (
              <RecentRow
                key={project.path}
                project={project}
                first={index === 0}
                when={t('desktop:start.recent.opened', 'Opened {when}', { when: openedWhen(project.lastOpened, now, tag) })}
                onOpen={() => {
                  void open(project.path, false);
                }}
                onDashboard={() => {
                  void open(project.path, false, 'dashboard');
                }}
                onLocate={() => {
                  void locate(project);
                }}
                onRemove={() => {
                  void remove(project);
                }}
              />
            ))}
          </div>
        </section>
      )}

      <PackagesDialog
        question={packages}
        now={tick}
        onCancel={() => {
          setPackages(null);
        }}
        onGet={() => {
          void getPackages();
        }}
      />

      <TrustDialog
        question={question}
        busy={opening}
        onCancel={() => {
          setQuestion(null);
        }}
        onOpen={() => {
          if (question !== null) void open(question.path, true);
        }}
      />
    </div>
  );
}
