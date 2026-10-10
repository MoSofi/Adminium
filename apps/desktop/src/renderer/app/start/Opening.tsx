// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The screens a person may meet between choosing a folder and its project
 * being open: what was found in it, a notice about how it was made, the
 * question of a missing key, and the accounts it brought. Each is one answer
 * of `openProject` drawn; "Continue" asks main again with that screen named
 * as seen. Nothing here decides anything: main does, each time it is asked.
 */
import { useT } from '@adminium/i18n/react';
import { AppWindow, Check, CircleAlert, FolderSearch, Globe, Info, KeyRound, Package, RefreshCw, UsersRound, type LucideIcon } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { DesktopFolderAccounts, DesktopFoundRow, DesktopOpenProjectResult } from '../../../preload/api.js';

type T = ReturnType<typeof useT>;

/** The answers of `openProject` that are a screen of their own. */
export type OpeningStep = Extract<DesktopOpenProjectResult, { status: 'running' | 'needs-newer' | 'key-missing' | 'other-manager' | 'older-engine' | 'found' | 'accounts' }> | { readonly status: 'not-a-project'; readonly path: string; readonly displayPath: string };

export type KeyAnswer = 'env' | 'fresh' | 'new';

export interface OpeningActions {
  /** The screen was read: go on. */
  readonly onContinue: () => void;
  /** Back to Start; nothing is opened. */
  readonly onClose: () => void;
  /** Ask main again as if for the first time (a server was stopped, a folder was fixed). */
  readonly onLookAgain: () => void;
  readonly onUpdateProject: () => void;
  readonly onUpdateApp: () => void;
  readonly onKeyAnswer: (answer: KeyAnswer) => void;
  readonly onChooseAnother: () => void;
  readonly onMakeHere: () => void;
}

const PRIMARY = 'cursor-pointer rounded-[10px] border-0 bg-accent px-5 py-[11px] text-[13.5px] font-bold text-accent-fg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50';
const QUIET = 'cursor-pointer rounded-[10px] border border-border bg-surface px-[18px] py-2.5 text-[13.5px] font-bold text-fg-muted hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50';
const MONO = 'font-mono [unicode-bidi:isolate]';

const TONES = {
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
} as const;

