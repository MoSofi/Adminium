// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The bridge as these pages see it. They are loaded only by the app, so the
 * bridge is always there; a missing one is a build that was put together wrong,
 * and saying so beats a page of dead buttons.
 */
import type { AdminiumDesktopApi, DesktopStartApi } from '../../preload/api.js';

export function desktopApi(): AdminiumDesktopApi {
  const api = window.adminiumDesktop;
  if (api === undefined) throw new Error('The Adminium desktop bridge is missing from this page.');
  return api;
}

export const startApi = (): DesktopStartApi => desktopApi().start;
