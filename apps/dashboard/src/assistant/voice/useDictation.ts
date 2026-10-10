// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SPEAKING TO THE ASSISTANT, in the browser.
 *
 * A press starts listening; a second press (or Escape, or two minutes) stops
 * it and the words are written into the input, where the person checks them
 * and sends them. Nothing is sent by voice alone.
 *
 * Two ways turn speech into text, and the server says which this workspace
 * has (`availability.voice.input`):
 *
 *  - `provider`: the browser records, and the recording is sent through the
 *    server to the workspace's own model service.
 *  - `browser`: the browser's own speech service writes it down, and the
 *    server never hears it. Also the way back when the provider turns out not
 *    to transcribe (a compatible server with no such route).
 *
 * The button is not drawn at all when neither can work in this browser.
 *
 * Leaving the panel while listening stops and DISCARDS: `cancel()`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { csrfHeaders } from '../../app/api.js';

export type VoiceWay = 'provider' | 'browser' | 'none';

export type MicState = 'idle' | 'asking' | 'listening' | 'working';

/** What stands under the field after the microphone was used. */
export type MicNote = 'check' | 'failed' | 'blocked' | 'used' | 'stopped';

/** The browser's own speech service, where there is one (Chrome, Edge, Safari). */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionOf(): (new () => Recognition) | null {
  const scope = globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function canRecord(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof globalThis.MediaRecorder === 'function';
}

/** The way this browser can actually take, of the one the workspace has: the provider's, the browser's, or none. */
export function usableWay(way: VoiceWay): VoiceWay {
  if (way === 'none') return 'none';
  if (way === 'provider' && canRecord()) return 'provider';
  return recognitionOf() === null ? 'none' : 'browser';
}

/** What the recorder can make here: WebM where the browser has it, MP4 on Safari. */
function recordingType(): string {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (globalThis.MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export interface DictationOptions {
  way: VoiceWay;
  /** The longest one recording may be, in seconds. */
  maxSeconds: number;
  /** The language spoken, as a locale (`de_DE`). */
  language: string;
  /** The words, written down: whole when done, and as they come while the browser's own service listens. */
  onText: (text: string, final: boolean) => void;
}

export interface Dictation {
  /** The way taken in this browser; `none` draws no button. */
  way: VoiceWay;
  state: MicState;
  /** Seconds listened so far. */
  seconds: number;
  note: MicNote | null;
  /** Start, or stop and write down, as the one button does. */
  toggle: () => void;
  /** Stop and throw away what was heard. */
  cancel: () => void;
  clearNote: () => void;
}

export function useDictation(options: DictationOptions): Dictation {
  const [way, setWay] = useState<VoiceWay>(() => usableWay(options.way));
  useEffect(() => setWay(usableWay(options.way)), [options.way]);
  const [state, setState] = useState<MicState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [note, setNote] = useState<MicNote | null>(null);

  const latest = useRef(options);
  latest.current = options;
  /** What is under way: torn down by `end`. */
  const live = useRef<{ stop: (discard: boolean) => void } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const end = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    live.current = null;
  }, []);

  const tick = useCallback(
    (onLimit: () => void) => {
      const began = Date.now();
      setSeconds(0);
      timer.current = setInterval(() => {
        const passed = Math.floor((Date.now() - began) / 1000);
        setSeconds(passed);
        if (passed >= latest.current.maxSeconds) onLimit();
      }, 250);
      return () => Math.max(1, Math.ceil((Date.now() - began) / 1000));
    },
    [],
  );

  const listenInBrowser = useCallback(() => {
    const Recognition = recognitionOf();
    if (Recognition === null) {
      setNote('failed');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = latest.current.language.replace('_', '-');
    recognition.continuous = true;
    recognition.interimResults = true;
    let heard = '';
    let discard = false;
    let limit = false;
    let refused: MicNote | null = null;
    recognition.onresult = (event) => {
      let text = '';
      for (let index = 0; index < event.results.length; index += 1) text += event.results[index]?.[0]?.transcript ?? '';
      heard = text.trim();
      if (!discard) latest.current.onText(heard, false);
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') refused = 'blocked';
      else if (event.error !== 'aborted' && event.error !== 'no-speech') refused = 'failed';
    };
    recognition.onend = () => {
      end();
      setState('idle');
      if (discard) return;
      if (refused !== null) setNote(refused);
      else if (heard !== '') {
        latest.current.onText(heard, true);
        setNote(limit ? 'stopped' : 'check');
      }
    };
    live.current = {
      stop: (thrown) => {
        discard = thrown;
        if (thrown) recognition.abort();
        else recognition.stop();
      },
    };
    setState('listening');
    tick(() => {
      limit = true;
      recognition.stop();
    });
    try {
      recognition.start();
    } catch {
      end();
      setState('idle');
      setNote('failed');
    }
  }, [end, tick]);

  const record = useCallback(async () => {
    setState('asking');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setState('idle');
      const name = error instanceof Error ? error.name : '';
      setNote(name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : 'failed');
      return;
    }
    const type = recordingType();
    const recorder = new MediaRecorder(stream, type === '' ? undefined : { mimeType: type });
    const chunks: Blob[] = [];
    let discard = false;
    let limit = false;
    let lasted = (): number => 1;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      const seconds = lasted();
      end();
      if (discard || chunks.length === 0) {
        setState('idle');
        return;
      }
      setState('working');
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
      const query = new URLSearchParams({ language: latest.current.language, seconds: String(seconds) });
      void fetch(`/api/v1/assistant/transcribe?${query.toString()}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': blob.type, accept: 'application/json', ...csrfHeaders() },
        body: blob,
      })
        .then(async (answer) => {
          const body = (await answer.json().catch(() => null)) as { text?: unknown; error?: { code?: string; details?: { reason?: string } } } | null;
          setState('idle');
          if (answer.ok && typeof body?.text === 'string') {
            if (body.text !== '') latest.current.onText(body.text, true);
            setNote(body.text === '' ? 'failed' : limit ? 'stopped' : 'check');
            return;
          }
          if (body?.error?.code === 'VOICE_ALLOWANCE') setNote('used');
          else if (body?.error?.details?.reason === 'voice-not-here' && recognitionOf() !== null) {
            // The workspace's service does not transcribe after all: the browser's own from now on.
            setWay('browser');
            setNote('failed');
          } else setNote('failed');
        })
        .catch(() => {
          setState('idle');
          setNote('failed');
        });
    };
    live.current = {
      stop: (thrown) => {
        discard = thrown;
        if (recorder.state !== 'inactive') recorder.stop();
      },
    };
    setState('listening');
    lasted = tick(() => {
      limit = true;
      if (recorder.state !== 'inactive') recorder.stop();
    });
    recorder.start();
  }, [end, tick]);

  const toggle = useCallback(() => {
    if (state === 'working' || state === 'asking') return;
    if (state === 'listening') {
      live.current?.stop(false);
      return;
    }
    setNote(null);
    if (way === 'provider') void record();
    else if (way === 'browser') listenInBrowser();
  }, [state, way, record, listenInBrowser]);

  const cancel = useCallback(() => {
    live.current?.stop(true);
  }, []);

  // The panel going away while listening: stopped, and what was heard is thrown away.
  useEffect(() => () => live.current?.stop(true), []);

  return { way, state, seconds, note, toggle, cancel, clearNote: useCallback(() => setNote(null), []) };
}
