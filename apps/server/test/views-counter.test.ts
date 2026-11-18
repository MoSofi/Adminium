// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The view counter (`views/counter.ts`) and its bot list (`views/bots.ts`):
 * known bots, link previews, monitors, headless browsers and scripts count
 * nothing, nor does a prefetch, while today's browsers count; a second view
 * from the same address (an IPv6 /64) within thirty minutes counts once, and
 * again after; Off counts nothing, and a level switched off elsewhere writes
 * nothing at the next flush; a sent form counts every answer; a key the table
 * cannot hold is dropped; the repeat check is bounded; a flush writes one row
 * per (thing, kind, place, day) in the business's zone, never a zero, and two
 * flushes add, on all three engines; a failing store never reaches the door;
 * and a visitor's visits wait only at "Per visitor", never in a frame.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { viewDaysRepo, visitorsRepo, type VisitInput } from '@adminium/meta';

import { BOT_MARKERS, isKnownBot, isPrefetch } from '../src/views/bots.js';
import { createViewCounter, DEDUPE_MAX, DEDUPE_MS, dayIn, LEVEL_FRESH_MS, type CountInput, type TrackingLevel } from '../src/views/counter.js';
import type { Newcomer } from '../src/views/visitor.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0';
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const FACEBOOK_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBBV/620000000]';
const DUCKDUCKGO_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15';

const BOTS: Record<string, string> = {
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  linkedin: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  twitter: 'Twitterbot/1.0',
  discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  telegram: 'TelegramBot (like TwitterBot)',
  whatsapp: 'WhatsApp/2.23.20.0 A',
  teams: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 SkypeUriPreview Preview/0.5',
  outlookSafeLinks: 'Mozilla/5.0 (compatible; MSOffice 16) BingPreview/1.0b',
  apple: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
  lighthouse: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  uptimeRobot: 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
  pingdom: 'Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)',
  ahrefs: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  curl: 'curl/8.7.1',
  wget: 'Wget/1.21.4',
  python: 'python-requests/2.32.3',
  go: 'Go-http-client/2.0',
  node: 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
  gpt: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  claude: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
};

const T0 = Date.UTC(2026, 10, 18, 10, 0, 0);
const INSTALL = 'mf_forms_1';

/** A request from `ip`; `userAgent` null sends none. */
function req(ip: string, userAgent: string | null = CHROME, extra: Record<string, string> = {}): CountInput['request'] {
  return { ip, headers: { ...(userAgent === null ? {} : { 'user-agent': userAgent }), ...extra } };
}

describe('the bot list', () => {
  it('leaves out every named bot, preview, monitor, headless browser and script, and an empty user agent', () => {
    for (const [name, agent] of Object.entries(BOTS)) expect([name, isKnownBot(agent)]).toEqual([name, true]);
    expect(isKnownBot(undefined)).toBe(true);
    expect(isKnownBot('   ')).toBe(true);
  });

  it('keeps today\'s browsers, and the apps people read in', () => {
    for (const agent of [CHROME, SAFARI_IPHONE, FIREFOX, EDGE, SAMSUNG, FACEBOOK_APP, DUCKDUCKGO_APP]) expect([agent, isKnownBot(agent)]).toEqual([agent, false]);
    // No marker is one of the words every browser carries.
    for (const marker of BOT_MARKERS) expect([marker, ['mozilla', 'applewebkit', 'chrome/', 'safari', 'gecko', 'mobile', 'version', 'like'].includes(marker)]).toEqual([marker, false]);
  });

  it('knows a prefetch and a prerender by each header that says so', () => {
    expect(isPrefetch({ 'sec-purpose': 'prefetch' })).toBe(true);
    expect(isPrefetch({ 'sec-purpose': 'prefetch;prerender' })).toBe(true);
    expect(isPrefetch({ purpose: 'prefetch' })).toBe(true);
    expect(isPrefetch({ 'x-moz': 'prefetch' })).toBe(true);
    expect(isPrefetch({})).toBe(false);
  });
});

