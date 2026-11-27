// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building from a site template with `use_site`: the plan first, then the template into the side.
 *
 * Nothing of the template is written before the person approves a plan on its card, and only for the very
 * template it was made for. Then the template's files come in under `src/site/`, its pages become screens,
 * its content pictures filled spots, and the side follows its template. What the person changed by hand is
 * kept unless they say otherwise on a card of their own.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attachmentNote, createAttachments, type Attachments } from '../src/designer/attachments.js';
import type { CardAnswer, CardRequest } from '../src/designer/cards.js';
import { createEventLog } from '../src/designer/events.js';
import { designSection } from '../src/designer/prompt.js';
import { builtInStylesDir } from '../src/project/apps/design-skills.js';
import { missingFonts, type Look } from '../src/project/apps/look.js';
import { designIssues } from '../src/project/apps/design-check.js';
import { sideBuildDir } from '../src/project/apps/side-build.js';
import { createSkills } from '../src/designer/skills.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import { judgeSite, type SiteEntry } from '../src/designer/site/judge.js';
import { picturesState, prepareFills, writeFills } from '../src/designer/pictures-apply.js';
import { readSpots } from '../src/designer/spots.js';
import { approvedAll, planFor, readTemplatePlan, writeTemplatePlan, type TemplatePlanAnswer, type TemplatePlanFile } from '../src/designer/site/template-plan.js';
import { notFoundLine, PLAN_GUIDE, seenInSite, SMALL_WINDOW_SENTENCE } from '../src/designer/site/plan-step.js';
import { nameFits, nameInTitles, titleOf } from '../src/designer/site/template-name.js';
import { pageRoutes } from '../src/designer/site/use-site.js';
import type { DesignerTool, ToolContext } from '../src/designer/tool-types.js';
import { createDesignerTools } from '../src/designer/tools.js';
import { runCli } from '../src/cli/run.js';
import { APP_VERSION } from '../src/version.js';
import { canBuildSides, tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

const session = { id: 'ds_000000000000000000000000', appKey: 'repairs', connectionId: 'c1' } as DesignerSession;

/** A PNG's first bytes, with its size in the header: enough for the judge and for a spot's shape. */
function png(width: number, height: number, mark: string): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.from(mark)]);
}

const card = (name: string, price: string, picture: string): string => `<div class="product-item"><img src="${picture}" alt="${name}"><h3 class="product-title">${name}</h3><strong class="product-price">${price}</strong></div>`;
const HEAD = (title: string): string => `<!doctype html><html lang="en"><head><title>${title}</title><link rel="stylesheet" href="css/style.css"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap" rel="stylesheet"></head>`;
const INDEX = `${HEAD('Furni')}<body class="home"><nav><a href="index.html">Home</a><a href="shop.html">Shop</a></nav>
<section class="hero"><h1>Modern interior</h1><img src="images/hero.png" alt="A sofa by the window"></section>
<div class="row">${card('Nordic Chair', '$50.00', 'images/chair.png')}${card('Kruzo Chair', '$78.00', 'images/kruzo.png')}${card('Ergo Chair', '$43.00', 'images/ergo.png')}</div>
<a href="#">Learn more</a>
<form class="subscription"><input type="email" name="email" required placeholder="Your email"><button>Send</button></form>
</body></html>`;
const SHOP = `${HEAD('Shop')}<body><div class="row">${card('Nordic Chair', '$50.00', 'images/chair.png')}${card('Kruzo Chair', '$78.00', 'images/kruzo.png')}</div><a href="index.html">Back home</a></body></html>`;

const at = (path: string, data: string | Buffer): SiteEntry => {
  const bytes = typeof data === 'string' ? Buffer.from(data) : data;
  return { path, size: bytes.length, type: 'file', read: async () => bytes };
};
const SITE: SiteEntry[] = [
  at('index.html', INDEX),
  at('shop.html', SHOP),
  at('about.htm', `${HEAD('About')}<body><p>About us</p><a href="about.html">Same name</a></body></html>`),
  at('about.html', `${HEAD('About too')}<body><p>About, the other</p></body></html>`),
  at('css/style.css', '.hero{background:url(../images/bg.png)} .product-item{display:block} .gone{background:url(../images/gone.png)}'),
  at('images/hero.png', png(1600, 900, 'hero')),
  at('images/bg.png', png(10, 10, 'bg')),
  at('images/chair.png', png(400, 400, 'chair')),
  at('images/kruzo.png', png(400, 400, 'kruzo')),
  at('images/ergo.png', png(400, 400, 'ergo')),
];

let root: string;
let attachments: Attachments;
let tools: DesignerTool[];
let asked: CardRequest[];
let answers: (CardAnswer | ((card: CardRequest) => CardAnswer))[];
let window: number;
let installed: string[][];

const context = (): ToolContext => {
  const signal = new AbortController().signal;
  const ask = async (request: CardRequest): Promise<CardAnswer> => {
    asked.push(request);
    const next = answers.shift();
    if (next === undefined) throw new Error('nobody answered');
    return typeof next === 'function' ? next(request) : next;
  };
  return { session, turn: 1, signal, ask, handle: { turn: 1, by: { id: null, label: 'x' }, signal, ask, events: createEventLog({ lastSeq: 0, append: () => undefined, publish: () => undefined }) } };
};
const make = (): void => {
  tools = createDesignerTools(
    {
      root,
      version: APP_VERSION,
      designer: () => ({ store: { messages: () => [] } }) as never,
      skills: createSkills(),
      listAddOns: async () => [{ key: 'offers', name: 'Offers & gift cards', version: '1.0.0', line: 'Discount codes.', state: 'available' }],
      attachments,
      // A registry that has what a side is asked for, so a needs card would have something to show.
      newestVersion: async (name) => ({ '@fontsource/inter': '5.2.8', tailwindcss: '4.3.3', 'lucide-react': '0.544.0', clsx: '2.1.1', 'tailwind-merge': '3.3.1' })[name] ?? null,
      install: async (specs) => {
        installed.push(specs.map((spec) => spec.name));
        // What was added is in the project from now on, as a real install leaves it.
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
        pkg.dependencies = { ...(pkg.dependencies ?? {}), ...Object.fromEntries(specs.map((spec) => [spec.name, spec.version])) };
        writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
        // A font package as npm leaves it: one stylesheet per weight it comes in.
        for (const spec of specs.filter((one) => one.name.startsWith('@fontsource/'))) {
          const dir = join(root, 'node_modules', ...spec.name.split('/'));
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: spec.name, version: spec.version }));
          for (const weight of [400, 700]) writeFileSync(join(dir, `${String(weight)}.css`), `@font-face { font-family: Inter; font-weight: ${String(weight)}; src: local(Inter); }\n`);
        }
        return null;
      },
      windowOf: async () => window,
    },
    'repairs',
    session.id,
  );
};
const useSite = (input: Record<string, unknown>) => {
  const found = tools.find((candidate) => candidate.name === 'use_site');
  if (found === undefined) throw new Error('no use_site in this session');
  return found.run(input, context());
};
const app = (path: string): string => join(root, 'apps', 'repairs', path);
const side = (path: string): string => app(`customer/src/${path}`);

let site: string;
beforeEach(async () => {
  root = tempProject('adminium-use-site-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs', '--customer'], { io, deps }), io.stderr()).toBe(0);
  attachments = createAttachments(root);
  site = attachments.addSite(session.id, { label: 'furni', judged: await judgeSite('furni.zip', SITE) }).attachment.id;
  asked = [];
  answers = [];
  window = 160_000;
  installed = [];
  make();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A plan as the model would make it from what was found. */
