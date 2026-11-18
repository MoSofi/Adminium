// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE VISITOR'S CONVERSATION, as the window holds it: what was said, what
 * is on its way, the conversation's state and the business's hours, and the
 * calls that move it on.
 *
 * SENDING. The first message solves the human check, then starts the
 * conversation (`checking`; a failed check says so, with "Try again"). Later
 * ones are posted with the token. A message the door could not be reached
 * for waits (`queued`, the "can't reach" band shown) and goes once a poll
 * gets through again; one the door refused for another reason is "Not
 * sent", with "Try again". A tripped cap greys the box and says the wait
 * the door gave, by which cap.
 *
 * POLLING is the heartbeat (the door counts the visitor as on the page while
 * the window asks): every 4 seconds while a person is wanted or answering,
 * or an answer is due; every 15 when it is quiet; every 60 while the window
 * is closed (so a reply can light the launcher's badge) or the chat is
 * closed (so a reopen is seen). Never without a conversation. A hidden tab
 * asks four times less often, and an unreachable door is asked less and
 * less often until it answers.
 *
 * KEPT across the website's pages (`keep.ts`): the token, the last message
 * read, the details saved, the language and whether the window was open. A
 * kept token that the door no longer knows (lapsed after a day, erased)
 * starts afresh with "We couldn't find your earlier chat".
 *
 * A PREVIEW ("Try the chat" in the add-on's settings) writes nothing and
 * calls nothing: a message shows in the log and goes nowhere.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ChatOffline, isRefusal, type ChatCap, type ChatDoorClient, type ChatHours, type ChatMessage, type ChatRefusal, type ChatState, type NextOpen } from './api.js';
import { readKept, writeKept } from './keep.js';

export type PendingStatus = 'checking' | 'fail' | 'sending' | 'notSent' | 'queued';

/** A visitor's message not yet in the conversation. */
export interface Pending {
  key: string;
  body: string;
  status: PendingStatus;
}

/** The hours ended while the conversation went on: drawn after the message it followed. */
export interface HoursEnded {
  closing: string | null;
  nextOpen: NextOpen | null;
  after: string;
}

/** A tripped cap: which, and until when (null: never, for this conversation). */
export interface Rate {
  cap: ChatCap;
  until: number | null;
}

export interface Session {
  token: string | null;
  cursor: string;
  state: ChatState | null;
  messages: ChatMessage[];
  pending: Pending[];
  /** The first message's time, when the conversation was taken up again on another page. */
  resumedAt: string | null;
  /** A kept conversation the door no longer knows. */
  lost: boolean;
  hoursEnded: HoursEnded | null;
  hours: ChatHours;
  rate: Rate | null;
  offline: boolean;
  name: string;
  email: string;
  saved: boolean;
  /** Where the reply to a question left outside hours goes, once it is sent. */
  asked: string | null;
  open: boolean;
  unread: number;
  language: string;
}

/** What asking a question outside hours came to. */
export type QuestionResult = 'sent' | 'proof' | 'offline' | 'in-hours' | { tooMany: number | null } | { field: 'question' | 'email' | 'name' };

/** What saving the name and e-mail came to. */
export type DetailsResult = 'saved' | 'offline' | 'failed' | { field: 'email' | 'name' };

export interface SessionDeps {
  addOn: string;
  door: ChatDoorClient;
  hours: ChatHours;
  language: string;
  preview: boolean;
  /** The page the visitor is on, for the first message's "came from". */
  page: () => string | null;
  /** A message the door would not take now, given back to the box. */
  giveBack: (text: string) => void;
  now?: () => number;
}

const compareIds = (a: string, b: string): number => {
  try {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
};

function merge(list: readonly ChatMessage[], more: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map(list.map((message) => [message.id, message]));
  for (const message of more) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
}

/** Whether an answer is due: the conversation is with automatic answers and the visitor spoke last. */
function answerDue(session: Pick<Session, 'state' | 'pending' | 'messages'>): boolean {
  return session.state === 'bot' && (session.pending.length > 0 || session.messages[session.messages.length - 1]?.kind === 'visitor');
}

/** How long until the next poll; null for none. */
export function pollEvery(session: Pick<Session, 'token' | 'state' | 'open' | 'offline' | 'pending' | 'messages'>, opts: { hidden: boolean; failures: number; preview: boolean }): number | null {
  if (session.token === null || opts.preview) return null;
  let every: number;
  if (session.offline) every = Math.min(30_000, 4_000 * 2 ** Math.min(opts.failures, 3));
  else if (session.state === 'closed' || !session.open) every = 60_000;
  else if (session.state === 'waiting' || session.state === 'open' || answerDue(session)) every = 4_000;
  else every = 15_000;
  return opts.hidden ? Math.min(every * 4, 120_000) : every;
}

const counted = (message: ChatMessage): boolean => message.kind === 'staff' || message.kind === 'automatic';

export function useChatSession(deps: SessionDeps) {
  const { addOn, door, preview } = deps;
  const now = deps.now ?? Date.now;
  const kept = useRef(preview ? null : readKept(addOn));
  const first = (): Session => ({
    token: kept.current?.token ?? null,
    // A kept conversation is read again from its start, so the whole of it shows on the new page.
    cursor: '0',
    state: null,
    messages: [],
    pending: [],
    resumedAt: null,
    lost: false,
    hoursEnded: null,
    hours: deps.hours,
    rate: null,
    offline: false,
    name: kept.current?.name ?? '',
    email: kept.current?.email ?? '',
    saved: kept.current?.saved ?? false,
    asked: null,
    // A preview shows the window open; a visitor's opens when they ask, or as it was on the last page.
    open: preview || kept.current?.open === true,
    unread: 0,
    language: deps.language,
  });
  const ref = useRef<Session | null>(null);
  if (ref.current === null) ref.current = first();
  const [session, setSession] = useState<Session>(ref.current);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const polling = useRef(false);
  const alive = useRef(true);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  // Bumped after every poll, so the next one is set even when nothing changed.
  const [beat, setBeat] = useState(0);
  const pollRef = useRef<() => Promise<void>>(async () => undefined);

  const update = useCallback((change: (prev: Session) => Session) => {
    const next = change(ref.current!);
    ref.current = next;
    if (alive.current) setSession(next);
  }, []);

  // What the next page needs, kept whenever it changes.
  useEffect(() => {
    if (preview) return;
    const { token, cursor, name, email, saved, open, language } = session;
    writeKept(addOn, { ...(token === null ? {} : { token }), cursor, name, email, saved, open, language });
  }, [session.token, session.cursor, session.name, session.email, session.saved, session.open, session.language]);

  /** A kept conversation the door does not know any more: start afresh, saying so. */
  const lose = useCallback(() => {
    update((prev) => ({ ...prev, token: null, cursor: '0', state: null, messages: [], pending: [], resumedAt: null, lost: true, hoursEnded: null, rate: null, saved: false }));
  }, [update]);

  /** A poll's or a reply's news, taken in. */
  const takeIn = useCallback(
    (news: { messages?: ChatMessage[]; state?: ChatState; cursor?: string; token?: string; hours?: ChatHours }, opts: { counted?: boolean } = {}) => {
      update((prev) => {
        const messages = news.messages === undefined ? prev.messages : merge(prev.messages, news.messages);
        const fresh = (news.messages ?? []).filter((message) => !prev.messages.some((held) => held.id === message.id));
        let hoursEnded = prev.hoursEnded;
        // The hours ended while the conversation went on: said once, after the last message.
        if (news.hours !== undefined && prev.hours.open && !news.hours.open && prev.state !== null && prev.state !== 'closed' && hoursEnded === null && messages.length > 0) {
          hoursEnded = { closing: prev.hours.closesAt, nextOpen: news.hours.nextOpen, after: messages[messages.length - 1]!.id };
        }
        return {
          ...prev,
          messages,
          state: news.state ?? prev.state,
          cursor: news.cursor !== undefined && compareIds(news.cursor, prev.cursor) > 0 ? news.cursor : prev.cursor,
          token: news.token ?? prev.token,
          hours: news.hours ?? prev.hours,
          hoursEnded,
          // Replies that came while the window was closed; never a conversation read again on a new page.
          unread: prev.open || opts.counted === false ? 0 : prev.unread + fresh.filter(counted).length,
        };
      });
    },
    [update],
  );

  const setPending = useCallback((key: string, status: PendingStatus | null) => {
    update((prev) => ({ ...prev, pending: status === null ? prev.pending.filter((one) => one.key !== key) : prev.pending.map((one) => (one.key === key ? { ...one, status } : one)) }));
  }, [update]);

  const tooMany = useCallback(
    (refused: Extract<ChatRefusal, { state: 'too-many' }>, key: string) => {
      // As drawn: the box is greyed and empty for the wait, and the message it refused is not shown.
      setPending(key, null);
      update((prev) => ({ ...prev, rate: { cap: refused.cap, until: refused.retryAfter === null ? null : now() + refused.retryAfter * 1000 } }));
    },
    [setPending, update],
  );

  const offline = useCallback(() => {
    failures.current += 1;
    update((prev) => (prev.offline ? prev : { ...prev, offline: true }));
  }, [update]);

  /** The first message: the human check, then the conversation. */
  const startWith = useCallback(
    async (key: string, body: string): Promise<void> => {
      setPending(key, 'checking');
      try {
        // The check's solver is fetched with the first message: no page needs it before.
        const { solve } = await import('../../pay/proof.js');
        let reply: Awaited<ReturnType<ChatDoorClient['start']>> = { state: 'proof' };
        // One silent second try: a check can expire while a slow phone solves it.
        for (let round = 0; round < 2 && isRefusal(reply) && reply.state === 'proof'; round += 1) {
          const challenge = await door.challenge();
          reply = await door.start(`${challenge.id}.${solve(challenge.salt, challenge.difficulty)}`, { body, language: ref.current!.language, cameFrom: deps.page() });
        }
        if (!isRefusal(reply)) {
          failures.current = 0;
          update((prev) => ({ ...prev, pending: prev.pending.filter((one) => one.key !== key), lost: false, offline: false, rate: null }));
          takeIn({ messages: reply.messages, state: reply.conversation.state, cursor: reply.cursor, token: reply.token, hours: { open: reply.open, closesAt: reply.closesAt, nextOpen: reply.nextOpen } });
          return;
        }
        if (reply.state === 'proof') setPending(key, 'fail');
        else if (reply.state === 'too-many') tooMany(reply, key);
        else setPending(key, 'notSent');
      } catch (error) {
        if (error instanceof ChatOffline) {
          setPending(key, 'queued');
          offline();
        } else setPending(key, 'notSent');
      }
    },
    [door, setPending, takeIn, tooMany, offline, update],
  );

  /** A later message, with the token. */
  const postWith = useCallback(
    async (key: string, body: string): Promise<void> => {
      const token = ref.current!.token;
      if (token === null) return startWith(key, body);
      setPending(key, 'sending');
      try {
        const reply = await door.post(token, { body });
        if (!isRefusal(reply)) {
          failures.current = 0;
          update((prev) => ({ ...prev, pending: prev.pending.filter((one) => one.key !== key), offline: false }));
          takeIn({ ...(reply.message === undefined ? {} : { messages: [reply.message] }), state: reply.conversation.state, token: reply.token });
          return;
        }
        if (reply.state === 'lost') {
          lose();
          deps.giveBack(body);
        } else if (reply.state === 'too-many') tooMany(reply, key);
        else {
          setPending(key, 'notSent');
          // Closed meanwhile: the next poll brings who closed it.
          if (reply.state === 'write-closed') void pollRef.current();
        }
      } catch (error) {
        if (error instanceof ChatOffline) {
          setPending(key, 'queued');
          offline();
        } else setPending(key, 'notSent');
      }
    },
    [door, startWith, setPending, takeIn, tooMany, lose, offline, update],
  );

  /** Messages that waited for the door, sent in order once it answers again. */
  const flush = useCallback(async () => {
    for (const waiting of ref.current!.pending.filter((one) => one.status === 'queued')) {
      if (ref.current!.offline) return;
      await postWith(waiting.key, waiting.body);
    }
  }, [postWith]);

  const pollNow = useCallback(async (): Promise<void> => {
    const token = ref.current!.token;
    if (token === null || preview || polling.current) return;
    polling.current = true;
    try {
      const reply = await door.poll(token, ref.current!.cursor);
      if (isRefusal(reply)) {
        if (reply.state === 'lost' || reply.state === 'unavailable') lose();
        return;
      }
      const wasOffline = ref.current!.offline;
      failures.current = 0;
      if (wasOffline) update((prev) => ({ ...prev, offline: false }));
      takeIn({ messages: reply.messages, state: reply.state, cursor: reply.cursor, hours: { open: reply.open, closesAt: reply.closesAt, nextOpen: reply.nextOpen } });
      if (wasOffline) void flush();
    } catch (error) {
      if (error instanceof ChatOffline) offline();
    } finally {
      polling.current = false;
      if (alive.current) setBeat((n) => n + 1);
    }
  }, [door, preview, lose, takeIn, offline, flush, update]);
  pollRef.current = pollNow;

  // The heartbeat: the next poll, from what the conversation is now.
  const every = pollEvery(session, { hidden, failures: failures.current, preview });
  useEffect(() => {
    if (every === null) return undefined;
    timer.current = setTimeout(() => {
      void pollNow();
    }, every);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [every, beat, pollNow]);

  useEffect(() => {
    const seen = (): void => {
      const now = document.visibilityState === 'hidden';
      setHidden(now);
      // Back in view: ask at once rather than at the end of a long wait.
      if (!now) void pollNow();
    };
    const back = (): void => void pollNow();
    document.addEventListener('visibilitychange', seen);
    window.addEventListener('online', back);
    return () => {
      document.removeEventListener('visibilitychange', seen);
      window.removeEventListener('online', back);
    };
  }, [pollNow]);

  // A kept conversation, taken up again on this page: everything in it, from the start.
  useEffect(() => {
    alive.current = true;
    const token = ref.current!.token;
    if (token !== null && !preview) {
      polling.current = true;
      void (async () => {
        try {
          const reply = await door.poll(token, '0');
          if (isRefusal(reply)) {
            lose();
            return;
          }
          update((prev) => ({ ...prev, resumedAt: reply.messages[0]?.sentAt ?? null, cursor: '0' }));
          takeIn({ messages: reply.messages, state: reply.state, cursor: reply.cursor, hours: { open: reply.open, closesAt: reply.closesAt, nextOpen: reply.nextOpen } }, { counted: false });
        } catch (error) {
          if (error instanceof ChatOffline) offline();
        } finally {
          polling.current = false;
          if (alive.current) setBeat((n) => n + 1);
        }
      })();
    }
    return () => {
      alive.current = false;
    };
  }, []);

  // A cap's wait, ended: the box opens again by itself.
  useEffect(() => {
    const until = session.rate?.until;
    if (until === undefined || until === null) return undefined;
    const wait = setTimeout(() => update((prev) => ({ ...prev, rate: null })), Math.max(0, until - now()));
    return () => clearTimeout(wait);
  }, [session.rate]);

  const send = useCallback(
    (text: string): void => {
      const body = text.trim();
      if (body === '') return;
      seq.current += 1;
      const key = `p${String(seq.current)}`;
      if (preview) {
        // Shown, sent nowhere.
        takeIn({ messages: [{ id: `${String(now())}${String(seq.current).padStart(3, '0')}`, kind: 'visitor', body, sentAt: new Date(now()).toISOString() }] });
        return;
      }
      update((prev) => ({ ...prev, lost: false, pending: [...prev.pending, { key, body, status: prev.token === null ? 'checking' : 'sending' }] }));
      void postWith(key, body);
    },
    [preview, postWith, takeIn, update],
  );

  const retry = useCallback(
    (key: string): void => {
      const waiting = ref.current!.pending.find((one) => one.key === key);
      if (waiting !== undefined) void postWith(waiting.key, waiting.body);
    },
    [postWith],
  );

  const talk = useCallback(async (): Promise<boolean> => {
    const token = ref.current!.token;
    if (token === null || preview) return false;
    try {
      const reply = await door.post(token, { talk: true });
      if (isRefusal(reply)) {
        if (reply.state === 'lost') lose();
        return false;
      }
      takeIn({ ...(reply.message === undefined ? {} : { messages: [reply.message] }), state: reply.conversation.state, token: reply.token });
      return true;
    } catch (error) {
      if (error instanceof ChatOffline) offline();
      return false;
    }
  }, [door, preview, lose, takeIn, offline]);

  const saveDetails = useCallback(
    async (name: string, email: string): Promise<DetailsResult> => {
      const token = ref.current!.token;
      if (token === null || preview) return 'failed';
      try {
        const reply = await door.details(token, { name, email });
        if (!isRefusal(reply)) {
          update((prev) => ({ ...prev, name, email, saved: true, token: reply.token }));
          return 'saved';
        }
        if (reply.state === 'refused') return { field: reply.errors['email'] !== undefined ? 'email' : 'name' };
        if (reply.state === 'lost') lose();
        return 'failed';
      } catch (error) {
        if (error instanceof ChatOffline) return 'offline';
        return 'failed';
      }
    },
    [door, preview, lose, update],
  );

  const changeDetails = useCallback(() => update((prev) => ({ ...prev, saved: false })), [update]);

  const question = useCallback(
    async (sent: { question: string; name: string; email: string }): Promise<QuestionResult> => {
      if (preview) {
        update((prev) => ({ ...prev, asked: sent.email }));
        return 'sent';
      }
      try {
        const { solve } = await import('../../pay/proof.js');
        let reply: Awaited<ReturnType<ChatDoorClient['question']>> = { state: 'proof' };
        for (let round = 0; round < 2 && isRefusal(reply) && reply.state === 'proof'; round += 1) {
          const challenge = await door.challenge();
          reply = await door.question(`${challenge.id}.${solve(challenge.salt, challenge.difficulty)}`, { ...sent, language: ref.current!.language, cameFrom: deps.page() });
        }
        if (!isRefusal(reply)) {
          update((prev) => ({ ...prev, email: sent.email, name: sent.name, asked: sent.email }));
          return 'sent';
        }
        if (reply.state === 'refused') {
          const field = (['question', 'email', 'name'] as const).find((one) => reply.errors[one] !== undefined) ?? 'question';
          return { field };
        }
        if (reply.state === 'too-many') return { tooMany: reply.retryAfter };
        if (reply.state === 'in-hours') return 'in-hours';
        return 'proof';
      } catch (error) {
        return error instanceof ChatOffline ? 'offline' : 'proof';
      }
    },
    [door, preview, update],
  );

  const newChat = useCallback(() => {
    update((prev) => ({ ...prev, token: null, cursor: '0', state: null, messages: [], pending: [], resumedAt: null, lost: false, hoursEnded: null, rate: null, saved: false, unread: 0 }));
  }, [update]);

  const setOpen = useCallback((open: boolean) => update((prev) => ({ ...prev, open, unread: open ? 0 : prev.unread })), [update]);

  const setLanguage = useCallback(
    (language: string) => {
      update((prev) => ({ ...prev, language }));
      const token = ref.current!.token;
      // The conversation follows: later automatic answers come in the new language.
      if (token !== null && !preview) void door.details(token, { language }).catch(() => undefined);
    },
    [door, preview, update],
  );

  const setHours = useCallback((hours: ChatHours) => update((prev) => ({ ...prev, hours })), [update]);

  return { session, send, retry, talk, saveDetails, changeDetails, question, newChat, setOpen, setLanguage, setHours, pollNow };
}
