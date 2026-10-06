// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LIMITS AN ADD-ON'S DECIDING CODE IS HELD TO, BY THEIR NUMBERS.
 *
 * An add-on's author writes against these: how long the code may think, how
 * large its file and its answer may be, how many rows a read may bring and a
 * plan may write. Each is enforced where it applies, by tests that name the
 * constant — so a constant quietly changed would pass every one of them.
 * Here the numbers themselves are held, and the copies kept in more than one
 * package are held to each other.
 */
import { POSTING_ROWS_MAX } from '@adminium/add-on-contracts';
import * as manifest from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import * as decide from '../src/add-ons/decide.js';
import * as reads from '../src/crud/ledger-reads.js';
import { WORDS_IDS_MAX } from '../src/crud/ledger-write.js';

describe('the limits an add-on\'s deciding code is held to', () => {
  it('are the numbers the contract says', () => {
    expect({
      timeout: decide.DECIDER_TIMEOUT_MS,
      warn: decide.DECIDER_WARN_MS,
      file: decide.DECIDER_FILE_MAX,
      output: decide.DECIDER_OUTPUT_MAX,
      readsAnAction: decide.LEDGER_READS_MAX,
      rowsARead: decide.LEDGER_READ_ROWS,
      rowsAllReads: decide.LEDGER_READ_ROWS_ALL,
      rowsWritten: decide.LEDGER_ROWS_WRITTEN,
      postingsATable: decide.POSTINGS_PER_TABLE,
      wordsRows: decide.WORDS_IDS_MAX,
    }).toEqual({
      timeout: 250,
      warn: 50,
      file: 512 * 1024,
      output: 2 * 1024 * 1024,
      readsAnAction: 6,
      rowsARead: 1000,
      rowsAllReads: 3000,
      rowsWritten: 500,
      postingsATable: 6,
      wordsRows: 60,
    });
  });

  it('are the same number wherever a package keeps its own copy', () => {
    // What the write path reads with, and what a manifest and an answer are checked against.
    expect([reads.LEDGER_READ_ROWS, manifest.LEDGER_READ_ROWS]).toEqual([decide.LEDGER_READ_ROWS, decide.LEDGER_READ_ROWS]);
    expect(reads.LEDGER_READ_ROWS_ALL).toBe(decide.LEDGER_READ_ROWS_ALL);
    expect(manifest.LEDGER_READS_MAX).toBe(decide.LEDGER_READS_MAX);
    expect(manifest.POSTINGS_PER_TABLE).toBe(decide.POSTINGS_PER_TABLE);
    expect([WORDS_IDS_MAX, manifest.WORDS_IDS_MAX]).toEqual([decide.WORDS_IDS_MAX, decide.WORDS_IDS_MAX]);
    // The rows one plan may write, and the lines one call may carry: as many as each other.
    expect([POSTING_ROWS_MAX, reads.LEDGER_LINES_MAX]).toEqual([decide.LEDGER_ROWS_WRITTEN, decide.LEDGER_ROWS_WRITTEN]);
  });
});