const PLAN = {
  tables: [
    { table: 'products', label: 'Products', columns: [{ column: 'name', label: 'name' }, { column: 'price', label: 'price' }, { column: 'picture', label: 'picture' }], shownOn: ['Home', 'Shop'], fromTemplate: 5, filler: 2, block: 'block-1', publicRead: ['id', 'name', 'price', 'picture'] },
    { table: 'categories', label: 'Categories', columns: [{ column: 'name', label: 'name' }], fromTemplate: 0, madeUp: 3 },
  ],
  forms: [{ form: 'form-1', label: 'Newsletter', table: 'subscribers', writable: ['email'], perHour: 5 }],
  report: [
    { id: 'nav', label: 'Navigation bar', where: 'On every page', seen: 'Shop', status: 'works' },
    { id: 'payments', label: 'Card payments', where: 'On the Checkout page', seen: 'product-price', status: 'not-available', build: 'a payment link emailed for each order', buildServerCode: true, replace: 'pay on delivery, marked paid by staff', leave: 'the card form comes off the page' },
    { id: 'chat', label: 'Chat widget', where: 'On every page', seen: 'form-1', status: 'not-available', build: 'a contact form in place of the chat', leave: 'the chat bubble comes off the page' },
  ],
  links: [{ id: 'link-1', label: '“Learn more” on Home' }],
  roles: [{ role: 'staff', tables: ['products', 'subscribers'] }],
};
const approve = (overrides: Partial<TemplatePlanAnswer> = {}) => (request: CardRequest): CardAnswer => {
  const offered = request as Extract<CardRequest, { type: 'template-plan' }>;
  return { type: 'template-plan', tables: offered.tables.map((table) => table.table), decisions: {}, links: { 'link-1': '' }, takeOutEmpty: true, added: offered.added.map((item) => item.id), ...overrides };
};

describe('the first call, with the attachment alone', () => {
  it('says what the template holds, as data, and how to make the plan, and writes nothing', async () => {
    const done = await useSite({ attachment: site });
    expect(done.isError).toBeUndefined();
    expect(done.content).toContain('DATA from the person\'s site template');
    expect(done.content).toMatch(/block-1/);
    expect(done.content).toMatch(/form-1/);
    expect(done.content).toContain('call use_site again with the same attachment and "plan"');
    expect(asked).toEqual([]);
    expect(existsSync(side('site'))).toBe(false);
    expect(existsSync(app('template-plan.json'))).toBe(false);
    expect(existsSync(side('pages'))).toBe(false);
  });

  it('is refused before anything is found or asked, on a model that reads too little at once', async () => {
    window = 23_500;
    make();
    for (const input of [{ attachment: site }, { attachment: site, plan: PLAN }]) {
      const done = await useSite(input);
      expect(done.isError).toBe(true);
      expect(done.content).toContain(SMALL_WINDOW_SENTENCE);
      expect(done.content).not.toContain('DATA from');
    }
    expect(asked).toEqual([]);
    expect(existsSync(app('template-plan.json'))).toBe(false);
  });
});

