// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { isRemoteOllamaModel } from './ProviderConfigForm.js';

describe('an Ollama model that does not run on this machine', () => {
  it('is what Ollama`s own list says it is', () => {
    const live = [{ id: 'gemma4:31b-cloud', label: 'gemma4:31b-cloud', remote: true }, { id: 'odd-cloud', label: 'odd-cloud' }];
    expect(isRemoteOllamaModel('gemma4:31b-cloud', live)).toBe(true);
    // Listed and not marked: the list is believed over the name.
    expect(isRemoteOllamaModel('odd-cloud', live)).toBe(false);
  });

  it('is read from the name while the list does not hold it', () => {
    expect(isRemoteOllamaModel('gpt-oss:120b-cloud', undefined)).toBe(true);
    expect(isRemoteOllamaModel('qwen3:cloud', [])).toBe(true);
    expect(isRemoteOllamaModel('llama3.2:latest', undefined)).toBe(false);
    expect(isRemoteOllamaModel('', undefined)).toBe(false);
  });
});