describe('the view counter', () => {
  let at: number;
  let written: { installId: string; kind: string; thing: string; place: string; day: string; views: number }[];
  let level: TrackingLevel;
  let visits: VisitInput[];

  let newcomers: Newcomer[];
  let dropped: number;

  function counter(opts: { add?: (count: (typeof written)[number]) => Promise<void>; zone?: string; visitor?: string | null; errors?: unknown[] } = {}) {
    return createViewCounter({
      add: opts.add ?? (async (count) => void written.push(count)),
      addVisits: async (list, coming) => {
        visits.push(...list);
        newcomers.push(...coming);
        return list.length;
      },
      dropVisitors: async () => {
        dropped += 1;
      },
      zoneOf: async () => opts.zone ?? 'UTC',
      readLevel: async () => level,
      visitorOf: () => (opts.visitor == null ? null : { id: opts.visitor, saidYesAt: T0, wordingVersion: 'w-0' }),
      now: () => at,
      onError: (error) => opts.errors?.push(error),
    });
  }

  beforeEach(() => {
    at = T0;
    written = [];
    level = 'counts';
    visits = [];
    newcomers = [];
    dropped = 0;
  });

  it('counts a browser\'s view, and never a bot\'s, a preview\'s or a prefetch', async () => {
    const views = counter();
    for (const agent of Object.values(BOTS)) views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('203.0.113.9', agent) });
    views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('203.0.113.10', null) });
    views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('203.0.113.11', CHROME, { 'sec-purpose': 'prefetch;prerender' }) });
    views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('203.0.113.12', CHROME, { purpose: 'prefetch' }) });
    views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('203.0.113.13', SAFARI_IPHONE) });
    await views.flush();
    expect(written).toEqual([{ installId: INSTALL, kind: 'form-page', thing: '41', place: '', day: '2026-11-18', views: 1 }]);
  });

  it('counts a second view from the same /64 within thirty minutes once, and again after; another thing or kind apart', async () => {
    const views = counter();
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('2001:db8:1:2::1') });
    at = T0 + 60_000;
    // The same /64, another address in it.
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('2001:db8:1:2:ffff::9') });
    // Another /64, another thing, another kind: each counted.
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('2001:db8:1:3::1') });
    views.count({ installId: INSTALL, kind: 'page', thing: '8', request: req('2001:db8:1:2::1') });
    views.count({ installId: INSTALL, kind: 'form-opened', thing: '7', request: req('2001:db8:1:2::1') });
    // An IPv4 address as itself, and as a dual-stack socket reports it.
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('198.51.100.7') });
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('::ffff:198.51.100.7') });
    at = T0 + DEDUPE_MS - 1;
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('2001:db8:1:2::1') });
    at = T0 + DEDUPE_MS;
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('2001:db8:1:2::1') });
    await views.flush();
    const total = (kind: string, thing: string) => written.filter((one) => one.kind === kind && one.thing === thing).reduce((sum, one) => sum + one.views, 0);
    expect(total('page', '7')).toBe(4);
    expect(total('page', '8')).toBe(1);
    expect(total('form-opened', '7')).toBe(1);
  });

  it('keeps the repeat check to its bound, the oldest let go first', async () => {
    const views = counter();
    for (let n = 0; n < DEDUPE_MAX + 10; n += 1) views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req(`10.${String((n >> 16) & 255)}.${String((n >> 8) & 255)}.${String(n & 255)}`) });
    // The first address was let go, so it counts again; the last is still held.
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('10.0.0.0') });
    const last = DEDUPE_MAX + 9;
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req(`10.${String((last >> 16) & 255)}.${String((last >> 8) & 255)}.${String(last & 255)}`) });
    await views.flush();
    expect(written.reduce((sum, one) => sum + one.views, 0)).toBe(DEDUPE_MAX + 11);
  });

  it('counts the same form block on two pages from one address twice: the place is in the repeat check', async () => {
    const views = counter();
    views.count({ installId: INSTALL, kind: 'form-opened', thing: '41', place: '7', request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'form-opened', thing: '41', place: '8', request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'form-opened', thing: '41', place: '7', request: req('198.51.100.1') });
    await views.flush();
    expect(written.map((one) => [one.place, one.views])).toEqual([
      ['7', 1],
      ['8', 1],
    ]);
  });

  it('lets go of marks from the front at its bound: one step a view, never a walk of the whole map', async () => {
    const views = counter();
    const address = (n: number) => `10.${String((n >> 16) & 255)}.${String((n >> 8) & 255)}.${String(n & 255)}`;
    for (let n = 0; n < DEDUPE_MAX; n += 1) views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req(address(n)) });
    // Every map step taken from here on is counted.
    const original = Map.prototype[Symbol.iterator];
    let steps = 0;
    Map.prototype[Symbol.iterator] = function counted(this: Map<unknown, unknown>) {
      const inner = original.call(this);
      return {
        next: () => {
          steps += 1;
          return inner.next();
        },
        [Symbol.iterator]() {
          return this;
        },
      } as never;
    };
    try {
      for (let n = DEDUPE_MAX; n < DEDUPE_MAX + 200; n += 1) views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req(address(n)) });
    } finally {
      Map.prototype[Symbol.iterator] = original;
    }
    // Two hundred new addresses at the bound: a few steps each, where a walk would take fifty thousand.
    expect(steps).toBeLessThan(200 * 4);
    // The oldest were let go (they count again), the newest are held.
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req(address(0)) });
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req(address(DEDUPE_MAX + 199)) });
    // Marks past their time go from the front first, whatever the bound.
    at = T0 + DEDUPE_MS;
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req(address(DEDUPE_MAX + 100)) });
    await views.flush();
    expect(written.reduce((sum, one) => sum + one.views, 0)).toBe(DEDUPE_MAX + 200 + 1 + 1);
  });

  it('asks the settings again for the level a few seconds after it last did, never waiting a view on it', async () => {
    let reads = 0;
    const views = createViewCounter({ add: async (count) => void written.push(count), zoneOf: async () => 'UTC', readLevel: async () => ((reads += 1), level), now: () => at });
    await views.refresh();
    expect(reads).toBe(1);
    // Switched off elsewhere: within the few seconds, the level held stands.
    level = 'off';
    at = T0 + LEVEL_FRESH_MS - 1;
    await expect(views.levelNow()).resolves.toBe('counts');
    expect(reads).toBe(1);
    // Past them, the next view asks again in the background, and the one after counts nothing.
    at = T0 + LEVEL_FRESH_MS + 1;
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('198.51.100.1') });
    await views.levelNow();
    expect(reads).toBe(2);
    expect(views.level()).toBe('off');
    views.count({ installId: INSTALL, kind: 'page', thing: '8', request: req('198.51.100.2') });
    expect(views.pending().counts).toBe(1);
  });

  it('deletes every visitor once more at the first flush after this process sees the level go down from Per visitor', async () => {
    level = 'visitor';
    const views = counter();
    await views.refresh();
    await views.flush();
    expect(dropped).toBe(0);
    // Another process went down to Counts only: this one sees it at its flush, and deletes once more, once.
    level = 'counts';
    await views.flush();
    expect(dropped).toBe(1);
    await views.flush();
    expect(dropped).toBe(1);
    // Going down here, by the Privacy page's save: the next flush deletes once more too.
    level = 'visitor';
    await views.refresh();
    views.setLevel('off');
    level = 'off';
    await views.flush();
    expect(dropped).toBe(2);
  });

  it('counts nothing while Off, and writes nothing once switched off elsewhere', async () => {
    level = 'off';
    const views = counter();
    await views.refresh();
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'form-sent', thing: '7', request: req('198.51.100.1') });
    expect(views.pending().counts).toBe(0);
    // Counting here, then another process switches it off before the flush.
    level = 'counts';
    await views.refresh();
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('198.51.100.2') });
    level = 'off';
    await views.flush();
    expect(written).toEqual([]);
    expect(views.level()).toBe('off');
  });

  it('counts every sent answer, from one address and from a script alike, and drops what the table cannot hold', async () => {
    const views = counter();
    views.count({ installId: INSTALL, kind: 'form-sent', thing: '41', place: '7', request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'form-sent', thing: '41', place: '7', request: req('198.51.100.1', 'curl/8.7.1') });
    views.count({ installId: undefined, kind: 'form-sent', thing: '41', request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'form-sent', thing: '', request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'form-sent', thing: 't'.repeat(65), request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'form-sent', thing: '41', place: 'p'.repeat(65), request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'chat-opened' as never, thing: '41', request: req('198.51.100.1') });
    await views.flush();
    expect(written).toEqual([{ installId: INSTALL, kind: 'form-sent', thing: '41', place: '7', day: '2026-11-18', views: 2 }]);
  });

  it('writes each count on the business\'s day, one row per day, and never a zero', async () => {
    // 23:50 UTC is already the 19th in Auckland and still the 18th in Los Angeles.
    at = Date.UTC(2026, 10, 18, 23, 50, 0);
    const auckland = counter({ zone: 'Pacific/Auckland' });
    auckland.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('198.51.100.1') });
    auckland.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('198.51.100.2') });
    await auckland.flush();
    expect(written).toEqual([{ installId: INSTALL, kind: 'page', thing: '7', place: '', day: '2026-11-19', views: 2 }]);
    // Nothing counted: nothing written.
    await auckland.flush();
    expect(written).toHaveLength(1);
    expect(dayIn('America/Los_Angeles', at)).toBe('2026-11-18');
    expect(dayIn('Asia/Kathmandu', Date.UTC(2026, 10, 18, 18, 15, 0))).toBe('2026-11-19');
    expect(dayIn('No/Such_Zone', at)).toBe('2026-11-18');
  });

  it('never lets a failing store reach the door, and drops that minute', async () => {
    const errors: unknown[] = [];
    const views = counter({ add: async () => Promise.reject(new Error('the store is down')), errors });
    views.count({ installId: INSTALL, kind: 'page', thing: '7', request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'page', thing: '8', request: req('198.51.100.1') });
    await expect(views.flush()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(views.pending()).toEqual({ counts: 0, visits: 0 });
    // A request with nothing a counter can read still never throws into the door.
    expect(() => views.count({ installId: INSTALL, kind: 'page', thing: '7', request: { ip: undefined as never, headers: {} } })).not.toThrow();
  });

  it('keeps a visitor\'s visit only at Per visitor, only with their cookie, and never in a frame', async () => {
    level = 'visitor';
    const views = counter({ visitor: 'v'.repeat(64) });
    await views.refresh();
    views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('198.51.100.1') });
    views.count({ installId: INSTALL, kind: 'form-page', thing: '42', framed: true, request: req('198.51.100.1') });
    // A repeat within the window is no view, and no visit.
    views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('198.51.100.1') });
    await views.flush();
    expect(visits).toEqual([{ visitorId: 'v'.repeat(64), installId: INSTALL, kind: 'form-page', thing: '41', at: T0 }]);
    // The "yes" it carries waits to become a visitor: with keyed labels of its networks, never the address.
    expect(newcomers).toEqual([{ proof: { id: 'v'.repeat(64), saidYesAt: T0, wordingVersion: 'w-0' }, host: '', at: T0, networks: { address: expect.any(String), wide: null } }]);
    expect(JSON.stringify(newcomers)).not.toContain('198.51.100');
    // At Counts only nothing of a visitor waits, cookie or not.
    level = 'counts';
    await views.refresh();
    views.count({ installId: INSTALL, kind: 'form-page', thing: '43', request: req('198.51.100.1') });
    expect(views.pending().visits).toBe(0);
    // No cookie: no visit.
    level = 'visitor';
    const anonymous = counter();
    await anonymous.refresh();
    anonymous.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('198.51.100.1') });
    expect(anonymous.pending()).toEqual({ counts: 1, visits: 0 });
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the view counter's flush [${engine.name}]`, () => {
    let handle: MetaHandle;
    beforeEach(async () => {
      handle = await engine.make();
    });
    afterEach(async () => {
      await handle.destroy();
    });

    it('writes one row per thing, kind, place and day, and two flushes add', async () => {
      let at = T0;
      const repo = viewDaysRepo(handle.meta);
      const views = createViewCounter({ add: (count) => repo.add(count), zoneOf: async () => 'Europe/London', readLevel: async () => 'counts', now: () => at });
      for (let n = 0; n < 5; n += 1) views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req(`198.51.100.${String(n)}`) });
      views.count({ installId: INSTALL, kind: 'form-opened', thing: '41', place: '7', request: req('198.51.100.1') });
      // A quarter later, the same day: one row still.
      at = T0 + 20 * 60_000;
      views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('198.51.100.9') });
      await views.flush();
      views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('198.51.100.10') });
      await views.flush();
      expect(await repo.read({ installId: INSTALL, kind: 'form-page', things: ['41'], from: '2026-11-18', to: '2026-11-18' })).toEqual([{ installId: INSTALL, kind: 'form-page', thing: '41', place: '', day: '2026-11-18', views: 7 }]);
      expect(await repo.read({ installId: INSTALL, kind: 'form-opened', things: ['41'], from: '2026-11-18', to: '2026-11-18' })).toEqual([{ installId: INSTALL, kind: 'form-opened', thing: '41', place: '7', day: '2026-11-18', views: 1 }]);
      const rows = await handle.meta.db.selectFrom('adminium_view_days').select('views').execute();
      expect(rows.every((row) => Number(row.views) > 0)).toBe(true);
    });

    it('writes a visitor\'s visits in the same flush, and drops those of a visitor gone since', async () => {
      const visitors = visitorsRepo(handle.meta);
      await visitors.create({ id: 'a'.repeat(64), host: 'crm.meridian.example', saidYesAt: T0, wordingVersion: 'w1' });
      let who = 'a'.repeat(64);
      const views = createViewCounter({
        add: (count) => viewDaysRepo(handle.meta).add(count),
        addVisits: (list) => visitors.addVisits(list),
        zoneOf: async () => 'UTC',
        readLevel: async () => 'visitor',
        visitorOf: () => ({ id: who, saidYesAt: T0, wordingVersion: 'w1' }),
        now: () => T0,
      });
      await views.refresh();
      views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('198.51.100.1') });
      who = 'b'.repeat(64);
      views.count({ installId: INSTALL, kind: 'form-page', thing: '41', request: req('198.51.100.2') });
      await views.flush();
      expect((await visitors.visitsOf(['a'.repeat(64), 'b'.repeat(64)], 10)).count).toBe(1);
    });
  });
}
