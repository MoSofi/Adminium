// SPDX-License-Identifier: AGPL-3.0-only
/**
 * KNOWN BOTS AND PREFETCHES: the requests the view counter leaves out.
 *
 * Counts are "views, known bots left out", never people. A view is counted at
 * the page's own data read, which only a browser running the page's script
 * makes, so a link scanner or a link preview that fetches the HTML alone is
 * never counted at all. Some crawlers and scanners do run scripts; they are
 * left out here by their user agent:
 *
 *  - an empty or missing user agent (no browser sends none);
 *  - the general markers crawlers name themselves with (`bot`, `crawl`,
 *    `spider`, `slurp`, `preview`, `scan`, `fetch`, `monitor`, `check`…);
 *  - link previews by name (Facebook, WhatsApp, Skype, Teams, Reddit, Google's
 *    and others; Slack, LinkedIn, X, Discord and Telegram name themselves bots);
 *    never an app's own browser (Pinterest's, Flipboard's, DuckDuckGo's), which
 *    real people read in;
 *  - uptime monitors and SEO tools by name;
 *  - headless browsers and automation (`HeadlessChrome`, PhantomJS,
 *    Puppeteer, Playwright, Selenium, Lighthouse, the Chrome-Lighthouse mark);
 *  - command-line and library clients (curl, Wget, python-requests, Go's,
 *    Java's, okhttp, axios, node-fetch, undici, libwww).
 *
 * A prefetch or a prerender is not a view either: the browser fetched the
 * page in case it is opened. `Sec-Purpose: prefetch` (and `prefetch;prerender`),
 * the older `Purpose: prefetch` and Firefox's `X-Moz: prefetch` say so.
 *
 * The list is the engine's own: small, readable, matched case-blind on
 * words, and leaves a real browser's user agent alone (the tests name the
 * main ones of each kind, and today's desktop and phone browsers).
 */

/**
 * Markers matched anywhere in the user agent, lower case. Each is a word a
 * real browser's user agent never holds (`Safari`, `Chrome`, `Mobile`,
 * `Gecko`, `like`, `Version`, `Edg`, `OPR` and the platforms are not here).
 */
export const BOT_MARKERS: readonly string[] = [
  // General self-descriptions.
  'bot',
  'crawl',
  'spider',
  'slurp',
  'preview',
  'scanner',
  'scan/',
  'fetcher',
  'monitor',
  'checker',
  'archiver',
  'validator',
  'proxy/',
  // Link previews and social fetchers by name.
  'facebookexternalhit',
  'facebookcatalog',
  'meta-externalagent',
  'embedly',
  'quora link preview',
  'whatsapp',
  'skypeuripreview',
  'microsoftpreview',
  'teams/',
  'redditbot',
  'vkshare',
  'w3c_validator',
  'iframely',
  'outbrain',
  'nuzzel',
  'bitlybot',
  'google-pagerenderer',
  'google-read-aloud',
  'google-inspectiontool',
  'googleother',
  'mediapartners-google',
  'adsbot',
  'feedfetcher',
  'apis-google',
  // Uptime monitors and SEO tools.
  'pingdom',
  'uptimerobot',
  'statuscake',
  'site24x7',
  'datadog',
  'newrelicpinger',
  'better uptime',
  'ahrefs',
  'semrush',
  'mj12',
  'dotbot',
  'screaming frog',
  'sitebulb',
  'gtmetrix',
  'pagespeed',
  'lighthouse',
  'chrome-lighthouse',
  // Headless browsers and automation.
  'headless',
  'phantomjs',
  'puppeteer',
  'playwright',
  'selenium',
  'webdriver',
  'electron/',
  'cypress',
  // Command-line and library clients.
  'curl/',
  'wget/',
  'python-requests',
  'python-urllib',
  'aiohttp',
  'httpx',
  'go-http-client',
  'java/',
  'okhttp',
  'apache-httpclient',
  'axios/',
  'node-fetch',
  'undici',
  'libwww',
  'lwp::',
  'httpie',
  'postmanruntime',
  'insomnia',
  'ruby',
  'php/',
  'guzzlehttp',
  'dart:io',
  'scrapy',
  // AI and research fetchers.
  'gptbot',
  'chatgpt-user',
  'oai-searchbot',
  'claudebot',
  'claude-web',
  'anthropic-ai',
  'perplexity',
  'ccbot',
  'bytespider',
  'amazonbot',
  'applebot',
  'bingpreview',
  'yandex',
  'baiduspider',
  'petalbot',
];

/** Whether a request's user agent is a known bot, crawler, preview, monitor, headless browser or script, or missing. */
export function isKnownBot(userAgent: string | readonly string[] | undefined): boolean {
  const text = typeof userAgent === 'string' ? userAgent : userAgent === undefined ? '' : userAgent.join(' ');
  const agent = text.trim().toLowerCase();
  if (agent === '') return true;
  return BOT_MARKERS.some((marker) => agent.includes(marker));
}

type Headers = Readonly<Record<string, string | readonly string[] | undefined>>;

function header(headers: Headers, name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '').toLowerCase();
}

/** Whether a request says it is a prefetch or a prerender, not a page the visitor opened. */
export function isPrefetch(headers: Headers): boolean {
  return header(headers, 'sec-purpose').includes('prefetch') || header(headers, 'purpose').includes('prefetch') || header(headers, 'x-moz').includes('prefetch') || header(headers, 'x-purpose').includes('preview');
}

/** Whether a request is left out of the counts: a known bot, or a prefetch. */
export function leftOut(request: { headers: Headers }): boolean {
  return isKnownBot(request.headers['user-agent']) || isPrefetch(request.headers);
}
