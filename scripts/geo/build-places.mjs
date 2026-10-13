#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Builds the place list the server ships: `apps/server/assets/geo/places.tsv.gz`
 * and the `README.md` beside it.
 *
 *   node scripts/geo/build-places.mjs <scratch directory> [--offline]
 *
 * RUN BY A DEVELOPER, by hand, when the list should be refreshed. Not by CI
 * and not by the release: the output is committed, so a build never reaches
 * for another site, and two builds of one commit ship the same list.
 *
 * What it does:
 *
 *  1. Downloads four files from https://download.geonames.org/export/dump/
 *     into the scratch directory (kept there, so a second run only fetches
 *     what is missing; `--offline` fetches nothing):
 *       cities1000.zip        every place with 1,000 people or more
 *       alternateNamesV2.zip  each place's names in other languages (≈205 MB)
 *       admin1CodesASCII.txt  the regions (a state, a governorate)
 *       countryInfo.txt       the countries
 *  2. Reads them as text. The big one is streamed out of its zip by `unzip -p`
 *     and read a line at a time: it is never whole in memory, and nothing in
 *     any of the four is run.
 *  3. Writes one gzipped, tab-separated file, sorted by GeoNames id.
 *
 * Needs `unzip` on the PATH (macOS and every Linux image have it) and Node 22.
 *
 * THE FILE (apps/server/src/geo/places.ts reads it)
 *
 *   #adminium-places <format> <date> <places> <countries>
 *   =<country code> \t <name> \t <names>               one line per country
 *   <id> \t <name> \t <ASCII name> \t <country code> \t <region code>
 *        \t <region name> \t <lat> \t <lng> \t <people> \t <names>
 *
 * `<ASCII name>` is empty when it is the name. `<lat>`/`<lng>` have five
 * decimals (about a metre). `<names>` is `lang=name|lang=name`, only for the
 * languages Adminium ships (packages/i18n/locales, and `en`), and only where
 * GeoNames has a name that differs from `<name>`. For each language the name
 * GeoNames marks as preferred wins (a country's short name before its formal
 * one); a historic or colloquial name is never taken. Simplified Chinese (zh-CN) reads `zh-Hans`, `zh-CN`, then `zh`;
 * Traditional (zh-TW) reads `zh-Hant`, then `zh-TW`, and nothing else: a name
 * in the other script is not shown as this one.
 *
 * GeoNames' data is under CC BY 4.0: the README this writes carries the credit.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const SOURCE = 'https://download.geonames.org/export/dump/';
const FILES = ['cities1000.zip', 'alternateNamesV2.zip', 'admin1CodesASCII.txt', 'countryInfo.txt'];
const FORMAT = 1;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const scratchArg = args.find((arg) => !arg.startsWith('--'));
if (scratchArg === undefined) {
  process.stderr.write('usage: node scripts/geo/build-places.mjs <scratch directory> [--offline]\n');
  process.exit(2);
}
const scratch = resolve(scratchArg);
const outDir = join(root, 'apps', 'server', 'assets', 'geo');

const log = (line) => process.stdout.write(`${line}\n`);

async function exists(path) {
  return stat(path).then(
    (found) => found.size > 0,
    () => false,
  );
}

async function download(name) {
  const target = join(scratch, name);
  if (await exists(target)) return log(`have ${name}`);
  if (offline) throw new Error(`${name} is not in ${scratch}, and --offline fetches nothing`);
  log(`fetching ${name} …`);
  const response = await fetch(SOURCE + name);
  if (!response.ok || response.body === null) throw new Error(`${name}: HTTP ${String(response.status)}`);
  // To a part file first: a download that stops halfway is not mistaken for the file.
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`${target}.part`));
  const { rename } = await import('node:fs/promises');
  await rename(`${target}.part`, target);
  log(`  ${((await stat(target)).size / 1e6).toFixed(1)} MB`);
}

