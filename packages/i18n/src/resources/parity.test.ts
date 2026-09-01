// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Locale-bundle parity gate (10-i18n-theming.md §3.5), all 8 locales:
 *
 * 1. TS mirror ≡ canonical JSON for every locale/namespace pair (the JSON is
 *    hand-authored; regenerate mirrors with `node scripts/gen-resources.mjs`).
 * 2. Key-set parity: every locale carries exactly the en-US key set.
 * 3. ICU health: every message parses, its argument NAMES match en-US
 *    exactly, and plural branches only use categories the locale actually
 *    has (`Intl.PluralRules`) — cs one/few/many/other, ar zero…other, zh
 *    other-only — plus the mandatory `other`.
 * 4. zh_CN and zh_TW are genuinely distinct bundles (Simplified vs
 *    Traditional + regional vocabulary), per the M8 risk note in
 *    16-milestones.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';

import { LOCALES } from '../locales.js';
import { EN_US_RESOURCES, NAMESPACES, type ResourceBundle } from './index.js';
import { loadLocaleBundle } from './lazy.js';

const localesDir = join(fileURLToPath(new URL('.', import.meta.url)), '../../locales');

function readJson(tag: string, ns: string): ResourceBundle {
  return JSON.parse(readFileSync(join(localesDir, tag, `${ns}.json`), 'utf8')) as ResourceBundle;
}

async function loadMirror(tag: string, ns: (typeof NAMESPACES)[number]): Promise<ResourceBundle> {
  if (tag === 'en-US') return EN_US_RESOURCES[ns];
  const mod = await loadLocaleBundle(tag, ns);
  if (mod === null) throw new Error(`no lazy bundle registered for ${tag}/${ns}`);
  return mod.default;
}

/** Nested bundle → flat `dot.path` → message map. */
function flatten(bundle: ResourceBundle, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(bundle)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out.set(path, value);
    else flatten(value, path, out);
  }
  return out;
}

/** Minimal @formatjs AST node shape (see icu-format.ts for the runtime use). */
interface IcuNode {
  type: number;
  value?: unknown;
  options?: Record<string, { value: IcuNode[] }>;
  children?: IcuNode[];
}

interface IcuShape {
  /** Argument names, sorted. */
  args: string[];
  /** `argName → selector keywords` for each plural/selectordinal argument. */
  plurals: Map<string, string[]>;
}

/** TYPE enum from @formatjs/icu-messageformat-parser: 1 argument, 2 number, 3 date, 4 time, 5 select, 6 plural, 8 tag. */
function walk(nodes: IcuNode[], args: Set<string>, plurals: Map<string, string[]>): void {
  for (const node of nodes) {
    if (node.type >= 1 && node.type <= 6 && typeof node.value === 'string') args.add(node.value);
    if ((node.type === 5 || node.type === 6) && node.options !== undefined) {
      if (node.type === 6 && typeof node.value === 'string') {
        plurals.set(node.value, Object.keys(node.options).sort());
      }
      for (const option of Object.values(node.options)) walk(option.value, args, plurals);
    }
    if (node.children !== undefined) walk(node.children, args, plurals);
  }
}

/** Parses with the same options the runtime uses (icu-format.ts) and extracts the message's shape. */
function icuShape(message: string, tag: string, key: string): IcuShape {
  const args = new Set<string>();
  const plurals = new Map<string, string[]>();
  try {
    const ast = new IntlMessageFormat(message, tag, undefined, { ignoreTag: true }).getAst() as IcuNode[];
    walk(ast, args, plurals);
  } catch (error) {
    throw new Error(`ICU parse failed for ${tag} "${key}": ${String(error)}`);
  }
  return { args: [...args].sort(), plurals };
}

const TARGET_LOCALES = LOCALES.filter((l) => l.id !== 'en_US');

describe('canonical JSON ↔ TS mirror parity (all 8 locales)', () => {
  for (const locale of LOCALES) {
    for (const ns of NAMESPACES) {
      it(`src/resources/${locale.tag.toLowerCase()}/${ns}.ts mirrors locales/${locale.tag}/${ns}.json`, async () => {
        expect(await loadMirror(locale.tag, ns)).toEqual(readJson(locale.tag, ns));
      });
    }
  }
});

