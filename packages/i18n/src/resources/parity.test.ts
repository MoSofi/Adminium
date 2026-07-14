/**
 * The canonical hand-authored bundles are locales/en-US/*.json (10 §3.1);
 * the runtime bundles TS mirrors (see index.ts). This test pins the two in
 * lockstep — edit the JSON, run `node scripts/gen-resources.mjs`, done.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EN_US_RESOURCES, NAMESPACES } from './index.js';

const localesDir = join(fileURLToPath(new URL('.', import.meta.url)), '../../locales/en-US');

describe('en-US resource parity', () => {
  for (const ns of NAMESPACES) {
    it(`src/resources/en-us/${ns}.ts mirrors locales/en-US/${ns}.json`, () => {
      const json = JSON.parse(readFileSync(join(localesDir, `${ns}.json`), 'utf8')) as unknown;
      expect(EN_US_RESOURCES[ns]).toEqual(json);
    });
  }
});
