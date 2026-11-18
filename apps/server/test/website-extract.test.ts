// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The company facts the website reader takes from one page, and what it never takes: a person's name, a named
 * address, a mobile, anything inside a script or a `javascript:` link, the page's own prose as "About".
 */
import { describe, expect, it } from 'vitest';

import { decodePage, extractPage, GENERIC_LOCAL_PARTS, genericAddress, isMobile } from '../src/net/extract.js';

const at = { url: 'https://kestrel-yard.example/', finalUrl: 'https://kestrel-yard.example/' };

describe('the generic-address filter', () => {
  it('keeps a front-desk address and never one that names somebody', () => {
    for (const kept of ['info@kestrel-yard.example', 'Contact@Kestrel-Yard.example', 'post@fjordlys.example', 'bonjour@saone-clair.example', 'enquiries@ouseburn.example', 'kontakt@millbeck.example']) {
      expect(genericAddress(kept), kept).toBe(kept.toLowerCase());
    }
    for (const dropped of ['jane.doe@kestrel-yard.example', 'j.doe@kestrel-yard.example', 'info.jane@kestrel-yard.example', 'jane@kestrel-yard.example', 'infos@kestrel-yard.example', 'info@', 'info@nodot', 'noreply@kestrel-yard.example']) {
      expect(genericAddress(dropped), dropped).toBeNull();
    }
  });

  it('is a closed list of plain words', () => {
    for (const local of GENERIC_LOCAL_PARTS) expect(local).toMatch(/^[a-z]+$/);
    expect(GENERIC_LOCAL_PARTS).toEqual(expect.arrayContaining(['info', 'contact', 'hello', 'post', 'office', 'enquiries', 'sales', 'mail', 'kontakt', 'bonjour', 'accueil']));
  });
});

describe('mobiles', () => {
  it('are dropped where the country is known, by its own code or by the caller', () => {
    expect(isMobile('+44 7700 900123', null)).toBe(true);
    expect(isMobile('+44 (0)7700 900123', null)).toBe(true);
    expect(isMobile('07700 900123', 'GB')).toBe(true);
    expect(isMobile('+44 20 7946 0123', null)).toBe(false);
    expect(isMobile('01632 960000', 'GB')).toBe(false);
    expect(isMobile('06 12 34 56 78', 'FR')).toBe(true);
    expect(isMobile('+33 7 12 34 56 78', null)).toBe(true);
    expect(isMobile('01 23 45 67 89', 'FR')).toBe(false);
    expect(isMobile('+47 412 34 567', null)).toBe(true);
    expect(isMobile('912 34 567', 'NO')).toBe(true);
    expect(isMobile('22 12 34 56', 'NO')).toBe(false);
    // With no country to go by, a number is kept.
    expect(isMobile('07700 900123', null)).toBe(false);
    expect(isMobile('+49 151 2345678', null)).toBe(false);
  });
});

