// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Speaking to the assistant: the composer's microphone in each state the comp
 * draws, and the hook behind it against a recorder and a browser speech
 * service that the test stands in for.
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { PanelView, type MicView, type PanelViewProps } from '../dock/PanelView.js';
import { usableWay, useDictation } from './useDictation.js';

const noop = (): void => undefined;
const MIC: MicView = { state: 'idle', seconds: 0, language: 'Deutsch', note: null, maxMinutes: 2, notice: null, onNoticeRead: noop, onToggle: noop };

function panel(over: Partial<PanelViewProps>) {
  return render(
    <PanelView layout="docked" name="Milo" lookingAt="Orders" canStartNew onNew={noop} onClose={noop} busyElsewhere={false} chip={null} onDismissChip={noop} followups={[]} input="" onInput={noop} onSubmit={noop} placeholder="Ask about this data…" blocked={false} working={false} onStop={noop} nextTurnTokens={10} dimmed={false} {...over}>
      <p>thread</p>
    </PanelView>,
  );
}

beforeAll(async () => {
  await installTestI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the microphone in the composer', () => {
  it('is not drawn where speaking cannot work, and is a named button where it can', () => {
    const { unmount } = panel({});
    expect(screen.queryByTestId('assistant-mic')).toBeNull();
    unmount();
    panel({ mic: MIC });
    const mic = screen.getByRole('button', { name: 'Speak to Milo' });
    expect(mic.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('assistant-mic-note')).toBeNull();
  });

  it('says it is listening, in which language and for how long, and nothing can be sent meanwhile', async () => {
    const onSubmit = vi.fn();
    panel({ mic: { ...MIC, state: 'listening', seconds: 67 }, input: 'Which dishes sold best last', onSubmit });
    const mic = screen.getByRole('button', { name: 'Stop listening' });
    expect(mic.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('assistant-mic-listening').textContent).toBe('ListeningDeutsch·1:07');
    // Nothing is sent by voice alone: Send is off and Enter waits.
    expect((screen.getByTestId('assistant-send') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.setup().type(screen.getByTestId('assistant-input'), '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says in the field what it waits for: the browser\'s permission, then the words being written down', () => {
    const { unmount } = panel({ mic: { ...MIC, state: 'asking' } });
    expect(screen.getByPlaceholderText('Allow the microphone to speak to Milo')).toBeDefined();
    expect((screen.getByTestId('assistant-mic') as HTMLButtonElement).disabled).toBe(true);
    unmount();
    panel({ mic: { ...MIC, state: 'working' } });
    expect(screen.getByPlaceholderText('Writing down what you said…')).toBeDefined();
    expect((screen.getByTestId('assistant-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('says under the field how it ended', () => {
    const says: [MicView['note'], string][] = [
      ['check', 'Check the text, then send.'],
      ['stopped', 'Stopped at 2 minutes.'],
      ['blocked', 'The microphone is blocked for this site. Allow it in your browser’s address bar.'],
      ['used', 'Voice is used up for today.'],
      ['failed', 'That did not work. Try again.'],
    ];
    for (const [note, text] of says) {
      const { unmount } = panel({ mic: { ...MIC, note } });
      const line = screen.getByTestId('assistant-mic-note');
      expect(line.textContent, String(note)).toBe(text);
      expect(line.getAttribute('role')).toBe('status');
      unmount();
    }
  });

  it('says once where the voice goes, with a button to go on', async () => {
    const onNoticeRead = vi.fn();
    panel({ mic: { ...MIC, notice: 'What you say is sent to OpenAI to be written down. Nothing is kept.', onNoticeRead } });
    expect(screen.getByTestId('assistant-mic-notice').textContent).toContain('What you say is sent to OpenAI to be written down. Nothing is kept.');
    await userEvent.setup().click(screen.getByTestId('assistant-mic-notice-ok'));
    expect(onNoticeRead).toHaveBeenCalledTimes(1);
  });
});

// ── the hook, against stand-ins ───────────────────────────────────────────────

/** A recorder that "records" what the test hands it. */
function fakeRecorder(permission: 'granted' | 'NotAllowedError' = 'granted') {
  const stopped = vi.fn();
  const recorders: { stop: () => void; state: string }[] = [];
  class Recorder {
    static isTypeSupported = (type: string) => type === 'audio/webm';
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor() {
      recorders.push(this);
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob([new Uint8Array(4_000)], { type: 'audio/webm' }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: () => (permission === 'granted' ? Promise.resolve({ getTracks: () => [{ stop: stopped }] }) : Promise.reject(Object.assign(new Error('no'), { name: permission }))),
    },
  });
  return { stopped, recorders };
}

function answering(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(jsonResponse(status, body));
    }),
  );
  return calls;
}

describe('dictation', () => {
  it('takes the provider\'s way where the browser records, the browser\'s where it only listens, and none otherwise', () => {
    expect(usableWay('none')).toBe('none');
    // This test browser has neither a recorder nor a speech service.
    expect(usableWay('provider')).toBe('none');
    expect(usableWay('browser')).toBe('none');
    fakeRecorder();
    expect(usableWay('provider')).toBe('provider');
    expect(usableWay('browser')).toBe('none');
    vi.stubGlobal('webkitSpeechRecognition', class {});
    expect(usableWay('browser')).toBe('browser');
  });

  it('records, sends the recording with its language and length, and hands the words back to be checked', async () => {
    const { stopped } = fakeRecorder();
    const calls = answering(200, { text: 'Which dishes sold best last weekend?', seconds: 1 });
    const onText = vi.fn();
    const { result } = renderHook(() => useDictation({ way: 'provider', maxSeconds: 120, language: 'de_DE', onText }));
    expect(result.current.way).toBe('provider');
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.state).toBe('listening'));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(onText).toHaveBeenCalledWith('Which dishes sold best last weekend?', true);
    expect(result.current.note).toBe('check');
    // The microphone is let go as soon as the recording ends.
    expect(stopped).toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/v1/assistant/transcribe?language=de_DE&seconds=1');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe('audio/webm');
    expect((calls[0]!.init.body as Blob).size).toBe(4_000);
  });

  it('says why when it cannot: blocked by the browser, the day used up, a failure', async () => {
    fakeRecorder('NotAllowedError');
    const onText = vi.fn();
    const blocked = renderHook(() => useDictation({ way: 'provider', maxSeconds: 120, language: 'en_US', onText }));
    act(() => blocked.result.current.toggle());
    await waitFor(() => expect(blocked.result.current.note).toBe('blocked'));
    expect(blocked.result.current.state).toBe('idle');
    blocked.unmount();

    fakeRecorder();
    answering(429, { error: { code: 'VOICE_ALLOWANCE', message: 'used' } });
    const used = renderHook(() => useDictation({ way: 'provider', maxSeconds: 120, language: 'en_US', onText }));
    act(() => used.result.current.toggle());
    await waitFor(() => expect(used.result.current.state).toBe('listening'));
    act(() => used.result.current.toggle());
    await waitFor(() => expect(used.result.current.note).toBe('used'));
    used.unmount();

    answering(502, { error: { code: 'VOICE_FAILED', message: 'no' } });
    const failed = renderHook(() => useDictation({ way: 'provider', maxSeconds: 120, language: 'en_US', onText }));
    act(() => failed.result.current.toggle());
    await waitFor(() => expect(failed.result.current.state).toBe('listening'));
    act(() => failed.result.current.toggle());
    await waitFor(() => expect(failed.result.current.note).toBe('failed'));
    expect(onText).not.toHaveBeenCalled();
  });

  it('throws away what was heard when the panel goes, and sends nothing', async () => {
    const { stopped } = fakeRecorder();
    const calls = answering(200, { text: 'never' });
    const onText = vi.fn();
    const { result, unmount } = renderHook(() => useDictation({ way: 'provider', maxSeconds: 120, language: 'en_US', onText }));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.state).toBe('listening'));
    unmount();
    expect(stopped).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(onText).not.toHaveBeenCalled();
  });

  it('goes over to the browser\'s own service when the workspace\'s turns out not to transcribe', async () => {
    fakeRecorder();
    vi.stubGlobal('webkitSpeechRecognition', class {});
    answering(409, { error: { code: 'CONFLICT', message: 'no', details: { reason: 'voice-not-here' } } });
    const { result } = renderHook(() => useDictation({ way: 'provider', maxSeconds: 120, language: 'en_US', onText: noop }));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.state).toBe('listening'));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.way).toBe('browser'));
    expect(result.current.note).toBe('failed');
  });

  it('with the browser\'s own service: the words come as they are heard, then whole', async () => {
    let made: { lang: string; onresult: ((event: unknown) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null } | null = null;
    class Recognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        made = { lang: this.lang, onresult: (event) => this.onresult?.(event), onend: () => this.onend?.(), onerror: (event) => this.onerror?.(event) };
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    vi.stubGlobal('SpeechRecognition', Recognition);
    const onText = vi.fn();
    const { result } = renderHook(() => useDictation({ way: 'browser', maxSeconds: 120, language: 'fr_FR', onText }));
    expect(result.current.way).toBe('browser');
    act(() => result.current.toggle());
    expect(result.current.state).toBe('listening');
    expect(made!.lang).toBe('fr-FR');
    act(() => made!.onresult?.({ results: [Object.assign([{ transcript: 'Combien de commandes' }], { isFinal: false })] }));
    expect(onText).toHaveBeenLastCalledWith('Combien de commandes', false);
    act(() => made!.onresult?.({ results: [Object.assign([{ transcript: 'Combien de commandes ' }], { isFinal: true }), Object.assign([{ transcript: 'aujourd’hui ?' }], { isFinal: true })] }));
    act(() => result.current.toggle());
    expect(result.current.state).toBe('idle');
    expect(onText).toHaveBeenLastCalledWith('Combien de commandes aujourd’hui ?', true);
    expect(result.current.note).toBe('check');

    // Refused by the browser: said, and nothing written.
    onText.mockClear();
    act(() => result.current.toggle());
    act(() => {
      made!.onerror?.({ error: 'not-allowed' });
      made!.onend?.();
    });
    expect(result.current.note).toBe('blocked');
    expect(onText).not.toHaveBeenCalled();
  });
});