describe('the plan', () => {
  it('is refused when it does not read, or names what was not found', async () => {
    const bad = await useSite({ attachment: site, plan: { tables: [{ table: 'Products!', label: 'x', columns: [] }] } });
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain('The plan does not read');
    const unknown = await useSite({ attachment: site, plan: { ...PLAN, forms: [{ form: 'form-9', label: 'Contact', table: 'messages', writable: ['body'] }], links: [{ id: 'link-7', label: 'x' }] } });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toContain('There is no form "form-9"');
    expect(unknown.content).toContain('There is no link "link-7"');
    const outside = await useSite({ attachment: site, plan: { ...PLAN, roles: [{ role: 'staff', tables: ['payments'] }] } });
    expect(outside.content).toContain('names tables that are not in the plan');
    expect(asked).toEqual([]);
  });

  it('lists only what the template has: a report row says where it was seen, and one the template does not have is refused', async () => {
    const row = (seen: unknown) => ({ id: 'search', label: 'Search', where: 'On the Shop page', status: 'works', ...(seen === undefined ? {} : { seen }) });
    // A row that does not say where is not read at all.
    const unsaid = await useSite({ attachment: site, plan: { report: [row(undefined)] } });
    expect(unsaid.content).toContain('report.0.seen: say where the template has it');
    // Thought up, not found: the template has no search box and no card payment (seen 2026-11-26, on a shop with filter buttons and a plain order form).
    const made = await useSite({ attachment: site, plan: { report: [row('Search products'), { ...row('feature-9'), id: 'pay', label: 'Card or PayPal payment' }] } });
    expect(made.isError).toBe(true);
    expect(made.content).toContain('"search": the template does not have "Search products". In "seen" give an id from what was found, or a few words exactly as a page has them; if the template does not have this, take the row out.');
    expect(made.content).toContain('"pay": the template does not have "feature-9".');
    expect(asked).toEqual([]);
    // Found: an id the server gave, words of a page (whatever their case or spacing), a placeholder in the markup.
    for (const seen of ['form-1', 'block-1', 'link-1', 'modern   INTERIOR', 'Your email', 'Learn more']) {
      answers.push({ type: 'template-plan', tables: [], decisions: {}, links: {}, takeOutEmpty: true, added: [], changes: 'not yet' });
      const fine = await useSite({ attachment: site, plan: { report: [row(seen)] } });
      expect(fine.isError, `${seen}: ${fine.content}`).toBeUndefined();
    }
  });

  it('finds what a row saw in a page’s text, its markup and its comments, with entities and quotes read as a person reads them', () => {
    const pages = [{ html: '<!-- Please add a loyalty points scheme --><p>Tea &amp; cake, &#8220;fresh&#8221; daily</p><input placeholder="Search the shop…"><a class="pay-with-paypal">Pay</a>' }];
    const ids = new Set(['feature-1']);
    for (const seen of ['feature-1', 'Tea & cake', '"fresh" daily', 'loyalty points scheme', 'Search the shop...', 'search the shop…', 'pay-with-paypal']) expect(seenInSite(seen, ids, pages), seen).toBe(true);
    for (const seen of ['feature-2', 'Card or PayPal payment', 'Search products', 'ab', '   ']) expect(seenInSite(seen, ids, pages), seen).toBe(false);
  });

  it('is told, with what was found, what the server did not find, as the server’s own word outside the template’s data', async () => {
    const first = await useSite({ attachment: site });
    const line = 'The server found none of these in the template: a card payment, a sign-in with a password, a search box, a chat widget, analytics, a video, a map. Leave them out of the plan, unless you read one in a page yourself and can give its words in "seen".';
    expect(first.content).toContain(line);
    // After the fence that holds the template's own words, never inside it.
    expect(first.content.indexOf(line)).toBeGreaterThan(first.content.lastIndexOf('```'));
    // Said only of what is missing: a template with a search box and a password field is not told it has none.
    const facts = { pages: [], blocks: [], forms: [{ id: 'form-1', page: 'a.html', purpose: 'search' as const, method: 'get' as const, action: null, fields: [] }], cart: null, features: [{ id: 'feature-1', kind: 'password' as const, pages: ['a.html'], detail: 'password field' }], links: [] };
    expect(notFoundLine(facts)).toBe('The server found none of these in the template: a card payment, a chat widget, analytics, a video, a map. Leave them out of the plan, unless you read one in a page yourself and can give its words in "seen".');
  });

  it('writes the template’s checkout as an order with its lines, and lets no page send a price or a total', async () => {
    // Seen 2026-11-27: "Place an order → orders: customer_name, …, items, total", one flat row with the total written by the stranger's page.
    const field = (name: string, label: string): string => `<label>${label} <input name="${name}" required></label>`;
    const checkout = `<form method="post" action="#">${field('name', 'Full name')}${field('email', 'Email')}${field('address', 'Delivery address')}${field('postcode', 'Postcode')}<button>Place order</button></form>`;
    const shop = attachments.addSite(session.id, {
      label: 'pots',
      judged: await judgeSite('pots.zip', [
        at('index.html', `${HEAD('Pots')}<body><h1>Pots</h1><a href="cart.html">Basket</a></body></html>`),
        at('cart.html', `${HEAD('Your basket')}<body><h1>Your basket</h1>${checkout}</body></html>`),
        // The same fields on a page that is no basket: a form the finder also calls a checkout, and no order.
        at('visit.html', `${HEAD('Visit us')}<body><h1>Book a visit</h1>${checkout}</body></html>`),
      ]),
    }).attachment.id;
    make();
    const facts = (await useSite({ attachment: shop })).content;
    const basket = /\b(form-\d+) on cart\.html: checkout/.exec(facts)?.[1] as string;
    const visit = /\b(form-\d+) on visit\.html: checkout/.exec(facts)?.[1] as string;
    expect(basket).toBeDefined();
    expect(visit).toBeDefined();
    const order = { form: basket, label: 'Place an order', table: 'orders', writable: ['name', 'email', 'address', 'postcode'] };
    const flat = await useSite({ attachment: shop, plan: { forms: [{ ...order, writable: [...order.writable, 'items', 'total'] }] } });
    expect(flat.isError).toBe(true);
    expect(flat.content).toContain(`"${basket}" is the template's checkout: an order is written with its lines. Give "lines" (the table of its lines) and "linesWritable" (the product and the quantity of a line).`);
    expect(flat.content).toContain(`"${basket}": a customer's page never sends "total". The server works a price or a total out (each line copies its price from the product): take it out of what is writable.`);
    // Lines that send a price, or nothing at all, are no lines.
    const priced = await useSite({ attachment: shop, plan: { forms: [{ ...order, lines: 'order_lines', linesWritable: ['product', 'quantity', 'unit_price', 'line_total', 'tax_amount'] }] } });
    expect(priced.content).toContain(`a customer's page never sends "unit_price", "line_total", "tax_amount".`);
    const empty = await useSite({ attachment: shop, plan: { forms: [{ ...order, lines: 'order_lines' }] } });
    expect(empty.content).toContain(`"${basket}": "linesWritable" names what a line sends (the product and the quantity). With none, no line could be written.`);
    expect(asked).toEqual([]);
    // As the guide asks: the order, its lines, the product and the quantity. A form that is no basket's is left alone,
    // whatever the finder called it; so are names that only look like sums.
    const later = { type: 'template-plan' as const, tables: [], decisions: {}, links: {}, takeOutEmpty: true, added: [], changes: 'not yet' };
    answers.push(later);
    const sound = await useSite({
      attachment: shop,
      plan: { forms: [{ ...order, lines: 'order_lines', linesWritable: ['product', 'quantity'] }, { form: visit, label: 'Book a visit', table: 'visits', writable: ['name', 'email', 'address', 'total_guests', 'discount_code', 'amount', 'donation_amount', 'vat_number', 'price_range'] }] },
    });
    expect(sound.isError, sound.content).toBeUndefined();
    expect(asked).toHaveLength(1);
    // Said once, never a wall: a form on the basket page that sells no basket (one thing, a gift) goes to the person the second time.
    answers.push(later);
    const again = await useSite({ attachment: shop, plan: { forms: [order] } });
    expect(again.isError, again.content).toBeUndefined();
    expect(asked).toHaveLength(2);
    // And still no price from the page, however often it is sent.
    expect((await useSite({ attachment: shop, plan: { forms: [{ ...order, writable: [...order.writable, 'total'] }] } })).content).toContain('never sends "total"');
  });

  it('is guided to call the template’s own rows the template’s, and to report only what is there', () => {
    // The model called a slider's three reviews "made up" and listed a payment and a search the template never had.
    expect(PLAN_GUIDE).toContain('"fromTemplate" (one sample row for each one the template shows, filler included: with a block id, or without one when its words are on a page, as the three reviews of a slider are)');
    expect(PLAN_GUIDE).toContain('"madeUp" (only rows the template has no words for at all, which you would invent; the template\'s own testimonials, team or prices are never made up)');
    expect(PLAN_GUIDE).toContain('"report": only what the template has');
    expect(PLAN_GUIDE).toContain('Never report what a site of this kind usually has: a checkout form with no payment fields has no payment to decide, and filter buttons are not a search.');
    expect(PLAN_GUIDE).not.toContain('The usual ones');
    // A working basket was reported "not available", with Replace picked (seen 2026-11-27).
    expect(PLAN_GUIDE).toContain('a basket kept in the browser (works: the screens keep it, and its checkout is the order)');
    expect(PLAN_GUIDE).not.toContain('rows you would invent: testimonials');
  });

  it('is asked on one card with the server’s own counts and what the project needs added, and its changes approve nothing', async () => {
    answers.push((request) => ({ ...approve()(request), changes: 'Keep Categories as fixed text.' }) as CardAnswer);
    const done = await useSite({ attachment: site, plan: PLAN });
    const shown = asked[0] as Extract<CardRequest, { type: 'template-plan' }>;
    expect(shown.type).toBe('template-plan');
    expect(shown.site).toMatchObject({ attachment: site, name: 'furni', pages: 4 });
    expect(shown.forms[0]).toMatchObject({ table: 'subscribers', tableLabel: 'Subscribers' });
    // The template's Google font is offered with what the screens are built with: the app carries it.
    expect(shown.added.map((item) => item.id)).toContain('font:@fontsource/inter');
    expect(done.content).toContain('Their words:');
    expect(done.content).toContain('Keep Categories as fixed text.');
    expect(done.content).toContain('Build nothing until a plan is approved');
    expect(existsSync(app('template-plan.json'))).toBe(false);
    expect(existsSync(side('site'))).toBe(false);
    expect(installed).toEqual([]);
  });

  it('once approved, is kept with the site’s sha256 and what it allows, its ticks are added with no second card, and the template comes in', async () => {
    answers.push(approve({ tables: ['products'], decisions: { payments: 'leave' }, links: { 'link-1': 'https://furni.example/about' } }));
    const done = await useSite({ attachment: site, plan: PLAN });
    expect(done.isError, done.content).toBeUndefined();
    expect(asked.map((request) => request.type)).toEqual(['template-plan']);
    const kept = readTemplatePlan(root, 'repairs');
    expect(kept?.site).toMatchObject({ attachment: site, name: 'furni', sha256: attachments.find(session.id, site)?.sha256 });
    expect(kept?.answer).toMatchObject({ tables: ['products'], decisions: { payments: 'leave' }, links: { 'link-1': 'https://furni.example/about' } });
    expect(kept?.approved.access).toEqual([
      { table: 'products', methods: ['GET'], select: ['id', 'name', 'price', 'picture'] },
      { table: 'subscribers', methods: ['POST'], writable: ['email'], humanCheck: true },
    ]);
    expect(kept?.approved.roles).toEqual([{ role: 'staff', tables: ['products', 'subscribers'] }]);
    expect(installed.flat()).toContain('@fontsource/inter');
    // The template in: its stylesheet cleaned, the index with the font first, pages as screens, the side marked.
    expect(readFileSync(side('site/index.css'), 'utf8')).toMatch(/@import "@fontsource\/inter\/400\.css";\n@import "@fontsource\/inter\/700\.css";\n@import "\.\/css\/style\.css";/);
    expect(readFileSync(side('site/css/style.css'), 'utf8')).toContain('.gone{background:none}');
    expect(readdirSync(side('pages')).sort()).toEqual(['about-2.tsx', 'about.tsx', 'index.tsx', 'shop.tsx']);
    expect(JSON.parse(readFileSync(app('look.json'), 'utf8'))).toMatchObject({ pictures: 'choose', templateSides: ['customer'] });
    expect(existsSync(side('app.css'))).toBe(false);
    // The hero is a filled spot; the products' pictures are the table's, not spots.
    expect(readSpots(root, 'repairs').map((spot) => ({ id: spot.id, shape: spot.shape, file: spot.file })), readFileSync(side('pages/index.tsx'), 'utf8')).toEqual([{ id: 'a-sofa-by-the-window', shape: 'wide', file: 'template/a-sofa-by-the-window.png' }]);
    // What the model builds by: the plan, said whole.
    expect(done.content).toContain('Build by the plan the person approved');
    expect(done.content).toContain('- categories: NOT a table');
    expect(done.content).toContain('Card payments (On the Checkout page): LEAVE it out');
    expect(done.content).toContain('Chat widget (On every page): LEAVE it out');
    expect(done.content).toContain('link link-1 (“Learn more” on Home) → https://furni.example/about');
  });

  it('imports no font the project does not carry: one left unticked is left out, and the build never fails for it', async () => {
    answers.push(approve({ added: [] }));
    await useSite({ attachment: site, plan: PLAN });
    expect(installed.flat()).not.toContain('@fontsource/inter');
    expect(readFileSync(side('site/index.css'), 'utf8')).not.toContain('@fontsource');
  });

  it('is not asked again for the same template: a build stopped by a limit goes on from it', async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    asked = [];
    const again = await useSite({ attachment: site });
    expect(again.isError, again.content).toBeUndefined();
    expect(asked).toEqual([]);
    expect(again.content).toContain('Build by the plan the person approved');
    // A plan sent again changes nothing: the approved one stands.
    await useSite({ attachment: site, plan: { ...PLAN, tables: [] } });
    expect(asked).toEqual([]);
    expect(readTemplatePlan(root, 'repairs')?.plan.tables).toHaveLength(2);
  });

  it('is asked again for a different template', async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    const other = attachments.addSite(session.id, { label: 'corner-cafe', judged: await judgeSite('corner-cafe.zip', [at('index.html', `${HEAD('Cafe')}<body><h1>Cafe</h1></body></html>`)]) }).attachment.id;
    make();
    const first = await useSite({ attachment: other });
    expect(first.content).toContain('call use_site again with the same attachment and "plan"');
    answers.push(approve());
    await useSite({ attachment: other, plan: { report: [] } });
    expect(asked.at(-1)?.type).toBe('template-plan');
    // An empty plan never takes the place of one with something on it: the app is still built by the first, and the
    // second is kept beside it, so it is not asked again (seen 2026-11-26: an empty plan replaced the approved one).
    const kept = readTemplatePlan(root, 'repairs');
    expect(kept?.site.name).toBe('furni');
    expect(kept?.plan.tables).toHaveLength(2);
    expect(kept?.others?.map((entry) => entry.site.name)).toEqual(['corner-cafe']);
    asked = [];
    expect((await useSite({ attachment: other })).isError).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('keeps what an earlier plan approved when another template’s plan becomes the one the app is built by', async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    const other = attachments.addSite(session.id, { label: 'corner-cafe', judged: await judgeSite('corner-cafe.zip', [at('index.html', `${HEAD('Cafe')}<body><h1>Cafe</h1></body></html>`)]) }).attachment.id;
    make();
    answers.push((request) => ({ ...(approve()(request) as TemplatePlanAnswer), links: {} }));
    await useSite({ attachment: other, plan: { tables: [{ table: 'dishes', label: 'Dishes', columns: [{ column: 'name', label: 'name' }], madeUp: 2, publicRead: ['name'] }], roles: [{ role: 'staff', tables: ['dishes'] }] } });
    const kept = readTemplatePlan(root, 'repairs') as TemplatePlanFile;
    expect(kept.site.name).toBe('corner-cafe');
    expect(kept.others?.map((entry) => entry.site.name)).toEqual(['furni']);
    // The check before going live reads every plan the person approved: nothing of the first is "not on the plan".
    const all = approvedAll(kept);
    expect(all.access.map((entry) => `${entry.table}:${entry.methods.join()}`)).toEqual(['dishes:GET', 'products:GET', 'subscribers:POST']);
    expect(all.roles).toEqual([{ role: 'staff', tables: ['dishes', 'products', 'subscribers'] }]);
    // The first template again, with a narrower answer, replaces its own plan whole: its old yes does not outlive it.
    answers.push(approve({ tables: [] }));
    expect(planFor(root, 'repairs', kept.others?.[0]?.site.sha256 ?? '', 'customer')?.site.name).toBe('furni');
    writeTemplatePlan(root, 'repairs', { ...kept, others: [] });
    await useSite({ attachment: site, plan: PLAN });
    const again = readTemplatePlan(root, 'repairs') as TemplatePlanFile;
    expect(again.site.name).toBe('furni');
    expect(approvedAll(again).access.map((entry) => `${entry.table}:${entry.methods.join()}`)).toEqual(['subscribers:POST', 'dishes:GET']);
  });

  it('waits for the side: approved first, then add_side asks nothing more, then the template comes in', async () => {
    rmSync(app('customer'), { recursive: true, force: true });
    const appJson = JSON.parse(readFileSync(app('manifest/app.json'), 'utf8')) as { sides?: unknown };
    delete appJson.sides;
    writeFileSync(app('manifest/app.json'), JSON.stringify(appJson));
    rmSync(app('look.json'), { force: true });
    answers.push(approve());
    const planned = await useSite({ attachment: site, plan: PLAN });
    expect(planned.content).toContain('call add_side for the customer side (nothing more is asked)');
    const before = asked.length;
    const added = await (tools.find((candidate) => candidate.name === 'add_side') as DesignerTool).run({ side: 'customer' }, context());
    expect(added.isError, added.content).toBeUndefined();
    // No needs card and no "How should it look?": the plan answered both.
    expect(asked.slice(before)).toEqual([]);
    const done = await useSite({ attachment: site });
    expect(done.isError, done.content).toBeUndefined();
    expect(existsSync(side('site/index.css'))).toBe(true);
  });
});