/** `${ns}.${key} → { status }` — the per-locale ledger `scripts/meta.mjs` writes. */
function readLedger(tag: string): Record<string, { status?: string }> {
  return JSON.parse(readFileSync(join(localesDir, tag, '.meta.json'), 'utf8')) as Record<
    string,
    { status?: string }
  >;
}

/**
 * ── KEY-SET PARITY, AND THE ONE WAY A KEY MAY BE MISSING (28-T32) ──────────
 *
 * This used to require every locale to carry EXACTLY the en-US key set, which
 * left one way to ship an untranslated string: paste the English in. That paste
 * is indistinguishable from a translation that legitimately equals its source,
 * so the debt went invisible — a few hundred entries accumulated while the
 * coverage table called them machine translation.
 *
 * A key may now be ABSENT instead, on one condition: the ledger says so, with
 * `status: "deferred"`. Behaviour is unchanged (i18next falls back to en-US),
 * the debt is countable, and the translation editor can already find it —
 * "Untranslated only" is `override === null && builtin === null`, which nothing
 * could match while parity was exact.
 *
 * TWO THINGS STAY STRICT, and they are what keep this from being a hole:
 *
 *   AN EXTRA KEY IS STILL A HARD FAILURE. A locale may be a subset of en-US
 *   and never a superset — a key nobody authored in the source is a typo or a
 *   merge artefact, and no ledger entry excuses it.
 *
 *   THE LEDGER MAY NOT ROT IN EITHER DIRECTION. A key missing from the bundle
 *   with no `deferred` entry fails, and a key PRESENT in the bundle that is
 *   still marked `deferred` fails too. Without the second half the ledger
 *   would drift into a list of things that used to be true, which is the
 *   failure mode `outdated` was already migrated away from.
 */
describe('key-set parity with en-US', () => {
  for (const locale of TARGET_LOCALES) {
    it(`${locale.id} carries no key en-US does not`, () => {
      for (const ns of NAMESPACES) {
        const source = new Set(flatten(EN_US_RESOURCES[ns]).keys());
        const extra = [...flatten(readJson(locale.tag, ns)).keys()].filter((k) => !source.has(k));
        expect(extra, `${locale.tag}/${ns} has keys en-US does not`).toEqual([]);
      }
    });

    it(`${locale.id} ledgers every key it does not carry as deferred`, () => {
      const ledger = readLedger(locale.tag);
      const unledgered: string[] = [];
      for (const ns of NAMESPACES) {
        const target = new Set(flatten(readJson(locale.tag, ns)).keys());
        for (const key of flatten(EN_US_RESOURCES[ns]).keys()) {
          if (target.has(key)) continue;
          if (ledger[`${ns}.${key}`]?.status !== 'deferred') unledgered.push(`${ns}.${key}`);
        }
      }
      expect(
        unledgered,
        `${locale.tag}: missing from the bundle and not marked deferred in .meta.json — ` +
          `run \`node scripts/meta.mjs init\``,
      ).toEqual([]);
    });

    it(`${locale.id} marks nothing deferred that it actually carries`, () => {
      const ledger = readLedger(locale.tag);
      const present = new Set<string>();
      for (const ns of NAMESPACES) {
        for (const key of flatten(readJson(locale.tag, ns)).keys()) present.add(`${ns}.${key}`);
      }
      const stale = Object.entries(ledger)
        .filter(([key, entry]) => entry.status === 'deferred' && present.has(key))
        .map(([key]) => key);
      expect(stale, `${locale.tag}: marked deferred but present in the bundle`).toEqual([]);
    });
  }
});

describe('studio.enrich is present and genuinely translated in all locales (acceptance #14)', () => {
  // The connect-wizard "Enrich with AI" step (EnrichStep / EnrichByoPanel /
  // EnrichDirectProgress) resolves these keys under the `common` namespace; a
  // regression that ships them in no bundle would make every non-English user
  // read English. Key-set parity above guarantees all-or-nothing presence — this
  // additionally proves the strings are real translations, not English fallbacks.
  // In the `studio` namespace since 10-T06 (they were `common.studio.*`).
  const SAMPLE_KEYS = [
    'enrich.title',
    'enrich.subtitle',
    'enrich.byo.cardTitle',
    'enrich.direct.title',
    'enrich.section.labels',
  ] as const;

  it('en-US carries the whole enrich subtree', () => {
    const en = flatten(EN_US_RESOURCES.studio);
    for (const key of SAMPLE_KEYS) expect(en.get(key), key).toBeTypeOf('string');
    // The full section vocabulary the wizard renders is present.
    for (const section of ['labels', 'groups', 'enums', 'relations', 'keys', 'templates', 'widgets', 'pii', 'icons', 'microcopy']) {
      expect(en.get(`enrich.section.${section}`), section).toBeTypeOf('string');
    }
  });

  for (const locale of TARGET_LOCALES) {
    it(`${locale.id} translates the enrich copy (not the English fallback)`, () => {
      const en = flatten(EN_US_RESOURCES.studio);
      const target = flatten(readJson(locale.tag, 'studio'));
      for (const key of SAMPLE_KEYS) {
        expect(target.get(key), `${locale.tag}:${key}`).toBeTypeOf('string');
        expect(target.get(key), `${locale.tag}:${key} must be translated, not English`).not.toBe(en.get(key));
      }
    });
  }
});

