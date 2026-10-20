// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Picture spots as the server reads and writes them, and the licences a
 * picture's badge is decided from.
 *
 * `spots.json` is written by the server alone and read by the side's build:
 * a path in it reaches a page every visitor loads. So what is tried here is
 * mostly what must be refused: a path that leaves `assets/pictures/`, a link
 * out of it, bytes that are no picture, an address that only looks like
 * Unsplash's, a write by one of the model's file tools.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { badgeOf, creditAsked, DEFAULT_BADGES, LICENCE_CODES, searchLicence } from '../src/designer/licences.js';
import { cleanPicturePath, cleanSpot, parseSpots, readCredits, readPictureFile, readSpots, serverOwned, spotsFileProblem, spotVersion, unsplashAddress, writeCredits, writeSpots, type SpotEntry } from '../src/designer/spots.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GIF = Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1');

let root: string;
const pictures = (): string => join(root, 'apps', 'cafe', 'assets', 'pictures');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-spots-'));
  mkdirSync(pictures(), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a picture file’s path in spots.json', () => {
  it('is a plain path under assets/pictures/, with a picture’s extension', () => {
    for (const path of ['hero.jpg', 'hero-3f2a9c1e.webp', 'menu/fries.PNG', 'a/b/c/d.gif', 'logo_2.jpeg']) expect(cleanPicturePath(path), path).toBe(path);
  });

  it('refuses whatever an archive’s member path may not be, and anything that is not a picture’s name', () => {
    for (const path of ['../../.env', '/etc/passwd', 'C:/x.jpg', 'a\\..\\b.jpg', 'a/../b.jpg', './a.jpg', 'a//b.jpg', '.hidden.jpg', 'a/.git/x.jpg', 'a/b/c/d/e.jpg', 'hero.svg', 'hero.jpg.html', 'hero\u0000.jpg', 'he ro.jpg', '', 'x'.repeat(200) + '.jpg', 42, null]) {
      expect(cleanPicturePath(path), String(path)).toBeNull();
    }
  });
});

describe('an Unsplash address', () => {
  it('is taken when it is exactly one of Unsplash’s own pictures', () => {
    expect(unsplashAddress('https://images.unsplash.com/photo-1?w=1080&q=80')).toBe('https://images.unsplash.com/photo-1?w=1080&q=80');
  });

  it('is refused when it only begins like one', () => {
    for (const address of [
      'https://images.unsplash.com.evil.example/photo-1',
      'https://images.unsplash.com@evil.example/photo-1',
      'https://user:pass@images.unsplash.com/photo-1',
      'https://images.unsplash.com:8443/photo-1',
      'http://images.unsplash.com/photo-1',
      'https://unsplash.com/photos/1',
      'https://plus.unsplash.com/premium_photo-1',
      'javascript:alert(1)',
      'not an address',
    ]) {
      expect(unsplashAddress(address), address).toBeNull();
    }
  });
});

