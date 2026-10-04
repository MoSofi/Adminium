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

import { classesDefined, classesIn, dashboardPageLine, designIssues, emojiIn, isPaletteClass, lowContrastRules, rawColours } from '../src/project/apps/design-check.js';
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
