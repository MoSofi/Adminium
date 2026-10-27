// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's words, held to the catalogues and to the parts' own code.
 *
 * Two ways a part on an app's screen could end up speaking English to
 * everybody, and both fail here: a words file that no longer says what the
 * catalogue says (somebody changed a text and did not run
 * `scripts/gen-kit-words.mjs`), and a part whose code asks for a key that
 * `words/keys.json` does not list for it.
 *
 * The second is read from source, so it sees only the files listed in
 * `PART_SOURCES`. A part that grows a file adds it there; the mounted tests
 * (kit-host.test.tsx) catch at run time what a missing line here lets by.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { KitPartName } from './contract.js';
import { KIT_LOCALES, loadKitWords } from './words.js';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const repo = '../../../../';

const KEYS = JSON.parse(read('./words/keys.json')) as Record<KitPartName, string[]>;

/** The source files whose words each part shows. */
const PART_SOURCES: Record<KitPartName, string[]> = {
  mentions: ['apps/dashboard/src/kit-host/parts/mentions.tsx', 'packages/widgets/src/families/forms/MentionTextarea.tsx', 'packages/ui/src/components/textarea/Textarea.tsx'],
  board: [
    'apps/dashboard/src/kit-host/parts/board.tsx',
    'packages/widgets/src/families/boards/KanbanBoard.tsx',
    'packages/widgets/src/families/boards/BoardCard.tsx',
    'packages/widgets/src/families/boards/CardActions.tsx',
    'packages/widgets/src/families/boards/InlineComposeCard.tsx',
    'packages/widgets/src/families/boards/board-dnd.tsx',
    'packages/ui/src/components/avatar/Avatar.tsx',
    'packages/ui/src/components/button/Button.tsx',
    'packages/ui/src/components/empty-state/EmptyState.tsx',
    'packages/ui/src/components/icon-tile/IconTile.tsx',
    'packages/ui/src/components/mono-text/MonoText.tsx',
    'packages/ui/src/components/progress-bar/ProgressBar.tsx',
    'packages/ui/src/components/spinner/Spinner.tsx',
    'packages/ui/src/components/tag/Tag.tsx',
  ],
  map: [
    'apps/dashboard/src/kit-host/parts/map.tsx',
    'packages/widgets/src/families/geo/MapBubble.tsx',
    'packages/widgets/src/families/geo/StatusNote.tsx',
    'packages/ui/src/components/button/Button.tsx',
    'packages/ui/src/components/empty-state/EmptyState.tsx',
    'packages/ui/src/components/icon-tile/IconTile.tsx',
    'packages/ui/src/components/spinner/Spinner.tsx',
  ],
  import: [
    'apps/dashboard/src/kit-host/parts/import.tsx',
    'apps/dashboard/src/data-io/ImportWizard.tsx',
    'packages/widgets/src/templates/page-wizard/PageWizard.tsx',
    'packages/widgets/src/families/media/UploadDropzone.tsx',
    'packages/widgets/src/families/forms/MappingTable.tsx',
    'packages/widgets/src/families/forms/IssuesList.tsx',
    'packages/ui/src/components/alert/Alert.tsx',
    'packages/ui/src/components/badge/Badge.tsx',
    'packages/ui/src/components/button/Button.tsx',
    'packages/ui/src/components/checkbox/Checkbox.tsx',
    'packages/ui/src/components/empty-state/EmptyState.tsx',
    'packages/ui/src/components/icon-tile/IconTile.tsx',
    'packages/ui/src/components/input/Input.tsx',
    'packages/ui/src/components/mono-text/MonoText.tsx',
    'packages/ui/src/components/progress-bar/ProgressBar.tsx',
    'packages/ui/src/components/select/Select.tsx',
    'packages/ui/src/components/spinner/Spinner.tsx',
    'packages/ui/src/components/textarea/Textarea.tsx',
  ],
  signature: ['apps/dashboard/src/kit-host/parts/signature.tsx', 'apps/dashboard/src/kit-host/parts/file-words.ts'],
  photos: ['apps/dashboard/src/kit-host/parts/photos.tsx', 'apps/dashboard/src/kit-host/parts/file-words.ts'],
  consent: [
    'apps/dashboard/src/kit-host/parts/consent.tsx',
    'apps/dashboard/src/consent/ConsentPanel.tsx',
    'apps/dashboard/src/consent/consentWords.ts',
  ],
};

function catalogueText(tag: string, key: string): unknown {
  const [ns, path] = key.split(':') as [string, string];
  let node: unknown = JSON.parse(read(`${repo}packages/i18n/locales/${tag}/${ns}.json`));
  for (const step of path.split('.')) node = (node as Record<string, unknown> | null)?.[step];
  return node;
}

describe('the kit’s words', () => {
  it('has the eight languages', () => {
    expect([...KIT_LOCALES].sort()).toEqual(['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW']);
  });

  it.each(KIT_LOCALES)('%s holds every key of every part, as the catalogue says it', async (tag) => {
    const { words } = await loadKitWords(tag);
    expect(words).not.toBeNull();
    for (const [part, keys] of Object.entries(KEYS)) {
      expect(Object.keys(words![part as KitPartName]).sort(), `${tag} ${part}`).toEqual([...keys].sort());
      for (const key of keys) {
        const text = catalogueText(tag, key);
        expect(typeof text, `${tag} has no ${key}`).toBe('string');
        expect(words![part as KitPartName][key], `${tag} ${key}: run scripts/gen-kit-words.mjs`).toBe(text);
      }
    }
  });

  it.each(Object.keys(PART_SOURCES) as KitPartName[])('the code of "%s" asks for no key outside its set', (part) => {
    const asked = new Set<string>();
    for (const file of PART_SOURCES[part]) {
      // `tRef.current(` is the same translator, read through a ref by a callback that outlives a render (MapBubble).
      for (const found of read(repo + file).matchAll(/\b(?:t|tRef\.current)\(\s*['"`]([A-Za-z]+:[\w.-]+)['"`]/g)) asked.add(found[1]!);
    }
    expect([...asked].filter((key) => !KEYS[part].includes(key))).toEqual([]);
    // And none listed that nothing asks for: a key carried in eight languages for nobody.
    expect(KEYS[part].filter((key) => !asked.has(key))).toEqual([]);
  });
});
