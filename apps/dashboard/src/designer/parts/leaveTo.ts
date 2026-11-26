// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Leave the Designer for another page of this server, by a full load: Studio
 * reads where it was opened (`/studio/apps#app=<key>`) as it starts. On its
 * own so a test of a page that leaves can see where to, without leaving.
 */
export function leaveTo(path: string): void {
  window.location.assign(path);
}
