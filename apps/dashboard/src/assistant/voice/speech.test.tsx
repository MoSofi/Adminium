// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant speaking: the hook over the browser's voices, which reply is
 * read when, and the two places a person meets it (the speaker on a reply,
 * their own choices under the panel's header).
 */
import { act, render, renderHook, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { PanelView, type PanelViewProps, type VoiceMenuView } from '../dock/PanelView.js';
import { arrivedReply, useSpeech } from './useSpeech.js';

const noop = (): void => undefined;

interface Said {
  text: string;
  voice: string;
  lang: string;
  rate: number;
  end: () => void;
}

/** The browser's speech, as far as the hook uses it. */
function fakeVoices(list: { voiceURI: string; name: string; lang: string; default?: boolean }[]) {
  const said: Said[] = [];
  const cancel = vi.fn();
  class Utterance {
    voice: { voiceURI: string; lang: string } | null = null;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => list.map((voice) => ({ default: false, ...voice })),
    addEventListener: noop,
    removeEventListener: noop,
    cancel,
    speak: (utterance: Utterance) => said.push({ text: utterance.text, voice: utterance.voice?.voiceURI ?? '', lang: utterance.lang, rate: utterance.rate, end: () => utterance.onend?.() }),
  });
  return { said, cancel };
}

beforeAll(async () => {
  await installTestI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the browser\'s voices', () => {
  it('cannot speak where the browser has no speech, and offers only the voices of the language asked for', () => {
    const none = renderHook(() => useSpeech());
    expect(none.result.current.supported).toBe(false);
    expect(none.result.current.voicesFor('de_DE')).toEqual([]);
    none.unmount();

    fakeVoices([
      { voiceURI: 'en-1', name: 'Samantha', lang: 'en-US' },
      { voiceURI: 'de-1', name: 'Anna', lang: 'de-DE' },
      { voiceURI: 'de-2', name: 'Markus', lang: 'de-DE', default: true },
      { voiceURI: 'de-at', name: 'Lena', lang: 'de_AT' },
    ]);
    const { result } = renderHook(() => useSpeech());
    expect(result.current.supported).toBe(true);
    // The browser's own choice first.
    expect(result.current.voicesFor('de_DE').map((voice) => voice.name)).toEqual(['Markus', 'Anna', 'Lena']);
    expect(result.current.voicesFor('fr_FR')).toEqual([]);
  });

  it('reads one thing at a time in the chosen voice and speed, and says when it has finished', () => {
    const { said, cancel } = fakeVoices([
      { voiceURI: 'de-1', name: 'Anna', lang: 'de-DE' },
      { voiceURI: 'de-2', name: 'Markus', lang: 'de-DE', default: true },
    ]);
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.speak('t1', '212 Bestellungen seit Montag.', { locale: 'de_DE', rate: 1.25, voice: 'de-1' }));
    expect(said[0]).toMatchObject({ text: '212 Bestellungen seit Montag.', voice: 'de-1', lang: 'de-DE', rate: 1.25 });
    expect(result.current.speaking).toBe('t1');
    // Another reply takes its place: the first is cut off, and its end changes nothing afterwards.
    act(() => result.current.speak('t2', 'Zweite Antwort.', { locale: 'de_DE', rate: 9, voice: 'gone' }));
    expect(cancel).toHaveBeenCalled();
    expect(said[1]).toMatchObject({ voice: 'de-2', rate: 2 });
    act(() => said[0]!.end());
    expect(result.current.speaking).toBe('t2');
    act(() => said[1]!.end());
    expect(result.current.speaking).toBeNull();
    // Stopped by hand.
    act(() => result.current.speak('t3', 'Dritte.', { locale: 'de_DE', rate: 1, voice: null }));
    act(() => result.current.stop());
    expect(result.current.speaking).toBeNull();
  });

  it('says nothing where there is no voice for the language, and nothing of an empty reply', () => {
    const { said } = fakeVoices([{ voiceURI: 'en-1', name: 'Samantha', lang: 'en-US' }]);
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.speak('t1', 'Bonjour', { locale: 'fr_FR', rate: 1, voice: null }));
    act(() => result.current.speak('t2', '   ', { locale: 'en_US', rate: 1, voice: null }));
    expect(said).toEqual([]);
    expect(result.current.speaking).toBeNull();
  });
});

