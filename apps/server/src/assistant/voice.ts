// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SPEAKING TO THE ASSISTANT.
 *
 * A person presses the microphone, speaks, and the words land in the input as
 * text: nothing is sent by voice. Two ways turn the recording into text:
 *
 *  - `provider`: the workspace's own model service transcribes it (OpenAI, or
 *    a compatible server). The recording goes there, through this server.
 *  - `browser`: the browser's own speech service does it, and this server
 *    never sees the recording.
 *
 * Which way is offered is decided here and told to the panel
 * (`GET /assistant/availability`): `none` while the workspace's switch is off.
 *
 * --- What a recording costs, and how it is held to its allowance -----------
 *
 * A workspace sets how many minutes a person may dictate in a day. A
 * recording's length is counted from what ARRIVED (its bytes, at the slowest
 * rate a browser records speech at), never from what the browser says alone:
 * a caller could say "one second" of a two-minute file. It is taken from the
 * day's allowance BEFORE the provider is called, so thirty recordings sent at
 * once cannot all pass a check that none of them has paid into yet; and one
 * person has one recording under way at a time.
 *
 * The recording itself is kept nowhere: not stored, not logged, not in the
 * audit, which says who dictated and for how many seconds.
 */
import { assistantUseDay, assistantUseRepo, assistantUseResetsAt, settingsRepo, userPrefsRepo, type MetaDb } from '@adminium/meta';

/** The longest one recording may be. */
export const VOICE_MAX_SECONDS = 120;
/** The most one recording may weigh: two minutes at the heaviest rate a browser records speech at, and room over it. */
export const VOICE_MAX_BYTES = 4 * 1024 * 1024;
/** The types a browser's recorder makes. */
export const VOICE_TYPES: readonly string[] = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'];
/** Bytes a second at the slowest rate speech is recorded at (about 16 kbit/s): the floor a length is counted from. */
const SLOWEST_BYTES_A_SECOND = 2_000;

export type VoiceWay = 'provider' | 'browser' | 'none';

/** The providers whose service turns a recording into text. */
const TRANSCRIBES: readonly string[] = ['openai', 'openai-compatible'];

/** How dictation works in this workspace, as the panel is told it. */
export function voiceWay(input: { on: boolean; provider: string | null; enabled: boolean }): VoiceWay {
  if (!input.on) return 'none';
  return input.enabled && input.provider !== null && TRANSCRIBES.includes(input.provider) ? 'provider' : 'browser';
}

/**
 * The seconds a recording is counted as: what the browser says it lasted, but
 * never less than its weight allows, and never more than one recording may be.
 */
export function recordingSeconds(bytes: number, claimed: number | undefined): number {
  const byWeight = Math.ceil(bytes / (SLOWEST_BYTES_A_SECOND * 8));
  const said = claimed === undefined || !Number.isFinite(claimed) ? 0 : Math.ceil(claimed);
  return Math.min(VOICE_MAX_SECONDS, Math.max(1, said, byWeight));
}

export interface VoiceAllowance {
  /** Seconds a person may dictate in a UTC day; 0 means no limit. */
  limitSeconds: number;
  usedSeconds: number;
  resetsAt: number;
}

export async function readVoiceAllowance(meta: MetaDb, userId: string, at: number): Promise<VoiceAllowance> {
  const minutes = await settingsRepo(meta).get('assistant.voice.dailyMinutes');
  const used = (await assistantUseRepo(meta).get(userId, assistantUseDay(at))).voiceSeconds;
  return { limitSeconds: minutes * 60, usedSeconds: used, resetsAt: assistantUseResetsAt(at) };
}

/** The people who have a recording under way in this process. */
const underWay = new Set<string>();

/**
 * Take a recording's seconds from the person's day, or say why not. `release`
 * ends their turn at the microphone; what was taken stays taken (the provider
 * was called, or was about to be).
 */
export async function reserveVoice(
  meta: MetaDb,
  userId: string,
  seconds: number,
  at: number,
): Promise<{ ok: true; release: () => void } | { ok: false; reason: 'busy' } | { ok: false; reason: 'allowance'; allowance: VoiceAllowance }> {
  if (underWay.has(userId)) return { ok: false, reason: 'busy' };
  underWay.add(userId);
  try {
    const allowance = await readVoiceAllowance(meta, userId, at);
    if (allowance.limitSeconds > 0 && allowance.usedSeconds + seconds > allowance.limitSeconds) {
      underWay.delete(userId);
      return { ok: false, reason: 'allowance', allowance };
    }
    await assistantUseRepo(meta).add(userId, assistantUseDay(at), { voiceSeconds: seconds });
  } catch (error) {
    underWay.delete(userId);
    throw error;
  }
  return { ok: true, release: () => underWay.delete(userId) };
}

// ─── the assistant speaking: one person's own choices ─────────────────────────

/**
 * Reading replies aloud is the browser's own voice: nothing leaves the
 * browser, and nothing of it is the server's except these three choices of
 * one person, kept beside their theme and language so they follow them from
 * one device to the next: whether replies are read as they arrive (off until
 * they switch it on), how fast, and in which of the browser's voices.
 */
export interface VoiceChoices {
  readAloud: boolean;
  /** 0.5 to 2; 1 is the voice's own pace. */
  rate: number;
  /** A voice of the browser's, by its own address; null for the browser's choice. */
  voice: string | null;
}

const UI_KEY = 'assistantVoice';
export const VOICE_DEFAULTS: VoiceChoices = { readAloud: false, rate: 1, voice: null };

/** What is stored, read as what it may be: anything else is the default. */
export function voiceChoicesOf(uiState: unknown): VoiceChoices {
  const held = (uiState as Record<string, unknown> | null)?.[UI_KEY] as Partial<VoiceChoices> | undefined;
  const rate = typeof held?.rate === 'number' && Number.isFinite(held.rate) ? Math.min(2, Math.max(0.5, held.rate)) : VOICE_DEFAULTS.rate;
  return {
    readAloud: held?.readAloud === true,
    rate,
    voice: typeof held?.voice === 'string' && held.voice !== '' ? held.voice.slice(0, 200) : null,
  };
}

export async function readVoiceChoices(meta: MetaDb, userId: string): Promise<VoiceChoices> {
  return voiceChoicesOf((await userPrefsRepo(meta).get(userId))?.uiState ?? null);
}

/** Change what is named, keep the rest, and keep everything else the person's screen state holds. */
export async function writeVoiceChoices(meta: MetaDb, userId: string, change: Partial<VoiceChoices>, at: number): Promise<VoiceChoices> {
  const repo = userPrefsRepo(meta);
  const state = (await repo.get(userId))?.uiState ?? {};
  const next = voiceChoicesOf({ [UI_KEY]: { ...voiceChoicesOf(state), ...change } });
  await repo.set(userId, { uiState: { ...state, [UI_KEY]: next } }, at);
  return next;
}