describe('a picture file of the app’s', () => {
  it('is read when it is a picture inside assets/pictures/, GIF included', () => {
    writeFileSync(join(pictures(), 'hero.png'), PNG);
    writeFileSync(join(pictures(), 'spin.gif'), GIF);
    expect(readPictureFile(root, 'cafe', 'hero.png')).toMatchObject({ path: 'hero.png', mime: 'image/png' });
    expect(readPictureFile(root, 'cafe', 'spin.gif')).toMatchObject({ mime: 'image/gif' });
  });

  it('is nothing when its bytes are no picture, whatever its name says', () => {
    writeFileSync(join(pictures(), 'hero.jpg'), 'SECRET=1\n');
    expect(readPictureFile(root, 'cafe', 'hero.jpg')).toBeNull();
  });

  it('is nothing through a link, even one that stays inside the folder', () => {
    writeFileSync(join(root, '.env.png'), PNG);
    symlinkSync(join(root, '.env.png'), join(pictures(), 'out.png'));
    writeFileSync(join(pictures(), 'real.png'), PNG);
    symlinkSync(join(pictures(), 'real.png'), join(pictures(), 'in.png'));
    expect(readPictureFile(root, 'cafe', 'out.png')).toBeNull();
    expect(readPictureFile(root, 'cafe', 'in.png')).toBeNull();
  });

  it('is nothing through a folder that is a link out of assets/pictures/', () => {
    mkdirSync(join(root, 'elsewhere'));
    writeFileSync(join(root, 'elsewhere', 'x.png'), PNG);
    symlinkSync(join(root, 'elsewhere'), join(pictures(), 'sub'));
    expect(readPictureFile(root, 'cafe', 'sub/x.png')).toBeNull();
  });

  it('is nothing when it is larger than a spot takes', () => {
    writeFileSync(join(pictures(), 'big.png'), Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
    expect(readPictureFile(root, 'cafe', 'big.png')).toBeNull();
  });
});

describe('spots.json', () => {
  const hero: SpotEntry = { id: 'hero', label: 'Hero', shape: 'wide', shows: 'the dining room', search: 'restaurant evening', file: null, alt: '', decorative: false };

  it('is written and read back in the order its spots were made', () => {
    const team: SpotEntry = { ...hero, id: 'team', label: 'Team' };
    writeSpots(root, 'cafe', [team, hero]);
    expect(readSpots(root, 'cafe').map((spot) => spot.id)).toEqual(['team', 'hero']);
  });

  it('keeps only what a spot holds, and says what is not one', () => {
    const read = parseSpots(
      JSON.stringify({
        hero: { ...hero, extra: 'x', label: '<b>Hero</b>\n', alt: 'A table `rm -rf`' },
        Bad: { label: 'x', shape: 'wide' },
        noshape: { label: 'x' },
        out: { label: 'Out', shape: 'square', file: '../../.env' },
        evil: { label: 'Evil', shape: 'tall', file: 'https://images.unsplash.com.evil.example/a' },
      }),
    );
    expect(read.spots).toEqual([
      { ...hero, label: 'b Hero /b', alt: 'A table rm -rf' },
      { id: 'out', label: 'Out', shape: 'square', shows: '', search: '', file: null, alt: '', decorative: false },
      { id: 'evil', label: 'Evil', shape: 'tall', shows: '', search: '', file: null, alt: '', decorative: false },
    ]);
    expect(read.problems).toHaveLength(4);
  });

  it('is nothing at all when it is not an object of spots', () => {
    expect(parseSpots('[1,2]').spots).toEqual([]);
    expect(parseSpots('{').problems[0]).toMatch(/not valid JSON/);
  });

  it('gives each spot a version that moves when the spot does', () => {
    const before = spotVersion(hero);
    expect(spotVersion({ ...hero })).toBe(before);
    expect(spotVersion({ ...hero, file: 'hero.png' })).not.toBe(before);
    expect(spotVersion({ ...hero, alt: 'x' })).not.toBe(before);
    expect(spotVersion({ ...hero, decorative: true })).not.toBe(before);
  });

  it('is read on a hand save as the server reads it: a file that is not this app’s picture is refused', () => {
    writeFileSync(join(pictures(), 'hero.png'), PNG);
    expect(spotsFileProblem(root, 'cafe', JSON.stringify({ hero: { ...hero, file: 'hero.png' } }))).toBeNull();
    expect(spotsFileProblem(root, 'cafe', JSON.stringify({ hero: { ...hero, file: 'gone.png' } }))).toMatch(/not a picture of this app/);
    expect(spotsFileProblem(root, 'cafe', JSON.stringify({ hero: { ...hero, file: '../x.png' } }))).toMatch(/not a picture in assets\/pictures/);
    expect(spotsFileProblem(root, 'cafe', '{ "hero": ')).toMatch(/not valid JSON/);
  });

  it('cleans a spot given by a caller as it cleans one read from the file', () => {
    expect(cleanSpot({ label: 'Hero', shape: 'round' })).toBeNull();
    expect(cleanSpot({ label: '', shape: 'wide' })).toBeNull();
    expect(cleanSpot({ label: 'Hero', shape: 'wide', decorative: 'yes' })).toMatchObject({ decorative: false });
  });
});

describe('CREDITS.json', () => {
  it('is read line by line, a line that is not one dropped, and its addresses only when they are https', () => {
    writeFileSync(
      join(pictures(), 'CREDITS.json'),
      JSON.stringify([
        { file: 'assets/pictures/hero.jpg', title: 'Board', creator: 'Maya', creatorUrl: 'javascript:alert(1)', licence: 'CC BY 2.0', licenceUrl: 'https://creativecommons.org/licenses/by/2.0/', source: 'Openverse', page: 'https://x.example/p', licenceCode: 'by' },
        { title: 'no file' },
        'nonsense',
      ]),
    );
    expect(readCredits(root, 'cafe')).toEqual([
      { file: 'assets/pictures/hero.jpg', title: 'Board', creator: 'Maya', creatorUrl: '', licence: 'CC BY 2.0', licenceUrl: 'https://creativecommons.org/licenses/by/2.0/', source: 'Openverse', page: 'https://x.example/p', licenceCode: 'by' },
    ]);
  });

  it('is written whole', () => {
    writeCredits(root, 'cafe', [{ file: 'assets/pictures/a.jpg', title: 'A', creator: 'B', creatorUrl: '', licence: 'CC0 1.0', licenceUrl: '', source: 'Openverse', page: '' }]);
    expect(readCredits(root, 'cafe')).toHaveLength(1);
  });
});

describe('what the model’s file tools may not write', () => {
  it('is the spots, their credits, the approved template plan and the template’s own files, however the path is spelt', () => {
    for (const path of ['apps/cafe/assets/pictures/spots.json', 'apps/cafe/assets/pictures/CREDITS.json', 'apps/cafe/ASSETS/Pictures/Credits.json', 'apps/cafe/template-plan.json', 'apps/cafe/customer/src/site/site.css', 'apps/cafe/src/site/a.css']) {
      expect(serverOwned('cafe', path), path).not.toBeNull();
    }
    for (const path of ['apps/cafe/assets/pictures/hero.jpg', 'apps/cafe/customer/src/App.tsx', 'apps/cafe/look.json', 'apps/other/assets/pictures/spots.json', 'apps/cafe/customer/src/website/a.css']) {
      expect(serverOwned('cafe', path), path).toBeNull();
    }
  });
});

describe('a picture’s licence', () => {
  it('maps every code a search may show to its badge, by the licence’s own name', () => {
    expect(searchLicence('Openverse', 'cc0', '1.0')).toEqual({ code: 'cc0', badge: 'no-credit', name: 'CC0 1.0' });
    expect(searchLicence('Openverse', 'pdm', '')).toEqual({ code: 'pdm', badge: 'no-credit', name: 'Public Domain Mark 1.0' });
    expect(searchLicence('Openverse', 'by', '2.0')).toEqual({ code: 'by', badge: 'credit', name: 'CC BY 2.0' });
    expect(searchLicence('Openverse', 'BY-SA', '4.0')).toEqual({ code: 'by-sa', badge: 'credit-same', name: 'CC BY-SA 4.0' });
    expect(searchLicence('Pexels', undefined)).toEqual({ code: 'pexels', badge: 'host', name: 'Pexels licence' });
    expect(searchLicence('Unsplash', undefined)).toEqual({ code: 'unsplash', badge: 'host', name: 'Unsplash licence' });
  });

  it('drops a result whose licence forbids a use, or that it does not know', () => {
    for (const code of ['by-nc', 'by-nd', 'by-nc-sa', 'by-nc-nd', 'sampling+', 'nc-sampling+', '', 'unknown', 7]) expect(searchLicence('Openverse', code, '2.0'), String(code)).toBeNull();
    expect(searchLicence('Somewhere', 'cc0')).toBeNull();
  });

  it('has a badge for every code, asks for credit only under CC BY and CC BY-SA, and hides CC BY-SA by default', () => {
    for (const code of LICENCE_CODES) expect(badgeOf(code)).toBeTruthy();
    expect(LICENCE_CODES.filter(creditAsked)).toEqual(['by', 'by-sa']);
    expect(badgeOf('own')).toBe('own');
    expect(badgeOf('template')).toBe('template');
    expect(DEFAULT_BADGES).toEqual(['no-credit', 'host', 'credit']);
  });
});