describe('which reply is read as it arrives', () => {
  const turn = (id: string, status: string, say: string | null = 'An answer.') => ({ id, status, say });

  it('reads nothing of what was already there when the conversation loaded', () => {
    const first = arrivedReply(null, [turn('a', 'done'), turn('b', 'done')]);
    expect(first.read).toBeNull();
    expect([...first.heard]).toEqual(['a', 'b']);
  });

  it('reads the reply that settles afterwards, once, and not one that failed or said nothing', () => {
    let state = arrivedReply(null, [turn('a', 'done')]);
    // A question is being answered: nothing yet.
    state = arrivedReply(state.heard, [turn('a', 'done'), turn('b', 'running', null)]);
    expect(state.read).toBeNull();
    state = arrivedReply(state.heard, [turn('a', 'done'), turn('b', 'done')]);
    expect(state.read?.id).toBe('b');
    // Seen again (a redraw): not read twice.
    expect(arrivedReply(state.heard, [turn('a', 'done'), turn('b', 'done')]).read).toBeNull();
    expect(arrivedReply(state.heard, [turn('a', 'done'), turn('b', 'done'), turn('c', 'failed')]).read).toBeNull();
    expect(arrivedReply(state.heard, [turn('a', 'done'), turn('b', 'done'), turn('d', 'done', '')]).read).toBeNull();
    // A turn that was running when the page loaded and ends now did arrive.
    const loaded = arrivedReply(null, [turn('a', 'done'), turn('e', 'running', null)]);
    expect(arrivedReply(loaded.heard, [turn('a', 'done'), turn('e', 'done')]).read?.id).toBe('e');
  });
});

describe('a person\'s own choices, under the panel\'s header', () => {
  function panel(voice: VoiceMenuView | undefined) {
    const props: PanelViewProps = { layout: 'docked', name: 'Milo', lookingAt: 'Orders', canStartNew: true, onNew: noop, onClose: noop, busyElsewhere: false, chip: null, onDismissChip: noop, followups: [], input: '', onInput: noop, onSubmit: noop, placeholder: 'Ask…', blocked: false, working: false, onStop: noop, nextTurnTokens: 1, dimmed: false, voice, children: <p>thread</p> };
    return render(<PanelView {...props} />);
  }

  it('has no speaker where replies cannot be read aloud', () => {
    panel(undefined);
    expect(screen.queryByTestId('assistant-voice')).toBeNull();
  });

  it('opens from the header: reading replies aloud, the speed, and a voice only where there are several', async () => {
    const onReadAloud = vi.fn();
    const onRate = vi.fn();
    const onVoice = vi.fn();
    const user = userEvent.setup();
    const { unmount } = panel({ readAloud: false, onReadAloud, rate: 1, onRate, voices: [{ uri: 'de-1', name: 'Anna' }, { uri: 'de-2', name: 'Markus' }], voice: null, onVoice });
    const button = screen.getByRole('button', { name: 'Reading aloud' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('assistant-voice-choices')).toBeNull();
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('switch', { name: 'Read replies aloud' }));
    expect(onReadAloud).toHaveBeenCalledWith(true);
    await user.selectOptions(screen.getByTestId('assistant-voice-rate'), '1.25');
    expect(onRate).toHaveBeenCalledWith(1.25);
    await user.selectOptions(screen.getByTestId('assistant-voice-pick'), 'de-2');
    expect(onVoice).toHaveBeenCalledWith('de-2');
    await user.selectOptions(screen.getByTestId('assistant-voice-pick'), '');
    expect(onVoice).toHaveBeenLastCalledWith(null);
    unmount();

    // One voice: nothing to choose between.
    panel({ readAloud: true, onReadAloud, rate: 1, onRate, voices: [{ uri: 'de-1', name: 'Anna' }], voice: null, onVoice });
    await user.click(screen.getByRole('button', { name: 'Reading aloud' }));
    expect(screen.getByRole('switch', { name: 'Read replies aloud' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByTestId('assistant-voice-pick')).toBeNull();
  });
});