describe('bringing the template in again', () => {
  beforeEach(async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    asked = [];
  });

  it('keeps each picture’s spot, and the picture the person put in it, with no spot made twice', async () => {
    const spotsFile = app('assets/pictures/spots.json');
    const before = readFileSync(spotsFile, 'utf8');
    await useSite({ attachment: site });
    await useSite({ attachment: site });
    expect(readFileSync(spotsFile, 'utf8')).toBe(before);
  });

  it('keeps a file the person changed, and says so', async () => {
    writeFileSync(side('pages/shop.tsx'), 'export default function ShopPage() { return <p>mine</p>; }\n');
    const done = await useSite({ attachment: site });
    expect(readFileSync(side('pages/shop.tsx'), 'utf8')).toContain('mine');
    expect(done.content).toContain('Kept as the person changed them: pages/shop.tsx');
    expect(asked).toEqual([]);
  });

  it('with replace, asks first: kept on "Keep my changes", written over on the other answer', async () => {
    writeFileSync(side('site/css/style.css'), '.mine{color:red}');
    answers.push({ type: 'question', text: 'Keep my changes' });
    await useSite({ attachment: site, replace: true });
    expect(asked.map((request) => request.type)).toEqual(['question']);
    expect(readFileSync(side('site/css/style.css'), 'utf8')).toBe('.mine{color:red}');
    answers.push({ type: 'question', text: 'Bring it in again over my changes' });
    await useSite({ attachment: site, replace: true });
    expect(readFileSync(side('site/css/style.css'), 'utf8')).toContain('.product-item');
  });
});

