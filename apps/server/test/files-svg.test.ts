// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A cleaned SVG: read by a strict XML reader, kept from an allow-list,
 * written again from its tree. What draws nothing (a script, an event
 * handler) comes back without it; what could change the drawing or reach
 * outside it (a foreignObject, an outside link, a style rule) is refused; an
 * XML trick (a DOCTYPE, an entity, CDATA, a processing instruction, another
 * namespace) is refused; an Inkscape export's own notes are dropped. Cleaning
 * the output again gives the same bytes.
 */
import { describe, expect, it } from 'vitest';

import { cleanSvg, SvgRefused } from '../src/files/svg.js';

const S = 'xmlns="http://www.w3.org/2000/svg"';
const clean = (text: string): string => cleanSvg(Buffer.from(text, 'utf8')).toString('utf8');
const refused = (text: string): string => {
  try {
    cleanSvg(Buffer.from(text, 'utf8'));
  } catch (error) {
    if (error instanceof SvgRefused) return error.message;
    throw error;
  }
  throw new Error(`not refused: ${text}`);
};

describe('a cleaned SVG', () => {
  it('keeps a drawing as it draws, written from its tree', () => {
    const logo = `<?xml version="1.0" encoding="UTF-8"?>
<!-- made by hand -->
<svg ${S} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="100" height="100">
  <title>Birch &amp; Row</title>
  <defs>
    <linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" style="stop-color: #000; stop-opacity: .5"/></linearGradient>
    <clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath>
    <symbol id="leaf"><path d="M0 0 L10 10 Z"/></symbol>
  </defs>
  <g clip-path="url(#c)" fill="url('#g')" transform="translate(1 2)">
    <rect x="0" y="0" width="100" height="100" rx="4"/>
    <use xlink:href="#leaf" x="5"/>
    <use href="#leaf" x="20"/>
  </g>
  <text x="10" y="90" font-family="'Playfair Display', serif" font-size="12">Hello <tspan font-weight="700">there</tspan> &#x263A;</text>
</svg>`;
    const out = clean(logo);
    expect(out).toBe(
      `<svg ${S} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="100" height="100"><title>Birch &amp; Row</title><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" style="stop-color:#000;stop-opacity:.5"/></linearGradient><clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath><symbol id="leaf"><path d="M0 0 L10 10 Z"/></symbol></defs><g clip-path="url(#c)" fill="url(#g)" transform="translate(1 2)"><rect x="0" y="0" width="100" height="100" rx="4"/><use xlink:href="#leaf" x="5"/><use href="#leaf" x="20"/></g><text x="10" y="90" font-family="'Playfair Display', serif" font-size="12">Hello <tspan font-weight="700">there</tspan> ☺</text></svg>`,
    );
  });

  it('is idempotent: cleaning its own output gives the same bytes', () => {
    const inputs = [
      `<svg ${S}><text x="1" y="2" xml:space="preserve">  two  spaces &lt;kept&gt; &#10;line</text></svg>`,
      `<svg><g id="a" style="fill:url(#b) red; stroke : blue"><path d="M0 0" data-name="x" class="c" onclick="x()"/></g></svg>`,
      `<svg ${S} width="10" height="10"><rect width="10" height="10" fill="#c00" stroke-dasharray="1&#9;2"/><script>alert(1)</script></svg>`,
      `<svg ${S}><text font-family='"Open Sans", sans-serif' x="1">a &amp; b &gt; c</text></svg>`,
    ];
    for (const input of inputs) {
      const once = cleanSvg(Buffer.from(input));
      expect(cleanSvg(once).equals(once)).toBe(true);
    }
  });

  it('writes a quote inside a value as a reference, so the value cannot end early', () => {
    expect(clean(`<svg ${S}><text font-family='"Open Sans" onload="x"'>a</text></svg>`)).toBe(`<svg ${S}><text font-family="&quot;Open Sans&quot; onload=&quot;x&quot;">a</text></svg>`);
  });

  it('comes back without a script, its event handlers, metadata and attributes that draw nothing', () => {
    const out = clean(`<svg ${S} onload="fetch('//x')" class="logo" version="1.1" data-x="1" aria-label="Logo"><script>alert(document.cookie)</script><metadata><rdf>…</rdf></metadata><circle r="4" onclick="steal()" onmouseover="x"/></svg>`);
    expect(out).toBe(`<svg ${S}><circle r="4"/></svg>`);
    expect(out).not.toMatch(/script|onload|onclick|alert/);
  });

  it('refuses a foreignObject, an image, a style element and anything else off the list', () => {
    expect(refused(`<svg ${S}><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject></svg>`)).toMatch(/<foreignObject>, which is not taken/);
    expect(refused(`<svg ${S}><image href="https://x.example/a.png"/></svg>`)).toMatch(/<image>/);
    expect(refused(`<svg ${S}><style>circle{fill:url(https://x)}</style></svg>`)).toMatch(/<style>/);
    expect(refused(`<svg ${S}><a href="https://x.example"><circle r="1"/></a></svg>`)).toMatch(/<a>/);
    expect(refused(`<svg ${S}><filter id="f"/></svg>`)).toMatch(/<filter>/);
    expect(refused(`<svg ${S}><animate attributeName="href" to="javascript:x"/></svg>`)).toMatch(/<animate>/);
    expect(refused(`<svg ${S}><font><font-face font-family="x"/></font></svg>`)).toMatch(/<font>/);
  });

  it('refuses an outside link: href only to #id, only on use and gradients', () => {
    expect(refused(`<svg ${S}><use href="https://evil.example/sprite.svg#a"/></svg>`)).toMatch(/outside the drawing/);
    expect(refused(`<svg ${S} xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="javascript:alert(1)"/></svg>`)).toMatch(/outside the drawing/);
    expect(refused(`<svg ${S}><use href="data:image/svg+xml,&lt;svg/&gt;"/></svg>`)).toMatch(/outside the drawing/);
    expect(refused(`<svg ${S}><rect href="#a"/></svg>`)).toMatch(/has a link/);
    expect(refused(`<svg ${S}><rect fill="url(https://evil.example/p.svg#x)"/></svg>`)).toMatch(/points outside the drawing/);
    expect(refused(`<svg ${S}><rect style="fill:url(//evil.example/x)"/></svg>`)).toMatch(/points outside the drawing/);
  });

  it('refuses a style beyond its properties', () => {
    expect(refused(`<svg ${S}><rect style="behavior:url(#x)"/></svg>`)).toMatch(/sets behavior/);
    expect(refused(`<svg ${S}><rect style="fill:red;/*x*/"/></svg>`)).toMatch(/style that is not taken/);
    expect(refused(`<svg ${S}><rect style="fill:\\75 rl(x)"/></svg>`)).toMatch(/style that is not taken/);
    expect(refused(`<svg ${S}><rect style="@import 'x'"/></svg>`)).toMatch(/style that is not taken/);
    // An editor's own property draws nothing, and goes.
    expect(clean(`<svg ${S}><rect style="-inkscape-font-specification:Sans;fill:red"/></svg>`)).toBe(`<svg ${S}><rect style="fill:red"/></svg>`);
  });

  it('refuses XML tricks: a DOCTYPE, an entity, CDATA, a processing instruction', () => {
    expect(refused(`<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg ${S}>&a;</svg>`)).toMatch(/DOCTYPE/);
    expect(refused(`<svg ${S}><text>&nbsp;</text></svg>`)).toMatch(/entity &nbsp;/);
    expect(refused(`<svg ${S}><text><![CDATA[<script>x</script>]]></text></svg>`)).toMatch(/CDATA/);
    expect(refused(`<?xml-stylesheet href="evil.css"?><svg ${S}/>`)).toMatch(/XML declaration|processing instruction/);
    expect(refused(`<svg ${S}><?php echo 1 ?></svg>`)).toMatch(/processing instruction/);
    expect(refused(`<svg ${S}><text>a & b</text></svg>`)).toMatch(/not a reference/);
    expect(refused(`  <?xml version="1.0"?><svg ${S}/>`)).toMatch(/processing instruction/);
  });

  it("refuses a namespace but SVG's, xlink's and an editor's own", () => {
    // Inkscape's prefix bound to anything but Inkscape's namespace, and another editor's (Illustrator's).
    expect(refused(`<svg ${S} xmlns:inkscape="http://www.w3.org/1999/xhtml"/>`)).toMatch(/namespace inkscape/);
    expect(refused(`<svg ${S} xmlns:sodipodi="http://www.inkscape.org/namespaces/inkscape"/>`)).toMatch(/namespace sodipodi/);
    expect(refused(`<svg ${S} xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/"/>`)).toMatch(/namespace i,/);
    expect(refused(`<svg ${S} xmlns:svg="http://www.w3.org/1999/xhtml"/>`)).toMatch(/namespace svg/);
    expect(refused(`<svg xmlns="http://www.w3.org/1999/xhtml"/>`)).toMatch(/not SVG's/);
    expect(refused(`<svg ${S}><x:rect xmlns:x="http://www.w3.org/2000/svg"/></svg>`)).toMatch(/namespace/);
    expect(refused(`<svg ${S}><rect ev:event="click"/></svg>`)).toMatch(/namespace/);
    expect(refused(`<svg ${S}><g><rect xmlns="http://www.w3.org/1999/xhtml"/></g></svg>`)).toMatch(/not SVG's/);
  });

  it('takes a drawing saved as "Inkscape SVG", dropping the editor\'s notes and drawing the same paths', () => {
    const inkscape = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->

<svg
   width="120mm"
   height="80mm"
   viewBox="0 0 120 80"
   version="1.1"
   id="svg1"
   inkscape:version="1.3.2 (091e20e, 2023-11-25)"
   sodipodi:docname="nook-front.svg"
   inkscape:export-filename="nook-front.png"
   inkscape:export-xdpi="96"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:svg="http://www.w3.org/2000/svg">
  <sodipodi:namedview
     id="namedview1"
     pagecolor="#ffffff"
     bordercolor="#000000"
     borderopacity="0.25"
     inkscape:showpageshadow="2"
     inkscape:pageopacity="0.0"
     inkscape:document-units="mm"
     inkscape:zoom="1.4"
     inkscape:current-layer="layer1">
    <inkscape:page
       x="0"
       y="0"
       width="120"
       height="80"
       id="page2" />
  </sodipodi:namedview>
  <defs
     id="defs1" />
  <g
     inkscape:label="Cut"
     inkscape:groupmode="layer"
     id="layer1">
    <path
       style="fill:none;stroke:#ff0000;stroke-width:0.1;-inkscape-stroke:hairline"
       d="M 10,10 H 110 V 70 H 10 Z"
       id="path1"
       sodipodi:nodetypes="ccccc" />
    <path
       style="fill:none;stroke:#0000ff;stroke-width:0.1"
       d="m 40,70 v -25 a 20,20 0 0 1 40,0 v 25"
       id="path2"
       inkscape:transform-center-x="1.5"
       sodipodi:nodetypes="cscc" />
  </g>
</svg>
`;
    const out = clean(inkscape);
    expect(out).toBe(
      `<svg ${S} width="120mm" height="80mm" viewBox="0 0 120 80" id="svg1"><defs id="defs1"/><g id="layer1">` +
        '<path style="fill:none;stroke:#ff0000;stroke-width:0.1" d="M 10,10 H 110 V 70 H 10 Z" id="path1"/>' +
        '<path style="fill:none;stroke:#0000ff;stroke-width:0.1" d="m 40,70 v -25 a 20,20 0 0 1 40,0 v 25" id="path2"/></g></svg>',
    );
    expect(out).not.toMatch(/inkscape|sodipodi|namedview/);
    // The same paths, drawn the same way.
    const paths = (text: string) => [...text.matchAll(/<path\b[^>]*?\sd="([^"]*)"/g)].map((match) => match[1]);
    expect(paths(out)).toEqual(paths(inkscape));
    // Cleaned again: the same bytes.
    expect(clean(out)).toBe(out);
  });

  it('refuses a document that is not well formed, and does not repair it', () => {
    expect(refused(`<svg ${S}><g></svg>`)).toMatch(/closes <g>/);
    expect(refused(`<svg ${S}><rect x="1" x="2"/></svg>`)).toMatch(/twice/);
    expect(refused(`<svg ${S}><rect x=1/></svg>`)).toMatch(/not quoted/);
    expect(refused(`<svg ${S}/><svg ${S}/>`)).toMatch(/after its drawing/);
    expect(refused(`<html><svg ${S}/></html>`)).toMatch(/<html>|not an SVG/);
    expect(refused(`<svg ${S}><!-- a -- b --></svg>`)).toMatch(/comment/);
    expect(refused('\u0000')).toMatch(/character|not an SVG/);
  });

  it('refuses a drawing nested past its bound', () => {
    const deep = `<svg ${S}>${'<g>'.repeat(70)}${'</g>'.repeat(70)}</svg>`;
    expect(refused(deep)).toMatch(/nested too deeply/);
  });

  it('refuses an unknown attribute rather than drop what may draw', () => {
    expect(refused(`<svg ${S}><rect filter="url(#f)"/></svg>`)).toMatch(/attribute filter/);
    expect(refused(`<svg ${S}><path marker-end="url(#m)"/></svg>`)).toMatch(/attribute marker-end/);
  });
});
