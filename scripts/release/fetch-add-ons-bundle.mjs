#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fetch the bundled add-on set (32 D3, tasks 32-T11/32-T12).
 *
 *   node scripts/release/fetch-add-ons-bundle.mjs <outDir> [--pins <file>]
 *
 * Downloads the exact-pinned first-party add-on tarballs from
 * `registry.npmjs.org` and writes, for each pin, the pair the server's boot
 * seed (`apps/server/src/add-ons/store.ts` seedBundledPackages) expects in a
 * FLAT directory:
 *
 *   <outDir>/<key>-<version>.tgz
 *   <outDir>/<key>-<version>.tgz.integrity   (the `sha512-<base64>` SRI string)
 *
 * Two call sites, both at release/build time, never at run time: the Docker
 * `build` stage parks the set at /app/add-ons-bundle (the server's CWD-relative
 * default), and desktop-release.yml parks it in apps/desktop/resources/ for the
 * packaged app. The pins come from scripts/release/add-ons-bundle.json — exact
 * versions + integrities copied from the release ledger, never `latest`,
 * refreshed per add-ons release — so this script contacts ONE host, asks for
 * bytes it can name in advance, and refuses anything else:
 *
 *   - a pin with a missing or malformed `sha512-` integrity refuses up front
 *     (a pin that cannot be verified is not a pin);
 *   - every downloaded byte stream is hashed and compared against the pin via
 *     `crypto.timingSafeEqual` over the raw digest bytes BEFORE anything is
 *     written to its final name (temp-then-rename; a mismatch deletes the temp
 *     and exits 1 naming the key);
 *   - redirects are refused (`redirect: 'error'`) — the registry serves these
 *     URLs directly, and a redirect is how a request leaves the pinned host;
 *   - responses are read under a size cap, so a misbehaving endpoint cannot
 *     balloon the build.
 *
 * Idempotent: an existing pair whose tarball already matches the pinned hash is
 * skipped (and the sidecar re-asserted), so re-running against a warm directory
 * is a no-op. The server re-verifies every hash again at boot — this script
 * failing closed is the first check, not the only one.
 *
 * Zero dependencies, Node >= 20 (global fetch, node:crypto).
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/** The only registry this script will talk to (32 D2). */
const REGISTRY_BASE = 'https://registry.npmjs.org';
/** Published names are `@adminiumjs/add-on-<key>`; see scripts/release/publish-npm.mjs. */
const NPM_SCOPE = 'adminiumjs';

/** Aligned with the seed's filename grammar in apps/server/src/add-ons/store.ts. */
const KEY_RE = /^[a-z][a-z0-9-]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/** sha512 = 64 digest bytes = 88 base64 chars (two `=` of padding). */
const SRI_RE = /^sha512-[A-Za-z0-9+/]{86}==$/;

/** These tarballs are a few hundred KB each; 64 MiB is "something is wrong". */
const MAX_TARBALL_BYTES = 64 * 1024 * 1024;

const DEFAULT_PINS = fileURLToPath(new URL('./add-ons-bundle.json', import.meta.url));