describe('after the plan', () => {
  beforeEach(async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
  });

  it('the prompt carries what was approved, and no style’s advice over the template’s look', () => {
    // Before a brief is written, a style's layout advice would be sent: never over a template's own look.
    rmSync(app('design.md'), { force: true });
    writeFileSync(app('look.json'), JSON.stringify({ skill: 'clean', pictures: 'choose', templateSides: ['customer'] }));
    expect(designSection(root, 'other', createSkills(), builtInStylesDir())).not.toContain('From a template');
    const section = designSection(root, 'repairs', createSkills(), builtInStylesDir());
    expect(section).toContain('===== From a template =====');
    expect(section).toContain('apps/repairs/template-plan.json');
    expect(section).not.toContain('===== The style');
  });

  it('a template’s picture is swapped from the picture dialog like any spot, and the template brought in again leaves the person’s picture', async () => {
    const state = () => picturesState(root, 'repairs', { sessionId: session.id, version: APP_VERSION, attachments, fileUrl: (path) => path, attachmentUrl: (id) => id });
    const hero = state().spots.find((spot) => spot.id === 'a-sofa-by-the-window');
    expect(hero?.licence?.code).toBe('template');
    const mine = attachments.add(session.id, { filename: 'my-sofa.png', bytes: png(1200, 800, 'mine') });
    const dialog = { search: async () => ({ state: 'off' as const }), sources: () => [], keys: () => null, keepKey: () => undefined, pin: async () => ({ state: 'gone' as const }), picked: async () => null, chosen: async () => undefined };
    const { ready } = await prepareFills([{ spot: 'a-sofa-by-the-window', version: hero?.version ?? '', from: { attachment: mine.id }, alt: 'My sofa' }], { root, key: 'repairs', sessionId: session.id, dialog, attachments });
    const written = await writeFills(ready, { root, key: 'repairs', version: APP_VERSION, by: { id: null, label: 'x' } });
    expect(written.results[0]?.state).toBe('applied');
    const swapped = state().spots.find((spot) => spot.id === 'a-sofa-by-the-window');
    expect(swapped?.licence?.code).not.toBe('template');
    expect(swapped?.alt).toBe('My sofa');
    const file = readSpots(root, 'repairs').find((spot) => spot.id === 'a-sofa-by-the-window')?.file;
    await useSite({ attachment: site });
    expect(readSpots(root, 'repairs').find((spot) => spot.id === 'a-sofa-by-the-window')?.file).toBe(file);
    expect(readSpots(root, 'repairs')).toHaveLength(1);
  });

  it('a sample row takes the template’s own picture by its path, each row its own file', async () => {
    const sample = JSON.parse(readFileSync(app('seeds/sample.json'), 'utf8')) as { tables: { ref: string; rows: Record<string, unknown>[] }[]; assets?: Record<string, { file: string }> };
    const table = (sample.tables[0] as { ref: string }).ref;
    const pictures = tools.find((candidate) => candidate.name === 'use_pictures') as DesignerTool;
    const done = await pictures.run({ pictures: [{ attachment: site, path: 'images/chair.png', for: 'rows', table, row: 1 }, { attachment: site, path: 'images/chair.png', for: 'rows', table, row: 2 }, { attachment: site, path: 'css/style.css', for: 'rows', table }, { attachment: site, for: 'rows', table }] }, context());
    expect(done.content).toContain('2 of the person\'s pictures are in the app now.');
    expect(done.content).toContain('"css/style.css" is not a picture of the template');
    expect(done.content).toContain('give "path"');
    const after = JSON.parse(readFileSync(app('seeds/sample.json'), 'utf8')) as typeof sample;
    const rows = (after.tables.find((candidate) => candidate.ref === table) as { rows: Record<string, unknown>[] }).rows;
    const one = (rows[0] as Record<string, { '@asset': string }>)['picture']?.['@asset'];
    const two = (rows[1] as Record<string, { '@asset': string }>)['picture']?.['@asset'];
    expect(one).toBeDefined();
    expect(two).not.toBe(one);
    expect(readFileSync(app((after.assets?.[one as string] as { file: string }).file)).subarray(24).toString()).toBe('chair');
  });
});

describe.skipIf(!canBuildSides)('the side the template became', () => {
  it('builds, with the template’s stylesheet and its pictures, and the design check has nothing to say of its pages', async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    // What the model writes next: one page per address.
    writeFileSync(
      side('App.tsx'),
      [
        "import { usePath } from '@adminiumjs/adminium/side';",
        "import IndexPage from './pages/index';",
        "import ShopPage from './pages/shop';",
        'export default function App() {',
        '  const path = usePath();',
        "  return path === '/shop' ? <ShopPage /> : <IndexPage />;",
        '}',
        '',
      ].join('\n'),
    );
    const io = fakeIo({ interactive: false });
    const code = await runCli(['app', 'build'], { io, deps: fakeDeps({ cwd: root, env: {} }) });
    expect(io.stderr()).toBe('');
    expect(code).toBe(0);
    const dir = sideBuildDir(root, 'repairs', 'customer');
    const assets = readdirSync(join(dir, 'assets'));
    const css = assets.filter((file) => file.endsWith('.css')).map((file) => readFileSync(join(dir, 'assets', file), 'utf8')).join('\n');
    expect(css).toContain('.product-item');
    expect(css).not.toContain('tailwind');
    // The products' pictures are the page's imports; the hero is a spot the build bakes in.
    expect(assets.some((file) => /^chair-[A-Z0-9]+\.png$/.test(file))).toBe(true);
    // Of the template's pages: no colour, font, inline-style or class finding (a template side keeps its own look).
    const issues = (await designIssues(root, 'repairs')).filter((issue) => /customer\/src\/pages\//.test(issue.line));
    expect(issues.filter((issue) => issue.kind !== 'names').map((issue) => issue.line)).toEqual([]);
    // What is no matter of look is still said: the template's own newsletter box has a placeholder and no name.
    expect(issues.filter((issue) => issue.kind === 'names').map((issue) => issue.line)).toEqual([expect.stringContaining('pages/index.tsx: the field <input type="email" name="email"> has no name a screen reader can say')]);
    // A class the model adds later is still checked.
    writeFileSync(side('pages/shop.tsx'), `${readFileSync(side('pages/shop.tsx'), 'utf8').replace('className={"row"}', 'className={"row my-new-grid"}')}`);
    expect((await designIssues(root, 'repairs')).map((issue) => issue.line).join('\n')).toContain('"my-new-grid"');
  });
});

