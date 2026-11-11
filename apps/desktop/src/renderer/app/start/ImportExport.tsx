// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File → "Open a project…" with an "Export everything" file: what it holds, a
 * name and a folder for the NEW project made from it, and the password of the
 * Super Admin who signs in first. An export carries nobody's password, and this
 * computer may have no mail to send a reset with, so the person sets one here,
 * as `adminium import-zip --owner` asks for one in a terminal.
 *
 * Main decides everything again: the engine reads and checks the file, main
 * judges the folder when "Open the project" is pressed, and the restore refuses
 * a file that changed since it was read. Once made, Start opens it as any
 * folder: its code is asked about first when the file brought some.
 */
import { useT } from '@adminium/i18n/react';
import { Ban, FileArchive, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { DesktopExportFacts, DesktopExportRefusal, DesktopMakeProgress, DesktopNewFolderJudgement, DesktopReadExportResult } from '../../../preload/api.js';
import { startApi } from '../bridge.js';
import { MakeSteps, PROGRESS_EVERY_MS, refusalWords, warningWords } from '../new/NewProjectScreen.js';
import { BackLink } from '../shell/PlainShell.js';

type T = ReturnType<typeof useT>;

const INPUT = 'h-11 w-full rounded-[10px] border border-border-strong bg-surface px-3.5 text-[14px] text-fg outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]';

/** The sentence for a file that is not opened. */
export function exportRefusalWords(t: T, refused: DesktopExportRefusal): string {
  switch (refused) {
    case 'full-archive':
      return t('desktop:export.refuse.fullArchive', 'This is a whole-server archive, not an Export everything file. Restore it on a server with adminium archive restore.');
    case 'not-an-export':
      return t('desktop:export.refuse.notAnExport', 'This file is not an Export everything file. Make one in Studio, under Settings, Export everything.');
    case 'refused':
      return t('desktop:export.refuse.refused', 'This file did not pass the checks, so nothing was made from it.');
    case 'failed':
      return t('desktop:export.refuse.failed', 'This file could not be opened.');
  }
}

function Problem({ title, detail }: { title: string; detail?: string | undefined }): ReactNode {
  return (
    <div role="alert" className="mt-5 flex items-start gap-[11px] rounded-[12px] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-danger-soft px-[15px] py-3.5">
      <span aria-hidden="true" className="mt-px flex text-danger">
        <Ban className="size-[17px]" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="text-[13px] font-bold leading-[1.55] [text-wrap:pretty]">{title}</div>
        {detail === undefined || detail === '' ? null : (
          <pre dir="ltr" className="m-0 whitespace-pre-wrap font-mono text-[12px] leading-[1.5] text-fg-muted [overflow-wrap:anywhere]">
            {detail}
          </pre>
        )}
      </div>
    </div>
  );
}

export function ImportExportScreen({
  file,
  proposedParent,
  proposedParentDisplay,
  onBack,
  onChooseAnother,
  onImported,
}: {
  file: { readonly path: string; readonly displayPath: string };
  proposedParent: string;
  proposedParentDisplay: string;
  onBack: () => void;
  onChooseAnother: () => void;
  /** Made: Start opens it, as any folder. */
  onImported: (made: { path: string; name: string; owner: string; connections: number; drafts: readonly string[] }) => void;
}): ReactNode {
  const t = useT();
  const nameId = useId();
  const whereId = useId();
  const ownerId = useId();
  const passwordId = useId();
  const againId = useId();
  const [read, setRead] = useState<DesktopReadExportResult | null>(null);
  const [name, setName] = useState('');
  const [parent, setParent] = useState(proposedParent);
  const [judged, setJudged] = useState<DesktopNewFolderJudgement | null>(null);
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  const [owner, setOwner] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [importing, setImporting] = useState(false);
  const [failure, setFailure] = useState<{ title: string; detail?: string } | null>(null);
  const asked = useRef(0);
  const [progress, setProgress] = useState<DesktopMakeProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // While the project is made (the restore, then the packages, minutes on a slow line), main is asked where it is.
  useEffect(() => {
    if (!importing) {
      setProgress(null);
      return;
    }
    let live = true;
    const ask = (): void => {
      void startApi()
        .makeProgress()
        .then((value) => {
          if (!live) return;
          setProgress(value);
          setNow(Date.now());
        })
        .catch(() => undefined);
    };
    ask();
    const timer = setInterval(ask, PROGRESS_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [importing]);

  useEffect(() => {
    let live = true;
    setRead(null);
    void startApi()
      .readExport({ path: file.path })
      .then((result) => {
        if (!live) return;
        setRead(result);
        if (result.status === 'ready') {
          setName(result.facts.name);
          setOwner(result.facts.owners[0]?.email ?? '');
        }
      })
      .catch((error: unknown) => {
        if (live) setRead({ status: 'refused', refused: 'failed', detail: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      live = false;
    };
  }, [file.path]);

  useEffect(() => {
    if (read?.status !== 'ready') return;
    const mine = (asked.current += 1);
    void startApi()
      .judgeNewFolder({ parent, name })
      .then((result) => {
        if (asked.current === mine) setJudged(result);
      });
  }, [read, parent, name]);

  const back = <BackLink label={t('desktop:new.back', 'Back')} onBack={onBack} />;
  const heading = (
    <>
      <h1 className="m-0 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em]">{t('desktop:export.heading', 'Open a project')}</h1>
      <p className="m-0 mt-2 flex items-center gap-2 text-[13px] text-fg-muted">
        <FileArchive aria-hidden="true" className="size-[15px] shrink-0" />
        <span dir="ltr" className="min-w-0 truncate font-mono [unicode-bidi:isolate]">
          {file.displayPath}
        </span>
      </p>
    </>
  );

  if (read === null) {
    return (
      <div className="mx-auto flex w-full max-w-[580px] flex-col pt-2">
        {back}
        {heading}
        <p role="status" className="m-0 mt-8 inline-flex items-center gap-2 text-[13.5px] font-semibold text-fg-muted">
          <LoaderCircle aria-hidden="true" className="size-[15px] animate-spin" />
          {t('desktop:export.reading', 'Reading and checking the file…')}
        </p>
      </div>
    );
  }

  if (read.status !== 'ready' || read.facts.owners.length === 0) {
    const title =
      read.status === 'missing'
        ? t('desktop:export.missing', 'This file was moved or deleted.')
        : read.status === 'refused'
          ? exportRefusalWords(t, read.refused)
          : t('desktop:export.noOwner', 'This file names no Super Admin who could sign in. Import it on a server with adminium import-zip.');
    return (
      <div className="mx-auto flex w-full max-w-[580px] flex-col pt-2">
        {back}
        {heading}
        <Problem title={title} detail={read.status === 'refused' && read.refused !== 'full-archive' && read.refused !== 'not-an-export' ? read.detail : undefined} />
        <div className="mt-8 flex justify-end">
          <button type="button" onClick={onChooseAnother} className="cursor-pointer rounded-[10px] border-0 bg-accent px-5 py-[11px] text-[13.5px] font-bold text-accent-fg hover:brightness-105">
            {t('desktop:export.another', 'Choose another file')}
          </button>
        </div>
      </div>
    );
  }

  const facts: DesktopExportFacts = read.facts;
  const shownPath = judged?.displayPath ?? (parent === proposedParent ? proposedParentDisplay : parent);
  const warning = judged?.ok === true && judged.warning !== null && acceptedFor !== judged.path ? judged.warning : null;
  const refusal = judged?.ok === false ? refusalWords(t, judged.refused) : null;
  const short = password !== '' && password.length < facts.passwordMinLength;
  const differ = again !== '' && again !== password;
  const canOpen = judged?.ok === true && warning === null && owner !== '' && password.length >= facts.passwordMinLength && password.length <= 1024 && again === password && !importing;

  const changeFolder = async (): Promise<void> => {
    const picked = await startApi().chooseParent({ from: parent, title: t('desktop:new.where', 'Where to keep it') });
    if (picked !== null) setParent(picked);
  };

  const open = async (): Promise<void> => {
    setImporting(true);
    setFailure(null);
    try {
      const accepted = judged?.ok === true && acceptedFor === judged.path;
      const result = await startApi().importExport({ path: file.path, parent, name, owner, password, ...(accepted ? { acceptWarning: true } : {}) });
      if (result.status === 'imported') {
        setPassword('');
        setAgain('');
        onImported({ path: result.path, name: name.trim(), owner: result.owner, connections: result.connections, drafts: result.drafts });
        return;
      }
      if (result.status === 'refused') setFailure({ title: exportRefusalWords(t, result.refused), detail: result.detail });
      // 'folder-refused' and 'warned': main saw something this page had not yet; ask again and show it.
      else setJudged(await startApi().judgeNewFolder({ parent, name }));
    } catch (error) {
      setFailure({ title: t('desktop:export.refuse.failed', 'This file could not be opened.'), detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[580px] flex-col pt-2">
      {back}
      {heading}
      <p className="m-0 mt-4 text-[14px] leading-[1.6] text-fg-muted [text-wrap:pretty]">
        {t('desktop:export.holds', 'An Export everything file with {people, plural, one {# person} other {# people}}, {pages, plural, one {# page} other {# pages}} and {files, plural, one {# uploaded file} other {# uploaded files}}. It becomes a new project on this computer.', {
          people: facts.people,
          pages: facts.pages,
          files: facts.files,
        })}
      </p>

      <div className="mt-[26px] flex flex-col gap-[7px]">
        <label htmlFor={nameId} className="text-[12.5px] font-bold">
          {t('desktop:new.name', 'Name')}
        </label>
        <input id={nameId} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} className={INPUT} />
      </div>

      <div className="mt-[22px] flex flex-col gap-[7px]">
        <span id={whereId} className="text-[12.5px] font-bold">
          {t('desktop:new.where', 'Where to keep it')}
        </span>
        <div className="flex gap-2">
          <input readOnly aria-labelledby={whereId} dir="ltr" value={shownPath} className="h-11 min-w-0 flex-1 rounded-[10px] border border-border bg-surface-2 px-3.5 font-mono text-[13px] text-fg outline-none" />
          <button
            type="button"
            onClick={() => {
              void changeFolder();
            }}
            className="cursor-pointer whitespace-nowrap rounded-[10px] border border-border-strong bg-surface px-4 text-[13px] font-bold text-fg hover:bg-surface-2"
          >
            {t('desktop:new.change', 'Change…')}
          </button>
        </div>
        {warning === null ? null : (
          <div role="alert" className="mt-1.5 flex items-start gap-[11px] rounded-[12px] border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-warn-soft px-[15px] py-3.5">
            <span aria-hidden="true" className="mt-px flex text-warn">
              <TriangleAlert className="size-[17px]" />
            </span>
            <div className="flex flex-1 flex-col gap-3">
              <div className="text-[13px] leading-[1.55] [text-wrap:pretty]">{warningWords(t, warning)}</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void changeFolder();
                  }}
                  className="cursor-pointer rounded-[9px] border-0 bg-accent px-[13px] py-2 text-[12.5px] font-bold text-accent-fg hover:brightness-105"
                >
                  {t('desktop:new.warn.another', 'Choose another folder')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (judged?.ok === true) setAcceptedFor(judged.path);
                  }}
                  className="cursor-pointer rounded-[9px] border border-transparent bg-transparent px-[13px] py-2 text-[12.5px] font-bold text-fg-muted hover:border-border-strong"
                >
                  {t('desktop:new.warn.anyway', 'Use it anyway')}
                </button>
              </div>
            </div>
          </div>
        )}
        {refusal === null ? null : <Problem title={refusal} />}
      </div>

      <fieldset className="m-0 mt-[26px] flex flex-col gap-[7px] border-0 p-0">
        <legend id={ownerId} className="mb-[7px] p-0 text-[12.5px] font-bold">
          {t('desktop:export.owner', 'Who signs in first')}
        </legend>
        {facts.owners.length === 1 ? (
          <p className="m-0 text-[13.5px]">
            <span dir="ltr" className="font-semibold [unicode-bidi:isolate]">
              {facts.owners[0]?.email}
            </span>
            {facts.owners[0]?.name === '' ? null : <span className="text-fg-muted"> · {facts.owners[0]?.name}</span>}
          </p>
        ) : (
          <div role="radiogroup" aria-labelledby={ownerId} className="flex flex-col overflow-hidden rounded-[12px] border border-border bg-surface">
            {facts.owners.map((candidate, index) => (
              <label key={candidate.id} className={`flex cursor-pointer items-center gap-3 px-[15px] py-3 text-[13.5px] ${index === 0 ? '' : 'border-t border-border'} hover:bg-surface-2`}>
                <input type="radio" name={ownerId} value={candidate.email} checked={owner === candidate.email} onChange={() => setOwner(candidate.email)} className="accent-[var(--accent)]" />
                <span dir="ltr" className="font-semibold [unicode-bidi:isolate]">
                  {candidate.email}
                </span>
                {candidate.name === '' ? null : <span className="text-fg-muted">{candidate.name}</span>}
              </label>
            ))}
          </div>
        )}
        <p className="m-0 text-[12.5px] leading-[1.55] text-fg-muted [text-wrap:pretty]">
          {t('desktop:export.ownerHelp', 'The file carries nobody’s password. This Super Admin gets the one you set here; everyone else resets theirs to sign in.')}
        </p>
      </fieldset>

      <div className="mt-[22px] flex flex-col gap-[7px]">
        <label htmlFor={passwordId} className="text-[12.5px] font-bold">
          {t('desktop:export.password', 'New password')}
        </label>
        <input id={passwordId} type="password" autoComplete="new-password" value={password} maxLength={1024} onChange={(event) => setPassword(event.target.value)} className={INPUT} aria-invalid={short} />
        <p className={`m-0 text-[12.5px] ${short ? 'font-semibold text-danger' : 'text-fg-muted'}`}>
          {t('desktop:export.passwordLength', 'At least {count, plural, one {# character} other {# characters}}.', { count: facts.passwordMinLength })}
        </p>
      </div>
      <div className="mt-[18px] flex flex-col gap-[7px]">
        <label htmlFor={againId} className="text-[12.5px] font-bold">
          {t('desktop:export.passwordAgain', 'The same password again')}
        </label>
        <input id={againId} type="password" autoComplete="new-password" value={again} maxLength={1024} onChange={(event) => setAgain(event.target.value)} className={INPUT} aria-invalid={differ} />
        {differ ? <p className="m-0 text-[12.5px] font-semibold text-danger">{t('desktop:export.passwordDiffer', 'The two passwords are not the same.')}</p> : null}
      </div>

      <p className="m-0 mt-[22px] text-[12.5px] leading-[1.55] text-fg-muted [text-wrap:pretty]">
        {t('desktop:export.secrets', 'Connection strings, mail and AI keys are not in the file. After it opens, the connections that need theirs are marked in Studio.')}
      </p>

      {failure === null ? null : <Problem title={failure.title} detail={failure.detail} />}

      {importing && progress !== null && progress.step !== null ? <MakeSteps progress={progress} now={now} /> : null}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          disabled={!canOpen}
          onClick={() => {
            void open();
          }}
          className="inline-flex cursor-pointer items-center gap-[7px] rounded-[10px] border-0 bg-accent px-[22px] py-[11px] text-[13.5px] font-bold text-accent-fg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {importing ? <LoaderCircle className="size-[15px] animate-spin" aria-hidden="true" /> : null}
          {importing ? t('desktop:export.opening', 'Making the project…') : t('desktop:export.open', 'Open the project')}
        </button>
      </div>
    </div>
  );
}
