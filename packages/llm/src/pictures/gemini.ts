// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Google's Gemini picture models.
 *
 * `POST {base}/models/{model}:generateContent` with the key in
 * `x-goog-api-key`, asking for a picture only (`responseModalities:
 * ["IMAGE"]`) at 1K, in the shape's aspect ratio. One picture a call, so
 * `count` pictures are `count` calls, at most two at once; each call stands
 * alone, and the ones that fail are counted, not fatal, while one picture
 * comes back.
 *
 * Every picture Gemini makes carries Google's invisible SynthID watermark.
 * A call with no picture in its answer is a refusal: a block reason, a
 * safety finish, or text in place of a picture.
 */
import { checkPicture, decodeBase64 } from './bytes.js';
import { pictureCall } from './http.js';
import { checkMakeRequest } from './openai.js';
import { GEMINI_PICTURE_MODELS, MADE_PICTURE_MAX_BYTES, MAKE_TIMEOUT_MS, PICTURE_MODEL_ID, PictureError, type MadePicture, type MakeRequest, type PictureMaker, type PictureShape } from './types.js';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const ASPECT: Readonly<Record<PictureShape, string>> = { wide: '3:2', tall: '2:3', square: '1:1' };
const KNOWN: readonly string[] = GEMINI_PICTURE_MODELS.map((model) => model.id);
/** At most this many calls at once. */
const AT_ONCE = 2;

/** The picture in one `generateContent` answer, or null with whether the service refused it. */
export function readGeminiAnswer(answer: unknown): { picture: MadePicture | null; refused: boolean } {
  const root = (answer ?? {}) as { candidates?: unknown; promptFeedback?: { blockReason?: unknown } };
  if (typeof root.promptFeedback?.blockReason === 'string') return { picture: null, refused: true };
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  for (const candidate of candidates.slice(0, 2)) {
    const content = ((candidate ?? {}) as { content?: { parts?: unknown } }).content;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts.slice(0, 8)) {
      const entry = (part ?? {}) as { inlineData?: { data?: unknown }; inline_data?: { data?: unknown } };
      const data = entry.inlineData?.data ?? entry.inline_data?.data;
      if (data === undefined) continue;
      const picture = checkPicture(decodeBase64(data));
      if (picture !== null) return { picture, refused: false };
    }
  }
  // An answer with no picture in it: the model said no (a safety finish, or words instead of a picture).
  const finish = ((candidates[0] ?? {}) as { finishReason?: unknown }).finishReason;
  return { picture: null, refused: candidates.length === 0 || finish !== 'MAX_TOKENS' };
}

export function geminiPictures(opts: { apiKey: string; baseUrl?: string | undefined }): PictureMaker {
  if (opts.apiKey.trim() === '') throw new PictureError('config', 'Gemini needs a key');
  const base = (opts.baseUrl ?? GEMINI_BASE_URL).replace(/\/+$/, '');
  const headers = { 'x-goog-api-key': opts.apiKey, accept: 'application/json' };

  const one = async (req: MakeRequest): Promise<{ picture: MadePicture | null; refused: boolean }> => {
    const answer = await pictureCall<unknown>({
      url: `${base}/models/${encodeURIComponent(req.model)}:generateContent`,
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: {
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ASPECT[req.shape], imageSize: '1K' } },
      },
      timeoutMs: MAKE_TIMEOUT_MS,
      maxBytes: Math.ceil(MADE_PICTURE_MAX_BYTES * 1.37) + 64 * 1024,
      ...(req.signal === undefined ? {} : { signal: req.signal }),
    });
    return readGeminiAnswer(answer);
  };

  return {
    kind: 'google',
    async listModels(signal) {
      const answer = await pictureCall<{ models?: unknown }>({ url: `${base}/models?pageSize=200`, method: 'GET', headers, timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024, ...(signal === undefined ? {} : { signal }) });
      const listed = (Array.isArray(answer.models) ? answer.models : []).flatMap((entry: unknown) => {
        const model = (entry ?? {}) as { name?: unknown; supportedGenerationMethods?: unknown };
        const id = typeof model.name === 'string' ? model.name.replace(/^models\//, '') : '';
        const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
        // By name: the known ones (Nano Banana's name says nothing of pictures) and any other whose name says image.
        const makes = KNOWN.includes(id) || /image|banana/i.test(id);
        return id !== '' && PICTURE_MODEL_ID.test(id) && makes && methods.includes('generateContent') ? [id] : [];
      });
      // The known ones first, in their order; then the account's others that make pictures.
      const known = KNOWN.filter((id) => listed.includes(id));
      return [...known, ...listed.filter((id) => !known.includes(id))].slice(0, 30);
    },
    async make(req) {
      checkMakeRequest(req);
      const pictures: MadePicture[] = [];
      let refused = 0;
      let firstError: PictureError | null = null;
      /** A call that may have been charged: what the whole make answers with, so its count is never given back. */
      let chargedError: PictureError | null = null;
      let next = 0;
      const lane = async (): Promise<void> => {
        while (next < req.count) {
          next += 1;
          try {
            const got = await one(req);
            if (got.picture !== null) pictures.push(got.picture);
            else if (got.refused) refused += 1;
          } catch (error) {
            const known = error instanceof PictureError ? error : new PictureError('bad_response', 'the answer could not be read');
            firstError ??= known;
            if (known.maybeCharged) chargedError ??= known;
            // The key or the route is wrong, or the person went away: the other calls would only fail the same way.
            if (known.code === 'auth' || known.code === 'not_found' || known.code === 'model_gone' || known.code === 'billing' || known.code === 'rate_limit' || known.code === 'aborted') next = req.count;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(AT_ONCE, req.count) }, lane));
      if (pictures.length === 0) {
        if (refused > 0) throw new PictureError('refused', 'the service would not make this picture');
        throw chargedError ?? firstError ?? new PictureError('bad_response', 'the answer held no picture that could be kept');
      }
      return { pictures, dropped: req.count - pictures.length, refused };
    },
  };
}