describe('what a second call never loses', () => {
  beforeEach(async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    asked = [];
  });

  it('keeps the index the person changed, a file they added under site/, and a file an earlier call copied', async () => {
    writeFileSync(side('site/index.css'), '@import "./css/style.css";\n.mine{}\n');
    writeFileSync(side('site/notes.css'), '.added-by-me{}\n');
    await useSite({ attachment: site, also: ['images/bg.png'] });
    expect(existsSync(side('site/images/bg.png'))).toBe(true);
    const done = await useSite({ attachment: site });
    expect(readFileSync(side('site/index.css'), 'utf8')).toContain('.mine{}');
    expect(readFileSync(side('site/notes.css'), 'utf8')).toBe('.added-by-me{}\n');
    expect(existsSync(side('site/images/bg.png'))).toBe(true);
    expect(done.content).toContain('site/index.css');
  });

  it('drops what another template brought in, unchanged, when a new one comes; keeps what the person changed or added', async () => {
    writeFileSync(side('site/notes.css'), '.added-by-me{}\n');
    writeFileSync(side('site/images/bg.png'), png(10, 10, 'changed by me'));
    const other = attachments.addSite(session.id, { label: 'corner-cafe', judged: await judgeSite('corner-cafe.zip', [at('index.html', `${HEAD('Cafe')}<body><h1>Cafe</h1></body></html>`), at('css/style.css', '.cafe{}')]) }).attachment.id;
    make();
    answers.push(approve());
    await useSite({ attachment: other, plan: { report: [] } });
    expect(existsSync(side('site/images/chair.png'))).toBe(false);
    expect(readFileSync(side('site/css/style.css'), 'utf8')).toContain('.cafe');
    expect(readFileSync(side('site/notes.css'), 'utf8')).toBe('.added-by-me{}\n');
    expect(existsSync(side('site/images/bg.png'))).toBe(true);
  });

  it('reads a bookkeeping file that does not hold what it should as none, and goes on', async () => {
    writeFileSync(side('site/.written.json'), 'null');
    writeFileSync(side('site/.spots.json'), '[1,2]');
    const done = await useSite({ attachment: site });
    expect(done.isError, done.content).toBeUndefined();
  });
});

describe('a first call into a side that already has screens', () => {
  it('never writes over a screen file it did not write: the template’s page takes another name', async () => {
    mkdirSync(side('pages'), { recursive: true });
    writeFileSync(side('pages/index.tsx'), 'export default function Mine() { return <p>mine</p>; }\n');
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    expect(readFileSync(side('pages/index.tsx'), 'utf8')).toContain('mine');
    expect(readFileSync(side('pages/index-2.tsx'), 'utf8')).toContain("Made by Adminium Designer's use_site");
  });
});

describe('a page’s own stylesheet', () => {
  it('copies what its <style> imports, and two pages’ styles never share one file', async () => {
    const styled = (body: string): string => `<!doctype html><html><head><title>S</title><style>@import url("css/extra.css"); .x{color:red}</style></head><body>${body}</body></html>`;
    const other = attachments.addSite(session.id, { label: 'styled', judged: await judgeSite('styled.zip', [at('a.html', styled('<p>a</p>')), at('a.htm', styled('<p>b</p>')), at('css/extra.css', '.extra{margin:0}')]) }).attachment.id;
    make();
    answers.push(approve());
    await useSite({ attachment: other, plan: { report: [] } });
    expect(readFileSync(side('site/css/extra.css'), 'utf8')).toContain('.extra');
    const index = readFileSync(side('site/index.css'), 'utf8');
    expect(index).toContain('./css/extra.css');
    expect(existsSync(side('site/a.style-1.css'))).toBe(true);
    expect(existsSync(side('site/a-2.style-1.css'))).toBe(true);
  });
});

describe('a page too deep or too wide to convert in one go', () => {
  it('is converted, or listed, and never stops the other pages', async () => {
    const wide = `<!doctype html><html><head><title>W</title></head><body><div>${'<br>'.repeat(130_000)}</div></body></html>`;
    const big = attachments.addSite(session.id, { label: 'wide', judged: await judgeSite('wide.zip', [at('index.html', `${HEAD('Home')}<body><h1>Home</h1></body></html>`), at('wide.html', wide)]) }).attachment.id;
    make();
    answers.push(approve());
    const done = await useSite({ attachment: big, plan: { report: [] } });
    expect(done.isError, done.content).toBeUndefined();
    expect(existsSync(side('pages/index.tsx'))).toBe(true);
    // Refused for its size, as a page too large is, not lost to a stack that ran out.
    expect(done.content).toMatch(/Not made into screens: wide\.html[^;]*256/);
  });
});

describe('the name of an app made from a template', () => {
  const TITLES = ['Fernhill Ceramics — Handmade stoneware from the Peak Distri…', 'Your basket — Fernhill Ceramics', 'Visit & contact — Fernhill Ceramics', 'Speckled Mug — Fernhill Ceramics', 'Shop — Fernhill Ceramics'];

  it('is the business its pages’ titles agree on, or nothing when they agree on none', () => {
    expect(nameInTitles(TITLES)).toBe('Fernhill Ceramics');
    expect(nameInTitles(['Home | Shopwise', 'Shop | Shopwise', 'About us'])).toBe('Shopwise');
    // One page, or titles with no word in common, name no business for certain.
    expect(nameInTitles(['Fernhill Ceramics — Handmade stoneware'])).toBeNull();
    expect(nameInTitles(['Home', 'Shop', 'Contact'])).toBeNull();
    expect(nameInTitles([])).toBeNull();
    expect(titleOf('<html><head><TITLE>Tea &amp; Cake &#8212; <b>Harbor</b></TITLE></head>')).toBe('Tea & Cake — Harbor');
    expect(titleOf('<html><head></head><body><title>too late</title>'.padStart(20_000, ' '))).toBeNull();
  });

  it('fits when it is that business’s name, or one the person wrote, and never by one shared word or the request’s own words', () => {
    // The name, a short form of it, or the name with a word more.
    expect(nameFits('Fernhill Ceramics', 'Fernhill Ceramics', '')).toBe(true);
    expect(nameFits('fernhill', 'Fernhill Ceramics', 'Make an app from it.')).toBe(true);
    expect(nameFits('Fernhill Ceramics Shop', 'Fernhill Ceramics', '')).toBe(true);
    // Half the business's and half the model's own (seen 2026-11-27: "Fernhill Pottery").
    expect(nameFits('Fernhill Pottery', 'Fernhill Ceramics', 'Make an app from it.')).toBe(false);
    expect(nameFits('Ceramics Shop', 'Fernhill Ceramics', '')).toBe(false);
    expect(nameFits('Site Studio', 'Fernhill Ceramics', 'Make an app from it.')).toBe(false);
    expect(nameFits('Site App', 'Fernhill Ceramics', 'Make an app from this site template.')).toBe(false);
    expect(nameFits('Anna Flowers', 'Shopwise', 'A shop for Anna’s flowers from this template.')).toBe(true);
  });

  it('is not taken at once when it has nothing to do with the template: the titles are handed over once, as data, and the next name is taken', async () => {
    const named: string[] = [];
    const said = { text: 'Make an app from it.' };
    const mine = createDesignerTools(
      {
        root,
        version: APP_VERSION,
        designer: () =>
          ({
            store: { messages: () => [{ turn: 1, message: { role: 'user', content: [{ type: 'text', text: said.text }] } }] },
            needsName: () => true,
            nameApp: async (_id: string, name: string) => {
              named.push(name);
              return { key: name.toLowerCase().replace(/\s+/g, '-'), name };
            },
          }) as never,
        skills: createSkills(),
        listAddOns: async () => [],
        attachments,
      },
      'repairs',
      session.id,
    );
    const nameApp = (name: string, id = session.id) => (mine.find((tool) => tool.name === 'name_app') as DesignerTool).run({ name }, { ...context(), session: { ...session, id } as DesignerSession });
    // The furni template's four pages are titled Furni, Shop, About, About too: they agree on no name, so nothing is said.
    expect((await nameApp('Site Studio')).label).toBe('Named the app Site Studio');
    // A template whose pages all name the business.
    const other = 'ds_000000000000000000000001';
    attachments.addSite(other, { label: 'fernhill', judged: await judgeSite('fernhill.zip', TITLES.map((title, n) => at(n === 0 ? 'index.html' : `p${String(n)}.html`, `<!doctype html><html><head><title>${title.replace('&', '&amp;')}</title></head><body><p>x</p></body></html>`))) });
    named.length = 0;
    const told = await nameApp('Site Studio', other);
    expect(told.isError).toBeUndefined();
    expect(told.label).toBe('Read the template\'s own name first');
    expect(told.facts).toEqual({ outcome: 'declined' });
    expect(named).toEqual([]);
    // The titles are the template's words: fenced as data, and the instruction is the server's own, outside the fence.
    expect(told.content).toContain('Your basket — Fernhill Ceramics');
    expect(told.content.indexOf('Your basket — Fernhill Ceramics')).toBeLessThan(told.content.lastIndexOf('```'));
    expect(told.content).toContain('Call name_app again: with that business\'s name, or with "Site Studio" once more if the person asked for that very name.');
    // The next name is taken, whatever it is: said once, never a wall.
    expect((await nameApp('Site Studio', other)).label).toBe('Named the app Site Studio');
    expect(named).toEqual(['Site Studio']);
    // A name of the business, or one the person asked for, is taken at once.
    const third = 'ds_000000000000000000000002';
    attachments.addSite(third, { label: 'fernhill', judged: await judgeSite('fernhill.zip', TITLES.map((title, n) => at(n === 0 ? 'index.html' : `p${String(n)}.html`, `<!doctype html><html><head><title>${title.replace('&', '&amp;')}</title></head><body><p>y</p></body></html>`))) });
    expect((await nameApp('Fernhill Ceramics', third)).label).toBe('Named the app Fernhill Ceramics');
  });
});

