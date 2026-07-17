/**
 * The "Require login on this device" answer (11-electron.md §5), read and
 * written through the preload bridge.
 *
 * ─── Why the bridge and not the API ──────────────────────────────────────────
 *
 * `config.json` is the source of truth for `singleUser` (§2.3: the main process
 * owns that file), and the server's `adminium_settings.desktop.singleUser` — the
 * value the §5 route actually gates on — is a MIRROR the server writes at boot
 * from the env block. So the only correct place to write this answer is the file,
 * through `setConfig`; writing the mirror instead would produce a value that the
 * next launch silently overwrites, i.e. a toggle that appears to work and does
 * not. This is exactly §5's promised behavior: "turning on 'Require login on this
 * device' lands on the standard login screen ON NEXT LAUNCH".
 *
 * This is also the reason `lib/desktop-runtime.ts`'s "gate features on the
 * SERVER, use the bridge only for native affordances" rule points this way and
 * not at `system/info`: `config.json` IS a native affordance — a file on this
 * machine that only the main process can read or write. The server cannot answer
 * a question about it that the next boot has not already asked.
 */
import { getDesktopApi, isDesktopRuntime } from '../lib/desktop-runtime.js';

export { isDesktopRuntime };

/**
 * The current answer, or `null` when there is no bridge to ask.
 * `singleUser: true` = "skip login on this computer" = auto-login allowed.
 */
export async function readSingleUser(): Promise<boolean | null> {
  const api = getDesktopApi();
  if (api === null) return null;
  return (await api.getRuntimeInfo()).singleUser;
}

/**
 * Write the answer to `config.json`.
 *
 * Note the inversion at the call site: the TOGGLE is "Require login on this
 * device", the CONFIG is `singleUser` ("skip login"). They are opposites, and the
 * flip lives in exactly one place — here — rather than in each component that
 * touches it.
 */
export async function setRequireLogin(requireLogin: boolean): Promise<void> {
  const api = getDesktopApi();
  if (api === null) throw new Error('the desktop bridge is unavailable');
  await api.setConfig({ singleUser: !requireLogin });
}
