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

import { createAttachments, type Attachments } from '../src/designer/attachments.js';
import type { CardAnswer, CardRequest } from '../src/designer/cards.js';
import { createEventLog } from '../src/designer/events.js';
import { designSection } from '../src/designer/prompt.js';
import { builtInStylesDir } from '../src/project/apps/design-skills.js';
import { designIssues } from '../src/project/apps/design-check.js';
import { sideBuildDir } from '../src/project/apps/side-build.js';
import { createSkills } from '../src/designer/skills.js';
import type { DesignerSession } from '../src/designer/session-store.js';
import { judgeSite, type SiteEntry } from '../src/designer/site/judge.js';
import { picturesState, prepareFills, writeFills } from '../src/designer/pictures-apply.js';
import { readSpots } from '../src/designer/spots.js';
import { readTemplatePlan, type TemplatePlanAnswer } from '../src/designer/site/template-plan.js';
import { SMALL_WINDOW_SENTENCE } from '../src/designer/site/plan-step.js';
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
    { id: 'nav', label: 'Navigation bar', where: 'On every page', status: 'works' },
    { id: 'payments', label: 'Card payments', where: 'On the Checkout page', status: 'not-available', build: 'a payment link emailed for each order', buildServerCode: true, replace: 'pay on delivery, marked paid by staff', leave: 'the card form comes off the page' },
    { id: 'chat', label: 'Chat widget', where: 'On every page', status: 'not-available', build: 'a contact form in place of the chat', leave: 'the chat bubble comes off the page' },
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
    expect(readTemplatePlan(root, 'repairs')?.site.name).toBe('corner-cafe');
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
    const dialog = { search: async () => ({ state: 'off' as const }), sources: () => [], pin: async () => ({ state: 'gone' as const }), picked: async () => null, chosen: async () => undefined };
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
    expect(issues.map((issue) => issue.line)).toEqual([]);
    // A class the model adds later is still checked.
    writeFileSync(side('pages/shop.tsx'), `${readFileSync(side('pages/shop.tsx'), 'utf8').replace('className={"row"}', 'className={"row my-new-grid"}')}`);
    expect((await designIssues(root, 'repairs')).map((issue) => issue.line).join('\n')).toContain('"my-new-grid"');
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
