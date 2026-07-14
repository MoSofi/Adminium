/**
 * Clipboard + download side-effects for the BYO enrichment screens
 * (06-llm-assist.md §10.2 step 4). Kept tiny and DOM-guarded so the pure
 * `enrichState.ts` stays side-effect-free and the components stay declarative.
 *
 * BYO is telemetry-free (§9): both helpers stay entirely in-process — the
 * clipboard write and the object-URL download never touch the network.
 */

/** Copy text to the clipboard; resolves `false` when the API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return navigator.clipboard !== undefined;
  } catch {
    return false;
  }
}

/** Trigger a client-side download of `text` as `fileName` (no network). */
export function downloadTextFile(fileName: string, text: string, mime = 'text/markdown'): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