describe('the translation editor\u2019s own chrome is translated in every locale', () => {
  // `settings.translations.*` draws /settings/translations itself, and it closes
  // a loop the other suites cannot see: English leaking onto THIS surface is
  // the one case a super-admin has to repair through the very screen that is
  // broken (23-runtime-translations.md §7).
  //
  // [Corrected 2026-08-20, 28-T32.] This used to say the editor "refuses to
  // override a key that is absent from the compiled bundle", which is not what
  // the code does and would have made the deferred state above unrepairable.
  // `rejectReason` calls `sourceMessage`, and `sourceMessage` reads
  // EN_US_RESOURCES — the English source index, never the target locale's
  // bundle (`routes/i18n/index.ts`, `packages/i18n/src/keys.ts`). A key that
  // exists in en-US and is absent from de-DE is editable; only a key that
  // exists in NO bundle is rejected. Key-set parity proves the keys are
  // present in all 8 bundles; `key-coverage.test.ts` proves the page's `t()`
  // calls resolve. Neither can tell a translation from English pasted into
  // `ar-EG` and marked `mt` — which has happened here before (eight aria-label
  // keys shipped as literal English) — so this asserts the text actually moved.
  const SURFACE_KEYS = [
    'settings.translations.title',
    'settings.translations.subtitle',
    'settings.translations.warning',
    'settings.translations.editor.heading',
    'settings.translations.locales.heading',
    'settings.translations.valueLabel',
    'settings.translations.locale.intlHelp',
  ] as const;

  it('en-US carries the editor surface', () => {
    const en = flatten(EN_US_RESOURCES.common);
    for (const key of SURFACE_KEYS) expect(en.get(key), key).toBeTypeOf('string');
  });

  for (const locale of TARGET_LOCALES) {
    it(`${locale.id} translates the editor chrome (not the English fallback)`, () => {
      const en = flatten(EN_US_RESOURCES.common);
      const target = flatten(readJson(locale.tag, 'common'));
      for (const key of SURFACE_KEYS) {
        expect(target.get(key), `${locale.tag}:${key}`).toBeTypeOf('string');
        expect(target.get(key), `${locale.tag}:${key} must be translated, not English`).not.toBe(en.get(key));
      }
    });
  }
});

