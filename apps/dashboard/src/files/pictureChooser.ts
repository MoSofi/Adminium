// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard's half of "Choose existing…" on a picture column: the lists
 * the picker shows and the copy every choice makes, over the files routes.
 *
 * Two lists. "Used in {page}": the pictures this table's records already
 * show, whoever uploaded them, each one this reader may read. "From the Files
 * page": that page's own uploads, offered only to someone who can open the
 * Files page (they hold `files.manage`); for anyone else the tab is not drawn
 * at all, rather than drawn empty.
 *
 * A choice never points the record at the file it was chosen from: the server
 * copies it for the column (`POST /files/:id/copy`) and answers the value to
 * store, in the column's own shape. Its refusals come back as the words the
 * field says them in.
 */
import { PictureCopyRefused, type PictureChooser, type PickerItem } from '@adminium/widgets';

import { ApiError } from '../app/api.js';
import { copyFile, listLibrary, listUsedIn, type FileDto } from './api.js';

export interface PictureChooserInput {
  connectionId: string;
  /** The page's table, as the page names it. */
  table: string;
  /** What the page is called (else its table's label): "Used in {page}". */
  pageTitle: string;
  /** The table's label, for a refusal. */
  tableLabel: string;
  /** Whether this person can open the Files page: the second tab is theirs only. */
  filesPage: boolean;
}

function itemOf(file: FileDto): PickerItem {
  return {
    id: file.id,
    filename: file.filename,
    mime: file.mime,
    sizeBytes: file.sizeBytes,
    contentPath: file.contentPath,
    ...(file.recordLabel === undefined ? {} : { recordLabel: file.recordLabel }),
  };
}

export function pictureChooser(input: PictureChooserInput): PictureChooser {
  const { connectionId, table } = input;
  return {
    pageTitle: input.pageTitle,
    tableLabel: input.tableLabel,
    usedIn: async ({ column, q }) => (await listUsedIn({ connectionId, table, column, q })).map(itemOf),
    ...(input.filesPage ? { library: async ({ q }: { q: string }) => (await listLibrary({ connectionId, q })).map(itemOf) } : {}),
    copy: async ({ fileId, column }) => {
      try {
        const made = await copyFile({ fileId, connectionId, table, column });
        return { ref: made.ref, file: made.data };
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        // A file this reader may not read, one in the bin and one that is not there are answered alike: gone.
        if (error.status === 404) throw new PictureCopyRefused('gone', error.message);
        if (error.status === 403) throw new PictureCopyRefused('forbidden', error.message);
        if (error.code === 'TYPE_NOT_ACCEPTED') throw new PictureCopyRefused('type', error.message);
        if (error.code === 'TOO_LARGE') {
          const limit = (error.details as { maxBytes?: unknown } | undefined)?.maxBytes;
          throw new PictureCopyRefused('size', error.message, typeof limit === 'number' ? limit : undefined);
        }
        throw error;
      }
    },
  };
}
