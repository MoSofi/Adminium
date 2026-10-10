// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ASSISTANT SPEAKING, with the browser's own voice.
 *
 * Nothing leaves the browser: `speechSynthesis` reads the reply's words. One
 * thing is read at a time; asking for another stops the first.
 *
 * WHAT CAN BE READ. A reply is read only where the browser has a voice for
 * the reply's language: a French answer in an English voice is worse than
 * silence, so where there is none there is no speaker to press.
 *
 * WHAT STOPS IT. The stop button, Escape, a new message, the panel closing
 * and the microphone opening all call `stop()`. It never starts by itself on
 * a page load: the dock reads aloud only replies that ARRIVE while it is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SpeechVoice {
  /** The voice's own address: what a person's choice stores. */
  uri: string;
  name: string;
  lang: string;
}

export interface Speech {
  /** The browser can read aloud at all. */
  supported: boolean;
  /** The voices for one language (`de_DE`), the browser's default first. */
  voicesFor: (locale: string) => SpeechVoice[];
  /** The id of what is being read now, or null. */
  speaking: string | null;
  speak: (id: string, text: string, opts: { locale: string; rate: number; voice: string | null }) => void;
  stop: () => void;
}

function synth(): SpeechSynthesis | null {
  return typeof globalThis.speechSynthesis === 'object' && typeof globalThis.SpeechSynthesisUtterance === 'function' ? globalThis.speechSynthesis : null;
}

const primary = (tag: string): string => tag.replace('_', '-').split('-')[0]?.toLowerCase() ?? '';

export function useSpeech(): Speech {
  const engine = synth();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => engine?.getVoices() ?? []);
  const [speaking, setSpeaking] = useState<string | null>(null);
  /** The utterance under way: an ended one that is no longer this one changes nothing. */
  const current = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (engine === null) return;
    // Voices arrive after the page in most browsers.
    const read = (): void => setVoices(engine.getVoices());
    read();
    engine.addEventListener?.('voiceschanged', read);
    return () => engine.removeEventListener?.('voiceschanged', read);
  }, [engine]);

  const stop = useCallback(() => {
    current.current = null;
    engine?.cancel();
    setSpeaking(null);
  }, [engine]);

  const voicesFor = useCallback(
    (locale: string): SpeechVoice[] => {
      const wanted = primary(locale);
      return voices
        .filter((voice) => primary(voice.lang) === wanted)
        .sort((a, b) => Number(b.default) - Number(a.default) || Number(b.lang.replace('_', '-') === locale.replace('_', '-')) - Number(a.lang.replace('_', '-') === locale.replace('_', '-')))
        .map((voice) => ({ uri: voice.voiceURI, name: voice.name, lang: voice.lang }));
    },
    [voices],
  );

  const speak = useCallback(
    (id: string, text: string, opts: { locale: string; rate: number; voice: string | null }) => {
      if (engine === null || text.trim() === '') return;
      const wanted = primary(opts.locale);
      const candidates = voices.filter((voice) => primary(voice.lang) === wanted);
      const voice = candidates.find((one) => one.voiceURI === opts.voice) ?? candidates.find((one) => one.default) ?? candidates[0];
      if (voice === undefined) return;
      engine.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = Math.min(2, Math.max(0.5, opts.rate));
      const done = (): void => {
        if (current.current !== utterance) return;
        current.current = null;
        setSpeaking(null);
      };
      utterance.onend = done;
      utterance.onerror = done;
      current.current = utterance;
      setSpeaking(id);
      engine.speak(utterance);
    },
    [engine, voices],
  );

  // Whoever was listening has gone: nothing goes on talking to an empty panel.
  useEffect(() => () => engine?.cancel(), [engine]);

  return { supported: engine !== null, voicesFor, speaking, speak, stop };
}

/**
 * Which reply, if any, has just ARRIVED and is to be read.
 *
 * `heard` holds the turns already settled; null before the conversation has
 * loaded. The first look only remembers what is there (nothing is read on a
 * page load); after it, the newest turn that settled since is the one to read,
 * when it ended well and said something.
 */
export function arrivedReply<Turn extends { id: string; status: string; say: string | null }>(heard: ReadonlySet<string> | null, turns: readonly Turn[]): { heard: Set<string>; read: Turn | null } {
  const settled = turns.filter((turn) => turn.status === 'done' || turn.status === 'failed');
  if (heard === null) return { heard: new Set(settled.map((turn) => turn.id)), read: null };
  const fresh = settled.filter((turn) => !heard.has(turn.id));
  const newest = fresh.at(-1);
  return {
    heard: new Set([...heard, ...fresh.map((turn) => turn.id)]),
    read: newest !== undefined && newest.status === 'done' && (newest.say ?? '') !== '' ? newest : null,
  };
}
