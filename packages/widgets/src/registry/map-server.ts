// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where a map may be drawn from, read off the widget runtime. Apart from
 * `offline.ts` on purpose: that module is in every page's first load (the
 * widget host reads it), and only a map ever asks this.
 */
import { offlineAssetsRequired, type WidgetRuntimeEnv } from './offline.js';

/**
 * The map server a widget may draw from right now: null on the desktop app and
 * under the offline policy whatever the session says, and null while maps are
 * switched off. One read, so no caller can ask a server the policy forbids.
 */
export function mapServerOf(env: WidgetRuntimeEnv): string | null {
  if (offlineAssetsRequired(env)) return null;
  const server = env.maps?.server ?? null;
  return server === null || server.trim() === '' ? null : server;
}
