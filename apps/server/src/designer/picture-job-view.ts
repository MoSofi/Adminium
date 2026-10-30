// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a page is told about a picture make: plain types with no imports, so
 * the events a session sends can name them without importing the job runner.
 */

/** Where a picture is made for: a spot, a sample row, or every row of a table that holds one value (a group). */
export type MakeTarget = { spot: string } | { table: string; row: number } | { table: string; column: string; value: string };

/** A made picture as a page sees it: our ids, the target's name, the service's label and model, the words. Never a path. */
export interface MadePublic {
  id: string;
  shelf: string;
  title: string;
  creator: string;
  source: 'AI';
  licence: { code: 'made'; name: string };
  page: '';
  made: { label: string; model: string; words: string };
  target: MakeTarget | null;
  pinned: boolean;
  at: number;
}

export type LineState = 'waiting' | 'making' | 'done' | 'gone';

export interface JobLine {
  target: MakeTarget | null;
  /** The target's name, as the dialog shows it. */
  name: string;
  asked: number;
  made: number;
  refused: number;
  failed: number;
  state: LineState;
  /** Why it ended with nothing: a code, never the service's words. */
  code?: string;
  pictures: MadePublic[];
}

export type JobState = 'running' | 'done' | 'stopped' | 'lost';

export interface JobView {
  job: string;
  state: JobState;
  /** Why a stopped job stopped: a wrong key, no credit, a rate limit, the model gone, or the person. */
  stoppedBy?: string;
  label: string;
  model: string;
  lines: JobLine[];
  left: { mine: number; all: number };
}
