// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A RECORD'S FIELDS CAME FROM: "From {source} · {date}" under a field.
 *
 * An add-on that fills a company's fields from its sources has the engine
 * note each field it filled (`GET /pages/:id` · `fieldNotes` names it). The
 * record page asks it for one record's notes (`GET /leads/:key/notes`), and
 * the server answers only for the fields that still hold what was filled:
 * after an edit of one field, its note is gone and the others stay, with
 * nothing to clear. The record is asked again whenever the row the page
 * holds changes, so an edit made here hides its note at once.
 *
 * A source is named in the add-on's words for it, in the reader's language
 * where it wrote them; the date is the day it was found, in the reader's
 * calendar. A note that cannot be read leaves the field as it was: it is a
 * help, never a reason for the page to fail.
 */
import { useQueries } from '@tanstack/react-query';
import { FileCheck2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { api, installOptions } from '../../app/api.js';
import type { FieldNotesFact } from '../../api/pages.js';
import { addOnWords } from '../../add-ons/messages.js';
import { getI18nInstance, t } from '../../i18n/t.js';

/** One field's note, as the server answers it. */
export interface FieldNote {
  column: string;
  source: string;
  label: string;
  labelKey: string | null;
  foundAt: number;
}

interface NotesReply {
  table: string;
  row: string;
  notes: FieldNote[];
}

/** The address of one record's notes from one add-on. */
export function notesUrl(fact: Pick<FieldNotesFact, 'addOn' | 'table'>, recordId: string): string {
  const query = new URLSearchParams({ table: fact.table, row: recordId });
  return `/api/v1/leads/${encodeURIComponent(fact.addOn)}/notes?${query.toString()}`;
}

/** The day a note's source was found, as the reader writes a short date ("28 Jul"; the year when it is not this one). */
export function noteDate(at: number, locale: string, now: number = Date.now()): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(new Date(at));
}

/** One note, as the record page draws it under its field. */
export function FieldNoteLine({ addOn, note, locale }: { addOn: string; note: FieldNote; locale: string }) {
  const source = addOnWords(addOn, note.labelKey, note.label);
  return (
    <span data-part="field-note" className="mt-1 inline-flex flex-wrap items-center gap-[5px] text-[11.5px] leading-[normal] text-info">
      <FileCheck2 aria-hidden="true" className="size-3 shrink-0" />
      <span>{t('ui:pages.record.fieldNote', 'From {source}', { source })}</span>
      <span aria-hidden="true">·</span>
      <span className="font-mono">{noteDate(note.foundAt, locale)}</span>
    </span>
  );
}

/**
 * The notes of one record, by column, ready to draw under each field; empty
 * while they load, for a record with none, and when they cannot be read.
 */
export function useFieldNotes(facts: readonly FieldNotesFact[] | undefined, recordId: string | undefined, row: Readonly<Record<string, unknown>> | null): Readonly<Record<string, ReactNode>> {
  // The row as the page holds it: a change of any of its values asks again.
  const held = row === null ? null : JSON.stringify(row);
  const asked = recordId === undefined || held === null ? [] : (facts ?? []);
  const replies = useQueries({
    queries: asked.map((fact) => ({
      queryKey: ['field-notes', fact.addOn, fact.installId, fact.table, recordId, held],
      queryFn: () => api.get<NotesReply>(notesUrl(fact, recordId!), installOptions(fact.installId)),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const locale = getI18nInstance()?.language ?? 'en-US';
  const out: Record<string, ReactNode> = {};
  replies.forEach((reply, index) => {
    const fact = asked[index];
    if (reply.data === undefined || fact === undefined) return;
    for (const note of reply.data.notes) {
      // One note per field: the first add-on that answers for it.
      if (out[note.column] !== undefined) continue;
      out[note.column] = <FieldNoteLine addOn={fact.addOn} note={note} locale={locale} />;
    }
  });
  return out;
}