function fail(message) {
  console.error(`fetch-add-ons-bundle: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let outDir;
  let pinsPath = DEFAULT_PINS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pins') {
      pinsPath = argv[i + 1];
      if (pinsPath === undefined) fail('--pins needs a file argument');
      i += 1;
    } else if (arg.startsWith('-')) {
      fail(`unknown option "${arg}" (usage: fetch-add-ons-bundle.mjs <outDir> [--pins <file>])`);
    } else if (outDir === undefined) {
      outDir = arg;
    } else {
      fail(`unexpected argument "${arg}" — exactly one output directory, please`);
    }
  }
  if (outDir === undefined) {
    fail('usage: node scripts/release/fetch-add-ons-bundle.mjs <outDir> [--pins <file>]');
  }
  return { outDir: resolve(outDir), pinsPath: resolve(pinsPath) };
}

/**
 * Read + validate the pin file. Every refusal here is a hard exit: a build
 * that proceeds past a malformed pin would ship a package this script never
 * verified, which is the one outcome the whole file exists to prevent.
 */
async function loadPins(pinsPath) {
  let raw;
  try {
    raw = await readFile(pinsPath, 'utf8');
  } catch (err) {
    fail(`cannot read pin file ${pinsPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    fail(`pin file ${pinsPath} is not valid JSON`);
  }
  if (doc === null || typeof doc !== 'object' || doc.schemaVersion !== 1) {
    fail(`pin file ${pinsPath} must declare "schemaVersion": 1`);
  }
  if (!Array.isArray(doc.addOns) || doc.addOns.length === 0) {
    fail(`pin file ${pinsPath} has no "addOns" entries`);
  }
  const seen = new Set();
  for (const pin of doc.addOns) {
    const label = pin && typeof pin === 'object' ? String(pin.key ?? '(missing key)') : '(not an object)';
    if (pin === null || typeof pin !== 'object') fail(`pin ${label}: not an object`);
    if (typeof pin.key !== 'string' || !KEY_RE.test(pin.key)) {
      fail(`pin ${label}: "key" must match ${String(KEY_RE)}`);
    }
    if (typeof pin.version !== 'string' || !VERSION_RE.test(pin.version)) {
      fail(`pin ${pin.key}: "version" must be an exact semver version, got ${JSON.stringify(pin.version)}`);
    }
    if (typeof pin.integrity !== 'string' || !SRI_RE.test(pin.integrity)) {
      // A pin without a verifiable integrity is refused outright — this script
      // never falls back to "whatever the registry says".
      fail(`pin ${pin.key}: "integrity" is missing or not a sha512 SRI string`);
    }
    if (seen.has(pin.key)) fail(`pin ${pin.key}: listed twice`);
    seen.add(pin.key);
  }
  return doc.addOns;
}

/** `sha512-<base64>` → the 64 raw digest bytes. Grammar is pre-checked by SRI_RE. */
function sriDigestBytes(integrity) {
  return Buffer.from(integrity.slice('sha512-'.length), 'base64');
}

function digestsMatch(bytes, integrity) {
  const actual = createHash('sha512').update(bytes).digest();
  const expected = sriDigestBytes(integrity);
  // Same length by construction (both sha512), but timingSafeEqual throws on a
  // length mismatch rather than returning false — keep the guard explicit.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Download one tarball, reading the body under {@link MAX_TARBALL_BYTES}.
 * Scoped-package tarball URL shape, verified against the live registry:
 *   https://registry.npmjs.org/@<scope>/<name>/-/<name>-<version>.tgz
 */
async function download(pin) {
  const name = `add-on-${pin.key}`;
  const url = `${REGISTRY_BASE}/@${NPM_SCOPE}/${name}/-/${name}-${pin.version}.tgz`;
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok || response.body === null) {
    throw new Error(`GET ${url} → ${response.status}`);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_TARBALL_BYTES) {
      throw new Error(`GET ${url} exceeded the ${String(MAX_TARBALL_BYTES)}-byte cap`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main() {
  const { outDir, pinsPath } = parseArgs(process.argv.slice(2));
  const pins = await loadPins(pinsPath);
  await mkdir(outDir, { recursive: true });

  const rows = [];
  for (const pin of pins) {
    const fileName = `${pin.key}-${pin.version}.tgz`;
    const target = join(outDir, fileName);
    const sidecar = `${target}.integrity`;

    // Idempotency: a tarball already on disk that hashes to the pin is kept.
    // The sidecar is (re)written unconditionally in that case — it is derived
    // from the pin, and a stale or missing sidecar next to a good tarball
    // should heal rather than fail.
    const existing = await readFile(target).catch(() => null);
    if (existing !== null && digestsMatch(existing, pin.integrity)) {
      await writeFile(sidecar, `${pin.integrity}\n`);
      rows.push({ key: pin.key, version: pin.version, status: 'skipped (verified)', bytes: existing.byteLength });
      console.log(`skip ${fileName} — already present, hash verified`);
      continue;
    }

    let bytes;
    try {
      bytes = await download(pin);
    } catch (err) {
      fail(`${pin.key}: download failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!digestsMatch(bytes, pin.integrity)) {
      // Nothing has been written under the final name; make sure no temp
      // survives either, then refuse loudly enough to stop the whole build.
      await rm(`${target}.partial`, { force: true });
      fail(
        `${pin.key}: integrity mismatch — the registry served bytes that do not match the pinned ` +
          `sha512 for ${fileName}. Refusing to write it.`,
      );
    }

    // Temp-then-rename, same discipline as the server's own store writes: an
    // interrupted build must not leave a half-tarball that a later run (or the
    // boot seed) reads as the package.
    const temp = `${target}.partial`;
    try {
      await writeFile(temp, bytes);
      await rename(temp, target);
      await writeFile(sidecar, `${pin.integrity}\n`);
    } catch (err) {
      await rm(temp, { force: true });
      fail(`${pin.key}: could not write ${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
    rows.push({ key: pin.key, version: pin.version, status: 'downloaded', bytes: bytes.byteLength });
    console.log(`ok   ${fileName} — downloaded, hash verified`);
  }

  const keyWidth = Math.max(...rows.map((r) => r.key.length), 'add-on'.length);
  const statusWidth = Math.max(...rows.map((r) => r.status.length), 'status'.length);
  console.log('');
  console.log(`${'add-on'.padEnd(keyWidth)}  version  ${'status'.padEnd(statusWidth)}  bytes`);
  for (const row of rows) {
    console.log(
      `${row.key.padEnd(keyWidth)}  ${row.version.padEnd(7)}  ${row.status.padEnd(statusWidth)}  ${String(row.bytes)}`,
    );
  }
  console.log(`\n${String(rows.length)} package(s) in ${outDir}`);
}

await main();
