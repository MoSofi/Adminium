// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture site a person allowed in the Designer: kept in the project's
 * `.env` beside what was there, let through at once, and never added where
 * the list is the operator's.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { envSchema } from '../src/config/env.js';
import { createPictureHosts } from '../src/config/picture-hosts.js';
import { createPictureSites } from '../src/designer/picture-sites.js';
import { outsidePictures } from '../src/project/apps/side-pictures.js';
import { readDotEnv } from '../src/project/dotenv.js';

let root: string;
const by = { id: 'usr_1', label: 'Owner' };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-picture-sites-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the Designer’s picture sites', () => {
  it('keeps a site in .env beside the lines already there, and lets it through at once', () => {
    writeFileSync(join(root, '.env'), '# the secret\nADMINIUM_SECRET=0123456789abcdef0123\nDATABASE_URL=sqlite:./data/app.sqlite\n');
    const hosts = createPictureHosts([]);
    const said: string[] = [];
    const sites = createPictureSites({ root, hosts, mode: 'local', fromEnvironment: undefined, onAdded: (host, who) => said.push(`${host} ${who.label}`) });
    expect(sites.closed()).toBeNull();
    expect(sites.covers('images.unsplash.com')).toBe(false);

    sites.add('images.unsplash.com', by);
    sites.add('picsum.photos', by);
    sites.add('images.unsplash.com', by);
    expect(sites.covers('images.unsplash.com')).toBe(true);
    expect(hosts.added()).toEqual(['https://images.unsplash.com', 'https://picsum.photos']);
    expect(said).toEqual(['images.unsplash.com Owner', 'picsum.photos Owner', 'images.unsplash.com Owner']);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(
      '# the secret\nADMINIUM_SECRET=0123456789abcdef0123\nDATABASE_URL=sqlite:./data/app.sqlite\n\nADMINIUM_CSP_IMG_HOSTS=https://images.unsplash.com,https://picsum.photos\n',
    );
    // What was written is what the next start reads as its list.
    const parsed = envSchema.shape.ADMINIUM_CSP_IMG_HOSTS.parse(readDotEnv(root)?.['ADMINIUM_CSP_IMG_HOSTS']);
    expect(parsed).toEqual(['https://images.unsplash.com', 'https://picsum.photos']);
  });

  it('adds to a list the file already has, which the server started with', () => {
    writeFileSync(join(root, '.env'), 'ADMINIUM_CSP_IMG_HOSTS=https://cdn.example.com\n');
    const sites = createPictureSites({ root, hosts: createPictureHosts(['https://cdn.example.com']), mode: 'local', fromEnvironment: 'https://cdn.example.com' });
    expect(sites.closed()).toBeNull();
    expect(sites.covers('cdn.example.com')).toBe(true);
    sites.add('picsum.photos', by);
    expect(readDotEnv(root)?.['ADMINIUM_CSP_IMG_HOSTS']).toBe('https://cdn.example.com,https://picsum.photos');
  });

  it('is closed where the operator’s environment names the list, and on a live server', () => {
    writeFileSync(join(root, '.env'), 'ADMINIUM_CSP_IMG_HOSTS=https://cdn.example.com\n');
    const operator = createPictureSites({ root, hosts: createPictureHosts(['https://other.example.com']), mode: 'local', fromEnvironment: 'https://other.example.com' });
    expect(operator.closed()).toContain('own environment');
    const live = createPictureSites({ root, hosts: createPictureHosts([]), mode: 'live', fromEnvironment: undefined });
    expect(live.closed()).toContain('whoever runs it');
  });
});

describe('pictures from another site, read from an app’s files', () => {
  it('finds them in screens, styles and sample rows, and not in comments or plain links', () => {
    const write = (file: string, text: string): void => {
      const path = join(root, 'apps/cafe', file);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, text);
    };
    write(
      'customer/src/App.tsx',
      [
        '// <img src="https://commented.example.com/a.png" />',
        'const dishes = [{ name: "Soup", photo: "https://Images.Unsplash.com/photo-1?w=400" }];',
        'const docs = <a href="https://adminium.dev/docs">Docs</a>;',
        'const logo = <img src="https://static.example.org/brand/logo" alt="" />;',
      ].join('\n'),
    );
    write('customer/src/app.css', '.hero { background-image: url("http://old.example.net/hero.jpg"); }\n');
    write('seeds/sample.json', JSON.stringify({ menu_items: [{ name: 'Tea', image_url: 'https://cdn.example.io/tea' }] }));
    expect(outsidePictures(root, 'cafe')).toEqual([
      { host: 'old.example.net', secure: false, file: 'apps/cafe/customer/src/app.css' },
      { host: 'images.unsplash.com', secure: true, file: 'apps/cafe/customer/src/App.tsx' },
      { host: 'static.example.org', secure: true, file: 'apps/cafe/customer/src/App.tsx' },
      { host: 'cdn.example.io', secure: true, file: 'apps/cafe/seeds/sample.json' },
    ]);
  });
});