describe('the plan before the app, in a session that holds a template', () => {
  // A new app this session made, never applied: the furni zip is attached, no plan is approved.
  const fresh = { ...session, createdApp: true, version: null } as DesignerSession;
  const TABLE = JSON.stringify({ ref: 'products', columns: [{ ref: 'name', type: 'text' }] });
  const NOT_YET = 'Not yet: this session holds a site template, and its plan comes first.\nThe person has not approved a plan for it.';
  let transcript: { turn: number; message: { role: string; content: Record<string, unknown>[] } }[];
  const mine = (): DesignerTool[] =>
    createDesignerTools(
      { root, version: APP_VERSION, designer: () => ({ store: { messages: () => transcript } }) as never, skills: createSkills(), listAddOns: async () => [], attachments, windowOf: async () => window },
      'repairs',
      session.id,
    );
  const call = (name: string, input: Record<string, unknown>, as: DesignerSession = fresh) => (mine().find((tool) => tool.name === name) as DesignerTool).run(input, { ...context(), session: as });
  beforeEach(() => {
    transcript = [];
  });

  it('is asked for first: the app’s tables, access and sample rows, and its side, are not written before it', async () => {
    // Seen 2026-11-27: the side added (its card asking for packages a template's side never uses), 11 files written, and only then the plan.
    const before = readFileSync(app('manifest/tables/items.json'), 'utf8');
    for (const [name, input] of [
      ['write_file', { path: 'apps/repairs/manifest/tables/products.json', content: TABLE }],
      ['write_file', { path: 'apps/repairs/seeds/sample.json', content: '{}' }],
      ['edit_file', { path: 'apps/repairs/manifest/tables/items.json', old: '"items"', new: '"things"' }],
      ['add_side', { side: 'staff' }],
    ] as const) {
      const said = await call(name, input);
      // Every call of the reply gets the same answer: none of a batch is half written.
      expect(said.isError, `${name}: ${said.content}`).toBe(true);
      expect(said.content).toContain(NOT_YET);
      expect(said.content).toContain('call use_site with the attachment');
    }
    expect(existsSync(app('manifest/tables/products.json'))).toBe(false);
    expect(readFileSync(app('manifest/tables/items.json'), 'utf8')).toBe(before);
    expect(existsSync(app('staff'))).toBe(false);
    expect(asked).toEqual([]);
    // The app's own screens and its brief are not the plan's to hold.
    expect((await call('write_file', { path: 'apps/repairs/design.md', content: 'A brief of eighty characters or more, for the test to have something to write down.' })).isError).toBeUndefined();
  });

  it('is said in one reply and never a wall: from the next reply on the same calls are taken', async () => {
    const said = await call('write_file', { path: 'apps/repairs/manifest/tables/products.json', content: TABLE });
    expect(said.isError).toBe(true);
    // The reply's answers are in the transcript now: the person may have asked for something the template has no part in.
    transcript = [
      { turn: 1, message: { role: 'assistant', content: [{ type: 'tool_call', id: 'c1', name: 'write_file', input: {} }] } },
      { turn: 1, message: { role: 'user', content: [{ type: 'tool_result', callId: 'c1', content: said.content, isError: true }] } },
    ];
    expect((await call('write_file', { path: 'apps/repairs/manifest/tables/products.json', content: TABLE })).isError).toBeUndefined();
    expect(existsSync(app('manifest/tables/products.json'))).toBe(true);
  });

  it('is not said once use_site was answered, with a plan kept, for an app that was applied, or with no template to plan', async () => {
    const write = (as?: DesignerSession) => call('write_file', { path: 'apps/repairs/manifest/tables/products.json', content: TABLE }, as);
    // use_site answered (the plan was proposed, sent back, or this model cannot build from a template): the model knows.
    transcript = [
      { turn: 1, message: { role: 'assistant', content: [{ type: 'tool_call', id: 'u1', name: 'use_site', input: {} }] } },
      { turn: 1, message: { role: 'user', content: [{ type: 'tool_result', callId: 'u1', content: 'What the template holds…' }] } },
    ];
    expect((await write()).isError).toBeUndefined();
    // A use_site call of this very reply, not answered yet, is no answer: the writes beside it are still held.
    transcript = [{ turn: 1, message: { role: 'assistant', content: [{ type: 'tool_call', id: 'u1', name: 'use_site', input: {} }] } }];
    expect((await write()).isError).toBe(true);
    transcript = [];
    // An app that was there before, or was applied: what it lets strangers do is asked by the card before it goes live.
    expect((await write({ ...fresh, createdApp: false } as DesignerSession)).isError).toBeUndefined();
    expect((await write({ ...fresh, version: 2 } as DesignerSession)).isError).toBeUndefined();
    // A plan is kept.
    rmSync(app('manifest/tables/products.json'), { force: true });
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    expect((await write()).isError).toBeUndefined();
  });

  it('is not said of a page attached by itself, which may be a sketch for something else', async () => {
    rmSync(join(root, '.adminium'), { recursive: true, force: true });
    attachments = createAttachments(root);
    attachments.add(session.id, { filename: 'sketch.html', bytes: Buffer.from('<!doctype html><html><head><title>Sketch</title></head><body><h1>Like this</h1></body></html>') });
    expect((await call('write_file', { path: 'apps/repairs/manifest/tables/products.json', content: TABLE })).isError).toBeUndefined();
  });
});

