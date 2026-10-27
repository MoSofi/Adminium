// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The campaign screens, loaded when the editor first draws one: the editor
 * renders these inside a `<Suspense>`, never the screens themselves, so
 * nothing of them (nor the Studio's words, which each waits for) reaches the
 * editor's chunk before a campaign asks for it.
 */
import { lazy } from 'react';

export const SendCampaignModalLazy = lazy(async () => ({ default: (await import('./SendCampaignModal.js')).SendCampaignModalWithWords }));
export const RunControlsLazy = lazy(async () => ({ default: (await import('./RunControls.js')).RunControls }));
export const CampaignBarLazy = lazy(async () => ({ default: (await import('./CampaignBar.js')).CampaignBar }));
export const SendLogLazy = lazy(async () => ({ default: (await import('./SendLog.js')).SendLog }));
export const LockedFooterCanvasLazy = lazy(async () => ({ default: (await import('./LockedFooter.js')).LockedFooterCanvas }));
export const LockedFooterRowsLazy = lazy(async () => ({ default: (await import('./LockedFooter.js')).LockedFooterRows }));
