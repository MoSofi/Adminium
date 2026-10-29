// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MAKING A PICTURE WITH AI: the one contract every picture service speaks
 * through.
 *
 * Not a method of `ProviderClient`: a picture service is not always a chat
 * provider here (Google's Gemini makes pictures and is no chat connection),
 * and the chat contract stays the doc's.
 *
 * Everything that sets what a picture costs or how it is filtered is the
 * maker's own, never the caller's: the size comes from the shape, the
 * quality is fixed, the content filter is always the service's own default.
 * The caller gives the words, the model and how many.
 */

export const PICTURE_SHAPES = ['wide', 'tall', 'square'] as const;
export type PictureShape = (typeof PICTURE_SHAPES)[number];

/** The kinds of service that make pictures. */
export const PICTURE_MAKER_KINDS = ['openai', 'openai-compatible', 'google'] as const;
export type PictureMakerKind = (typeof PICTURE_MAKER_KINDS)[number];

/** The most pictures one call asks for. */
export const MAKE_COUNT_MAX = 4;
/** The most of a picture kept: an attachment's own cap. A larger one is refused, never shrunk. */
export const MADE_PICTURE_MAX_BYTES = 5 * 1024 * 1024;
/** The longest side a made picture may have: a larger one is refused (a picture that says it is huge fills a browser's memory). */
export const MADE_PICTURE_SIDE_MAX = 4096;
/** The most words sent. */
export const MAKE_WORDS_MAX = 600;
/** How long one call may take: a service can take two minutes for one picture. */
export const MAKE_TIMEOUT_MS = 180_000;

export interface MakeRequest {
  /** What to make, in the person's (or the Designer's) words; cleaned by the caller. */
  prompt: string;
  model: string;
  shape: PictureShape;
  /** 1 to {@link MAKE_COUNT_MAX}. */
  count: number;
  signal?: AbortSignal;
}

/** One picture, its bytes checked: one of the three types a browser draws, and its size read from its header. */
export interface MadePicture {
  bytes: Uint8Array;
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

export interface MakeResult {
  pictures: MadePicture[];
  /** Asked for and not delivered: refused one by one, failed, or dropped by the checks. */
  dropped: number;
  /** Of `dropped`, how many the service's filter refused. */
  refused: number;
}

export interface PictureMaker {
  readonly kind: PictureMakerKind;
  /** The models of the service that make pictures, from its own list; [] when it lists none it can say. */
  listModels(signal?: AbortSignal): Promise<string[]>;
  /** Make pictures. Throws a {@link PictureError} when not one was delivered. */
  make(req: MakeRequest): Promise<MakeResult>;
}

/**
 * Why no picture was made. `maybeCharged` is false only where the answer
 * proves nothing was made: a turned-down key, no route or no
 * model, no credit, a rate limit, a 400 that is not a content refusal, or a
 * request refused before it was sent. Never carries what the service said: its text is
 * not shown, stored, logged or given to a model.
 *
 *  - `refused`: the service's content filter;
 *  - `billing`: no credit, or a plan that does not include pictures;
 *  - `not_found`: no picture route at this address;
 *  - `model_gone`: the route is there, the model is not (retired, or never offered to this key);
 *  - `auth`: the key was turned down;
 *  - `bad_response`: an answer that could not be read, was too large, or held no picture that passed the checks.
 */
export type PictureErrorCode = 'refused' | 'billing' | 'auth' | 'not_found' | 'model_gone' | 'rate_limit' | 'timeout' | 'network' | 'server' | 'http' | 'bad_response' | 'aborted' | 'config';

export class PictureError extends Error {
  override readonly name = 'PictureError';
  readonly code: PictureErrorCode;
  readonly status?: number;
  /** Whether the service may have made (and charged for) something: false only when the answer proves nothing was made. */
  readonly maybeCharged: boolean;

  constructor(code: PictureErrorCode, message: string, opts: { status?: number } = {}) {
    super(message);
    this.code = code;
    if (opts.status !== undefined) this.status = opts.status;
    this.maybeCharged = !(code === 'auth' || code === 'not_found' || code === 'model_gone' || code === 'config' || code === 'billing' || code === 'rate_limit' || (code === 'http' && opts.status === 400));
  }
}

/** A model the package knows, with what one picture cost at `medium` quality when it was read; null when unknown. */
export interface KnownPictureModel {
  id: string;
  label: string;
  /** US dollars a picture at the size and quality this package asks for; null when no price was read. */
  usd: number | null;
}

/**
 * OpenAI's picture models, as its documents named them (read 2026-10-29).
 * The 1.5 and 1-mini models retire on 2026-12-01 and are left out. A price
 * is given only where one was read for `medium` at 1024×1024.
 */
export const OPENAI_PICTURE_MODELS: readonly KnownPictureModel[] = [
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', usd: null },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', usd: null },
  { id: 'gpt-image-2', label: 'GPT Image 2', usd: 0.053 },
];

/** Google's Gemini picture models (read 2026-10-29). */
export const GEMINI_PICTURE_MODELS: readonly KnownPictureModel[] = [
  { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1', usd: null },
  { id: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite Image', usd: null },
  { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', usd: null },
  { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image', usd: null },
];

/** The price this package knows for a model, or null. */
export function knownPicturePrice(kind: PictureMakerKind, model: string): number | null {
  const list = kind === 'openai' ? OPENAI_PICTURE_MODELS : kind === 'google' ? GEMINI_PICTURE_MODELS : [];
  return list.find((known) => known.id === model)?.usd ?? null;
}

/** A model id as a person or a list may give it. */
export const PICTURE_MODEL_ID = /^[\w.:/-]{1,120}$/;
