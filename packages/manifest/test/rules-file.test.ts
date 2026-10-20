// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A column that holds files (`rules.file`), as the manifest check reads it:
 * one file's id in a text column, a list of them in a json column with how
 * many it may hold, the kinds it takes by name (never SVG, never HEIC), a
 * size, no rule of Adminium's deciding the value as well, no public write of
 * it, and a manifest that uses it asks for the release that runs it.
 */
import { describe, expect, it } from 'vitest';

import { FILE_COLUMN_KINDS, PICTURE_FILE_KINDS, installFloorWords, sampleBundleIssues, sampleBundleSchema, validateManifest, WORD_FLOORS } from '../src/index.js';

const en = (text: string) => ({ 'en-US': text });

const SIGNATURE = { accept: ['png'], maxBytes: 512 * 1024 };
const PHOTOS = { accept: ['jpeg', 'png', 'webp'], maxBytes: 8 * 1024 * 1024, maxCount: 6 };

/** A sign-off with a signature and photos; `over` replaces either column, `publicAccess` is added as given. */
function signOffs(over: { signature?: Record<string, unknown>; photos?: Record<string, unknown> } = {}, more: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crew',
    name: 'Crew',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crew.desc', fallback: 'Crew.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'crew', label: en('Crew'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'sign_offs',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'signer_name', type: 'text', maxLength: 120 },
            { ref: 'signature', type: 'text', maxLength: 64, nullable: true, rules: { file: SIGNATURE }, ...over.signature },
            { ref: 'photos', type: 'json', nullable: true, rules: { file: PHOTOS }, ...over.photos },
          ],
        },
      ],
    },
    pages: [{ ref: 'crew-sign-offs', template: 'page-crud', title: { key: 't.signoffs', fallback: 'Sign-offs' }, nav: { group: 'crew', icon: 'list', order: 1 }, bindings: { rows: 'sign_offs' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
    ...more,
  };
}

const issuesOf = (doc: Record<string, unknown>): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
};

