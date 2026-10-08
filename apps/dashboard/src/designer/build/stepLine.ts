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
    case 'sight':
      return t('designer:step.looked', 'Looked at {subject} after it built', S);
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
    case 'add_ui_part':
      if (running) return t('designer:step.partsAdding', 'Adding ready-made parts');
      return row.state === 'failed' ? t('designer:step.partsFailed', 'No ready-made parts were added') : t('designer:step.partsAdded', 'Added ready-made parts');
    case 'name_app':
      if (running) return t('designer:step.naming', 'Naming the app');
      return row.state === 'failed' || row.subject === undefined ? t('designer:step.notNamed', 'The app was not named') : t('designer:step.named', 'Named the app {subject}', S);
    case 'find_pictures':
      if (running) return t('designer:step.picturesLooking', 'Looking for pictures');
      switch (row.outcome) {
        case 'added':
          return t('designer:step.picturesAdded', 'Pictures added: {count}', { count: row.count ?? 0 });
        case 'declined':
          return t('designer:step.picturesDeclined', 'Did without pictures');
        case 'failed':
          return t('designer:step.picturesFailed', 'Could not add pictures');
        default:
          return t('designer:step.picturesRefused', 'No pictures added');
      }
    case 'set_style':
      if (running) return t('designer:step.style', 'Changing the style');
      if (row.state === 'failed') return t('designer:step.styleFailed', 'The style was not changed');
      return row.look === undefined ? t('designer:style.change', 'Change the style') : t('designer:step.styleDone', 'Changed the style to {style}', { style: row.look });
    case 'list_styles':
      return running ? t('designer:step.styles', 'Looking at the styles') : t('designer:step.stylesDone', 'Looked at the styles');
    case 'set_look':
      if (running) return t('designer:step.look', 'Changing the look');
      return row.state === 'failed' ? t('designer:step.lookFailed', 'The look was not changed') : t('designer:step.lookDone', 'Changed the look');
    case 'build_on_shape':
    case 'post_to_ledger':
      if (running) return t('designer:step.shape', 'Building on an add-on');
      return row.state === 'failed' ? t('designer:step.shapeFailed', 'Could not build on the add-on') : t('designer:step.shapeDone', 'Built on an add-on');
    case 'ask_person':
      return running ? t('designer:step.asking', 'Asking you') : t('designer:step.answered', 'You answered');
    case 'read_attachment':
      return running ? t('designer:step.fileReading', 'Reading the attached file') : row.state === 'failed' ? t('designer:step.fileNotRead', 'Could not read the attached file') : t('designer:step.fileRead', 'Read the attached file');
    case 'load_rows':
      if (running) return t('designer:step.rowsAsking', 'Asking to load the file’s rows');
      switch (row.outcome) {
        case 'added':
          return t('designer:step.rowsLoaded', '{count, plural, one {Loaded # row} other {Loaded # rows}}', { count: row.count ?? 0 });
        case 'declined':
          return t('designer:step.rowsDeclined', 'The rows were not loaded');
        case 'failed':
          return t('designer:step.rowsFailed', 'Could not load the rows');
        default:
          return t('designer:step.rowsRefused', 'No rows loaded');
      }
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
      // Everything a step needs, on one card: no one name to say. (A session of before the list named one package.)
      if (row.subject === undefined) {
        if (running) return t('designer:step.needsAsking', 'Asking for what the design needs');
        switch (row.outcome) {
          case 'added':
            return t('designer:step.needsAdded', 'Added what the design needs');
          case 'declined':
            return t('designer:step.needsNone', 'Did without them');
          case 'failed':
            return t('designer:step.needsFailed', 'Could not add what the design needs');
          default:
            return t('designer:step.needsRefused', 'Nothing to ask for');
        }
      }
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
    case 'allow_picture_site':
      if (running) return t('designer:step.pictureSiteAsking', 'Asking to allow pictures from {subject}', S);
      switch (row.outcome) {
        case 'added':
          return t('designer:step.pictureSiteAllowed', 'Allowed pictures from {subject}', S);
        case 'declined':
          return t('designer:step.pictureSiteDeclined', 'Did without pictures from {subject}', S);
        case 'failed':
          return t('designer:step.pictureSiteFailed', 'Could not allow pictures from {subject}', S);
        default:
          return t('designer:step.pictureSiteRefused', 'No picture site allowed');
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
