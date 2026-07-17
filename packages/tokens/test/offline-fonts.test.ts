/**
 * The font half of the offline guarantee (11-electron.md §7, 11-T09).
 *
 * §7's fonts row:
 *
 * > Manrope, JetBrains Mono, IBM Plex Sans Arabic ship as self-hosted woff2 in
 * > `@adminium/tokens` (02-design-system.md). CJK (zh_CN/zh_TW) uses the
 * > system-font fallback stack from 10-i18n-theming.md — no multi-MB CJK font
 * > download, ever.
 *
 * `scripts/check-offline-assets.mjs` covers the negative half of that row — no
 * `fonts.googleapis.com` / `fonts.gstatic.com` in any build output. It cannot
 * cover the positive half: a build with NO font URLs at all passes it perfectly
 * and renders in Helvetica. So this asserts the bytes exist and that fonts.css
 * points at them, which is what makes the desktop app look like Adminium at
 * 30,000 feet rather than merely not crash.
 *
 * Asserted against the FILES ON DISK rather than against copy-fonts.mjs's
 * manifest: the manifest is what the vendoring script INTENDS, and `src/fonts/`
 * is what ships (the package's `files` list includes `src`). Those are the same
 * thing right up until they are not.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const fontsCss = readFileSync(join(SRC, 'fonts.css'), 'utf8');

/** §7's three, and only these three. */
const SELF_HOSTED_FAMILIES = ['IBM Plex Sans Arabic', 'JetBrains Mono', 'Manrope'];

/** `@font-face { … }` blocks, as text. */
function fontFaceBlocks(): string[] {
  return [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1] as string);
}

function familyOf(block: string): string | undefined {
  return /font-family:\s*"([^"]+)"/.exec(block)?.[1];
}

/** Every `src: url(...)` target across all @font-face rules. */
function srcUrls(): string[] {
  return [...fontsCss.matchAll(/src:\s*url\("([^"]+)"\)/g)].map((match) => match[1] as string);
}

/** The `font-family` stack a `html[lang="…"] body` rule sets, split into names. */
function localeStack(lang: string): string[] {
  const rule = new RegExp(`html\\[lang="${lang}"\\]\\s*body\\s*\\{[^}]*font-family:\\s*([^;}]+)`).exec(fontsCss);
  expect(rule, `no body font stack for lang="${lang}"`).not.toBeNull();
  return (rule?.[1] ?? '')
    .split(',')
    .map((name) => name.trim().replace(/^"|"$/g, ''))
    .filter((name) => name !== '');
}

describe('§7 fonts row — the three families are self-hosted woff2', () => {
  it('declares @font-face for exactly Manrope, JetBrains Mono and IBM Plex Sans Arabic', () => {
    const families = [...new Set(fontFaceBlocks().map(familyOf))].sort();
    // Exact, not superset: a fourth @font-face family is either a font nobody
    // approved the download size of, or the CJK bundle §7 rules out. Both are
    // decisions, and both should arrive as a failing test rather than a diff.
    expect(families).toEqual(SELF_HOSTED_FAMILIES);
  });

  it('serves every face from a relative path inside this package — never a URL', () => {
    const urls = srcUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith('./fonts/'), `${url} is not a vendored relative path`).toBe(true);
      expect(/^https?:/i.test(url)).toBe(false);
    }
    // The whole stylesheet, not just the src lines: a preconnect hint or an
    // @import would not match the regex above but would still hit the network.
    expect(/https?:\/\//i.test(fontsCss)).toBe(false);
  });

  it('ships the actual woff2 bytes for every declared face', () => {
    // The failure this exists for: `url()` pointing at a path that copy-fonts
    // never vendored. CSS does not care — the family silently falls back to
    // system-ui, on every locale, and nothing else in the repo notices.
    for (const url of srcUrls()) {
      const file = join(SRC, url.replace(/^\.\//, ''));
      expect(existsSync(file), `${url} is declared in fonts.css but absent from src/`).toBe(true);
      // woff2's magic number. Guards against a truncated/LFS-pointer/HTML-error
      // file being committed in a font's place — all of which "exist".
      expect(readFileSync(file).subarray(0, 4).toString('latin1'), `${url} is not a woff2`).toBe('wOF2');
    }
  });

  it('vendors no font that fonts.css does not declare', () => {
    // The other direction: an orphaned family in src/fonts/ is either dead
    // weight in every installer or — the case §7 cares about — a CJK bundle
    // someone added and wired up later.
    const declared = new Set(srcUrls().map((url) => url.replace(/^\.\/fonts\//, '')));
    const onDisk = readdirSync(join(SRC, 'fonts'), { withFileTypes: true }).flatMap((dir) =>
      dir.isDirectory()
        ? readdirSync(join(SRC, 'fonts', dir.name))
            .filter((file) => file.endsWith('.woff2'))
            .map((file) => `${dir.name}/${file}`)
        : [],
    );
    expect(onDisk.sort()).toEqual([...declared].sort());
  });
});

describe('§7 fonts row — CJK is system fonts, never a bundle', () => {
  const SYSTEM_CJK = {
    'zh-CN': ['Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei'],
    'zh-TW': ['Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei'],
  };

  for (const [lang, expected] of Object.entries(SYSTEM_CJK)) {
    it(`${lang} names only system CJK faces and ends in a generic`, () => {
      const stack = localeStack(lang);
      // Manrope leads (Latin text in a CJK UI stays Manrope); the CJK names that
      // follow are all OS-installed, and none is declared @font-face above — so
      // nothing here can trigger a download.
      expect(stack[0]).toBe('Manrope');
      expect(stack).toEqual(['Manrope', ...expected, 'system-ui', 'sans-serif']);

      const bundled = new Set(fontFaceBlocks().map(familyOf));
      const wouldDownload = stack.filter((name) => name !== 'Manrope' && bundled.has(name));
      // THE ASSERTION §7 ACTUALLY MAKES ("no multi-MB CJK font download, ever").
      // Bundling Noto Sans SC is the open decision in §7's own list (#5) — it
      // needs an owner's approval on the ~10–15 MB installer hit, so it must not
      // be possible to arrive by accident.
      expect(wouldDownload).toEqual([]);
    });
  }

  it('ar-EG gets the bundled Arabic face — the locale that DOES ship one', () => {
    // The control for the two above: "no @font-face family in the stack" is only
    // meaningful if some locale legitimately has one, or the tests would pass on
    // a fonts.css that bundled nothing at all.
    expect(localeStack('ar-EG')).toEqual(['var(--font-arabic)']);
    expect(/--font-arabic:\s*"IBM Plex Sans Arabic"/.test(fontsCss)).toBe(true);
  });
});