describe('a page and its stylesheet, attached one by one', () => {
  const PAGE = `<!doctype html><html lang="en"><head><title>Fernhill</title><link rel="stylesheet" href="css/style.css"></head><body><h1 class="hero">Pots</h1><form><input type="email" name="email" required><button>Join</button></form></body></html>`;
  let page: string;
  let sheet: string;
  beforeEach(() => {
    attachments = createAttachments(root);
    page = attachments.add(session.id, { filename: 'index.html', bytes: Buffer.from(PAGE) }).id;
    sheet = attachments.add(session.id, { filename: 'style.css', bytes: Buffer.from('.hero{color:teal}') }).id;
    make();
  });

  it('are one template with one plan: the stylesheet is never a template of its own', async () => {
    // Called with the stylesheet, it speaks of the page's template: one page, not none.
    const first = await useSite({ attachment: sheet });
    expect(first.content).toContain('form-1 on index.html');
    answers.push(approve({ links: {} }));
    await useSite({ attachment: page, plan: { forms: [{ form: 'form-1', label: 'Newsletter', table: 'subscribers', writable: ['email'] }] } });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ type: 'template-plan', site: { name: 'index', pages: 1, files: 2 } });
    // The stylesheet goes where the page names it, and comes in with the page.
    expect(readFileSync(side('site/css/style.css'), 'utf8')).toContain('.hero');
    expect(readFileSync(side('site/index.css'), 'utf8')).toContain('"./css/style.css"');
    // With the stylesheet again: no second card, no second plan, the same template.
    asked = [];
    const again = await useSite({ attachment: sheet });
    expect(again.isError, again.content).toBeUndefined();
    expect(asked).toEqual([]);
    const kept = readTemplatePlan(root, 'repairs');
    expect(kept?.plan.forms).toHaveLength(1);
    expect(kept?.others).toBeUndefined();
  });

  it('says in the message that they are one template, by counts and never by a name', () => {
    const note = attachmentNote(attachments, session.id, [page, sheet]);
    expect(note).toContain('The pages and stylesheets attached to this session are one template: that one call brings them all in, by one plan.');
    expect(note).toContain('call use_site once, with the page, and this stylesheet comes in with it. Never call use_site with the stylesheet by itself.');
    for (const word of ['style.css', 'index.html', 'Fernhill']) expect(note).not.toContain(word);
  });
});

describe('a stylesheet by itself', () => {
  it('is brought in with no plan asked and none written', async () => {
    attachments = createAttachments(root);
    const sheet = attachments.add(session.id, { filename: 'look.css', bytes: Buffer.from('.badge{color:teal}') }).id;
    make();
    const done = await useSite({ attachment: sheet });
    expect(done.isError, done.content).toBeUndefined();
    expect(asked).toEqual([]);
    expect(existsSync(app('template-plan.json'))).toBe(false);
    expect(done.content).toContain('Nothing was planned or asked');
    expect(readFileSync(side('site/look.css'), 'utf8')).toContain('.badge');
    expect(readFileSync(side('site/index.css'), 'utf8')).toContain('"./look.css"');
  });

  it('comes in beside the template a side already follows: its files, screens, plan and class names stay', async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    const before = { written: JSON.parse(readFileSync(side('site/.written.json'), 'utf8')) as Record<string, string>, classes: readFileSync(side('site/.classes.json'), 'utf8'), spots: readFileSync(side('site/.spots.json'), 'utf8') };
    const sheet = attachments.add(session.id, { filename: 'extra.css', bytes: Buffer.from('.badge{color:teal}') }).id;
    make();
    asked = [];
    const done = await useSite({ attachment: sheet });
    expect(done.isError, done.content).toBeUndefined();
    expect(asked).toEqual([]);
    expect(readTemplatePlan(root, 'repairs')?.site.name).toBe('furni');
    expect(readTemplatePlan(root, 'repairs')?.others).toBeUndefined();
    // The template's own files and screens are where they were, and the new stylesheet loads after them.
    for (const kept of ['site/css/style.css', 'site/images/chair.png', 'pages/index.tsx', 'pages/shop.tsx']) expect(existsSync(side(kept)), kept).toBe(true);
    const index = readFileSync(side('site/index.css'), 'utf8');
    expect(index.indexOf('"./css/style.css"')).toBeGreaterThan(-1);
    expect(index.indexOf('"./extra.css"')).toBeGreaterThan(index.indexOf('"./css/style.css"'));
    const after = JSON.parse(readFileSync(side('site/.written.json'), 'utf8')) as Record<string, string>;
    expect(after['.template']).toBe(before.written['.template']);
    expect(after['pages/index.tsx']).toBe(before.written['pages/index.tsx']);
    expect(after['site/extra.css']).toBeDefined();
    expect(readFileSync(side('site/.classes.json'), 'utf8')).toBe(before.classes);
    expect(readFileSync(side('site/.spots.json'), 'utf8')).toBe(before.spots);
    // The template again finds its own copy, and asks nothing.
    const again = await useSite({ attachment: site });
    expect(again.isError, again.content).toBeUndefined();
    expect(asked).toEqual([]);
  });
});

describe('the side a plan is for', () => {
  it('is kept with it: another side asks for its own plan, and add_side of another side asks as ever', async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    expect(readTemplatePlan(root, 'repairs')?.side).toBe('customer');
    const staff = await useSite({ attachment: site, side: 'staff' });
    expect(staff.content).toContain('call use_site again with the same attachment and "plan"');
  });

  it('asks no style fonts for an app whose every side follows its template', async () => {
    answers.push(approve());
    await useSite({ attachment: site, plan: PLAN });
    // A style's own fonts, none of them in the project.
    rmSync(join(root, 'node_modules', '@fontsource'), { recursive: true, force: true });
    const withSkill: Look = { skill: 'clean', templateSides: ['customer'] };
    expect(missingFonts(root, withSkill, { builtInDir: builtInStylesDir() }).length).toBeGreaterThan(0);
    expect(missingFonts(root, withSkill, { builtInDir: builtInStylesDir(), key: 'repairs' })).toEqual([]);
  });

  it('tells the model what the plan’s additions came to', async () => {
    answers.push(approve());
    const done = await useSite({ attachment: site, plan: PLAN });
    expect(done.content).toContain('Added: Inter');
  });
});

describe('what is refused', () => {
  it('an app that builds its own screens', async () => {
    writeFileSync(app('build.json'), JSON.stringify({ command: 'npm run build', out: 'dist' }));
    const done = await useSite({ attachment: site });
    expect(done.isError).toBe(true);
    expect(done.content).toContain('builds its own screens');
    expect(asked).toEqual([]);
  });

  it('a page too large to be a screen is listed, and the others are still built', async () => {
    const huge = `${HEAD('Big')}<body>${'<p>x</p>'.repeat(60_000)}</body></html>`;
    const big = attachments.addSite(session.id, { label: 'big', judged: await judgeSite('big.zip', [...SITE.filter((entry) => entry.path !== 'about.htm'), at('big.html', huge)]) }).attachment.id;
    make();
    answers.push(approve());
    const done = await useSite({ attachment: big, plan: PLAN });
    expect(done.content).toContain('Not made into screens: ');
    expect(done.content).toContain('big.html');
    expect(existsSync(side('pages/index.tsx'))).toBe(true);
    expect(existsSync(side('pages/big.tsx'))).toBe(false);
  });
});

describe('each page’s screen', () => {
  it('has a file, an address and a component name of its own, even where two pages’ names would make one', () => {
    const routes = pageRoutes(['index.html', 'index.htm', 'about.html', 'about.htm', 'a b.html', 'a-b.html', 'blog/post.html', 'blog-post.html']);
    const all = [...routes.values()];
    for (const key of ['file', 'screen', 'component'] as const) expect(new Set(all.map((route) => route[key].toLowerCase())).size, key).toBe(all.length);
    expect(routes.get('index.html')).toMatchObject({ file: 'pages/index.tsx', screen: '/' });
    expect(routes.get('index.htm')?.screen).toBe('/index-2');
    expect(routes.get('about.htm')).toMatchObject({ file: 'pages/about-2.tsx', screen: '/about-2' });
  });
});