describe('a column that holds files', () => {
  it('is one file in a text column and a list in a json column, kept as written, and asks for the release that runs it', () => {
    expect(issuesOf(signOffs())).toEqual([]);
    const result = validateManifest(signOffs());
    if (!result.ok || result.manifest.kind !== 'app') throw new Error('expected an app');
    const [, , signature, photos] = result.manifest.requiredSchema.tables[0]!.columns;
    expect(signature!.rules?.file).toEqual(SIGNATURE);
    expect(photos!.rules?.file).toEqual(PHOTOS);
    const words = installFloorWords(signOffs()).filter((found) => found.word === 'column.file');
    expect(words.map((found) => found.path)).toEqual(['requiredSchema.tables.0.columns.2.rules.file', 'requiredSchema.tables.0.columns.3.rules.file']);
    expect(WORD_FLOORS['column.file']).toBe('0.3.28');
    const older = signOffs();
    (older['compatibility'] as Record<string, unknown>)['minAdminiumVersion'] = '0.3.27';
    expect(issuesOf(older).join('\n')).toContain('column.file');
  });

  it('keeps one file in text and a list in json, and says how many a list holds', () => {
    expect(issuesOf(signOffs({ signature: { rules: { file: { ...SIGNATURE, maxCount: 2 } } } })).join('\n')).toContain('a text column holds one file; keep a list of them in a json column');
    expect(issuesOf(signOffs({ signature: { maxLength: 20 } })).join('\n')).toContain("a file's id is 31 characters, so maxLength is at least 31");
    expect(issuesOf(signOffs({ photos: { rules: { file: { accept: ['jpeg'], maxBytes: 4096 } } } })).join('\n')).toContain('say how many files the list may hold (maxCount)');
    expect(issuesOf(signOffs({ signature: { type: 'int', maxLength: undefined } })).join('\n')).toContain('a file is kept in a text column, a list of files in a json column, and "sign_offs.signature" is int');
  });

  it('takes only the kinds the server reads by their bytes, never SVG or HEIC, each once', () => {
    expect(FILE_COLUMN_KINDS).not.toContain('svg');
    expect(FILE_COLUMN_KINDS).not.toContain('heic');
    for (const kind of ['svg', 'heic', 'exe', 'image/png']) {
      expect(issuesOf(signOffs({ signature: { rules: { file: { ...SIGNATURE, accept: [kind] } } } }))).not.toEqual([]);
    }
    expect(issuesOf(signOffs({ signature: { rules: { file: { ...SIGNATURE, accept: [] } } } }))).not.toEqual([]);
    expect(issuesOf(signOffs({ signature: { rules: { file: { ...SIGNATURE, accept: ['png', 'png'] } } } })).join('\n')).toContain('each kind of file is named once');
  });

  it('holds a size from 1 KiB to 25 MiB and a list of 1 to 20, and nothing else', () => {
    expect(issuesOf(signOffs({ signature: { rules: { file: { ...SIGNATURE, maxBytes: 1000 } } } }))).not.toEqual([]);
    expect(issuesOf(signOffs({ signature: { rules: { file: { ...SIGNATURE, maxBytes: 26 * 1024 * 1024 } } } }))).not.toEqual([]);
    expect(issuesOf(signOffs({ signature: { rules: { file: { accept: ['png'] } } } }))).not.toEqual([]);
    expect(issuesOf(signOffs({ photos: { rules: { file: { ...PHOTOS, maxCount: 21 } } } }))).not.toEqual([]);
    expect(issuesOf(signOffs({ photos: { rules: { file: { ...PHOTOS, maxCount: 0 } } } }))).not.toEqual([]);
    expect(issuesOf(signOffs({ photos: { rules: { file: { ...PHOTOS, inline: true } } } }))).not.toEqual([]);
  });

  it('is a value a person uploads, never one a rule of Adminium decides, a default or one no two rows share', () => {
    const told = issuesOf(signOffs({ signature: { rules: { file: SIGNATURE, copy: { via: 'id', from: 'signer_name' } } } })).join('\n');
    expect(told).toContain('a file column holds what a person uploaded, not also copy');
    expect(issuesOf(signOffs({ signature: { rules: { file: SIGNATURE, secret: true } } })).join('\n')).toContain('not also secret');
    expect(issuesOf(signOffs({ signature: { unique: true } })).join('\n')).toContain('a file column holds a file nobody else holds already: it is not also unique');
    expect(issuesOf(signOffs({ signature: { default: 'file_x' } })).join('\n')).toContain('a file column takes no default: a file is uploaded');
    // Personal, and required: both are what a person's file can be.
    expect(issuesOf(signOffs({ signature: { rules: { file: SIGNATURE, personal: true, required: true } } }))).toEqual([]);
  });

  it('is never written by a public entry: a browser key uploads nothing', () => {
    const entry = (extra: Record<string, unknown>) => ({ publicAccess: [{ table: 'sign_offs', methods: ['POST'], ...extra }] });
    expect(issuesOf(signOffs({}, entry({ writable: ['signer_name', 'signature'] }))).join('\n')).toContain('"sign_offs.signature" holds files a signed-in person uploads, so a public write never sets it');
    expect(issuesOf(signOffs({}, entry({ writable: ['signer_name'], defaults: { photos: '[]' } }))).join('\n')).toContain('"sign_offs.photos" holds files a signed-in person uploads, so a public write never sets it');
  });

  it('is left empty by a sample row: no sample brings a file', () => {
    const result = validateManifest(signOffs());
    if (!result.ok) throw new Error('expected a manifest');
    const issues = (row: Record<string, unknown>) => sampleBundleIssues(sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'crew', tables: [{ ref: 'sign_offs', rows: [{ id: 1, signer_name: 'Ada', ...row }] }] }), result.manifest).map((issue) => issue.message);
    expect(issues({ signature: null, photos: [] })).toEqual([]);
    expect(issues({ signature: 'file_01JZZZZZZZZZZZZZZZZZZZZZZZ' })).toContain('"sign_offs.signature" holds files a signed-in person uploads, so a sample row leaves it empty.');
    expect(issues({ photos: ['file_01JZZZZZZZZZZZZZZZZZZZZZZZ'] })).toContain('"sign_offs.photos" holds files a signed-in person uploads, so a sample row leaves it empty.');
  });

  describe('a picture column: an image column whose file rule takes pictures only', () => {
    const PHOTO = { accept: ['png', 'jpeg', 'webp', 'gif'], maxBytes: 2 * 1024 * 1024 };
    /** The sign-offs with a `photo`: text, `semantic: "image"`, and the file rule as given. */
    const withPhoto = (rule: Record<string, unknown> | undefined, more: Record<string, unknown> = {}): Record<string, unknown> => {
      const doc = signOffs({}, more);
      const table = ((doc['requiredSchema'] as { tables: { columns: Record<string, unknown>[] }[] }).tables[0])!;
      table.columns.push({ ref: 'photo', type: 'text', maxLength: 600, nullable: true, semantic: 'image', ...(rule === undefined ? {} : { rules: { file: rule } }) });
      return doc;
    };
    const SHA = 'a'.repeat(64);

    it('takes pictures only, never another kind, and PNG, JPEG, WebP and GIF are the pictures', () => {
      expect(PICTURE_FILE_KINDS).toEqual(['png', 'jpeg', 'webp', 'gif']);
      expect(issuesOf(withPhoto(PHOTO))).toEqual([]);
      expect(issuesOf(withPhoto({ ...PHOTO, accept: ['png', 'pdf'] })).join('\n')).toContain('"sign_offs.photo" is an image column, so its files are pictures: png, jpeg, webp, gif');
      // An image column with no file rule holds links, as it always has.
      expect(issuesOf(withPhoto(undefined))).toEqual([]);
    });

    it('a sample row gives it one of the bundle’s pictures, or leaves it empty: never a file id', () => {
      const result = validateManifest(withPhoto(PHOTO));
      if (!result.ok) throw new Error('expected a manifest');
      const issues = (row: Record<string, unknown>) =>
        sampleBundleIssues(sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'crew', assets: { wings: { file: 'seeds/wings.png', sha256: SHA } }, tables: [{ ref: 'sign_offs', rows: [{ id: 1, signer_name: 'Ada', ...row }] }] }), result.manifest).map((issue) => issue.message);
      expect(issues({ photo: { '@asset': 'wings' } })).toEqual([]);
      expect(issues({ photo: null })).toEqual([]);
      expect(issues({ photo: 'file_01JZZZZZZZZZZZZZZZZZZZZZZZ' })).toContain('"sign_offs.photo" holds a picture: a sample row gives it one of the bundle\'s pictures ({"@asset": …}) or leaves it empty.');
      expect(issues({ photo: { '@asset': 'nope' } })).toContain('"nope" is not one of the bundle’s assets.');
      // A picture-only rule on a column that is no image column still takes nothing from a sample.
      expect(issues({ signature: { '@asset': 'wings' } })).toContain('"sign_offs.signature" holds files a signed-in person uploads, so a sample row leaves it empty.');
    });

    it('is a picture a public entry may show to every visitor', () => {
      const shown = withPhoto(PHOTO, { publicAccess: [{ table: 'sign_offs', methods: ['GET'], select: ['id', 'signer_name', 'photo'], pictures: ['photo'] }] });
      expect(issuesOf(shown)).toEqual([]);
    });
  });
});
