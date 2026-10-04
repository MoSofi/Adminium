// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A Designer session, kept as files in the project folder.
 *
 *   .adminium/designer/sessions/<id>/session.json      what the session is
 *   .adminium/designer/sessions/<id>/transcript.jsonl  every message, one per line
 *   .adminium/designer/sessions/<id>/events.jsonl      every event, in order
 *
 * Files, not meta rows: a session belongs to one app in one folder, and goes
 * with the folder. Each message and event is appended as it happens, so a
 * server that stops loses nothing but the turn that was running. Nothing
 * here ever holds a key: the transcript is messages, not requests.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import type { RunMessage } from '@adminium/llm';

import { NotFoundError } from '../errors.js';
import type { DesignerEvent } from './events.js';

/** Where the Designer keeps what it keeps, under the project folder. */
export const DESIGNER_DIR = join('.adminium', 'designer');

/** What a person can ask the Designer to build for. Mobile comes with its own milestone. */
export const DESIGNER_TARGETS = ['auto', 'dashboard', 'web'] as const;
export type DesignerTarget = (typeof DESIGNER_TARGETS)[number];

export interface DesignerSession {
  id: string;
  /** The app this session builds: `apps/<appKey>/`. */
  appKey: string;
  title: string;
  target: DesignerTarget;
  /** The model connection and model a turn calls. */
  connectionId: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  /** How many turns were started. */
  turns: number;
  /** The newest version, or null before the first. */
  version: number | null;
  /** Whether this session made the app's folder (then "put the files back" in its first turn empties it). */
  createdApp: boolean;
  /** A person gave the session its title: it no longer follows the app's name. */
  titled?: boolean;
  /** The Designer gave the app its name (and its key was made from it): asked once, before anything is written. */
  named?: boolean;
  /** The style the person picked when they started, a design skill's key; absent when they left it to the Designer. */
  style?: string;
  /** Tokens spent across the session, for its ceiling. */
  tokens: { in: number; out: number };
}

/** A session id: `ds_` and 24 characters that sort by time. */
const SESSION_ID = /^ds_[0-9a-z]{24}$/;

export function newSessionId(now: number = Date.now()): string {
  return `ds_${now.toString(36).padStart(10, '0')}${randomBytes(7).toString('hex')}`;
}

export interface SessionStore {
  list(): DesignerSession[];
  create(input: Omit<DesignerSession, 'id' | 'createdAt' | 'updatedAt' | 'turns' | 'version' | 'tokens'>): DesignerSession;
  /** The session, or a 404 for an id that is not one or not there. */
  read(id: string): DesignerSession;
  update(id: string, patch: Partial<Omit<DesignerSession, 'id' | 'createdAt'>>): DesignerSession;
  appendMessage(id: string, turn: number, message: RunMessage): void;
  /** Every message, in order, with the turn each belongs to. */
  messages(id: string): { turn: number; message: RunMessage }[];
  appendEvent(id: string, event: DesignerEvent): void;
  /** Events after `after`, at most `limit`. */
  eventsSince(id: string, after: number, limit: number): { events: DesignerEvent[]; more: boolean };
  /** The newest event's sequence number, or 0. */
  lastSeq(id: string): number;
}

/** Each line of a JSON-lines file, skipping one a crash cut short. */
function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // A line half-written when the process stopped: the rest is still good.
    }
  }
  return out;
}

export function createSessionStore(root: string, opts: { now?: () => number } = {}): SessionStore {
  const now = opts.now ?? Date.now;
  const sessionsDir = join(root, DESIGNER_DIR, 'sessions');
  const dirOf = (id: string): string => {
    if (!SESSION_ID.test(id)) throw new NotFoundError('There is no such Designer session.', { sessionId: id });
    return join(sessionsDir, id);
  };
  const fileOf = (id: string): string => join(dirOf(id), 'session.json');
  /** Last sequence numbers already read, so appending stays cheap. */
  const seqs = new Map<string, number>();

  function write(session: DesignerSession): void {
    const file = fileOf(session.id);
    const temp = `${file}.tmp`;
    writeFileSync(temp, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  }

  function read(id: string): DesignerSession {
    const file = fileOf(id);
    if (!existsSync(file)) throw new NotFoundError('There is no such Designer session.', { sessionId: id });
    return JSON.parse(readFileSync(file, 'utf8')) as DesignerSession;
  }

  return {
    list() {
      if (!existsSync(sessionsDir)) return [];
      return readdirSync(sessionsDir)
        .filter((name) => SESSION_ID.test(name) && existsSync(join(sessionsDir, name, 'session.json')))
        .map((name) => read(name))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    create(input) {
      const at = now();
      const session: DesignerSession = { ...input, id: newSessionId(at), createdAt: at, updatedAt: at, turns: 0, version: null, tokens: { in: 0, out: 0 } };
      mkdirSync(dirOf(session.id), { recursive: true, mode: 0o700 });
      write(session);
      return session;
    },
    read,
    update(id, patch) {
      const next = { ...read(id), ...patch, updatedAt: now() };
      write(next);
      return next;
    },
    appendMessage(id, turn, message) {
      appendFileSync(join(dirOf(id), 'transcript.jsonl'), `${JSON.stringify({ turn, message })}\n`, { mode: 0o600 });
    },
    messages(id) {
      return readLines<{ turn: number; message: RunMessage }>(join(dirOf(id), 'transcript.jsonl'));
    },
    appendEvent(id, event) {
      appendFileSync(join(dirOf(id), 'events.jsonl'), `${JSON.stringify(event)}\n`, { mode: 0o600 });
      seqs.set(id, event.seq);
    },
    eventsSince(id, after, limit) {
      const all = readLines<DesignerEvent>(join(dirOf(id), 'events.jsonl')).filter((event) => event.seq > after);
      return { events: all.slice(0, limit), more: all.length > limit };
    },
    lastSeq(id) {
      const known = seqs.get(id);
      if (known !== undefined) return known;
      const events = readLines<DesignerEvent>(join(dirOf(id), 'events.jsonl'));
      const last = events.reduce((max, event) => Math.max(max, event.seq), 0);
      seqs.set(id, last);
      return last;
    },
  };
}
