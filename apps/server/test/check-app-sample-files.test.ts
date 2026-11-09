// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FOLDER CHECK OF A SAMPLE'S FILES says what adding the sample would
 * refuse (`apps/sample-files.ts`, which both ask): a file that is not the one
 * its sha256 names, an SVG the cleaner will not keep, a file over its kind's
 * public cap or a column's `maxBytes`, and — read whole by
 * `checkAppWithFiles` — a model that is not the kind its name says.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkApp, checkAppWithFiles } from '../src/project/apps/check-app.js';
import { binaryStl, goodGlb } from './model-files.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-app-sample-files-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
const id = { ref: 'id', type: 'int', role: 'pk' };

/** A shop whose own parts each carry a preview model, a cut file and a print model, and a sample that gives them these files. */
function app(files: Record<string, string | Buffer>, assets: Record<string, string>, row: Record<string, unknown>, floor = '0.3.51'): void {
  const manifest = {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'local', name: 'Local' },
    license: 'UNLICENSED',
    description: { key: 'shop.description', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: floor },
    frontends: [{ side: 'staff', kind: 'none' }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'parts',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80, nullable: true },
            { ref: 'model', type: 'text', maxLength: 600, nullable: true, rules: { file: { accept: ['glb'], maxBytes: 64 * 1024 * 1024 } } },
            { ref: 'cut', type: 'text', maxLength: 600, nullable: true, rules: { file: { accept: ['svg'], maxBytes: 2 * 1024 * 1024 } } },
            { ref: 'print', type: 'text', maxLength: 600, nullable: true, rules: { file: { accept: ['stl'], maxBytes: 1024 } } },
          ],
        },
      ],
    },
    pages: [{ ref: 'shop-parts', template: 'page-crud', title: { key: 'shop.parts', fallback: 'Parts' }, nav: { group: 'manifest:shop', icon: 'box', order: 1 }, bindings: { main: 'parts' } }],
    sampleData: { file: 'seeds/sample.json' },
  };
  const sample = {
    format: 'adminium.sample/1',
    app: 'shop',
    assets: Object.fromEntries(Object.entries(assets).map(([label, file]) => [label, { file, sha256: sha(files[file] ?? '') }])),
    tables: [{ ref: 'parts', rows: [{ name: 'Box', ...row }] }],
  };
  const all: Record<string, string | Buffer> = {
    'apps/shop/manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'apps/shop/seeds/sample.json': `${JSON.stringify(sample, null, 2)}\n`,
    ...Object.fromEntries(Object.entries(files).map(([path, bytes]) => [`apps/shop/${path}`, bytes])),
  };
  for (const [path, bytes] of Object.entries(all)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
}

const opts = { version: '0.3.51' };
const errors = (findings: readonly { level: string; message: string }[]) => findings.filter((finding) => finding.level === 'error').map((finding) => finding.message);
const said = async () => errors((await checkAppWithFiles(root, 'shop', opts)).findings);

describe("the folder check of a sample's files", () => {
  it('takes a good model, an SVG the cleaner keeps (its script dropped) and a print model within its column', async () => {
    const cut = `<svg ${SVG_NS} viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><rect width="10" height="10"/></svg>`;
    app({ 'seeds/box.glb': goodGlb(), 'seeds/box.svg': cut, 'seeds/box.stl': binaryStl(1) }, { model: 'seeds/box.glb', cut: 'seeds/box.svg', print: 'seeds/box.stl' }, {
      model: { '@asset': 'model' },
      cut: { '@asset': 'cut' },
      print: { '@asset': 'print' },
    });
    expect(await said()).toEqual([]);
  });

  it('holds the floor at the release that gives a sample row an SVG or a model', async () => {
    app({ 'seeds/box.glb': goodGlb() }, { model: 'seeds/box.glb' }, { model: { '@asset': 'model' } }, '0.3.50');
    expect(await said()).toEqual([
      'gives an SVG or a model file to a sample row ("sampleData.productAssets"), which Adminium 0.3.51 and later add, and compatibility.minAdminiumVersion is 0.3.50: set it to 0.3.51 or later.',
    ]);
    // A sample with no such file keeps the floor it had.
    app({}, {}, {}, '0.3.43');
    expect(await said()).toEqual([]);
  });

  it('says a file is not the one its sha256 names', async () => {
    app({ 'seeds/box.glb': goodGlb() }, { model: 'seeds/box.glb' }, { model: { '@asset': 'model' } });
    writeFileSync(join(root, 'apps/shop/seeds/box.glb'), goodGlb(4096));
    expect(await said()).toEqual([`is not the sha256 of seeds/box.glb, which is ${sha(goodGlb(4096))}.`]);
  });

  it('says an SVG the cleaner refuses, as the add would', async () => {
    for (const svg of [`<svg ${SVG_NS}><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject></svg>`, `<svg ${SVG_NS}><use href="https://evil.example/a.svg#a"/></svg>`]) {
      app({ 'seeds/box.svg': svg }, { cut: 'seeds/box.svg' }, { cut: { '@asset': 'cut' } });
      const [message, ...more] = await said();
      expect(more).toEqual([]);
      expect(message).toMatch(/^The sample file "seeds\/box\.svg" cannot be kept: This SVG/);
    }
  });

  it('says a model over the public cap, and a file over its column\'s maxBytes', async () => {
    app({ 'seeds/box.glb': goodGlb(31 * 1024 * 1024) }, { model: 'seeds/box.glb' }, { model: { '@asset': 'model' } });
    expect(errors(checkApp(root, 'shop', opts).findings)).toEqual(["The sample file \"seeds/box.glb\" is 31 MB. Every visitor's browser loads a file of its kind, so it can be at most 30 MB."]);
    app({ 'seeds/box.stl': binaryStl(30) }, { print: 'seeds/box.stl' }, { print: { '@asset': 'print' } });
    expect(await said()).toEqual(['names seeds/box.stl, 1584 bytes, and "parts.print" takes files of at most 1024 bytes.']);
  });

  it('says a model that is not the kind its name says, once it is read whole', async () => {
    app({ 'seeds/box.glb': 'not a model at all', 'seeds/box.stl': 'solid part\nendsolid part\n' }, { model: 'seeds/box.glb', print: 'seeds/box.stl' }, {
      model: { '@asset': 'model' },
      print: { '@asset': 'print' },
    });
    // The quick check cannot tell: it reads no model whole.
    expect(errors(checkApp(root, 'shop', opts).findings)).toEqual([]);
    expect(await said()).toEqual([
      'The sample file "seeds/box.glb" is not the GLB model its name says.',
      'The sample file "seeds/box.stl" cannot be kept: This is not an STL model: it is neither a binary STL of the size its header says nor a text STL.',
    ]);
  });
});
