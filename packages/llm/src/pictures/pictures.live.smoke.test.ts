// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The real picture services, called for real. Never in CI:
 * each picture is charged to the key's account. It runs only when
 * `ADMINIUM_LIVE_PICTURES=1`, and only for the services the environment has
 * a key or an address for:
 *
 *   ADMINIUM_AI_OPENAI_API_KEY        (+ ADMINIUM_LIVE_OPENAI_PICTURE_MODEL, default gpt-image-2)
 *   ADMINIUM_AI_GOOGLE_API_KEY        (+ ADMINIUM_LIVE_GOOGLE_PICTURE_MODEL, default gemini-3.1-flash-lite-image)
 *   ADMINIUM_AI_COMPATIBLE_BASE_URL   (+ ADMINIUM_AI_COMPATIBLE_API_KEY, ADMINIUM_LIVE_COMPATIBLE_PICTURE_MODEL)
 *
 * One small picture each, and each one's model list. The fakes agree with
 * us by construction; this is what proves the routes still take what we send.
 */
import { describe, expect, it } from 'vitest';

import { geminiPictures } from './gemini.js';
import { compatiblePictures, openAiPictures } from './openai.js';
import type { PictureMaker } from './types.js';

const env = process.env;
const LIVE = env['ADMINIUM_LIVE_PICTURES'] === '1';

const targets: { name: string; maker: () => PictureMaker; model: string }[] = [];
if (env['ADMINIUM_AI_OPENAI_API_KEY']) targets.push({ name: 'openai', maker: () => openAiPictures({ apiKey: env['ADMINIUM_AI_OPENAI_API_KEY'] ?? '' }), model: env['ADMINIUM_LIVE_OPENAI_PICTURE_MODEL'] ?? 'gpt-image-2' });
if (env['ADMINIUM_AI_GOOGLE_API_KEY']) targets.push({ name: 'google', maker: () => geminiPictures({ apiKey: env['ADMINIUM_AI_GOOGLE_API_KEY'] ?? '' }), model: env['ADMINIUM_LIVE_GOOGLE_PICTURE_MODEL'] ?? 'gemini-3.1-flash-lite-image' });
if (env['ADMINIUM_AI_COMPATIBLE_BASE_URL'] && env['ADMINIUM_LIVE_COMPATIBLE_PICTURE_MODEL']) {
  targets.push({ name: 'openai-compatible', maker: () => compatiblePictures({ baseUrl: env['ADMINIUM_AI_COMPATIBLE_BASE_URL'] ?? '', apiKey: env['ADMINIUM_AI_COMPATIBLE_API_KEY'] }), model: env['ADMINIUM_LIVE_COMPATIBLE_PICTURE_MODEL'] ?? '' });
}

describe.skipIf(!LIVE || targets.length === 0)('live picture services', () => {
  for (const target of targets) {
    it(`${target.name}: lists its picture models and makes one picture`, { timeout: 200_000 }, async () => {
      const maker = target.maker();
      const models = await maker.listModels();
      console.log(`${target.name} picture models: ${models.join(', ')}`);
      const made = await maker.make({ prompt: 'A slice of lemon drizzle cake on a white plate, soft window light, photo', model: target.model, shape: 'square', count: 1 });
      expect(made.pictures).toHaveLength(1);
      expect(['image/jpeg', 'image/png', 'image/webp']).toContain(made.pictures[0]?.type);
      console.log(`${target.name}: ${String(made.pictures[0]?.bytes.length)} bytes, ${String(made.pictures[0]?.width)}×${String(made.pictures[0]?.height)}`);
    });
  }
});