describe('a page’s facts', () => {
  it('takes the name, the meta description as About, JSON-LD and the address, and nothing of the page’s prose', () => {
    const html = `<!doctype html><html><head>
      <title>Home | Kestrel Yard</title>
      <meta property="og:site_name" content="Kestrel Yard Architects">
      <meta name="description" content="Small architecture studio in a made-up town.">
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'Not this one' },
          {
            '@type': ['Organization', 'LocalBusiness'],
            name: 'Kestrel Yard Architects Ltd',
            url: 'https://kestrel-yard.example/',
            telephone: '+44 1632 960000',
            description: 'Jane Doe founded this studio in her kitchen.',
            founder: { '@type': 'Person', name: 'Jane Doe', email: 'jane.doe@kestrel-yard.example' },
            address: { '@type': 'PostalAddress', streetAddress: '12 Tannery Lane', addressLocality: 'Nowhere Bridge', postalCode: 'ZZ1 1ZZ', addressCountry: 'gb' },
          },
          { '@type': 'Person', name: 'Jane Doe', telephone: '+44 1632 960111' },
        ],
      })}</script>
      </head><body><p>We were founded by Jane Doe and have built many houses.</p></body></html>`;
    const { page, wishes } = extractPage(html, at);
    expect(wishes).toEqual({ noindex: false, tdmReserved: false });
    expect(page.name).toBe('Kestrel Yard Architects');
    expect(page.about).toBe('Small architecture studio in a made-up town.');
    expect(page.jsonLd).toEqual([
      {
        name: 'Kestrel Yard Architects Ltd',
        website: 'https://kestrel-yard.example/',
        phone: '+44 1632 960000',
        address: { lines: '12 Tannery Lane', town: 'Nowhere Bridge', postalCode: 'ZZ1 1ZZ', country: 'GB' },
        sourceUrl: 'https://kestrel-yard.example/',
      },
    ]);
    expect(page.address).toEqual({ lines: '12 Tannery Lane', town: 'Nowhere Bridge', postalCode: 'ZZ1 1ZZ', country: 'GB' });
    expect(JSON.stringify(page)).not.toMatch(/Jane|kitchen|founded/);
  });

  it('falls back to the JSON-LD name, then the title, and leaves About out with no meta description', () => {
    const ld = `<script type="application/ld+json">{"@type":"LocalBusiness","name":"Millbeck Drawing Office"}</script>`;
    expect(extractPage(`<html><head><title>Millbeck</title>${ld}</head><body><p>About us: lots of prose.</p></body></html>`, at).page).toMatchObject({ name: 'Millbeck Drawing Office' });
    const plain = extractPage('<html><head><title>  Ouseburn\n Studio  </title></head><body><p>About us: lots of prose.</p></body></html>', at).page;
    expect(plain.name).toBe('Ouseburn Studio');
    expect(plain.about).toBeUndefined();
  });

  it('takes nothing from a javascript: or data: link, a script, a style, or a template', () => {
    const html = `<html><head><style>.x::after{content:"info@style.example"}</style></head><body>
      <a href="javascript:location='mailto:info@javascript.example'">Write to us</a>
      <a href="data:text/html,info@data.example">Card</a>
      <a href="JavaScript:void('tel:+441632960999')">Call</a>
      <script>var mail = 'info@script.example'; var tel = '+44 1632 960888';</script>
      <script type="application/json">{"email":"info@json.example"}</script>
      <template><p>info@template.example +44 1632 960777</p></template>
      <noscript>info@noscript.example</noscript>
      </body></html>`;
    const { page } = extractPage(html, at);
    expect(page.emails).toEqual([]);
    expect(page.phones).toEqual([]);
    expect(page.jsonLd).toEqual([]);
  });

  it('on a page that names people, keeps no person, no named address and no mobile, and keeps info@', () => {
    const html = `<html lang="en"><head><title>Tannery Row Design</title></head><body>
      <h2>Our team</h2>
      <p>Jane Doe, Director, <a href="mailto:jane.doe@tannery-row.example">jane.doe@tannery-row.example</a>, mobile 07700 900123</p>
      <p>John Roe, Partner: j.roe@tannery-row.example, <a href="tel:+447700900456">+44 7700 900456</a></p>
      <footer>Write to <a href="mailto:info@tannery-row.example?subject=Hello">info@tannery-row.example</a>
      or call the studio on <a href="tel:+441632960000">01632 960000</a>.</footer>
      </body></html>`;
    const { page } = extractPage(html, { url: 'https://tannery-row.example/', finalUrl: 'https://tannery-row.example/', country: 'GB' });
    expect(page.emails).toEqual(['info@tannery-row.example']);
    expect(page.phones).toEqual(['+441632960000']);
    expect(page.name).toBe('Tannery Row Design');
    expect(JSON.stringify(page)).not.toMatch(/Jane|John|Doe|Roe|7700/);
  });

  it('reads numbers in a visitor’s text only when they read as telephone numbers, two at most', () => {
    const text = `<html><body>
      <p>Company number 98123456. Founded 01.02.2024. SIREN 912 345 670.</p>
      <p>Tlf: 22 12 34 56</p><p>Switchboard +44 20 7946 0123</p><p>Fax 01632 960001</p>
      </body></html>`;
    const page = extractPage(text, { url: 'https://fjordlys.example/', finalUrl: 'https://fjordlys.example/' }).page;
    expect(page.phones).toEqual(['22 12 34 56', '+44 20 7946 0123']);
  });

  it('drops a JSON-LD mobile, and takes a country from the address or the site’s own name', () => {
    const ld = (phone: string, country?: string) =>
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Atelier Saône Clair', telephone: phone, ...(country === undefined ? {} : { address: { '@type': 'PostalAddress', addressCountry: country } }) })}</script>`;
    expect(extractPage(`<html><head>${ld('06 12 34 56 78', 'FR')}</head></html>`, at).page.jsonLd[0]?.phone).toBeUndefined();
    expect(extractPage(`<html><head>${ld('06 12 34 56 78')}</head></html>`, { url: 'https://saone-clair.fr/', finalUrl: 'https://saone-clair.fr/' }).page.phones).toEqual([]);
    expect(extractPage(`<html><head>${ld('01 23 45 67 89', 'FR')}</head></html>`, at).page.phones).toEqual(['01 23 45 67 89']);
  });

  it('cuts every fact to its length, as one plain line', () => {
    const long = 'A'.repeat(900);
    const { page } = extractPage(`<html><head><meta property="og:site_name" content="${long}"><meta name="description" content="Line one\nline‮ two ${long}"></head></html>`, at);
    expect([...(page.name ?? '')].length).toBe(200);
    expect([...(page.about ?? '')].length).toBe(500);
    expect(page.about?.startsWith('Line one line two')).toBe(true);
  });

  it('says when the page asks not to be read', () => {
    expect(extractPage('<html><head><meta name="robots" content="index, NOINDEX"></head></html>', at).wishes.noindex).toBe(true);
    expect(extractPage('<html><head><meta name="robots" content="none"></head></html>', at).wishes.noindex).toBe(true);
    expect(extractPage('<html><head><meta name="adminium" content="noindex"></head></html>', at).wishes.noindex).toBe(true);
    expect(extractPage('<html><head><meta name="googlebot" content="noindex"></head></html>', at).wishes.noindex).toBe(false);
    expect(extractPage('<html><head><meta name="tdm-reservation" content="1"></head></html>', at).wishes.tdmReserved).toBe(true);
    expect(extractPage('<html><head><meta name="tdm-reservation" content="0"></head></html>', at).wishes.tdmReserved).toBe(false);
  });
});

describe('decoding', () => {
  it('uses the header’s charset, else the page’s own meta charset, else UTF-8', () => {
    const latin = Buffer.from('<title>Saône</title>', 'latin1');
    expect(decodePage(latin, 'text/html; charset=ISO-8859-1')).toContain('Saône');
    expect(decodePage(Buffer.concat([Buffer.from('<meta charset="windows-1252">'), latin]), 'text/html')).toContain('Saône');
    expect(decodePage(Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">'), latin]), 'text/html')).toContain('Saône');
    expect(decodePage(Buffer.from('<title>Saône</title>', 'utf8'), 'text/html')).toContain('Saône');
    expect(decodePage(Buffer.from('<title>Saône</title>', 'utf8'), 'text/html; charset=no-such-charset')).toContain('Saône');
  });
});