/** A sentence with the parts between `‹` and `›` drawn in the mono face: versions, ports, file names. */
function Marked({ text, className }: { text: string; className: string }): ReactNode {
  return (
    <>
      {text.split(/‹([^›]*)›/).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} dir="ltr" className={className}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** One shape for every small notice: a tile in its tone, a heading, a line, the quiet button first. */
function Notice({ icon: Icon, tone, title, line, primary, quiet, busy }: { icon: LucideIcon; tone: keyof typeof TONES; title: string; line: string; primary: { label: string; onClick: () => void }; quiet?: { label: string; onClick: () => void } | undefined; busy?: string | null | undefined }): ReactNode {
  return (
    <div className="mx-auto flex w-full max-w-[580px] flex-col pt-24">
      <span aria-hidden="true" className={`flex size-11 items-center justify-center rounded-[13px] ${TONES[tone]}`}>
        <Icon className="size-[21px]" />
      </span>
      <h1 className="m-0 mt-[18px] text-balance text-[24px] font-extrabold leading-[1.25] tracking-[-0.025em]">
        <Marked text={title} className={`${MONO} text-[0.85em]`} />
      </h1>
      <p className="m-0 mt-2.5 text-pretty text-[14.5px] leading-[1.6] text-fg-muted">
        <Marked text={line} className={`${MONO} text-[13px] font-semibold text-fg`} />
      </p>
      {busy == null ? null : (
        <p role="status" className="m-0 mt-4 text-[13px] font-semibold text-fg-muted">
          {busy}
        </p>
      )}
      <div className="mt-[30px] flex justify-end gap-2.5">
        {quiet === undefined ? null : (
          <button type="button" className={QUIET} onClick={quiet.onClick} disabled={busy != null}>
            {quiet.label}
          </button>
        )}
        <button type="button" className={PRIMARY} onClick={primary.onClick} disabled={busy != null}>
          {primary.label}
        </button>
      </div>
    </div>
  );
}

function foundWords(t: T, row: DesktopFoundRow): string {
  switch (row) {
    case 'data':
      return t('desktop:found.data', 'Found this project’s data.');
    case 'key':
      return t('desktop:found.key', 'Found its key.');
    case 'no-data':
      return t('desktop:found.noData', 'This folder has the project but no data.');
    case 'made-key-and-database':
      return t('desktop:found.madeBoth', 'Adminium made a new key and an empty database.');
    case 'made-database':
      return t('desktop:found.madeDatabase', 'Adminium made an empty database.');
  }
}

/** The folder's path as a chip and the project's name as the heading, over what was found. */
function Head({ displayPath, name }: { displayPath: string; name: string }): ReactNode {
  return (
    <>
      <span dir="ltr" className={`${MONO} mb-3 self-start rounded-[6px] bg-surface-3 px-2 py-[3px] text-[12px] font-medium text-fg-muted`}>
        {displayPath}
      </span>
      <h1 className="m-0 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em]">{name}</h1>
    </>
  );
}

function Found({ step, onContinue }: { step: Extract<OpeningStep, { status: 'found' }>; onContinue: () => void }): ReactNode {
  const t = useT();
  const made = step.rows.some((row) => row === 'made-key-and-database' || row === 'made-database');
  return (
    <div className="mx-auto flex w-full max-w-[580px] flex-col pt-16">
      <Head displayPath={step.displayPath} name={step.name} />
      <ul className="m-0 mt-6 list-none overflow-hidden rounded-[14px] border border-border bg-surface p-0 shadow-card">
        {step.rows.map((row, index) => (
          <li key={row} className={`flex items-center gap-3 px-[18px] py-3.5 text-[14px] font-semibold ${index === 0 ? '' : 'border-t border-border'}`}>
            <span aria-hidden="true" className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-pos-soft text-pos">
              <Check className="size-[15px]" />
            </span>
            {foundWords(t, row)}
          </li>
        ))}
      </ul>
      {made ? <p className="m-0 mt-3 text-[12.5px] leading-[1.55] text-fg-muted">{t('desktop:found.rowsLost', 'The apps’ own tables are made again. Rows that were in the old data are not here.')}</p> : null}
      <div className="mt-[30px] flex justify-end">
        <button type="button" className={`${PRIMARY} px-[22px]`} onClick={onContinue}>
          {t('desktop:opening.continue', 'Continue')}
        </button>
      </div>
    </div>
  );
}

function NotAProject({ step, actions }: { step: Extract<OpeningStep, { status: 'not-a-project' }>; actions: OpeningActions }): ReactNode {
  const t = useT();
  const name = step.displayPath.split(/[\\/]/).filter((part) => part !== '' && part !== '~').pop() ?? step.displayPath;
  return (
    <div className="mx-auto flex w-full max-w-[580px] flex-col pt-16">
      <Head displayPath={step.displayPath} name={name} />
      <div className="mt-6 flex items-start gap-3 rounded-[14px] border border-info/25 bg-info-soft px-[18px] py-4">
        <FolderSearch aria-hidden="true" className="mt-px size-[18px] shrink-0 text-info" />
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-bold">{t('desktop:start.open.notAProject', 'This folder is not an Adminium project.')}</span>
          <span className="text-[13px] leading-[1.55] text-fg-muted">{t('desktop:opening.notAProject.line', 'You can make a new project in a folder inside it.')}</span>
        </div>
      </div>
      <div className="mt-[30px] flex justify-end gap-2.5">
        <button type="button" className="cursor-pointer rounded-[10px] border border-border-strong bg-surface px-[18px] py-2.5 text-[13.5px] font-bold text-fg hover:border-accent" onClick={actions.onChooseAnother}>
          {t('desktop:opening.notAProject.another', 'Choose another folder')}
        </button>
        <button type="button" className={`${PRIMARY} px-[18px]`} onClick={actions.onMakeHere}>
          {t('desktop:opening.notAProject.make', 'Make a new project here')}
        </button>
      </div>
    </div>
  );
}

/** Where the system hides a file whose name starts with a dot, in the words of the system the app runs on. */
export function hiddenFilesWords(t: T, platform: string): string {
  if (platform === 'darwin') return t('desktop:key.hidden.mac', 'In Finder, press ⌘ ⇧ . to show them.');
  if (platform === 'win32') return t('desktop:key.hidden.windows', 'In File Explorer, choose View › Show › Hidden items.');
  return t('desktop:key.hidden.linux', 'In your file manager, press Ctrl H.');
}

function KeyMissing({ step, platform, busy, problem, onAnswer, onClose }: { step: Extract<OpeningStep, { status: 'key-missing' }>; platform: string; busy: boolean; problem: string | null; onAnswer: (answer: KeyAnswer) => void; onClose: () => void }): ReactNode {
  const t = useT();
  const group = useId();
  const [choice, setChoice] = useState<KeyAnswer | null>(null);
  const options: { id: KeyAnswer; title: string; line: string }[] = [
    { id: 'env', title: t('desktop:key.env.title', 'I have the .env file'), line: t('desktop:key.env.line', 'Pick it, and Adminium copies it in.') },
    { id: 'fresh', title: t('desktop:key.fresh.title', 'Start the data fresh, keep my apps'), line: t('desktop:key.fresh.line', 'Your old data is moved to a folder named ‹{folder}›. Nothing is deleted.', { folder: step.dataBefore }) },
    { id: 'new', title: t('desktop:key.new.title', 'Go on with a new key'), line: t('desktop:key.new.line', 'The data is kept. Saved connections and keys in it stop working and must be entered again.') },
  ];
  // The arrow keys move the choice, as in any group of radios; in a right-to-left language they follow the reading direction.
  const onKey = (event: KeyboardEvent): void => {
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    if (!forward && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const at = options.findIndex((option) => option.id === choice);
    // With none chosen yet, down is the first and up is the last.
    const next = at === -1 ? options[forward ? 0 : options.length - 1] : options[(at + (forward ? 1 : -1) + options.length) % options.length];
    if (next === undefined) return;
    setChoice(next.id);
    document.getElementById(`${group}-${next.id}`)?.focus();
  };
  return (
    <div className="mx-auto flex w-full max-w-[580px] flex-col pt-2">
      <span aria-hidden="true" className="mb-[18px] flex size-11 items-center justify-center rounded-[13px] bg-warn-soft text-warn">
        <KeyRound className="size-[21px]" />
      </span>
      <h1 id={group} className="m-0 text-balance text-[26px] font-extrabold leading-[1.2] tracking-[-0.03em]">
        {t('desktop:key.heading', 'This project’s data is here, but its key is missing.')}
      </h1>
      <p className="m-0 mt-3 text-pretty text-[14px] leading-[1.65] text-fg-muted">
        <Marked text={t('desktop:key.body', 'The key is a line in a file named ‹.env› in the project’s folder. Your computer hides files whose names start with a dot.')} className={`${MONO} rounded-[5px] bg-surface-3 px-[5px] py-px text-[12.5px] font-semibold text-fg`} />{' '}
        {hiddenFilesWords(t, platform)} {t('desktop:key.body2', 'Without the key, the saved database connections and API keys in this project’s data cannot be read.')}
      </p>
      <div role="radiogroup" aria-labelledby={group} onKeyDown={onKey} className="mt-6 flex flex-col gap-2.5">
        {options.map((option, index) => {
          const on = choice === option.id;
          return (
            <button
              key={option.id}
              id={`${group}-${option.id}`}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (choice === null && index === 0) ? 0 : -1}
              disabled={busy}
              onClick={() => {
                setChoice(option.id);
              }}
              className={`flex w-full cursor-pointer items-start gap-3 rounded-[12px] border px-4 py-[15px] text-start text-fg disabled:cursor-not-allowed ${on ? 'border-accent bg-[color-mix(in_srgb,var(--accent)_5%,var(--surface))] shadow-[0_0_0_1px_var(--accent)]' : 'border-border bg-surface shadow-card'}`}
            >
              <span aria-hidden="true" className={`mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full ${on ? 'bg-accent' : 'border-2 border-fg-subtle'}`}>
                {on ? <span className="size-[7px] rounded-full bg-accent-fg" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[14px] font-extrabold tracking-[-0.01em]">{option.title}</span>
                <span className="text-pretty text-[12.5px] leading-normal text-fg-muted">
                  <Marked text={option.line} className={`${MONO} text-[12px] font-semibold text-fg`} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {problem === null ? null : (
        <p role="alert" className="m-0 mt-3 text-[13px] font-semibold leading-normal text-danger">
          {problem}
        </p>
      )}
      <div className="mt-[26px] flex justify-end gap-2.5">
        <button type="button" className={QUIET} onClick={onClose} disabled={busy}>
          {t('desktop:opening.close', 'Close')}
        </button>
        <button
          type="button"
          className={`${PRIMARY} px-[22px]`}
          disabled={choice === null || busy}
          onClick={() => {
            if (choice !== null) onAnswer(choice);
          }}
        >
          {t('desktop:opening.continue', 'Continue')}
        </button>
      </div>
    </div>
  );
}

function Accounts({ accounts, onContinue }: { accounts: DesktopFolderAccounts; onContinue: () => void }): ReactNode {
  const t = useT();
  const [shown, setShown] = useState(false);
  const details = useId();
  const rows: { icon: LucideIcon; count: string; label: string; names: readonly string[]; total: number }[] = [
    { icon: UsersRound, count: t('desktop:accounts.people', '{count, plural, one {# person} other {# people}}', { count: accounts.people.count }), label: t('desktop:accounts.peopleLabel', 'People'), names: accounts.people.names, total: accounts.people.count },
    { icon: KeyRound, count: t('desktop:accounts.apiKeys', '{count, plural, one {# API key} other {# API keys}}', { count: accounts.apiKeys.count }), label: t('desktop:accounts.apiKeysLabel', 'API keys'), names: accounts.apiKeys.names, total: accounts.apiKeys.count },
    { icon: Globe, count: t('desktop:accounts.publicKeys', '{count, plural, one {# key open to the public} other {# keys open to the public}}', { count: accounts.publicKeys.count }), label: t('desktop:accounts.publicKeysLabel', 'Open to the public'), names: accounts.publicKeys.names, total: accounts.publicKeys.count },
  ].filter((row) => row.total > 0);
  return (
    <div className="mx-auto flex w-full max-w-[580px] flex-col pt-16">
      <h1 className="m-0 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em]">{t('desktop:accounts.heading', 'This project came with accounts')}</h1>
      <ul className="m-0 mt-6 list-none overflow-hidden rounded-[14px] border border-border bg-surface p-0 shadow-card">
        {rows.map((row, index) => (
          <li key={row.label} className={`flex items-center gap-3 px-[18px] py-3 ${index === 0 ? '' : 'border-t border-border'}`}>
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-3 text-fg-muted">
              <row.icon className="size-4" />
            </span>
            <span className="text-[14px] font-bold">{row.count}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-4 text-pretty text-[14px] leading-[1.6] text-fg-muted">
        {t('desktop:accounts.body', 'You will work as its owner on this computer. Before you share it on your network you will choose a new owner password, and the old sessions and API keys will stop working.')}
      </p>
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={details}
        onClick={() => {
          setShown(!shown);
        }}
        className="mt-3 cursor-pointer self-start border-0 bg-transparent p-0 text-[13px] font-bold text-accent underline-offset-2 hover:underline"
      >
        {shown ? t('desktop:accounts.hide', 'Hide them') : t('desktop:accounts.show', 'Show them')}
      </button>
      {shown ? (
        <dl id={details} className="m-0 mt-3 flex flex-col gap-2 rounded-[12px] border border-border bg-surface-2 px-4 py-3 text-[13px] leading-normal">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5">
              <dt className="font-bold text-fg">{row.label}</dt>
              <dd className="m-0 text-fg-muted">
                {row.names.join(', ')}
                {row.total > row.names.length ? ` ${t('desktop:accounts.more', 'and {count} more', { count: row.total - row.names.length })}` : ''}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="mt-[30px] flex justify-end">
        <button type="button" className={`${PRIMARY} px-[22px]`} onClick={onContinue}>
          {t('desktop:opening.continue', 'Continue')}
        </button>
      </div>
    </div>
  );
}

/** Whichever screen the step is. `busy`: main is at work for this screen (a pick, an update); `problem`: why it did not go through. */
export function OpeningScreen({ step, platform, busy, problem, actions }: { step: OpeningStep; platform: string; busy: boolean; problem: string | null; actions: OpeningActions }): ReactNode {
  const t = useT();
  switch (step.status) {
    case 'found':
      return <Found step={step} onContinue={actions.onContinue} />;
    case 'accounts':
      return <Accounts accounts={step.accounts} onContinue={actions.onContinue} />;
    case 'not-a-project':
      return <NotAProject step={step} actions={actions} />;
    case 'key-missing':
      return <KeyMissing step={step} platform={platform} busy={busy} problem={problem} onAnswer={actions.onKeyAnswer} onClose={actions.onClose} />;
    case 'other-manager':
      return (
        <Notice
          icon={Package}
          tone="info"
          title={t('desktop:notice.manager.title', 'This project uses {manager}.', { manager: step.manager })}
          line={t('desktop:notice.manager.line', 'Adminium installs with npm instead. Your {manager} file is left as it is.', { manager: step.manager })}
          primary={{ label: t('desktop:opening.continue', 'Continue'), onClick: actions.onContinue }}
          quiet={{ label: t('desktop:opening.close', 'Close'), onClick: actions.onClose }}
        />
      );
    case 'older-engine':
      return (
        <Notice
          icon={RefreshCw}
          tone="accent"
          title={t('desktop:notice.older.title', 'This project was made with an older Adminium (‹{was}›).', { was: step.was })}
          line={problem ?? t('desktop:notice.older.line', 'Update it to ‹{here}› so everything matches. This changes one line in the project and downloads its building blocks again.', { here: step.here })}
          primary={{ label: t('desktop:notice.older.update', 'Update this project'), onClick: actions.onUpdateProject }}
          quiet={{ label: t('desktop:notice.older.notNow', 'Not now'), onClick: actions.onContinue }}
          busy={busy ? t('desktop:notice.older.working', 'Updating this project…') : null}
        />
      );
    case 'needs-newer':
      return (
        <Notice
          icon={CircleAlert}
          tone="warn"
          title={t('desktop:notice.newer.title', 'This project needs a newer Adminium.')}
          line={
            problem ??
            (step.last === null
              ? t('desktop:notice.newer.lineUnknown', 'It was last opened with a newer Adminium. This computer has ‹{here}›.', { here: step.here })
              : t('desktop:notice.newer.line', 'It was last opened with Adminium ‹{last}›. This computer has ‹{here}›.', { last: step.last, here: step.here }))
          }
          primary={{ label: t('desktop:notice.newer.update', 'Update Adminium'), onClick: actions.onUpdateApp }}
          quiet={{ label: t('desktop:opening.close', 'Close'), onClick: actions.onClose }}
        />
      );
    case 'running':
      return (
        <Notice
          icon={step.by === 'cli' ? AppWindow : Info}
          tone="info"
          title={t('desktop:notice.running.title', 'This project is already running')}
          line={
            step.by === 'cli'
              ? t('desktop:notice.running.cli', 'It is open in a terminal, on port ‹{port}›. Close it there first.', { port: step.port })
              : t('desktop:notice.running.app', 'It is open in another Adminium window, on port ‹{port}›. Close it there first.', { port: step.port })
          }
          primary={{ label: t('desktop:notice.running.again', 'Look again'), onClick: actions.onLookAgain }}
          quiet={{ label: t('desktop:opening.close', 'Close'), onClick: actions.onClose }}
        />
      );
  }
}
