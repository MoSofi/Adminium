// SPDX-License-Identifier: AGPL-3.0-only
/**
 * New app: a name, and where its project is kept. The folder is always one of
 * its own, made from the name; main judges it as the name is typed and again
 * when "Create" is pressed.
 */
import { useT } from '@adminium/i18n/react';
import { Ban, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { DesktopFolderRefusal, DesktopFolderWarning, DesktopNewFolderJudgement } from '../../../preload/api.js';
import { startApi } from '../bridge.js';
import { BackLink } from '../shell/PlainShell.js';

type Say = (title: string, variant?: 'success' | 'error' | 'info') => void;
type T = (key: string, fallback: string, args?: Record<string, unknown>) => string;

/** The sentence for each thing a person is warned of and may still choose. */
export function warningWords(t: T, warning: DesktopFolderWarning): string {
  switch (warning) {
    case 'icloud':
      return t('desktop:new.warn.icloud', 'This folder is synced by iCloud Drive. Projects work badly in synced folders: the sync can damage their data.');
    case 'onedrive':
      return t('desktop:new.warn.onedrive', 'This folder is synced by OneDrive. Projects work badly in synced folders: the sync can damage their data.');
    case 'dropbox':
      return t('desktop:new.warn.dropbox', 'This folder is synced by Dropbox. Projects work badly in synced folders: the sync can damage their data.');
    case 'googledrive':
      return t('desktop:new.warn.googledrive', 'This folder is synced by Google Drive. Projects work badly in synced folders: the sync can damage their data.');
    case 'no-links':
      return t('desktop:new.warn.noLinks', 'This disk cannot hold the links a project’s packages need, so getting them is likely to fail.');
  }
}

/** The sentence for each folder a project may not go in; `null` when the empty name says it all. */
export function refusalWords(t: T, refused: DesktopFolderRefusal): string | null {
  switch (refused) {
    case 'no-name':
      return null;
    case 'bad-name':
      return t('desktop:new.refuse.badName', 'Use at least one letter or number in the name.');
    case 'home-folder':
      return t('desktop:new.refuse.homeFolder', 'A project cannot be kept directly in your home folder. Choose or make a folder inside it.');
    case 'system-folder':
      return t('desktop:new.refuse.systemFolder', 'A project cannot be kept in a folder that belongs to the system. Choose a folder of your own.');
    case 'inside-the-app':
      return t('desktop:new.refuse.insideTheApp', 'A project cannot be kept inside Adminium itself. Choose another folder.');
    case 'inside-a-project':
      return t('desktop:new.refuse.insideAProject', 'This folder is inside another project. Choose a folder outside it.');
    case 'exists-with-files':
      return t('desktop:new.refuse.existsWithFiles', 'A folder with this name is already there and holds files. Choose another name or another folder.');
    case 'not-absolute':
      return t('desktop:new.refuse.notAbsolute', 'Choose a folder with the “Change…” button.');
  }
}

export function NewProjectScreen({
  proposedParent,
  proposedParentDisplay,
  onBack,
  say,
}: {
  proposedParent: string;
  proposedParentDisplay: string;
  onBack: () => void;
  say: Say;
}): ReactNode {
  const t = useT();
  const nameId = useId();
  const whereId = useId();
  const [name, setName] = useState('');
  const [parent, setParent] = useState(proposedParent);
  const [judged, setJudged] = useState<DesktopNewFolderJudgement | null>(null);
  // The warning the person chose to go past, for THIS folder only: another folder asks again.
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    const mine = (asked.current += 1);
    void startApi()
      .judgeNewFolder({ parent, name })
      .then((result) => {
        // Only the answer to what is in the fields now.
        if (asked.current === mine) setJudged(result);
      });
  }, [parent, name]);

  const changeFolder = async (): Promise<void> => {
    const picked = await startApi().chooseParent({ from: parent, title: t('desktop:new.where', 'Where to keep it') });
    if (picked !== null) setParent(picked);
  };

  const create = async (): Promise<void> => {
    setCreating(true);
    setFailure(null);
    try {
      const accepted = judged?.ok === true && acceptedFor === judged.path;
      const result = await startApi().createProject(accepted ? { parent, name, acceptWarning: true } : { parent, name });
      if (result.status === 'failed') setFailure(result.detail);
      // 'refused' and 'warned': main saw something this page had not yet; ask again and show it.
      else if (result.status !== 'created') setJudged(await startApi().judgeNewFolder({ parent, name }));
      // 'created': main is already taking the window to the project.
    } catch (error) {
      say(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setCreating(false);
    }
  };

  const shownPath = judged?.displayPath ?? (parent === proposedParent ? proposedParentDisplay : parent);
  const warning = judged?.ok === true && judged.warning !== null && acceptedFor !== judged.path ? judged.warning : null;
  const refusal = judged?.ok === false ? refusalWords(t, judged.refused) : null;
  const canCreate = judged?.ok === true && warning === null && !creating;

  return (
    <div className="mx-auto flex w-full max-w-[580px] flex-col pt-2">
      <BackLink label={t('desktop:new.back', 'Back')} onBack={onBack} />
      <h1 className="m-0 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em]">{t('desktop:new.heading', 'Build an app')}</h1>

      <div className="mt-[30px] flex flex-col gap-[7px]">
        <label htmlFor={nameId} className="text-[12.5px] font-bold">
          {t('desktop:new.name', 'Name')}
        </label>
        <input
          id={nameId}
          value={name}
          autoFocus
          maxLength={200}
          onChange={(event) => {
            setName(event.target.value);
          }}
          className="h-11 w-full rounded-[10px] border border-border-strong bg-surface px-3.5 text-[14px] text-fg outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
        />
      </div>

      <div className="mt-[22px] flex flex-col gap-[7px]">
        <span id={whereId} className="text-[12.5px] font-bold">
          {t('desktop:new.where', 'Where to keep it')}
        </span>
        <div className="flex gap-2">
          <input
            readOnly
            aria-labelledby={whereId}
            dir="ltr"
            value={shownPath}
            className="h-11 min-w-0 flex-1 rounded-[10px] border border-border bg-surface-2 px-3.5 font-mono text-[13px] text-fg outline-none"
          />
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

        {refusal === null ? null : (
          <div role="alert" className="mt-1.5 flex items-start gap-[11px] rounded-[12px] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-danger-soft px-[15px] py-3.5">
            <span aria-hidden="true" className="mt-px flex text-danger">
              <Ban className="size-[17px]" />
            </span>
            <div className="text-[13px] leading-[1.55] [text-wrap:pretty]">{refusal}</div>
          </div>
        )}

        <p className="m-0 mt-1 text-[12.5px] leading-[1.55] text-fg-muted">
          {t('desktop:new.help', 'Adminium makes this folder for you. Everything about your app lives in it.')}
        </p>
      </div>

      {failure === null ? null : (
        <div role="alert" className="mt-5 flex items-start gap-[11px] rounded-[12px] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-danger-soft px-[15px] py-3.5">
          <span aria-hidden="true" className="mt-px flex text-danger">
            <Ban className="size-[17px]" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="text-[13px] font-bold leading-[1.55]">{t('desktop:new.failed', 'The project could not be made.')}</div>
            <pre dir="ltr" className="m-0 whitespace-pre-wrap font-mono text-[12px] leading-[1.5] text-fg-muted [overflow-wrap:anywhere]">
              {failure}
            </pre>
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          disabled={!canCreate}
          onClick={() => {
            void create();
          }}
          className="inline-flex cursor-pointer items-center gap-[7px] rounded-[10px] border-0 bg-accent px-[22px] py-[11px] text-[13.5px] font-bold text-accent-fg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {creating ? <LoaderCircle className="size-[15px] animate-spin" aria-hidden="true" /> : null}
          {creating ? t('desktop:new.creating', 'Getting it ready…') : t('desktop:new.create', 'Create')}
        </button>
      </div>
    </div>
  );
}
