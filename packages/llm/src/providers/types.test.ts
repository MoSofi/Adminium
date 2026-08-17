// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Provider-contract helpers (06-llm-assist.md §3.1–§3.2): the config guards and
 * `stripTrailingSlash`, which every base-URL-taking client funnels through and
 * which had no direct coverage before.
 */
import { describe, expect, it } from 'vitest';

import {
  ProviderError,
  assertEnrichmentTemperature,
  requireApiKey,
  requireBaseUrl,
  requireModel,
  stripTrailingSlash,
} from './types.js';

describe('stripTrailingSlash', () => {
  it.each([
    ['http://localhost:11434', 'http://localhost:11434'],
    ['http://localhost:11434/', 'http://localhost:11434'],
    ['http://localhost:11434///', 'http://localhost:11434'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1'],
    ['https://api.example.com/v1//', 'https://api.example.com/v1'],
    // Interior slashes are untouched — only the trailing run goes.
    ['https://api.example.com//v1', 'https://api.example.com//v1'],
    ['', ''],
    ['/', ''],
    ['///', ''],
  ])('%j -> %j', (input, expected) => {
    expect(stripTrailingSlash(input)).toBe(expected);
  });

  /**
   * CodeQL js/polynomial-redos #10: `/\/+$/` is unanchored at the left, so a
   * long run of slashes NOT at the end of the string made the engine restart at
   * every index and re-walk the run before `$` failed. `baseUrl` is
   * operator-supplied config and arrives here unbounded.
   */
  it('trims a long slash run in linear time', () => {
    const url = `http://h/${'/'.repeat(200_000)}v1`;
    const started = performance.now();
    const result = stripTrailingSlash(url);
    const elapsed = performance.now() - started;

    // Nothing to trim — the run is interior, so the value is returned intact.
    expect(result).toBe(url);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('trims a long trailing slash run in linear time', () => {
    const started = performance.now();
    const result = stripTrailingSlash(`http://h/v1${'/'.repeat(200_000)}`);
    const elapsed = performance.now() - started;

    expect(result).toBe('http://h/v1');
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('config guards', () => {
  it('requireApiKey returns the key and rejects blank ones', () => {
    expect(requireApiKey({ provider: 'openai', apiKey: 'sk-x' }, 'openai')).toBe('sk-x');
    expect(() => requireApiKey({ provider: 'openai', apiKey: '  ' }, 'openai')).toThrow(ProviderError);
    expect(() => requireApiKey({ provider: 'openai' }, 'openai')).toThrow(ProviderError);
  });

  it('requireBaseUrl returns a slash-trimmed URL and rejects blank ones', () => {
    expect(requireBaseUrl({ provider: 'ollama', baseUrl: 'http://h:1/' }, 'ollama')).toBe('http://h:1');
    expect(() => requireBaseUrl({ provider: 'ollama', baseUrl: '' }, 'ollama')).toThrow(ProviderError);
  });

  it('requireModel returns the model and rejects blank ones', () => {
    expect(requireModel({ provider: 'openai', model: 'gpt' }, 'openai')).toBe('gpt');
    expect(() => requireModel({ provider: 'openai' }, 'openai')).toThrow(ProviderError);
  });

  it('assertEnrichmentTemperature only permits 0', () => {
    expect(() => assertEnrichmentTemperature(0, 'openai')).not.toThrow();
    expect(() => assertEnrichmentTemperature(0.2, 'openai')).toThrow(ProviderError);
  });
});