describe('ICU validity, argument parity, and plural categories', () => {
  for (const locale of TARGET_LOCALES) {
    it(`${locale.id}: every message parses with en-US argument names and locale-valid plural categories`, () => {
      const validCategories = new Set<string>(
        new Intl.PluralRules(locale.tag).resolvedOptions().pluralCategories,
      );
      for (const ns of NAMESPACES) {
        const source = flatten(EN_US_RESOURCES[ns]);
        const target = flatten(readJson(locale.tag, ns));
        for (const [key, sourceMessage] of source) {
          const targetMessage = target.get(key);
          // A DEFERRED key has no message to parse, which is the point of it —
          // en-US renders instead. Presence is the key-set suite's rule and it
          // is checked there against the ledger; asserting it again here would
          // make that relaxation unreachable (28-T32).
          if (targetMessage === undefined) continue;
          if (targetMessage === undefined) continue;
          const sourceShape = icuShape(sourceMessage, 'en-US', `${ns}:${key}`);
          const targetShape = icuShape(targetMessage, locale.tag, `${ns}:${key}`);
          // Identical ICU argument names — never renamed, dropped, or invented.
          expect(targetShape.args, `${locale.tag}/${ns}:${key} arguments`).toEqual(sourceShape.args);
          // Plural-bearing messages stay plural-bearing on the same arguments.
          expect(
            [...targetShape.plurals.keys()].sort(),
            `${locale.tag}/${ns}:${key} plural arguments`,
          ).toEqual([...sourceShape.plurals.keys()].sort());
          for (const [arg, selectors] of targetShape.plurals) {
            expect(selectors, `${locale.tag}/${ns}:${key} {${arg}, plural}`).toContain('other');
            for (const selector of selectors) {
              if (selector.startsWith('=')) continue; // exact matches are always allowed
              expect(
                validCategories.has(selector),
                `${locale.tag}/${ns}:${key} uses plural category "${selector}" which ${locale.tag} does not have`,
              ).toBe(true);
            }
          }
        }
      }
    });
  }

  it('the adoption message exercises each language’s cardinal plural system', () => {
    const pluralSelectors = (tag: string): string[] => {
      const message = flatten(readJson(tag, 'common')).get('settings.defaults.adoption');
      if (message === undefined) throw new Error(`adoption message missing in ${tag}`);
      return icuShape(message, tag, 'settings.defaults.adoption').plurals.get('total') ?? [];
    };
    // Czech: one/few/many/other; Arabic: the full six; German/French/Danish:
    // one/other (CLDR handles French 0-as-singular inside "one"); zh: other only.
    expect(pluralSelectors('cs-CZ')).toEqual(['few', 'many', 'one', 'other']);
    expect(pluralSelectors('ar-EG')).toEqual(['few', 'many', 'one', 'other', 'two', 'zero']);
    expect(pluralSelectors('de-DE')).toEqual(['one', 'other']);
    expect(pluralSelectors('fr-FR')).toEqual(['one', 'other']);
    expect(pluralSelectors('da-DK')).toEqual(['one', 'other']);
    expect(pluralSelectors('zh-CN')).toEqual(['other']);
    expect(pluralSelectors('zh-TW')).toEqual(['other']);
  });
});

describe('zh_CN / zh_TW are distinct locales, not one bundle (M8 risk note)', () => {
  /** `ns:dot.path` keys where Simplified and Traditional must diverge (script + regional vocabulary). */
  const DIVERGENT_KEYS = [
    'common:auth.headline', // 数据库/仪表盘 vs 資料庫/儀表板
    'common:auth.signIn.email', // 邮箱 vs 電子郵件
    'common:auth.signIn.submit', // 登录 vs 登入
    'common:nav.signOut', // 退出登录 vs 登出
    'common:topbar.preferences', // 偏好设置 vs 偏好設定
    'common:undo.done', // 撤销 vs 復原
    'common:settings.defaults.title', // 全局默认值 vs 全域預設值
    'common:settings.defaults.adoption', // 用户 vs 使用者
    'ui:action.save', // 保存 vs 儲存
    'ui:action.undo', // 撤销 vs 復原
    'ui:state.loading', // 加载中 vs 載入中
    'ui:combobox.search', // 搜索 vs 搜尋
    'studio:settings.title', // 设置 vs 設定
    'generated:app.title', // 仪表盘 vs 儀表板
    'errors:SESSION_EXPIRED', // 会话 vs 工作階段
    'errors:CONNECTION_FAILED', // 连接/数据库 vs 連線/資料庫
  ] as const;

  it('diverges on script and regional vocabulary for the sentinel key set', () => {
    const cn = new Map<string, string>();
    const tw = new Map<string, string>();
    for (const ns of NAMESPACES) {
      for (const [key, value] of flatten(readJson('zh-CN', ns))) cn.set(`${ns}:${key}`, value);
      for (const [key, value] of flatten(readJson('zh-TW', ns))) tw.set(`${ns}:${key}`, value);
    }
    for (const key of DIVERGENT_KEYS) {
      expect(cn.get(key), key).toBeTypeOf('string');
      expect(cn.get(key), `${key} must differ between zh-CN and zh-TW`).not.toBe(tw.get(key));
    }
  });

  it('uses the regional terms for database (数据库 vs 資料庫)', () => {
    const cnHeadline = flatten(readJson('zh-CN', 'common')).get('auth.headline') ?? '';
    const twHeadline = flatten(readJson('zh-TW', 'common')).get('auth.headline') ?? '';
    expect(cnHeadline).toContain('数据库');
    expect(twHeadline).toContain('資料庫');
  });
});
