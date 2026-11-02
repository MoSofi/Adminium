// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A file question on a stranger's page (comp M3 §7, "Drawings of your
 * space"): "Choose a file" (or "Choose files"), each file picked a row with
 * its name and size and a Remove button, a refused row with a danger border
 * and its reason under it.
 *
 * Each file is sent the moment it is picked, with a human check of its own
 * (`postFile`); the answer then names the files taken by the ids the door
 * gave. What the page checks first (the size, the name's ending) only spares
 * a stranger a wasted upload: the door judges the bytes again, and the
 * answer door again what the answer names.
 *
 * The button is named by the question and its own words together
 * (`aria-labelledby`), and described by the hint and the question's error.
 * Removing a row puts focus back on the button.
 */
import { useId, useRef, type ReactNode } from 'react';
import { useT } from '@adminium/i18n/react';
import { CircleAlert, FileText, LoaderCircle, Paperclip, X } from 'lucide-react';
import type { FormFileKind, FormQuestionOf } from '@adminium/add-on-contracts/forms';

import { fetchChallenge, postFile, type XFileRefusal } from './api.js';
import { solve } from '../pay/proof.js';

/** One file picked for a question: on its way, taken (with the door's id), or refused (with why). */
export interface FileRow {
  key: string;
  name: string;
  size: number;
  state: 'sending' | 'taken' | 'refused';
  id?: string;
  code?: XFileRefusal | 'count';
}

/** A megabyte as a question's `maxMb` counts it (the door's own). */
export const FILE_MB = 1024 * 1024;
/** The most files a question that takes several takes (the vocabulary's `FORM_FILES_MAX`, kept out of the page's first load). */
export const FILES_MAX = 5;

/** The name endings each kind is picked by (the door sniffs the bytes whatever the name). */
const ENDINGS: Readonly<Record<FormFileKind, readonly string[]>> = {
  pdf: ['pdf'],
  jpg: ['jpg', 'jpeg'],
  png: ['png'],
  text: ['txt', 'log'],
};
const TYPES: Readonly<Record<FormFileKind, string>> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', text: 'text/plain' };

/** What the file picker offers for a question's kinds. */
export function acceptOf(kinds: readonly FormFileKind[]): string {
  return kinds.flatMap((kind) => [...ENDINGS[kind].map((ending) => `.${ending}`), TYPES[kind]]).join(',');
}

/** Why a picked file would not be taken, before it is sent: too large, or a name ending none of the kinds have. */
export function refusalBeforeSending(file: { name: string; size: number }, question: Pick<FormQuestionOf<'file'>, 'kinds' | 'maxMb'>): 'too-big' | 'kind' | null {
  const dot = file.name.lastIndexOf('.');
  const ending = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase();
  if (!question.kinds.some((kind) => ENDINGS[kind].includes(ending))) return 'kind';
  if (file.size > question.maxMb * FILE_MB) return 'too-big';
  return null;
}

/** Sends one file with its own check; one silent retry when the check expired on a slow phone. */
export async function sendFile(slug: string, question: string, file: Blob & { name: string }): Promise<Awaited<ReturnType<typeof postFile>>> {
  let reply: Awaited<ReturnType<typeof postFile>> = { state: 'refused', code: 'proof' };
  for (let round = 0; round < 2 && reply.state === 'refused' && reply.code === 'proof'; round += 1) {
    try {
      const challenge = await fetchChallenge(slug);
      reply = await postFile(slug, question, file, `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}`);
    } catch {
      return { state: 'refused', code: 'failed' };
    }
  }
  return reply;
}

/** A size as the page's language writes it, Latin digits: KB under a megabyte, one decimal under ten. */
export function sizeWords(bytes: number, tag: string): string {
  const mb = bytes / FILE_MB;
  const unit = mb < 1 ? 'kilobyte' : 'megabyte';
  const n = mb < 1 ? Math.max(1, Math.round(bytes / 1024)) : mb;
  try {
    return new Intl.NumberFormat(`${tag}-u-nu-latn`, { style: 'unit', unit, maximumFractionDigits: mb < 1 || mb >= 10 ? 0 : 1 }).format(n);
  } catch {
    return mb < 1 ? `${String(n)} KB` : `${String(Math.round(mb * 10) / 10)} MB`;
  }
}

export interface FileFieldProps {
  question: FormQuestionOf<'file'>;
  rows: readonly FileRow[];
  /** The page's language tag. */
  tag: string;
  /** The question's kinds, in words ("PDF, JPG or PNG"). */
  kinds: string;
  /** The question's label's id, the hint's and the error's (the button is named and described by them). */
  labelId: string;
  describedBy: string | undefined;
  onPick: (files: File[]) => void;
  onRemove: (key: string) => void;
}

export function FileField(props: FileFieldProps): ReactNode {
  const t = useT();
  const base = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const { question, rows, tag } = props;
  const buttonId = `${base}-button`;
  const list = props.kinds;

  function reason(row: FileRow): string {
    switch (row.code) {
      case 'too-big':
        return t('x:files.tooBig', 'This file is {size}. The limit is {mb} MB.', { size: sizeWords(row.size, tag), mb: question.maxMb });
      case 'kind':
        return t('x:files.kind', 'This file type isn’t accepted. Use {kinds}.', { kinds: list });
      case 'quota':
        return t('x:files.quota', 'Files can’t be taken right now. Try again later.');
      case 'cap':
        return t('x:files.cap', 'Too many files from here today. Try again tomorrow.');
      case 'count':
        return t('x:files.count', 'You can add up to {max, plural, one {# file} other {# files}}.', { max: FILES_MAX });
      case 'proof':
        return t('x:proofFailed', 'The check that you are a person did not pass. Try again.');
      default:
        return t('x:files.failed', 'This file could not be sent. Try again.');
    }
  }

  return (
    <>
      {rows.map((row) => {
        const refusalId = `${base}-${row.key}-why`;
        return (
          <div key={row.key} className="x-file">
            <div className="x-file-row" data-bad={row.state === 'refused' ? '' : undefined}>
              {row.state === 'sending' ? (
                <LoaderCircle className="x-icon x-spin x-file-icon" size={18} strokeWidth={2} aria-hidden="true" />
              ) : (
                <FileText className="x-icon x-file-icon" size={18} strokeWidth={2} aria-hidden="true" />
              )}
              <span className="x-file-text">
                <bdi dir="ltr" className="x-file-name">
                  {row.name}
                </bdi>
                <bdi dir="ltr" className="x-file-size">
                  {row.state === 'sending' ? t('x:sending', 'Sending…') : sizeWords(row.size, tag)}
                </bdi>
              </span>
              <button
                type="button"
                className="x-file-remove"
                aria-label={t('x:files.remove', 'Remove {file}', { file: row.name })}
                aria-describedby={row.state === 'refused' ? refusalId : undefined}
                onClick={() => {
                  props.onRemove(row.key);
                  button.current?.focus();
                }}
              >
                <X className="x-icon" size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            {row.state === 'refused' ? (
              <p id={refusalId} className="x-error">
                <CircleAlert className="x-icon" size={14} strokeWidth={2} aria-hidden="true" />
                <span>{reason(row)}</span>
              </p>
            ) : null}
          </div>
        );
      })}
      <input
        ref={input}
        type="file"
        className="x-file-input"
        multiple={question.many === true}
        accept={acceptOf(question.kinds)}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          // The same file may be picked again after a Remove.
          event.target.value = '';
          if (picked.length > 0) props.onPick(picked);
        }}
      />
      <button
        ref={button}
        id={buttonId}
        type="button"
        className="x-button-secondary x-choose"
        aria-labelledby={`${props.labelId} ${buttonId}`}
        aria-describedby={props.describedBy}
        onClick={() => input.current?.click()}
      >
        <Paperclip className="x-icon" size={16} strokeWidth={2} aria-hidden="true" />
        <span>{question.many === true ? t('x:file.chooseMany', 'Choose files') : t('x:file.chooseOne', 'Choose a file')}</span>
      </button>
    </>
  );
}
