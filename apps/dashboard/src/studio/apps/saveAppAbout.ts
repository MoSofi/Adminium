// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app: what the app is called, checked before the server is asked.
 *
 * The server refuses a version saved before or older than the last, a key
 * another database saved, and a key that is not a key. Saying so beside the
 * field, from the saves this page already lists, keeps the person from
 * meeting those as errors at the end. A key an app of adminium.dev uses is
 * refused here too: installed elsewhere, the two would clash.
 */
import { t } from '../../i18n/t.js';
import type { AppSaveRow } from './saveAppApi.js';
import { compareVersions, nextVersionAfter } from './saveAppApi.js';
import { KEY_PATTERN, VERSION_PATTERN, type SaveDraft } from './saveAppDraft.js';

/** The saves of one key, newest version first. */
export function savesOf(key: string, saves: readonly AppSaveRow[]): AppSaveRow[] {
  return saves.filter((save) => save.key === key).sort((a, b) => compareVersions(b.version, a.version));
}

/** The version a save of `key` takes when none is typed: the last + 1, else 1.0.0. */
export function nextVersionFor(key: string, saves: readonly AppSaveRow[]): string {
  const last = savesOf(key, saves)[0];
  return last === undefined ? '1.0.0' : nextVersionAfter(last.version);
}

export interface AboutProblems {
  name?: string;
  key?: string;
  version?: string;
  label?: string;
}

/** An address rather than a name: a scheme, or a host with dots and no spaces. */
export function looksLikeAddress(label: string): boolean {
  const value = label.trim();
  return /:\/\//.test(value) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(value);
}

/** What stops the save, by field; null when nothing does. */
export function aboutProblems(draft: SaveDraft, saves: readonly AppSaveRow[], connectionId: string | null, catalogKeys: ReadonlySet<string> = new Set()): AboutProblems | null {
  const out: AboutProblems = {};
  if (draft.name.trim() === '') out.name = t('studio:saveApp.about.nameMissing', 'Give the app a name.');
  if (!KEY_PATTERN.test(draft.key)) {
    out.key = t('studio:saveApp.about.keyShape', 'A key is 2 to 80 lower-case letters, digits and -, starting with a letter.');
  } else if (catalogKeys.has(draft.key)) {
    out.key = t('studio:saveApp.about.keyTaken', 'That key belongs to an app on adminium.dev. Pick another.');
  } else if (saves.some((save) => save.key === draft.key && save.connectionId !== null && save.connectionId !== connectionId)) {
    out.key = t('studio:saveApp.about.keyElsewhere', 'That key was saved from another database. Pick another.');
  }
  if (draft.version !== null) {
    const last = savesOf(draft.key, saves)[0];
    if (!VERSION_PATTERN.test(draft.version)) {
      out.version = t('studio:saveApp.about.versionShape', 'A version is three numbers, like 1.2.0.');
    } else if (savesOf(draft.key, saves).some((save) => save.version === draft.version)) {
      out.version = t('studio:saveApp.about.versionSaved', '{version} was already saved. A saved version can’t be saved again.', { version: draft.version });
    } else if (last !== undefined && compareVersions(draft.version, last.version) < 0) {
      out.version = t('studio:saveApp.about.versionOlder', '{version} is older than {last}, the last one saved. Use a higher version.', { version: draft.version, last: last.version });
    }
  }
  if (looksLikeAddress(draft.label)) out.label = t('studio:saveApp.about.labelAddress', 'That looks like an address. Use a name, not an address.');
  return Object.keys(out).length === 0 ? null : out;
}