/** The lines of one member of a zip, streamed: `unzip -p` writes it to a pipe. */
async function* zipLines(zip, member) {
  const child = spawn('unzip', ['-p', join(scratch, zip), member], { stdio: ['ignore', 'pipe', 'inherit'] });
  const done = new Promise((ok, fail) => {
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`unzip ${zip} ended with ${String(code)}`))));
  });
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) yield line;
  await done;
}

/** A name that can sit in a cell of the file. */
function clean(name) {
  return /[\t\n\r|=]/.test(name) ? null : name.trim();
}

/** The languages shipped, as the file names them, each with the GeoNames tags it reads, best first. */
async function languages() {
  const locales = (await readdir(join(root, 'packages', 'i18n', 'locales'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const out = new Map([['en', ['en']]]);
  for (const locale of locales.sort()) {
    if (locale === 'zh-CN') out.set('zh-CN', ['zh-Hans', 'zh-CN', 'zh']);
    else if (locale === 'zh-TW') out.set('zh-TW', ['zh-Hant', 'zh-TW']);
    else if (!locale.startsWith('en')) out.set(locale.split('-')[0], [locale.split('-')[0]]);
  }
  return out;
}

async function main() {
  await mkdir(scratch, { recursive: true });
  for (const name of FILES) await download(name);

  const langs = await languages();
  // GeoNames tag → [our language, how good a source it is for it (0 = best)].
  const wanted = new Map();
  for (const [ours, tags] of langs) tags.forEach((tag, rank) => wanted.set(tag, [...(wanted.get(tag) ?? []), [ours, rank]]));
  log(`languages: ${[...langs.keys()].join(', ')}`);

  // Regions: "BR.27" → "São Paulo".
  const regions = new Map();
  for (const line of (await readFile(join(scratch, 'admin1CodesASCII.txt'), 'utf8')).split('\n')) {
    const [code, name] = line.split('\t');
    if (code !== undefined && name !== undefined && clean(name) !== null) regions.set(code, clean(name));
  }

  // Countries: code → { id, name }.
  const countries = new Map();
  const countryOfId = new Map();
  for (const line of (await readFile(join(scratch, 'countryInfo.txt'), 'utf8')).split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const cells = line.split('\t');
    const [code, , , , name] = cells;
    const id = Number(cells[16]);
    if (!/^[A-Z]{2}$/.test(code ?? '') || clean(name ?? '') === null || name === '') continue;
    countries.set(code, { name: clean(name), names: new Map() });
    if (Number.isInteger(id) && id > 0) countryOfId.set(id, code);
  }

  // Places.
  const places = new Map();
  for await (const line of zipLines('cities1000.zip', 'cities1000.txt')) {
    const cells = line.split('\t');
    if (cells.length < 15) continue;
    const id = Number(cells[0]);
    const name = clean(cells[1]);
    const ascii = clean(cells[2]);
    const lat = Number(cells[4]);
    const lng = Number(cells[5]);
    const country = cells[8];
    if (!Number.isInteger(id) || name === null || name === '' || !countries.has(country)) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const regionCode = /^[A-Za-z0-9]{1,8}$/.test(cells[10]) ? cells[10] : '';
    places.set(id, {
      name,
      ascii: ascii === null || ascii === name ? '' : ascii,
      country,
      regionCode,
      region: regions.get(`${country}.${cells[10]}`) ?? '',
      lat: lat.toFixed(5),
      lng: lng.toFixed(5),
      people: Math.max(0, Math.trunc(Number(cells[14]) || 0)),
      names: new Map(),
    });
  }
  log(`places: ${String(places.size)}`);

  // Names in the shipped languages. Each kept name carries a score: lower wins.
  let read = 0;
  for await (const line of zipLines('alternateNamesV2.zip', 'alternateNamesV2.txt')) {
    read += 1;
    if (read % 4_000_000 === 0) log(`  ${String(read / 1e6)} M names read`);
    const cells = line.split('\t');
    const targets = wanted.get(cells[2]);
    if (targets === undefined) continue;
    const id = Number(cells[1]);
    const place = places.get(id);
    const holder = place ?? countries.get(countryOfId.get(id));
    if (holder === undefined) continue;
    // Colloquial (a nickname) and historic (a name no longer used) are never the name to show.
    if (cells[6] === '1' || cells[7] === '1') continue;
    const name = clean(cells[3] ?? '');
    if (name === null || name === '' || name.length > 80) continue;
    // Preferred first, then the better tag. Between two preferred names a place takes the full one
    // and a country the short one ("Deutschland", not "Bundesrepublik Deutschland").
    const quality = (cells[4] === '1' ? 0 : 2) + ((cells[5] === '1') === (place === undefined) ? 0 : 1);
    for (const [ours, rank] of targets) {
      const score = rank * 10 + quality;
      const held = holder.names.get(ours);
      if (held === undefined || score < held.score) holder.names.set(ours, { name, score });
    }
  }
  log(`alternate names read: ${String(read)}`);

  const order = [...langs.keys()];
  const namesCell = (holder) =>
    order
      .filter((lang) => holder.names.has(lang) && holder.names.get(lang).name !== holder.name)
      .map((lang) => `${lang}=${holder.names.get(lang).name}`)
      .join('|');

  const date = new Date().toISOString().slice(0, 10);
  const lines = [`#adminium-places ${String(FORMAT)} ${date} ${String(places.size)} ${String(countries.size)}`];
  for (const code of [...countries.keys()].sort()) lines.push([`=${code}`, countries.get(code).name, namesCell(countries.get(code))].join('\t'));
  for (const id of [...places.keys()].sort((a, b) => a - b)) {
    const place = places.get(id);
    lines.push([id, place.name, place.ascii, place.country, place.regionCode, place.region, place.lat, place.lng, place.people, namesCell(place)].join('\t'));
  }
  const text = `${lines.join('\n')}\n`;
  const packed = gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'places.tsv.gz'), packed);

  const withNames = (lang) => [...places.values()].filter((place) => place.names.has(lang) && place.names.get(lang).name !== place.name).length;
  const readme = `# The place list

\`places.tsv.gz\` is the list of towns and cities the server answers
\`/api/v1/geo/places\` from: a place's name, country, region, position and number
of people, with its name in each language Adminium ships where one is known.
It is read from this file on the server; nothing is asked of another site.

| | |
|---|---|
| Source | [GeoNames](https://www.geonames.org/), \`${SOURCE}\`: \`cities1000.zip\`, \`alternateNamesV2.zip\`, \`admin1CodesASCII.txt\`, \`countryInfo.txt\` |
| Fetched | ${date} |
| Places | ${places.size.toLocaleString('en-US')} (every place with 1,000 people or more) |
| Countries | ${String(countries.size)} |
| Size | ${(packed.length / 1e6).toFixed(2)} MB gzipped, ${(Buffer.byteLength(text) / 1e6).toFixed(1)} MB as text |
| Names by language | ${order.map((lang) => `${lang} ${withNames(lang).toLocaleString('en-US')}`).join(' · ')} |

## Credit

This list is made from data by [GeoNames](https://www.geonames.org/), which is
licensed under the [Creative Commons Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/).
It was reshaped for Adminium: only the columns named above are kept, and only
the names in the languages Adminium ships.

## Making it again

\`\`\`sh
node scripts/geo/build-places.mjs <a scratch directory>
\`\`\`

The script's first lines describe the file's format. It is run by hand, never
by CI or a release: this file is committed.
`;
  await writeFile(join(outDir, 'README.md'), readme);
  log(`wrote ${join(outDir, 'places.tsv.gz')}: ${(packed.length / 1e6).toFixed(2)} MB, ${String(places.size)} places, ${String(countries.size)} countries`);
  for (const lang of order) log(`  ${lang}: ${String(withNames(lang))}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
