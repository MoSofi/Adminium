#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A fake operator for "Connect Supabase": both sides of the hand-off an
 * operator's connect service plays, for tests and for trying the flow on
 * this computer. It never talks to Supabase.
 *
 *   GET  <base>?instance=…&state=…&challenge=…   the page the browser is sent to.
 *        Picks a scenario (a list of links, or `scenario=` / `--auto`), mints a
 *        one-time code bound to the challenge, and sends the browser back to
 *        `<instance>/connect/supabase/return?state=…&code=…`. Like a real
 *        operator it sends it only to the origin registered for the instance
 *        (`--instance`), never to the `instance` parameter as given (S14).
 *   POST <base>/redeem {code, verifier}           the server-to-server redeem.
 *        Spends the code, checks S256(verifier) against the challenge, and
 *        answers as the scenario says.
 *
 * Scenarios: `new` (a new project, with its password), `existing` (an existing
 * project: no password, the instance asks for it), `redirect` (a 302 to the
 * cloud metadata address), `oversized` (an answer past 64 KB), `question` (a
 * `?` in `database`), `wrong-engine` (`mysql`), `expired` (the code is refused),
 * `slow` (answers after `--slow-ms`), `malformed` (not JSON), `bad-host` (a
 * host the database guard refuses: the cloud metadata name).
 *
 * It serves https with a certificate it makes at start, because the instance
 * calls only https operators. It also puts a TLS front before your local
 * Postgres (which usually has no TLS), because the answer always asks for
 * `sslmode=require`; the answer names that front.
 *
 * Run it (see apps/docs/.../self-hosting/for-other-people.md, "Connect Supabase"):
 *
 *   node scripts/dev/fake-connect-operator.mjs \
 *     --instance http://localhost:4600 \
 *     --database postgres://me@localhost:5432/shop
 *
 * then start Adminium with the two variables it prints.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { connect as netConnect, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';

export const SCENARIOS = ['new', 'existing', 'redirect', 'oversized', 'question', 'wrong-engine', 'expired', 'slow', 'malformed', 'bad-host'];

// ── a certificate, made here ─────────────────────────────────────────────────
// Node reads certificates but does not make them, and no certificate library is
// a dependency. A self-signed P-256 certificate for localhost is a few nested
// DER sequences, so it is written out directly.

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const integer = (bytes) => tlv(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
function oid(text) {
  const [first, second, ...rest] = text.split('.').map(Number);
  const out = [first * 40 + second];
  for (const part of rest) {
    const chunk = [];
    let n = part;
    do {
      chunk.unshift(n & 0x7f);
      n = Math.floor(n / 128);
    } while (n > 0);
    for (let i = 0; i < chunk.length - 1; i += 1) chunk[i] |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function utcTime(ms) {
  const iso = new Date(ms).toISOString();
  return tlv(0x17, Buffer.from(`${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`, 'ascii'));
}

/** A self-signed certificate for `localhost`, 127.0.0.1 and ::1, valid two days: `{ key, cert }` as PEM. */
export function selfSignedTls() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const name = seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from('Adminium fake connect operator')))));
  const altNames = seq(tlv(0x82, Buffer.from('localhost')), tlv(0x87, Buffer.from([127, 0, 0, 1])), tlv(0x87, Buffer.from([...Array(15).fill(0), 1])));
  const extensions = tlv(
    0xa3,
    seq(
      seq(oid('2.5.29.19'), tlv(0x01, Buffer.from([0xff])), tlv(0x04, seq(tlv(0x01, Buffer.from([0xff]))))),
      seq(oid('2.5.29.17'), tlv(0x04, altNames)),
    ),
  );
  const now = Date.now();
  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))),
    integer(randomBytes(8)),
    ecdsaSha256,
    name,
    seq(utcTime(now - 60_000), utcTime(now + 2 * 86_400_000)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`,
  };
}

/**
 * Listen on this machine's loopback, both families, one port: `localhost`
 * resolves to ::1 and to 127.0.0.1, and a client may try either first.
 * Never on another interface.
 */
async function listenLoopback(make, port = 0) {
  const first = make();
  await new Promise((resolve, reject) => {
    first.once('error', reject);
    first.listen(port, '127.0.0.1', resolve);
  });
  const bound = first.address().port;
  const servers = [first];
  const second = make();
  await new Promise((resolve) => {
    second.once('error', () => resolve()); // no IPv6 here: 127.0.0.1 alone
    second.listen(bound, '::1', () => {
      servers.push(second);
      resolve();
    });
  });
  return { port: bound, servers };
}

// ── a TLS front for a Postgres without TLS ───────────────────────────────────

const SSL_REQUEST = 80877103;

/**
 * Listen on a port of its own; answer Postgres's SSLRequest with `S`, take the
 * TLS handshake, and pass the plain protocol on to `target`. A client that
 * does not ask for TLS is hung up on, so a connection that works through the
 * front proves the instance asked for it.
 */
export async function startPostgresTlsFront({ target, tls = selfSignedTls() }) {
  const sockets = new Set();
  const make = () => createNetServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.once('data', (first) => {
      if (first.length < 8 || first.readUInt32BE(4) !== SSL_REQUEST) {
        socket.destroy();
        return;
      }
      socket.write('S');
      const secure = new TLSSocket(socket, { isServer: true, key: tls.key, cert: tls.cert });
      const upstream = netConnect(target.port, target.host);
      sockets.add(upstream);
      upstream.on('close', () => sockets.delete(upstream));
      const end = () => {
        secure.destroy();
        upstream.destroy();
      };
      secure.on('error', end);
      upstream.on('error', end);
      secure.pipe(upstream).pipe(secure);
    });
  });
  const { port, servers } = await listenLoopback(make);
  return {
    port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(() => resolve()))));
    },
  };
}

// ── the operator ─────────────────────────────────────────────────────────────

const s256 = (verifier) => createHash('sha256').update(verifier).digest('base64url');

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font:15px system-ui;margin:48px;max-width:640px}a{display:block;margin:8px 0}</style></head><body><h1>${title}</h1>${body}</body></html>`;
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Start the fake operator.
 *
 * - `instance`: the origin registered for the instance (where the browser goes back to).
 * - `answer`: the database the answers name: `{ host, port, database, user, password, project }`.
 * - `scenario`: the default for a page visit without one; `auto`: skip the list and use it.
 * - `slowMs`: how long `slow` waits before answering.
 *
 * Returns `{ url, cert, redeems, close }`: `url` is the value for
 * ADMINIUM_SUPABASE_CONNECT_URL, `cert` the certificate to trust, `redeems`
 * every redeem body received (to check what the instance sent).
 */
export async function startFakeOperator({ instance, answer, scenario = 'new', auto = false, slowMs = 11_000, port = 0, basePath = '/supabase', tls = selfSignedTls() }) {
  const registered = new URL(instance).origin;
  const codes = new Map();
  const redeems = [];
  const timers = new Set();

  function answerFor(chosen) {
    const good = { engine: 'postgres', host: answer.host, port: answer.port, database: answer.database, user: answer.user, sslmode: 'require', project: answer.project ?? 'hollis-orders' };
    switch (chosen) {
      case 'new':
      case 'slow':
        return { ...good, password: answer.password ?? 'operator-made-password' };
      case 'existing':
        return good;
      case 'question':
        return { ...good, database: `${answer.database}?host=10.0.0.5`, password: 'x' };
      case 'wrong-engine':
        return { ...good, engine: 'mysql', password: 'x' };
      case 'bad-host':
        return { ...good, host: 'metadata.google.internal', password: 'x' };
      case 'oversized':
        return { ...good, password: 'x', padding: 'x'.repeat(70 * 1024) };
      default:
        return good;
    }
  }

  const handle = (req, res) => {
    const url = new URL(req.url ?? '/', 'https://fake');
    if (req.method === 'GET' && (url.pathname === basePath || url.pathname === `${basePath}/`)) {
      const state = url.searchParams.get('state');
      const challenge = url.searchParams.get('challenge');
      const asked = url.searchParams.get('instance');
      if (state === null || challenge === null || asked === null) {
        res.writeHead(400, { 'content-type': 'text/html' }).end(page('Missing state, challenge or instance', ''));
        return;
      }
      if (new URL(asked).origin !== registered) {
        res.writeHead(400, { 'content-type': 'text/html' }).end(page('Not the registered instance', `<p>This operator sends people back only to ${escapeHtml(registered)}.</p>`));
        return;
      }
      const picked = url.searchParams.get('scenario') ?? (auto ? scenario : null);
      if (picked === null) {
        const links = SCENARIOS.map((name) => {
          const next = new URL(url);
          next.searchParams.set('scenario', name);
          return `<a href="${escapeHtml(`${next.pathname}${next.search}`)}">${escapeHtml(name)}</a>`;
        }).join('');
        res.writeHead(200, { 'content-type': 'text/html' }).end(page('Fake Supabase sign-in', `<p>Pick what the operator answers.</p>${links}`));
        return;
      }
      if (!SCENARIOS.includes(picked)) {
        res.writeHead(400, { 'content-type': 'text/html' }).end(page('Unknown scenario', ''));
        return;
      }
      const code = randomBytes(24).toString('base64url');
      codes.set(code, { challenge, scenario: picked, expiresAt: Date.now() + 60_000 });
      const back = new URL('/connect/supabase/return', registered);
      back.searchParams.set('state', state);
      back.searchParams.set('code', code);
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === `${basePath}/redeem`) {
      const parts = [];
      req.on('data', (part) => parts.push(part));
      req.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(parts).toString('utf8'));
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"bad request"}');
          return;
        }
        redeems.push(body);
        const held = codes.get(body.code);
        codes.delete(body.code);
        if (held === undefined || held.expiresAt < Date.now() || held.scenario === 'expired') {
          res.writeHead(410, { 'content-type': 'application/json' }).end('{"error":"expired"}');
          return;
        }
        if (typeof body.verifier !== 'string' || s256(body.verifier) !== held.challenge) {
          res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"verifier"}');
          return;
        }
        const send = () => {
          if (held.scenario === 'redirect') {
            res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
            return;
          }
          if (held.scenario === 'malformed') {
            res.writeHead(200, { 'content-type': 'text/plain' }).end('this is not json');
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answerFor(held.scenario)));
        };
        if (held.scenario === 'slow') {
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (!res.destroyed) send();
          }, slowMs);
          timers.add(timer);
        } else send();
      });
      return;
    }
    res.writeHead(404).end();
  };
  const { port: listening, servers } = await listenLoopback(() => createHttpsServer({ key: tls.key, cert: tls.cert }, handle), port);
  return {
    url: `https://localhost:${listening}${basePath}`,
    cert: tls.cert,
    redeems,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const server of servers) server.closeAllConnections();
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(() => resolve()))));
    },
  };
}

