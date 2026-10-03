// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A step's line in the page's language, from the tool and the facts the
 * event carries. A tool this page does not know shows the server's English
 * line.
 */
import { t } from '../../i18n/t.js';
import type { StepRow } from './turns.js';

/** Where the subject goes in a line; the caller draws it in mono. */
export const SUBJECT = '\u0001';
const S = { subject: SUBJECT };

/** The line, with {@link SUBJECT} where the file or name goes. */
export function stepLine(row: StepRow): string {
  const running = row.state === 'running';
  if (row.state === 'failed' && row.ended === 'stopped') return t('designer:step.stopped', 'Stopped');
  if (row.state === 'missed') return row.subject === undefined ? t('designer:step.missedPlain', 'Looked for something that is not there') : t('designer:step.missed', 'Looked for {subject} — not there', S);
  if (row.state === 'failed' && row.subject !== undefined) {
    // A file step that failed says so: "Wrote x" in red reads as if it had been written.
    if (row.tool === 'read_file' || row.tool === 'read_reference') return t('designer:step.readFailed', 'Could not read {subject}', S);
    if (row.tool === 'write_file') return t('designer:step.writeFailed', 'Could not write {subject}', S);
    if (row.tool === 'edit_file') return t('designer:step.editFailed', 'Could not edit {subject}', S);
    if (row.tool === 'delete_file') return t('designer:step.deleteFailed', 'Could not delete {subject}', S);
  }
  switch (row.tool) {
    case 'list_files':
      return running ? t('designer:step.listing', 'Listing files') : t('designer:step.listed', 'Listed the files');
    case 'read_file':
      return running ? t('designer:step.reading', 'Reading {subject}', S) : t('designer:step.read', 'Read {subject}', S);
    case 'write_file':
    case 'edit_file':
      if (row.folded > 1 && !running) return t('designer:step.wroteMany', '{count, plural, one {Wrote # file} other {Wrote # files}}', { count: row.folded });
      if (row.tool === 'edit_file') return running ? t('designer:step.editing', 'Editing {subject}', S) : t('designer:step.edited', 'Edited {subject}', S);
      return running ? t('designer:step.writing', 'Writing {subject}', S) : t('designer:step.wrote', 'Wrote {subject}', S);
    case 'delete_file':
      return running ? t('designer:step.deleting', 'Deleting {subject}', S) : t('designer:step.deleted', 'Deleted {subject}', S);
    case 'check_app':
    case 'check':
      if (running) return t('designer:step.checking', 'Checking the app');
      return (row.count ?? 0) === 0
        ? t('designer:step.checkedClean', 'Checked the app — no errors')
        : t('designer:step.checkedErrors', '{count, plural, one {Checked the app — # error} other {Checked the app — # errors}}', { count: row.count ?? 0 });
    case 'build_sides':
    case 'build':
      if (running) return t('designer:step.building', 'Building the screens');
      if (row.state === 'failed') return t('designer:step.buildFailed', 'The screens did not build');
      return row.count === 0 ? t('designer:step.noScreens', 'No screens to build') : t('designer:step.built', 'Built the screens');
    case 'apply_app':
    case 'apply':
      if (running) return t('designer:step.applying', 'Applying the app');
      return row.state === 'failed' ? t('designer:step.notApplied', 'Not applied') : t('designer:step.applied', 'Applied to the database');
    case 'run_tests':
      if (running) return t('designer:step.testing', 'Running the app’s tests');
      return row.state === 'failed' ? t('designer:step.testsFailed', 'Tests failed') : t('designer:step.testsPassed', 'Tests passed');
    case 'read_reference':
      return running ? t('designer:step.reading', 'Reading {subject}', S) : t('designer:step.read', 'Read {subject}', S);
    case 'list_add_ons':
      return running ? t('designer:step.addOns', 'Looking at the add-ons') : t('designer:step.addOnsDone', 'Looked at the add-ons');
    case 'add_side':
      return running ? t('designer:step.side', 'Adding screens') : t('designer:step.sideDone', 'Added screens');
    case 'set_look':
      if (running) return t('designer:step.look', 'Changing the look');
      return row.state === 'failed' ? t('designer:step.lookFailed', 'The look was not changed') : t('designer:step.lookDone', 'Changed the look');
    case 'build_on_shape':
      if (running) return t('designer:step.shape', 'Building on an add-on');
      return row.state === 'failed' ? t('designer:step.shapeFailed', 'Could not build on the add-on') : t('designer:step.shapeDone', 'Built on an add-on');
    case 'ask_person':
      return running ? t('designer:step.asking', 'Asking you') : t('designer:step.answered', 'You answered');
    case 'get_add_on':
      if (running) return t('designer:step.addOnAsking', 'Asking to get the add-on {subject}', S);
      switch (row.outcome) {
        case 'added':
          return t('designer:step.addOnGot', 'Got the add-on {subject}', S);
        case 'declined':
          return t('designer:step.addOnDeclined', 'Did without the add-on {subject}', S);
        case 'failed':
          return t('designer:step.addOnFailed', 'Could not get the add-on {subject}', S);
        default:
          return t('designer:step.addOnRefused', 'No add-on was got');
      }
    case 'request_package':
      if (running) return t('designer:step.packageAsking', 'Asking to add {subject}', S);
      switch (row.outcome) {
        case 'added':
          return t('designer:step.packageAdded', 'Added {subject}', S);
        case 'declined':
          return t('designer:step.packageDeclined', 'Did without {subject}', S);
        case 'failed':
          return t('designer:step.packageFailed', 'Could not add {subject}', S);
        default:
          return t('designer:step.packageRefused', 'No package added');
      }
    default:
      return row.state === 'failed' && row.ended === 'error' ? t('designer:step.failed', 'This step failed') : row.label;
  }
}

/** A path shown short: the part after the app's own folder. */
export function shortSubject(subject: string): string {
  const parts = subject.split('/');
  return parts[0] === 'apps' && parts.length > 2 ? parts.slice(2).join('/') : subject;
}

/** Seconds, one decimal under ten, whole above. */
export function secondsOf(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? s.toFixed(1) : String(Math.round(s));
}
