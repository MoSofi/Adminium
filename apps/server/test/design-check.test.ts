// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The design checks: what an app's own screens lack as a design, read from
 * its files.
 *
 * Each reading is held to what it would MISS and what it would wrongly say,
 * not only to the case it was written for: a class built in pieces is passed
 * over, a class in a comment is not one, a class defined only inside a media
 * rule counts, a mark of plain typography is no emoji.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { classesDefined, classesIn, dashboardPageLine, designIssues, emojiIn, isPaletteClass, lowContrastRules, rawColours, unbroughtCalls, unbroughtComponents, unbroughtPicture } from '../src/project/apps/design-check.js';
import { applyLook, resolveLook } from '../src/project/apps/look.js';

let root: string;
const src = (): string => join(root, 'apps', 'cakes', 'customer', 'src');
const write = (file: string, text: string): void => {
  mkdirSync(join(src(), '..', '..', file, '..'), { recursive: true });
  writeFileSync(join(root, 'apps', 'cakes', file), text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-design-check-'));
  mkdirSync(src(), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"x"}');
  write('customer/src/main.tsx', "import { App } from './App';");
  write('customer/src/app.css', '.page { margin: 0 } .logo { height: 2rem } .card, .btn.btn-primary { color: red } @media (min-width: 40rem) { .wide-only { display: grid } }');
  applyLook(root, 'cakes', { skill: 'warm' });
  write('assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const screen = (body: string): string => `import logo from '../../assets/logo.svg';\nexport function App() { return (${body}); }\n`;
const kinds = async (opts = {}): Promise<string[]> => (await designIssues(root, 'cakes', opts)).map((issue) => issue.kind);

describe('reading the classes a screen uses', () => {
  it('takes names written out in full, in quotes, in braces, in a template and in a helper’s arguments', () => {
    const source = `
      <div className="page hero-wrap">
        <p className={'lead  big'} />
        <p className={\`card \${open ? 'is-open' : ''} tail\`} />
        <p className={cn('btn', active && "btn-primary", { 'is-on': on })} />
        <p class="plain" />
      </div>`;
    expect(classesIn(source).sort()).toEqual(['big', 'btn', 'btn-primary', 'card', 'hero-wrap', 'is-on', 'is-open', 'lead', 'page', 'plain', 'tail']);
  });

  it('passes over what it cannot read as a whole name: a piece beside ${…}, a variable, a comment', () => {
    const source = `
      // <div className="commented-out" />
      /* className="also-commented" */
      <p className={\`btn-\${size} card--\${kind}-x solid\`} />
      <p className={styles} />
      <p className={names.join(' ')} />`;
    expect(classesIn(source)).toEqual(['solid']);
  });

  it('reads the names a stylesheet gives rules to, inside media rules too, with Tailwind’s escapes taken off', () => {
    const css = '.a, .b-c:hover > .d_e::before { } @media (min-width: 1px) { .inside { } } .md\\:p-4 { } .w-\\[12px\\] { } /* .commented { } */ a[href$=".pdf"] { }';
    expect([...classesDefined(css)].sort()).toEqual(['a', 'b-c', 'd_e', 'inside', 'md:p-4', 'pdf', 'w-[12px]']);
  });
});

describe('the design checks', () => {
  it('say nothing of a screen that is designed from what exists', async () => {
    write('customer/src/App.tsx', screen('<div className="page"><img className="logo" src={logo} alt="" /><p className="card wide-only">©  2026 ★ → ✓</p><i style={{ \'--w\': 3 }} /></div>'));
    expect(await kinds()).toEqual([]);
  });

  it('name a class nothing styles, by its name and its file, and say where to write it', async () => {
    write('customer/src/App.tsx', screen('<div className="page culture-grid"><img src={logo} alt="" /><p className="testimonial card" /></div>'));
    const issues = await designIssues(root, 'cakes');
    expect(issues.map((issue) => issue.kind)).toEqual(['class', 'class']);
    expect(issues[0]?.line).toBe(
      '- The class "culture-grid" (apps/cakes/customer/src/App.tsx) is styled nowhere, so that part shows unstyled: write .culture-grid { … } in apps/cakes/customer/src/design.css, or use a made part of app.css in its place.',
    );
    // Written in the app's own stylesheet, it is styled.
    write('customer/src/design.css', '.culture-grid { display: grid } @media (min-width: 40rem) { .testimonial { padding: 1rem } }');
    expect(await kinds()).toEqual([]);
  });

  it('name an emoji used as an icon, and word the fix by whether the project has icons', async () => {
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" /><span>🍕</span> {/* 🎉 in a comment is nobody’s icon */}</div>'));
    const without = await designIssues(root, 'cakes');
    expect(without.map((issue) => issue.kind)).toEqual(['emoji']);
    expect(without[0]?.line).toContain('draw a small inline SVG');
    expect((await designIssues(root, 'cakes', { icons: true }))[0]?.line).toContain('import an icon from "lucide-react"');
    expect(emojiIn('const a = "© ® ™ ♥ ☎ ✓ ★ → ▶";')).toBeNull();
    expect(emojiIn('<b>👍</b>')).toBe('👍');
  });

  it('name colours and fonts written as values in the app’s stylesheet, past a few, and an inline style', async () => {
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" /><p style={{ color: "red", marginTop: 4 }} /></div>'));
    write('customer/src/design.css', '.a { color: #1f4d3a; background: #F5A524; border-color: #abc; outline-color: #123456; box-shadow: 0 0 0 #000; font-family: "Comic Sans MS", cursive } .b { font-family: "Playfair Display", serif }');
    const issues = await designIssues(root, 'cakes');
    expect(issues.map((issue) => issue.kind)).toEqual(['colour', 'font', 'inline']);
    expect(issues[1]?.line).toContain('"Comic Sans MS"');
    // Three colours or fewer are a shadow or a gradient: nothing is said.
    write('customer/src/design.css', '.a { background: linear-gradient(#1f4d3a, #f5a524) } .b { color: #fff }');
    expect(rawColours('.a { color: #FFF; fill: #000000; stroke: #1F4D3A; } /* #abcdef */')).toEqual(['#1f4d3a']);
    expect((await kinds()).includes('colour')).toBe(false);
  });

  it('ask a public side for a logo it shows, and refuse one with a script in it', async () => {
    write('customer/src/App.tsx', 'export function App() { return <div className="page" />; }');
    expect((await designIssues(root, 'cakes'))[0]?.line).toContain('is written and no screen shows it');
    rmSync(join(root, 'apps', 'cakes', 'assets', 'logo.svg'));
    expect((await designIssues(root, 'cakes'))[0]?.line).toContain('The public page has no logo: write apps/cakes/assets/logo.svg');
    // A logo drawn as a component is a logo.
    write('customer/src/App.tsx', 'function Logo() { return <svg />; }\nexport function App() { return <div className="page"><Logo /></div>; }');
    expect(await kinds()).toEqual([]);
    write('assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><circle r="4"/></svg>');
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" /></div>'));
    expect((await designIssues(root, 'cakes'))[0]?.line).toContain('has a script or an address of another site in it');
  });

  it('ask for the brief only of an app this session is making, and say nothing for an app with no starter side', async () => {
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" /></div>'));
    expect(await kinds({ fresh: true })).toEqual(['brief']);
    write('design.md', `# Brief\n${'A warm page for a bakery, with the menu first. '.repeat(3)}`);
    expect(await kinds({ fresh: true })).toEqual([]);
    rmSync(join(src(), 'theme.css'));
    write('customer/src/App.tsx', screen('<div className="nothing-styles-this">🍕</div>'));
    expect(await kinds({ fresh: true })).toEqual([]);
  });

  it('say the same words each time a finding stands, so it can be said once and not again', async () => {
    write('customer/src/App.tsx', screen('<div className="page zz-b zz-a"><img src={logo} alt="" /></div>'));
    const first = (await designIssues(root, 'cakes')).map((issue) => issue.line);
    const second = (await designIssues(root, 'cakes')).map((issue) => issue.line);
    expect(second).toEqual(first);
    expect(first.map((line) => /"(zz-[ab])"/.exec(line)?.[1])).toEqual(['zz-a', 'zz-b']);
  });
});

describe('a colour of Tailwind’s own palette', () => {
  it('is told from a theme class, a size, a word that only looks like one, and a class of the app’s own', () => {
    for (const name of ['bg-red-500', 'text-slate-700', 'md:hover:bg-emerald-50', 'border-t-zinc-200', 'from-amber-400', 'text-rose-950/80', 'ring-offset-sky-300']) {
      expect(isPaletteClass(name), name).toBe(true);
    }
    for (const name of ['bg-accent', 'text-muted', 'bg-surface-2', 'text-red', 'bg-red', 'red-500', 'text-2xl', 'grid-cols-500', 'bg-red-550', 'card-red-500', 'bg-[#ff0000]', 'text-blue-500x']) {
      expect(isPaletteClass(name), name).toBe(false);
    }
  });

  it('is said in a screen only where the project has Tailwind: without it the class is one nothing styles, and that is said instead', async () => {
    write('customer/src/App.tsx', screen('<div className="page bg-red-500 md:text-slate-700"><img src={logo} alt="" /></div>'));
    expect(await kinds()).toEqual(['class', 'class']);
    // The project carries Tailwind 4 (a stand-in that compiles nothing: what Tailwind knows is then not guessed at).
    writeFileSync(join(root, 'package.json'), '{"name":"x","dependencies":{"tailwindcss":"4.0.0"}}');
    mkdirSync(join(root, 'node_modules', 'tailwindcss'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'tailwindcss', 'package.json'), '{"name":"tailwindcss","version":"4.0.0","main":"index.js"}');
    writeFileSync(join(root, 'node_modules', 'tailwindcss', 'index.js'), 'module.exports = {};');
    const issues = await designIssues(root, 'cakes');
    expect(issues.map((issue) => issue.kind)).toEqual(['colour']);
    expect(issues[0]?.line).toContain('apps/cakes/customer/src/App.tsx uses Tailwind\'s own colours (bg-red-500, md:text-slate-700): use the theme\'s in their place (bg-accent');
    // A theme class is the theme's: nothing is said.
    write('customer/src/App.tsx', screen('<div className="page bg-accent text-muted"><img src={logo} alt="" /></div>'));
    expect(await kinds()).toEqual([]);
  });
});

describe('text that does not read on its background', () => {
  const theme = (): NonNullable<ReturnType<typeof resolveLook>['theme']> => resolveLook(root, { skill: 'warm' }).theme as NonNullable<ReturnType<typeof resolveLook>['theme']>;

  it('is found where one rule sets both to values of the theme that fail 4.5:1, and the ink for that background is named', async () => {
    expect(lowContrastRules('.hero { color: var(--muted); background: var(--band) }', theme())).toEqual([{ selector: '.hero', text: 'muted', on: 'band' }]);
    expect(lowContrastRules('.tag{background-color:var(--accent);color:var(--accent) !important}', theme())).toEqual([{ selector: '.tag', text: 'accent', on: 'accent' }]);
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" /></div>'));
    write('customer/src/design.css', '.hero { color: var(--muted); background: var(--band) }');
    const issues = await designIssues(root, 'cakes');
    expect(issues.map((issue) => issue.kind)).toEqual(['contrast']);
    expect(issues[0]?.line).toBe('- apps/cakes/customer/src/design.css: ".hero" puts var(--muted) on var(--band), which is hard to read: on that background use var(--band-ink).');
  });

  it('says nothing of what it cannot read for certain: a pair that passes, one half alone, a gradient, a mix, a value of the app’s own, a comment, a rule inside a media rule that passes', () => {
    const quiet = [
      '.a { color: var(--text); background: var(--bg) }',
      '.b { color: var(--band-ink); background: var(--band) }',
      '.c { color: var(--accent-ink); background-color: var(--accent) }',
      '.d { color: var(--muted) }',
      '.e { background: var(--band) }',
      '.f { color: var(--muted); background: linear-gradient(var(--band), var(--accent)) }',
      '.g { color: color-mix(in srgb, var(--muted) 60%, white); background: var(--band) }',
      '.h { color: var(--mine); background: var(--band) }',
      '/* .i { color: var(--muted); background: var(--band) } */',
      '@media (min-width: 40rem) { .j { color: var(--text); background: var(--surface) } }',
      // The later value wins: the pair that fails was written and then replaced.
      '.k { color: var(--muted); background: var(--band); color: var(--band-ink) }',
      // A control that is switched off is meant to read faintly.
      '.btn:disabled { color: var(--muted); background: var(--band) }',
      '.btn[disabled], .btn[aria-disabled="true"] { color: var(--muted); background: var(--band) }',
      // Another property that only ends in "color".
      '.l { border-color: var(--muted); background: var(--band) }',
    ];
    for (const css of quiet) expect(lowContrastRules(css, theme()), css).toEqual([]);
    // Inside a media rule it is found, under the rule's own selector.
    expect(lowContrastRules('@media (min-width: 40rem) { .m { color: var(--muted); background: var(--band) } }', theme())).toEqual([{ selector: '.m', text: 'muted', on: 'band' }]);
  });
});

describe('a turn asked only for a look that wrote a dashboard page', () => {
  it('is told once that dashboard pages take no design, naming the page', () => {
    expect(dashboardPageLine('Make it warmer, with a serif font', ['apps/cakes/customer/src/design.css', 'apps/cakes/manifest/pages/cakes-orders.json'])).toBe(
      "- apps/cakes/manifest/pages/cakes-orders.json is a dashboard page, and this turn was asked for a look: dashboard pages are Adminium's own and take no design. If the change there was not asked for, put the page back as it was; the look belongs in the app's own screens (set_style, design.css).",
    );
    expect(dashboardPageLine('darker colours please', ['pages/orders.json'])).toContain('pages/orders.json is a dashboard page');
  });

  it('says nothing when the request asked for more than a look, said nothing of a look, or no page was written', () => {
    expect(dashboardPageLine('Make it warmer and add a status column to the orders page', ['apps/cakes/manifest/pages/cakes-orders.json'])).toBeNull();
    expect(dashboardPageLine('Add a field for notes', ['apps/cakes/manifest/pages/cakes-orders.json'])).toBeNull();
    expect(dashboardPageLine('Make it warmer', ['apps/cakes/customer/src/App.tsx', 'apps/cakes/manifest/tables/orders.json', 'apps/cakes/customer/src/pages/Home.tsx'])).toBeNull();
    expect(dashboardPageLine('Make it warmer', [])).toBeNull();
  });
});

describe('a picture shown from an address the screen made up', () => {
  it('is found when the address is written out: a path on this server, in quotes, in braces or in a template', async () => {
    expect(unbroughtPicture('<img src="/apps/cakes/assets/hero.jpg" alt="" />')).toBe('/apps/cakes/assets/hero.jpg');
    expect(unbroughtPicture("<img alt='' className=\"x\" src={'./hero.jpg'} />")).toBe('./hero.jpg');
    expect(unbroughtPicture('<img src={`/apps/cakes/assets/gallery${i}.jpg`} />')).toBe('/apps/cakes/assets/gallery${i}.jpg');
    expect(unbroughtPicture("<img src={`/apps/cakes/assets/${item.picture || 'placeholder.jpg'}`} />")).toContain('/apps/cakes/assets/${item.picture');
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" /><img src="/apps/cakes/assets/hero.jpg" alt="" /></div>'));
    const issues = await designIssues(root, 'cakes');
    expect(issues.map((issue) => issue.kind)).toEqual(['pictures']);
    expect(issues[0]?.line).toContain('apps/cakes/customer/src/App.tsx shows a picture from "/apps/cakes/assets/hero.jpg", an address nothing is at');
    // A file the side brings as it is, from its public/ folder, is there.
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" /><img src="./badge.png" alt="" /></div>'));
    expect(await kinds()).toEqual(['pictures']);
    write('customer/public/badge.png', 'png');
    expect(await kinds()).toEqual([]);
  });

  it('is not said of a picture that is brought: imported, given by a function, inline, of the public API, of another site, or in a comment', () => {
    const fine = [
      '<img src={logo} alt="" />',
      '<img src={hero1} className="media" />',
      '<img src={pictureUrl(row.picture)} />',
      '<img src={row.picture ? pictureUrl(row.picture) : fallback} />',
      '<img src={`${base}/hero.jpg`} />',
      '<img src="data:image/png;base64,AAAA" />',
      '<img src="https://images.example.com/a.jpg" />',
      '<img src="/api/v1/public/files/abc" />',
      '// <img src="/apps/cakes/assets/hero.jpg" />',
      '{/* <img src="./hero.jpg" /> */}',
      '<Image source="/apps/cakes/hero.jpg" />',
      '<a href="/apps/cakes/menu">Menu</a>',
      // A route of the screen's own, not a picture's file.
      '<img src={`/files/${id}`} />',
      '<img src="/qr" />',
    ];
    for (const source of fine) expect(unbroughtPicture(source), source).toBeNull();
  });
});

describe('a component a screen draws and never brings', () => {
  it('is named when it is neither imported nor declared, and the page would come up blank', async () => {
    expect(unbroughtComponents("import { Input } from './ui/input';\nexport function App() { return <form><Label>Name</Label><Input /><Card.Body /></form>; }")).toEqual(['Card', 'Label']);
    write('customer/src/App.tsx', "import logo from '../../assets/logo.svg';\nexport function App() { return <div className=\"page\"><img src={logo} alt=\"\" /><Label>Name</Label></div>; }");
    const issues = await designIssues(root, 'cakes');
    expect(issues.map((issue) => issue.kind)).toEqual(['component']);
    expect(issues[0]?.line).toContain('apps/cakes/customer/src/App.tsx draws <Label> and neither imports nor declares it');
  });

  it('is not said of what is brought in any of the ways a screen brings a component, nor of a type between angle brackets', () => {
    const fine = [
      "import React, { useState } from 'react';\nimport { Calendar, Clock as ClockIcon } from 'lucide-react';\nimport Logo from './Logo';\nimport * as Ui from './ui';\nfunction App() { return <><Calendar /><ClockIcon /><Logo /><Ui.Card /><React.Fragment /></>; }",
      "function Row({ item }: { item: Item }) { return <li>{item.name}</li>; }\nconst List = () => <ul><Row item={x} /></ul>;\nexport function App() { return <List />; }",
      "const { Provider, Consumer: Reader } = Ctx;\nexport function App() { return <Provider><Reader /></Provider>; }",
      "function Tile({ icon: Icon, as: Tag = 'div' }) { return <Tag><Icon size={16} /></Tag>; }",
      "const items = rows.map((Icon) => <Icon key={1} />);",
      // Names brought in ways that are neither an import nor a declaration: out of a list, as a later argument, as a type's own letter.
      "const tiles = icons.map(([label, Icon]) => <li key={label}><Icon size={16} /></li>);",
      "function row(label: string, Icon: LucideIcon) { return <p><Icon />{label}</p>; }",
      "const pick = <T extends object>(row: T) => row;\nconst both = <A, B>(a: A, b: B) => [a, b];",
      // A tag's name inside a quoted text draws nothing.
      "export function App() { return <p title='Press <Enter> to send'>{\"<Tab> moves on\"}</p>; }",
      // Types, not tags.
      "const [rows, setRows] = useState<Item[]>([]);\nconst m = new Map<Key, Row>();\nfunction pick<T>(x: Array<T>): Promise<Item> { return x as unknown as Promise<Item>; }",
      "export function App() { return <main><section className=\"page\" /></main>; }",
      "// <Missing />\n/* <AlsoMissing /> */\nexport function App() { return <p>{'<NotATag>'}</p>; }",
    ];
    for (const source of fine) expect(unbroughtComponents(source), source).toEqual([]);
  });
});

describe('a public page with no picture on it', () => {
  it('is said once while the app is being made, where pictures can be looked for, and not of a page that shows one', async () => {
    write('design.md', `# Brief\n${'A warm page for a bakery, with the menu first. '.repeat(3)}`);
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" className="logo" /><h1>Cakes</h1></div>'));
    // Pictures can be looked for here (the list of empty picture columns is given, and is empty).
    expect(await kinds({ fresh: true, emptyPictureColumns: [] })).toEqual(['pictures']);
    // Not where this server looks for none, and not of an app that already has a version.
    expect(await kinds({ fresh: true })).toEqual([]);
    expect(await kinds({ emptyPictureColumns: [] })).toEqual([]);
    // A picture of the page's own, or a row's, is a picture.
    write('customer/src/App.tsx', `import hero1 from '../../assets/pictures/hero-1.jpg';\n${screen('<div className="page"><img src={logo} alt="" /><img src={hero1} alt="" /></div>')}`);
    expect(await kinds({ fresh: true, emptyPictureColumns: [] })).toEqual([]);
    write('customer/src/App.tsx', `import { pictureUrl } from '@adminiumjs/public-client';\n${screen('<div className="page"><img src={logo} alt="" /><img src={pictureUrl(base, config, table, row.id, "picture", row.picture)} alt="" /></div>')}`);
    expect(await kinds({ fresh: true, emptyPictureColumns: [] })).toEqual([]);
    // Any picture the screen imports, and one a stylesheet of the app's own draws behind a part, is a picture.
    write('customer/src/App.tsx', `import shot from '../../assets/hero.jpg';\n${screen('<div className="page"><img src={logo} alt="" /><Hero image={shot} /></div>')}\nfunction Hero() { return null; }`);
    expect(await kinds({ fresh: true, emptyPictureColumns: [] })).toEqual([]);
    write('customer/src/App.tsx', screen('<div className="page hero-photo"><img src={logo} alt="" className="logo" /></div>'));
    write('customer/src/design.css', '.hero-photo { background-image: url("data:image/png;base64,AAAA"); }');
    expect(await kinds({ fresh: true, emptyPictureColumns: [] })).toEqual([]);
    write('customer/src/design.css', '');
    // A picture column that is empty is said by its own line, not twice.
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" className="logo" /></div>'));
    expect(await kinds({ fresh: true, emptyPictureColumns: [{ table: 'cakes', column: 'picture' }] })).toEqual(['pictures']);
  });
});

describe('a helper a screen calls and never brings', () => {
  it('is named when it is neither imported nor declared, and the page would come up blank', async () => {
    expect(unbroughtCalls('export function App() { return <p>{formatTenantMoney(row.price)} {formatDate(row.day)}</p>; }')).toEqual(['formatDate', 'formatTenantMoney']);
    write('customer/src/App.tsx', screen('<div className="page"><img src={logo} alt="" /><b>{formatTenantMoney(12)}</b></div>'));
    const issues = await designIssues(root, 'cakes');
    expect(issues.map((issue) => issue.kind)).toEqual(['component']);
    expect(issues[0]?.line).toContain('apps/cakes/customer/src/App.tsx calls formatTenantMoney() and neither imports nor declares it');
  });

  it('is not said of what is brought or made in any of the ways a screen does, nor of what a browser gives, nor of plain words', () => {
    const fine = [
      "import { useState, useEffect } from 'react';\nimport { createPublicClient, pictureUrl as urlOf } from '@adminiumjs/public-client';\nexport function App() { const [a, setA] = useState(0); useEffect(() => { setA(1); }, []); return <p>{urlOf(a)}{createPublicClient(a)}</p>; }",
      "function formatMoney(n: number) { return String(n); }\nconst toDay = (d: string) => d;\nasync function loadRows() {}\nexport function App() { loadRows(); return <p>{formatMoney(1)}{toDay('x')}</p>; }",
      // Defined where it stands, in an object or a class; called through the object.
      "const api = { loadRows(table: string): Promise<void> { return go(table); }, async saveRow() {} };\nclass Store { getAll() { return []; } }\nfunction go(t: string) { return Promise.resolve(); }",
      // Handed in: an argument, a prop, taken out of an object.
      "export function Row({ onPick, formatPrice }: Props) { return <button onClick={() => onPick(1)}>{formatPrice(2)}</button>; }",
      "const { loadMore, hasMore } = usePager();\nimport { usePager } from './pager';\nloadMore();",
      // What a browser gives, and a method of something.
      "setTimeout(() => {}, 10); parseInt('1', 10); encodeURIComponent('a'); window.scrollTo(0, 0); rows.forEach((r) => r); data.toFixed(2); new Intl.NumberFormat().format(1);",
      // Words, not code.
      "export function App() { return <p title=\"callNow(5)\">Rooms(4), price(s), seeMore (soon)</p>; }",
      "// formatMoney(1)\n/* loadRows() */\nexport const x = 1;",
    ];
    for (const source of fine) expect(unbroughtCalls(source), source).toEqual([]);
  });
});

describe('a side with more than one page and one address', () => {
  const HELPER = "import { Link, usePath, pathParams, go } from '@adminiumjs/adminium/side'";
  const address = async (): Promise<string[]> => (await designIssues(root, 'cakes')).filter((issue) => issue.kind === 'address').map((issue) => issue.line);
  /** A staff side beside the customer one, as add_side leaves it. */
  const staff = (app: string, nav: unknown[]): void => {
    write('staff/src/main.tsx', "import { App } from './App';");
    write('staff/src/app.css', '.page { margin: 0 }');
    write('staff/src/App.tsx', app);
    write('staff/nav.json', JSON.stringify(nav));
    applyLook(root, 'cakes', { skill: 'warm' });
  };
  const PLAIN = 'export function App() { return <div className="page" />; }\n';

  it('is named when its screens are files of pages and nothing reads the address', async () => {
    write('customer/src/App.tsx', screen('<div className="page"><img className="logo" src={logo} alt="" /></div>'));
    write('customer/src/pages/Menu.tsx', 'export function Menu() { return <div className="page" />; }\n');
    expect(await address()).toEqual([]);
    write('customer/src/pages/Cart.tsx', 'export function Cart() { return <div className="page" />; }\n');
    const [line, ...more] = await address();
    expect(more).toEqual([]);
    expect(line).toContain('apps/cakes/customer/src/');
    expect(line).toContain('2 files under src/pages/');
    // The fix is said exactly: the import, the names, where each goes.
    expect(line).toContain(HELPER);
    expect(line).toContain('const path = usePath()');
    expect(line).toContain('<Link to="/menu">');
    // screens/ and views/ are read the same way.
    for (const folder of ['screens', 'views']) {
      rmSync(join(src(), 'pages'), { recursive: true, force: true });
      rmSync(join(src(), 'screens'), { recursive: true, force: true });
      write(`customer/src/${folder}/A.tsx`, 'export function A() { return <div className="page" />; }\n');
      write(`customer/src/${folder}/B.tsx`, 'export function B() { return <div className="page" />; }\n');
      expect((await address())[0], folder).toContain(`2 files under src/${folder}/`);
    }
  });

  it('is named for a staff side whose nav.json lists more than one screen: each would open the same one', async () => {
    write('customer/src/App.tsx', screen('<div className="page"><img className="logo" src={logo} alt="" /></div>'));
    staff(PLAIN, [{ id: 'jobs', path: '', label: 'Jobs' }]);
    expect(await address()).toEqual([]);
    staff(PLAIN, [{ id: 'jobs', path: '', label: 'Jobs' }, { id: 'done', path: 'done', label: 'Done' }]);
    const lines = await address();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('apps/cakes/staff/nav.json lists 2 screens');
    expect(lines[0]).toContain(HELPER);
    // A nav file that cannot be read says nothing here: the build says it.
    write('staff/nav.json', '[{ "id": ');
    expect(await address()).toEqual([]);
  });

  it('names the state a screen keeps its page in, when another sign says the side has pages', async () => {
    const stateful = "import { useState } from 'react';\nexport function App() { const [screen, setScreen] = useState<'jobs' | 'done'>('jobs'); return <div className=\"page\" onClick={() => setScreen('done')}>{screen}</div>; }\n";
    write('customer/src/App.tsx', screen('<div className="page"><img className="logo" src={logo} alt="" /></div>'));
    staff(stateful, [{ id: 'jobs', path: '', label: 'Jobs' }, { id: 'done', path: 'done', label: 'Done' }]);
    expect((await address())[0]).toContain('(if const [screen, …] = useState is what chooses the page, the path takes its place)');
    staff(stateful.replace("useState<'jobs' | 'done'>('jobs')", "useState('jobs')"), [{ id: 'jobs', path: '', label: 'Jobs' }, { id: 'done', path: 'done', label: 'Done' }]);
    expect((await address())[0]).toContain('(if const [screen, …] = useState is what chooses the page, the path takes its place)');
    // The state alone is no sign: a word like "view" or "page" is used for much that is no page.
    staff(stateful, [{ id: 'jobs', path: '', label: 'Jobs' }]);
    expect(await address()).toEqual([]);
  });

  it('is not said of one page that turns its rows a page at a time', async () => {
    write(
      'customer/src/App.tsx',
      "import { useState } from 'react';\nimport logo from '../../assets/logo.svg';\nexport function App() { const [page, setPage] = useState(1); const [view, setView] = useState('grid'); return <div className=\"page\" onClick={() => { setPage(page + 1); setView('list'); }}><img className=\"logo\" src={logo} alt=\"\" />{view}</div>; }\n",
    );
    write('customer/src/Pager.tsx', 'export function Pager() { return <div className="page" />; }\n');
    expect(await address()).toEqual([]);
    // And where the side does have pages, a number in a state named "page" is not called the page.
    write('customer/src/pages/A.tsx', 'export function A() { return <div className="page" />; }\n');
    write('customer/src/pages/B.tsx', 'export function B() { return <div className="page" />; }\n');
    const line = (await address())[0];
    expect(line).not.toContain('const [page, …]');
    // A state named "view" with text in it may be the page or a grid: it is put as a question, never as a fact.
    expect(line).toContain('(if const [view, …] = useState is what chooses the page, the path takes its place)');
  });

  it('is not said of a side that reads its address, however it brings the helper', async () => {
    write('customer/src/pages/Menu.tsx', 'export function Menu() { return <div className="page" />; }\n');
    write('customer/src/pages/Cart.tsx', 'export function Cart() { return <div className="page" />; }\n');
    for (const brought of ["import { Link } from '@adminiumjs/adminium/side';", "import { en, usePath, type CustomerConfig } from '@adminiumjs/adminium/side';", "import {\n  en,\n  go,\n} from \"@adminiumjs/adminium/side\";"]) {
      write('customer/src/App.tsx', `${brought}\n${screen('<div className="page"><img className="logo" src={logo} alt="" /></div>')}`);
      expect(await address(), brought).toEqual([]);
    }
    // Named in a comment, or brought from somewhere else, it is not the helper.
    write('customer/src/App.tsx', `// import { Link } from '@adminiumjs/adminium/side';\nimport { Link } from './ui/link';\nimport { en } from '@adminiumjs/adminium/side';\n${screen('<div className="page"><img className="logo" src={logo} alt="" /></div>')}`);
    expect(await address()).toHaveLength(1);
  });

  it('names a link written from the server’s root, and a page kept in the hash, whatever the side imports', async () => {
    const withHelper = (body: string): string => `import { Link, usePath } from '@adminiumjs/adminium/side';\n${screen(body)}`;
    write('customer/src/App.tsx', withHelper('<div className="page"><img className="logo" src={logo} alt="" /><a href="/menu">Menu</a></div>'));
    const [rooted] = await address();
    expect(rooted).toContain('apps/cakes/customer/src/App.tsx');
    expect(rooted).toContain('href="/menu"');
    expect(rooted).toContain('<Link to="/menu">');
    for (const written of ["<a href={'/cart'}>x</a>", '<a href={`/menu/${id}`}>x</a>', '<a href="/">x</a>']) {
      write('customer/src/App.tsx', withHelper(`<div className="page"><img className="logo" src={logo} alt="" />${written}</div>`));
      expect(await address(), written).toHaveLength(1);
    }
    // Another site, a file of the public API, a place on this page, an address the helper made: none of these.
    write(
      'customer/src/App.tsx',
      withHelper('<div className="page"><img className="logo" src={logo} alt="" /><a href="//example.com">a</a><a href="https://example.com/x">b</a><a href="/api/v1/public/files/1">c</a><a href="#top">d</a><a href={pageHref(\'/menu\')}>e</a><a href="mailto:a@b.c">f</a>{/* <a href="/old">g</a> */}</div>'),
    );
    expect(await address()).toEqual([]);

    write('customer/src/App.tsx', withHelper('<div className="page" onClick={() => { window.location.hash = \'#/menu\'; }}><img className="logo" src={logo} alt="" /></div>'));
    const [hashed] = await address();
    expect(hashed).toContain('window.location.hash');
    expect(hashed).toContain("go('/menu')");
  });

  it('says the same words each time it stands, one line a side', async () => {
    write('customer/src/App.tsx', screen('<div className="page"><img className="logo" src={logo} alt="" /><a href="/menu">Menu</a></div>'));
    write('customer/src/pages/Menu.tsx', 'export function Menu() { location.hash = "x"; return <div className="page" />; }\n');
    write('customer/src/pages/Cart.tsx', 'export function Cart() { return <div className="page" />; }\n');
    const first = await address();
    expect(first).toHaveLength(1);
    expect(await address()).toEqual(first);
  });
});