// ── the command ──────────────────────────────────────────────────────────────

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [name, inline] = arg.slice(2).split('=', 2);
    if (inline !== undefined) out[name] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[name] = argv[(i += 1)];
    else out[name] = 'true';
  }
  return out;
}

async function main() {
  const args = flags(process.argv.slice(2));
  if (args.help !== undefined || args.database === undefined) {
    process.stdout.write(
      [
        'Usage: node scripts/dev/fake-connect-operator.mjs --database postgres://user[:password]@localhost:5432/db [options]',
        '',
        '  --instance <origin>   where the browser goes back to (default http://localhost:4600)',
        '  --port <n>            the operator\'s port (default 4790)',
        `  --scenario <name>     ${SCENARIOS.join(', ')}; with --auto, used without asking`,
        '  --auto                skip the list of scenarios',
        '  --slow-ms <n>         how long "slow" waits (default 11000)',
        '',
      ].join('\n'),
    );
    process.exitCode = args.help === undefined ? 1 : 0;
    return;
  }
  const db = new URL(args.database);
  const tls = selfSignedTls();
  const front = await startPostgresTlsFront({ target: { host: db.hostname, port: Number(db.port || 5432) }, tls });
  const operator = await startFakeOperator({
    instance: args.instance ?? 'http://localhost:4600',
    answer: {
      host: 'localhost',
      port: front.port,
      database: decodeURIComponent(db.pathname.replace(/^\//, '')),
      user: decodeURIComponent(db.username),
      password: db.password === '' ? undefined : decodeURIComponent(db.password),
      project: args.project ?? 'hollis-orders',
    },
    scenario: args.scenario ?? 'new',
    auto: args.auto !== undefined,
    slowMs: args['slow-ms'] === undefined ? 11_000 : Number(args['slow-ms']),
    port: args.port === undefined ? 4790 : Number(args.port),
    tls,
  });
  const caFile = join(tmpdir(), 'adminium-fake-connect-operator.pem');
  writeFileSync(caFile, operator.cert);
  process.stdout.write(
    [
      `Fake connect operator on ${operator.url} (TLS front for ${db.host} on localhost:${String(front.port)}).`,
      'Start Adminium with:',
      '',
      `  ADMINIUM_SUPABASE_CONNECT_URL=${operator.url}`,
      `  NODE_EXTRA_CA_CERTS=${caFile}`,
      '',
      'Ctrl+C stops it.',
      '',
    ].join('\n'),
  );
  const stop = () => {
    void Promise.all([operator.close(), front.close()]).then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
