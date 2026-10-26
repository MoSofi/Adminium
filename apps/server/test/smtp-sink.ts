// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A mail server for tests, on a loopback port: it speaks just enough SMTP for
 * nodemailer (EHLO, AUTH PLAIN, MAIL, RCPT, DATA, RSET, QUIT), keeps every
 * message as it arrived (the raw text, headers and DKIM signature included),
 * and refuses a recipient with the reply a test sets for that address (`550
 * 5.1.1 …` for good, `451 4.2.0 …` for later).
 */
import { createServer, type Server, type Socket } from 'node:net';

export interface SunkMessage {
  from: string;
  to: string[];
  /** The message as it came, CRLF line ends, dot-stuffing undone. */
  raw: string;
}

export interface SmtpSink {
  port: number;
  messages: SunkMessage[];
  /** The reply to `RCPT TO` for an address (lower case), instead of `250`. */
  refuse: Map<string, string>;
  close: () => Promise<void>;
}

export async function startSmtpSink(): Promise<SmtpSink> {
  const messages: SunkMessage[] = [];
  const refuse = new Map<string, string>();
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = '';
    let inData = false;
    let data: string[] = [];
    let from = '';
    let to: string[] = [];
    const say = (line: string) => socket.write(`${line}\r\n`);
    say('220 sink.test ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let at: number;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push({ from, to, raw: data.join('\r\n') });
            data = [];
            say('250 2.0.0 Ok: queued');
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') {
          say('250-sink.test');
          say('250-AUTH PLAIN LOGIN');
          say('250 8BITMIME');
        } else if (verb === 'HELO') say('250 sink.test');
        else if (verb === 'AUTH') say('235 2.7.0 Authentication successful');
        else if (verb === 'MAIL') {
          from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          to = [];
          say('250 2.1.0 Ok');
        } else if (verb === 'RCPT') {
          const address = (/<([^>]*)>/.exec(line)?.[1] ?? '').toLowerCase();
          const refused = refuse.get(address);
          if (refused !== undefined) say(refused);
          else {
            to.push(address);
            say('250 2.1.5 Ok');
          }
        } else if (verb === 'DATA') {
          inData = true;
          say('354 End data with <CR><LF>.<CR><LF>');
        } else if (verb === 'RSET') {
          from = '';
          to = [];
          say('250 2.0.0 Ok');
        } else if (verb === 'QUIT') {
          say('221 2.0.0 Bye');
          socket.end();
        } else say('250 Ok');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the SMTP sink has no port');
  return {
    port: address.port,
    messages,
    refuse,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A message's headers, unfolded, by lower-case name (the first of each). */
export function headersOf(raw: string): Map<string, string> {
  const head = raw.slice(0, raw.indexOf('\r\n\r\n'));
  const out = new Map<string, string>();
  let last: string | null = null;
  for (const line of head.split('\r\n')) {
    if (/^[ \t]/.test(line) && last !== null) {
      out.set(last, `${out.get(last) ?? ''} ${line.trim()}`.trim());
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    last = line.slice(0, colon).trim().toLowerCase();
    if (!out.has(last)) out.set(last, line.slice(colon + 1).trim());
    else last = null;
  }
  return out;
}

/** The names a DKIM signature's `h=` tag covers, in lower case. */
export function signedHeaders(raw: string): string[] {
  const signature = headersOf(raw).get('dkim-signature') ?? '';
  const h = /(?:^|;)\s*h=([^;]*)/.exec(signature.replace(/\s+/g, ''))?.[1] ?? '';
  return h === '' ? [] : h.split(':').map((name) => name.toLowerCase());
}

/** A message's text, its quoted-printable soft breaks and escapes undone (enough to find a sentence in it). */
export function decodedBody(raw: string): string {
  const body = raw.slice(raw.indexOf('\r\n\r\n') + 4).replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const hex = body[i] === '=' ? /^[0-9A-F]{2}/.exec(body.slice(i + 1, i + 3)) : null;
    if (hex !== null) {
      bytes.push(parseInt(hex[0], 16));
      i += 2;
    } else bytes.push(...Buffer.from(body[i]!, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}
