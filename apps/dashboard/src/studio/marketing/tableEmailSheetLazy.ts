// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The table's e-mail sheet, loaded when it is first opened: the send dialog
 * (and any other screen) renders this inside a `<Suspense>`, never the sheet
 * itself, so none of it reaches a screen's chunk before it is asked for. The
 * sheet waits for the Studio's words itself.
 */
import { lazy } from 'react';

export const TableEmailSheetLazy = lazy(async () => ({ default: (await import('./TableEmailSheet.js')).TableEmailSheet }));
