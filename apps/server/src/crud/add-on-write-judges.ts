// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH TABLES AN INSTALLED ADD-ON HOLDS A WRITE TO, as the write service
 * asks it ({@link WriteServiceOptions}): a forms add-on's answers and files,
 * a chat add-on's conversations, a lead source add-on's people found and
 * its fields' sources, and a landing pages add-on's pages.
 *
 * What is installed is read from the meta store (one query, the install
 * stamp) only where it must be: once for a person's write, by the
 * own-records check that runs first; the landing seal then asks what was
 * read a moment ago. A write to an ordinary table, of one row or a whole
 * file of rows, pays one read, not one more per row.
 */
import type { AddOnInstallsKeeper } from '../apps/table-ref.js';
import { chatOwnTable } from '../chat/transcripts.js';
import { formsOwnTable } from '../forms/files.js';
import { landingPagesTable } from '../landing/seal.js';
import { leadsOwnTable } from '../leads/installs.js';
import type { WriteServiceOptions } from './write-service.js';

export function addOnWriteJudges(installs: Pick<AddOnInstallsKeeper, 'fresh' | 'current'>): Required<Pick<WriteServiceOptions, 'ownRecords' | 'sealedRecords' | 'landingPages'>> {
  return {
    // A forms add-on's answers and their files, a chat add-on's own tables, and an add-on's people found and its
    // fields' sources (the engine writes them as a person is kept, told and erased, `leads/`): written by Adminium alone.
    ownRecords: async (connectionId, tableId) => {
      const now = await installs.fresh();
      return formsOwnTable(now, connectionId, tableId) || chatOwnTable(now, connectionId, tableId) || leadsOwnTable(now, connectionId, tableId);
    },
    // The chat and found people tables are not a person's to delete either: only the keeping sweeps and an erasure remove them.
    sealedRecords: async (connectionId, tableId) => {
      const now = await installs.fresh();
      return chatOwnTable(now, connectionId, tableId) || leadsOwnTable(now, connectionId, tableId);
    },
    // A landing pages add-on's pages: what `ownRecords` read on this write is asked again, else what is installed is read now.
    landingPages: async (connectionId, tableId, askedJustNow) => landingPagesTable(askedJustNow === true ? installs.current() : await installs.fresh(), connectionId, tableId),
  };
}
