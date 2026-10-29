// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Making pictures: what leaves for each service (every field that
 * sets the cost or the filter is the maker's own), what comes back (base64
 * only, every picture checked), and what an error may hold (a code, never the
 * service's words or the key).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { base64Size, checkPicture, decodeBase64, pictureInfo } from './bytes.js';
import { fakePictures, fakePng } from './fake.js';
import { geminiPictures, readGeminiAnswer } from './gemini.js';
import { refusalOf } from './http.js';
import { answerBound, compatiblePictures, openAiPictures } from './openai.js';
import { MADE_PICTURE_MAX_BYTES, MADE_PICTURE_SIDE_MAX, PictureError } from './types.js';

const KEY = 'sk-test-0123456789abcdef';
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const PNG = fakePng(48, 32, [200, 100, 50]);

interface Seen {
  url: string;
  init: RequestInit;
}

function serve(...answers: { status: number; body: unknown }[]): Seen[] {
  const seen: Seen[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init: RequestInit) => {
      seen.push({ url, init });
      const next = answers[Math.min(i, answers.length - 1)] as { status: number; body: unknown };
      i += 1;
      return Promise.resolve(new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } }));
    }),
  );
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A PNG whose header says it is `width` × `height`: the rest of it is never read. */
function pngSaying(width: number, height: number): Uint8Array {
  const bytes = PNG.slice();
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('a picture’s bytes', () => {
  it('reads a PNG, a JPEG and a WebP by their headers', () => {
    expect(pictureInfo(PNG)).toEqual({ type: 'image/png', width: 48, height: 32 });
    // SOI, an APP0 of 16 bytes, then SOF0 with height 300 and width 500.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0xf4, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(pictureInfo(jpeg)).toEqual({ type: 'image/jpeg', width: 500, height: 300 });
    // RIFF....WEBPVP8X with a 24-bit width-1 of 799 and height-1 of 599.
    const webp = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8X'].map((c) => c.charCodeAt(0)), [10, 0, 0, 0, 0, 0, 0, 0], [0x1f, 0x03, 0x00, 0x57, 0x02, 0x00]));
    expect(pictureInfo(webp)).toEqual({ type: 'image/webp', width: 800, height: 600 });
  });

  it('refuses a GIF, an SVG, a side over the limit, and a picture over 5 MB', () => {
    expect(checkPicture(new TextEncoder().encode('GIF89a\x01\x00\x01\x00'))).toBeNull();
    expect(checkPicture(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(checkPicture(pngSaying(MADE_PICTURE_SIDE_MAX + 1, 10))).toBeNull();
    expect(checkPicture(pngSaying(60_000, 60_000))).toBeNull();
    expect(checkPicture(pngSaying(MADE_PICTURE_SIDE_MAX, MADE_PICTURE_SIDE_MAX))).not.toBeNull();
    const huge = new Uint8Array(MADE_PICTURE_MAX_BYTES + 1);
    huge.set(PNG);
    expect(checkPicture(huge)).toBeNull();
  });

  it('checks base64 before decoding it, and works its size out from its length', () => {
    expect(decodeBase64(b64(PNG))).toEqual(PNG);
    expect(decodeBase64('not base64!')).toBeNull();
    expect(decodeBase64('abc')).toBeNull();
    expect(decodeBase64(42)).toBeNull();
    expect(base64Size('QUJD')).toBe(3);
    expect(base64Size('QUI=')).toBe(2);
    // Over the cap by its length alone: never decoded.
    const atob = vi.spyOn(globalThis, 'atob');
    expect(decodeBase64('A'.repeat(Math.ceil((MADE_PICTURE_MAX_BYTES * 4) / 3) + 8))).toBeNull();
    expect(atob).not.toHaveBeenCalled();
    atob.mockRestore();
  });
});

describe('OpenAI’s picture route', () => {
  it('sends the words, the model and the count, with size, quality, format and filter fixed', async () => {
    const seen = serve({ status: 200, body: { data: [{ b64_json: b64(PNG) }, { b64_json: b64(PNG) }] } });
    const made = await openAiPictures({ apiKey: KEY }).make({ prompt: 'a lemon cake', model: 'gpt-image-2', shape: 'tall', count: 2 });
    expect(made.pictures).toHaveLength(2);
    expect(made.pictures[0]).toMatchObject({ type: 'image/png', width: 48, height: 32 });
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect(seen[0]!.init.redirect).toBe('manual');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ model: 'gpt-image-2', prompt: 'a lemon cake', n: 2, size: '1024x1536', quality: 'medium', output_format: 'jpeg', output_compression: 85, moderation: 'auto' });
    expect((seen[0]!.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('never fetches a picture named by its address, and counts what it dropped', async () => {
    const seen = serve({ status: 200, body: { data: [{ url: 'http://169.254.169.254/latest/meta-data' }, { b64_json: b64(PNG) }, { b64_json: 'junk!' }] } });
    const made = await compatiblePictures({ baseUrl: 'http://localhost:9999/v1/' }).make({ prompt: 'x', model: 'flux-1', shape: 'square', count: 3 });
    expect(made).toMatchObject({ dropped: 2 });
    expect(made.pictures).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('http://localhost:9999/v1/images/generations');
    // A compatible server is asked only what such servers know.
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ model: 'flux-1', prompt: 'x', n: 3, size: '1024x1024', response_format: 'b64_json' });
    expect(seen[0]!.init.headers).not.toHaveProperty('authorization');
  });

  it('fails when the answer holds no picture it can keep', async () => {
    serve({ status: 200, body: { data: [{ url: 'https://example.com/a.png' }] } });
    await expect(compatiblePictures({ baseUrl: 'http://localhost:1/v1' }).make({ prompt: 'x', model: 'm', shape: 'wide', count: 1 })).rejects.toMatchObject({ code: 'bad_response', maybeCharged: true });
  });

  it('refuses a count or a model a caller made up before anything is sent', async () => {
    const seen = serve({ status: 200, body: {} });
    const maker = openAiPictures({ apiKey: KEY });
    await expect(maker.make({ prompt: 'x', model: 'gpt-image-2', shape: 'wide', count: 5 })).rejects.toMatchObject({ code: 'config' });
    await expect(maker.make({ prompt: 'x', model: 'gpt image; drop', shape: 'wide', count: 1 })).rejects.toMatchObject({ code: 'config' });
    expect(seen).toHaveLength(0);
  });

  it('says a content-filter refusal, a billing refusal and a wrong key as codes, with none of the service’s words', async () => {
    serve({ status: 400, body: { error: { code: 'moderation_blocked', type: 'image_generation_user_error', message: `Your request ${KEY} was rejected` } } });
    const refused = await openAiPictures({ apiKey: KEY })
      .make({ prompt: 'x', model: 'gpt-image-2', shape: 'wide', count: 1 })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PictureError);
    expect(refused).toMatchObject({ code: 'refused', status: 400, maybeCharged: true });
    expect(String((refused as Error).message)).not.toContain('rejected');
    expect(String((refused as Error).message)).not.toContain(KEY);
    expect(refusalOf(429, JSON.stringify({ error: { code: 'insufficient_quota' } }))).toBe('billing');
    expect(refusalOf(401, '{}')).toBe('auth');
    // Google's per-minute limit is a wait, not an account with no credit.
    expect(refusalOf(429, JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_requests' } }))).toBe('rate_limit');
    expect(refusalOf(404, 'nope')).toBe('not_found');
    expect(refusalOf(404, JSON.stringify({ error: { code: 'model_not_found', message: 'The model does not exist' } }))).toBe('model_gone');
    expect(refusalOf(404, JSON.stringify({ error: { status: 'NOT_FOUND', message: 'models/x is not found' } }))).toBe('model_gone');
    // A 429 and a plain 400 prove nothing was made: not charged. A refusal may have been.
    expect(new PictureError('rate_limit', 'x').maybeCharged).toBe(false);
    expect(new PictureError('http', 'x', { status: 400 }).maybeCharged).toBe(false);
    expect(new PictureError('refused', 'x', { status: 400 }).maybeCharged).toBe(true);
    expect(new PictureError('timeout', 'x').maybeCharged).toBe(true);
    expect(refusalOf(503, '')).toBe('server');
  });

  it('stops reading an answer past its bound', async () => {
    const big = JSON.stringify({ data: [{ b64_json: 'A'.repeat(answerBound(1)) }] });
    serve({ status: 200, body: big });
    await expect(compatiblePictures({ baseUrl: 'http://localhost:1/v1' }).make({ prompt: 'x', model: 'm', shape: 'wide', count: 1 })).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('lists OpenAI’s picture models the account has, and a compatible server’s by their names', async () => {
    serve({ status: 200, body: { data: [{ id: 'gpt-5' }, { id: 'gpt-image-2' }, { id: 'whisper-1' }] } });
    expect(await openAiPictures({ apiKey: KEY }).listModels()).toEqual(['gpt-image-2']);
    serve({ status: 200, body: { data: [{ id: 'llama3' }, { id: 'x/flux2-klein' }, { id: 'x/z-image-turbo' }] } });
    expect(await compatiblePictures({ baseUrl: 'http://localhost:11434/v1' }).listModels()).toEqual(['x/flux2-klein', 'x/z-image-turbo']);
  });
});

describe('Gemini', () => {
  const picture = { candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: b64(PNG) } }] }, finishReason: 'STOP' }] };

  it('asks one picture a call, in the shape’s aspect ratio, with the key in its header', async () => {
    const seen = serve({ status: 200, body: picture });
    const made = await geminiPictures({ apiKey: KEY }).make({ prompt: 'a cake', model: 'gemini-nano-banana-2.1', shape: 'wide', count: 3 });
    expect(made.pictures).toHaveLength(3);
    expect(seen).toHaveLength(3);
    expect(seen[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent');
    expect((seen[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(seen[0]!.url).not.toContain(KEY);
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'a cake' }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '1K' } },
    });
  });

  it('counts a refused call and keeps the others', async () => {
    serve({ status: 200, body: picture }, { status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } });
    const made = await geminiPictures({ apiKey: KEY }).make({ prompt: 'x', model: 'gemini-3-pro-image', shape: 'square', count: 2 });
    expect(made).toMatchObject({ dropped: 1, refused: 1 });
    expect(made.pictures).toHaveLength(1);
  });

  it('is a refusal when every call came back with no picture', async () => {
    serve({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'I cannot make that.' }] }, finishReason: 'STOP' }] } });
    await expect(geminiPictures({ apiKey: KEY }).make({ prompt: 'x', model: 'gemini-3-pro-image', shape: 'square', count: 2 })).rejects.toMatchObject({ code: 'refused' });
    expect(readGeminiAnswer({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] })).toEqual({ picture: null, refused: true });
  });

  it('answers with a charged error when one call may have been charged and the other was not', async () => {
    serve({ status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } } }, { status: 503, body: {} });
    await expect(geminiPictures({ apiKey: KEY }).make({ prompt: 'x', model: 'gemini-3-pro-image', shape: 'square', count: 2 })).rejects.toMatchObject({ maybeCharged: true });
  });

  it('stops after a wrong key instead of asking again', async () => {
    const seen = serve({ status: 403, body: { error: { status: 'PERMISSION_DENIED' } } });
    await expect(geminiPictures({ apiKey: KEY }).make({ prompt: 'x', model: 'gemini-3-pro-image', shape: 'square', count: 4 })).rejects.toMatchObject({ code: 'auth', maybeCharged: false });
    // Two lanes each asked once, then stopped.
    expect(seen.length).toBeLessThanOrEqual(2);
  });

  it('lists the account’s picture models, the known ones first', async () => {
    serve({
      status: 200,
      body: {
        models: [
          { name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-4-image-preview', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-nano-banana-2.1', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/imagen-5', supportedGenerationMethods: ['predict'] },
        ],
      },
    });
    expect(await geminiPictures({ apiKey: KEY }).listModels()).toEqual(['gemini-nano-banana-2.1', 'gemini-4-image-preview']);
  });
});

describe('the fake', () => {
  it('makes real PNGs in the shape, refuses on its word, and counts what it was asked', async () => {
    const calls: { prompt: string }[] = [];
    const fake = fakePictures({ calls: calls as never });
    const made = await fake.make({ prompt: 'cake', model: 'fake-picture-1', shape: 'tall', count: 2 });
    expect(made.pictures.map((p) => checkPicture(p.bytes))).toEqual(made.pictures.map(() => expect.objectContaining({ type: 'image/png', width: 32, height: 48 })));
    await expect(fake.make({ prompt: 'please refuse', model: 'fake-picture-1', shape: 'tall', count: 1 })).rejects.toMatchObject({ code: 'refused' });
    expect(calls).toHaveLength(2);
  });
});
