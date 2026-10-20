// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's own Figma token, kept by the server on every engine: encrypted under its own key, on
 * their row only, read only by `figmaTokenOf`, and the project's own token for its owner alone.
 */
import { usersRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decryptSecret, deriveKey } from '../src/config/secrets.js';
import { createFigmaTokens, FIGMA_TOKEN_SALT, tokenPrint } from '../src/designer/figma/tokens.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`a Figma token [${engine.name}]`, () => {
    let handle: MetaHandle;
    let ava: string;
    let ben: string;
    beforeEach(async () => {
      handle = await engine.make();
      ava = (await usersRepo(handle.meta).create({ email: 'ava@example.com', name: 'Ava' })).id;
      ben = (await usersRepo(handle.meta).create({ email: 'ben@example.com', name: 'Ben' })).id;
    });
    afterEach(async () => {
      await handle.destroy();
    });

    it('is kept encrypted on its person’s row only, and read back only for them', async () => {
      const tokens = createFigmaTokens({ meta: handle.meta, secret: TEST_SECRET });
      expect(await tokens.save(ava, 'figd_secret_token_1', { id: '1111', handle: 'ava.reyes' })).toBe(true);
      const raw = await handle.meta.db.selectFrom('adminium_users').select(['id', 'figmaTokenEncrypted']).execute();
      const avas = raw.find((row) => row.id === ava)?.figmaTokenEncrypted as string;
      expect(avas).not.toContain('figd_secret_token_1');
      expect(decryptSecret(avas, deriveKey(TEST_SECRET, FIGMA_TOKEN_SALT))).toBe('figd_secret_token_1');
      expect(raw.find((row) => row.id === ben)?.figmaTokenEncrypted).toBeNull();
      expect(await tokens.figmaTokenOf(ava)).toEqual({ token: 'figd_secret_token_1', source: 'mine', figmaUserId: '1111' });
      expect(await tokens.figmaTokenOf(ben)).toBeNull();
      expect(await tokens.status(ava)).toEqual({ connected: true, source: 'mine', handle: 'ava.reyes' });
      expect(JSON.stringify(await tokens.status(ava))).not.toContain('figd_');
      // Kept under another secret, it cannot be read, and is as good as none.
      expect(await createFigmaTokens({ meta: handle.meta, secret: `${TEST_SECRET}-other` }).figmaTokenOf(ava)).toBeNull();
      expect(await createFigmaTokens({ meta: handle.meta, secret: `${TEST_SECRET}-other` }).status(ava)).toEqual({ connected: false, source: null, handle: null });
      expect(await tokens.remove(ava)).toBe(true);
      expect(await tokens.figmaTokenOf(ava)).toBeNull();
    });

    it('lets the project’s own token stand in for its owner alone, ahead of their kept one', async () => {
      const tokens = createFigmaTokens({ meta: handle.meta, secret: TEST_SECRET, environment: { token: 'figd_project_token', ownerId: async () => ava } });
      await tokens.save(ava, 'figd_secret_token_1', { id: '1111', handle: 'ava.reyes' });
      expect(await tokens.figmaTokenOf(ava)).toEqual({ token: 'figd_project_token', source: 'environment', figmaUserId: null });
      expect(await tokens.status(ava)).toEqual({ connected: true, source: 'environment', handle: null });
      expect(await tokens.figmaTokenOf(ben)).toBeNull();
    });

    it('pauses by Figma account', async () => {
      const tokens = createFigmaTokens({ meta: handle.meta, secret: TEST_SECRET });
      await tokens.save(ava, 'figd_a', { id: '1111', handle: 'a' });
      await tokens.save(ben, 'figd_b', { id: '1111', handle: 'b' });
      await tokens.pause('1111', { until: 1_900_000_000_000, dated: true }, ava);
      expect(await tokens.pausedFor('1111')).toEqual({ until: 1_900_000_000_000, dated: true });
      await tokens.unpause('1111');
      expect(await tokens.pausedFor('1111')).toBeNull();
      expect(tokenPrint('figd_a')).toMatch(/^t:[0-9a-f]{16}$/);
      expect(tokenPrint('figd_a')).not.toContain('figd');
    });
  });
}
