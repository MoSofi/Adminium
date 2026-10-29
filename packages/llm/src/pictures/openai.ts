// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OpenAI's picture route, and the servers that copy it.
 *
 * `POST {base}/images/generations`. OpenAI's own service is asked with
 * every field fixed here: the size from the shape, `quality: medium`, JPEG
 * at 85, its own content filter (`moderation: auto`). A compatible server
 * (and Ollama's experimental route, at `{ollama}/v1`) often knows only
 * `model, prompt, n, size, response_format`, so it is asked with those.
 *
 * Only base64 is taken. An answer that names a `url` instead is not a
 * picture here and is never fetched: this door was checked for the
 * service's own address and no other.
 */
import { stripTrailingSlash } from '../providers/types.js';
import { checkPicture, decodeBase64 } from './bytes.js';
import { pictureCall } from './http.js';
import { MADE_PICTURE_MAX_BYTES, MAKE_COUNT_MAX, MAKE_TIMEOUT_MS, OPENAI_PICTURE_MODELS, PICTURE_MODEL_ID, PictureError, type MakeRequest, type MakeResult, type PictureMaker, type PictureShape } from './types.js';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

const SIZE: Readonly<Record<PictureShape, string>> = { wide: '1536x1024', tall: '1024x1536', square: '1024x1024' };

/** The bound on an answer of `count` pictures: each at most the cap, as base64, and room for the rest. */
export const answerBound = (count: number): number => Math.ceil(count * MADE_PICTURE_MAX_BYTES * 1.37) + 64 * 1024;

/** A model list's ids that make pictures, by their names: what a compatible server or Ollama calls an image model. */
const PICTURE_NAME = /image|flux|diffusion|sdxl|\bsd[-_]?\d|imagen|dall-e|kandinsky|playground|hidream|qwen-image/i;

/** Checked before anything is sent: a count or a model a caller made up never reaches the service. */
export function checkMakeRequest(req: MakeRequest): void {
  if (!Number.isInteger(req.count) || req.count < 1 || req.count > MAKE_COUNT_MAX) throw new PictureError('config', `count must be 1 to ${String(MAKE_COUNT_MAX)}`);
  if (!PICTURE_MODEL_ID.test(req.model)) throw new PictureError('config', 'the model id is not one');
  if (req.prompt.trim() === '') throw new PictureError('config', 'there are no words to make a picture from');
}

/** The pictures of an `images/generations` answer: base64 only, each checked. */
export function readImagesAnswer(answer: unknown, asked: number): MakeResult {
  const data = ((answer ?? {}) as { data?: unknown }).data;
  const items = Array.isArray(data) ? data.slice(0, asked) : [];
  const pictures = items.flatMap((item: unknown) => {
    const picture = checkPicture(decodeBase64(((item ?? {}) as { b64_json?: unknown }).b64_json));
    return picture === null ? [] : [picture];
  });
  if (pictures.length === 0) throw new PictureError('bad_response', 'the answer held no picture that could be kept');
  return { pictures, dropped: asked - pictures.length, refused: 0 };
}

function maker(kind: 'openai' | 'openai-compatible', opts: { baseUrl: string; apiKey?: string | undefined }): PictureMaker {
  const base = stripTrailingSlash(opts.baseUrl);
  const auth: Record<string, string> = opts.apiKey === undefined || opts.apiKey === '' ? {} : { authorization: `Bearer ${opts.apiKey}` };
  return {
    kind,
    async listModels(signal) {
      const answer = await pictureCall<{ data?: unknown }>({ url: `${base}/models`, method: 'GET', headers: { accept: 'application/json', ...auth }, timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024, ...(signal === undefined ? {} : { signal }) });
      const ids = (Array.isArray(answer.data) ? answer.data : []).flatMap((entry: unknown) => {
        const id = ((entry ?? {}) as { id?: unknown }).id;
        return typeof id === 'string' && PICTURE_MODEL_ID.test(id) ? [id] : [];
      });
      if (kind === 'openai') {
        // OpenAI's own: the ones its documents name, in their order, that this account has.
        // An account whose list names none of them (a list kept short by a project's limits) is offered them all: the service says no to one it does not give.
        const known = OPENAI_PICTURE_MODELS.map((model) => model.id);
        const listed = known.filter((id) => ids.includes(id));
        return listed.length > 0 ? listed : known;
      }
      return ids.filter((id) => PICTURE_NAME.test(id)).slice(0, 50);
    },
    async make(req) {
      checkMakeRequest(req);
      const body =
        kind === 'openai'
          ? { model: req.model, prompt: req.prompt, n: req.count, size: SIZE[req.shape], quality: 'medium', output_format: 'jpeg', output_compression: 85, moderation: 'auto' }
          : { model: req.model, prompt: req.prompt, n: req.count, size: SIZE[req.shape], response_format: 'b64_json' };
      const answer = await pictureCall<unknown>({
        url: `${base}/images/generations`,
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...auth },
        body,
        timeoutMs: MAKE_TIMEOUT_MS,
        maxBytes: answerBound(req.count),
        ...(req.signal === undefined ? {} : { signal: req.signal }),
      });
      return readImagesAnswer(answer, req.count);
    },
  };
}

/** OpenAI's own service, with the person's key. */
export function openAiPictures(opts: { apiKey: string; baseUrl?: string | undefined }): PictureMaker {
  if (opts.apiKey.trim() === '') throw new PictureError('config', 'OpenAI needs a key');
  return maker('openai', { baseUrl: opts.baseUrl ?? OPENAI_BASE_URL, apiKey: opts.apiKey });
}

/** A server that copies OpenAI's route (and Ollama's, at `{ollama}/v1`). */
export function compatiblePictures(opts: { baseUrl: string; apiKey?: string | undefined }): PictureMaker {
  if (opts.baseUrl.trim() === '') throw new PictureError('config', 'a compatible server needs its address');
  return maker('openai-compatible', opts);
}
