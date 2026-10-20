// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every kind of file an app's `rules.file` may name installs: the stored rule
 * takes each name the manifest check takes, digits and all. `mp4` and `mp3`
 * once passed the manifest check and failed the install at its pages step
 * ("invalid override payload for op column.file"), on every engine.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { FILE_COLUMN_KINDS } from '@adminium/manifest';
import { overridesRepo, snapshotsRepo, validateOverrideInput } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';

const CLIP = { accept: ['mp4', 'mp3', 'pdf'], maxBytes: 25 * 1024 * 1024 };
const TAKES = { accept: ['mp4', 'webm', 'mp3', 'wav', 'ogg'], maxBytes: 8 * 1024 * 1024, maxCount: 4 };

/** A deliverable's file (one) and its takes (a list), each taking video and sound. */
function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'deliverables',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'title', type: 'text', maxLength: 120 },
          { ref: 'file', type: 'text', maxLength: 64, nullable: true, rules: { file: CLIP } },
          { ref: 'takes', type: 'json', nullable: true, rules: { file: TAKES } },
        ],
      },
    ]),
    compatibility: { minAdminiumVersion: '0.3.28' },
    pages: [{ ref: 'studio-deliverables', template: 'page-crud', title: { key: 't', fallback: 'Deliverables' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deliverables' } }],
  };
}

describe('a stored file rule', () => {
  it('takes every kind of file the manifest check takes', () => {
    const value = { accept: [...FILE_COLUMN_KINDS], maxBytes: 1024, maxCount: 2 };
    expect(() => validateOverrideInput({ connectionId: 'c', op: 'column.file', tableName: 't', columnName: 'f', value, origin: 'app' } as never)).not.toThrow();
    for (const kind of ['', 'MP4', '4k', 'a', 'mpeg-4', 'x'.repeat(11)]) {
      expect(() => validateOverrideInput({ connectionId: 'c', op: 'column.file', tableName: 't', columnName: 'f', value: { accept: [kind], maxBytes: 1024 }, origin: 'app' } as never), kind).toThrow(/invalid override payload/);
    }
  });
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`an app's file column that takes video and sound, on ${dialect}`, () => {
    let h: InvoicingHarness & { reply: Record<string, unknown> };

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest());
    }, 120_000);
    afterAll(async () => h?.close());

    it('installs, and keeps the kinds as the app wrote them', async () => {
      expect((h.reply['rules'] as { skipped: unknown[] }).skipped).toEqual([]);
      const stored = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.origin === 'app' && o.op === 'column.file');
      const ruleOf = (column: string) => stored.find((o) => o.columnName === column)?.value;
      expect(ruleOf('file')).toEqual(CLIP);
      expect(ruleOf('takes')).toEqual(TAKES);

      const model = applyOverrides(parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema), stored);
      const table = model.tables.find((t) => t.name === h.real('deliverables'))!;
      expect(table.columns.find((c) => c.name === 'file')!.file).toEqual(CLIP);
      expect(table.columns.find((c) => c.name === 'takes')!.file).toEqual(TAKES);
    });
  });
}
