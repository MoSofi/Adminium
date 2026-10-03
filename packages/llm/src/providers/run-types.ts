// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A streamed run with tools: the second way to talk to a provider.
 *
 * `ProviderClient.complete()` sends strings and waits for one whole reply. A
 * run streams its text as it arrives, carries tools the model may call, takes
 * the caller's stop signal, and returns the assistant's message as blocks.
 * The two never meet: `complete()` is unchanged, and nothing here is on
 * `ProviderClient`, so everything written against that interface still holds.
 *
 * Like the rest of this package it uses the global `fetch` and
 * `AbortController` only.
 */
import type { ProviderId } from '../types.js';

/** One part of a message. */
export type RunBlock =
  | { type: 'text'; text: string }
  /** The model asks for a tool. Only ever in an assistant message. */
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  /** What the tool answered. Only ever in a user message, after the call it answers. */
  | { type: 'tool_result'; callId: string; content: string; isError?: boolean }
  /**
   * A picture the person attached. Only ever in a user message. `data` is
   * base64. A caller that keeps pictures elsewhere stores the block with
   * `data` empty and a `ref` of its own, and fills `data` before a run: a
   * block whose `data` is empty is not sent.
   */
  | { type: 'image'; mediaType: string; data: string; ref?: string; name?: string };

export interface RunMessage {
  role: 'user' | 'assistant';
  content: RunBlock[];
}

/** A tool the model may call. `inputSchema` is a JSON Schema of type `object`. */
export interface RunTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Why the model stopped. */
export type RunStop =
  | 'end' //         it finished its message
  | 'tool_calls' //  it wants the tools it named run
  | 'max_tokens' //  it ran out of the tokens it was given
  | 'refused'; //    the provider declined to answer

/** What a run says while it is going. */
export type RunEvent =
  | { type: 'text'; delta: string }
  /** A tool call was started: told once, as soon as its name is known. */
  | { type: 'tool_call'; id: string; name: string };

export interface RunRequest {
  system: string;
  messages: RunMessage[];
  tools: RunTool[];
  model: string;
  maxTokens: number;
  /** The caller's stop. Aborting it ends the run with a `ProviderError` of code `aborted`. */
  signal?: AbortSignal;
  /** How long to wait for the first byte of the reply. A local model may think for minutes. */
  firstByteTimeoutMs?: number;
  /** How long to wait between two chunks once the reply has started. */
  idleTimeoutMs?: number;
  onEvent?: (event: RunEvent) => void;
}

/** A tool call whose arguments were not a JSON object. */
export interface MalformedCall {
  id: string;
  name: string;
  /** What the model sent, cut short. */
  raw: string;
  error: string;
}

export interface RunResult {
  /** The assistant's message: text and tool calls, in the order they came. */
  blocks: RunBlock[];
  stop: RunStop;
  /** Present only when the provider reported both counts. */
  usage?: { inputTokens: number; outputTokens: number };
  /**
   * Calls that could not be read. Each is still in `blocks` (with an empty
   * input) so the transcript stays one the provider accepts: the caller
   * answers it with an error result and the model tries again.
   */
  malformed: MalformedCall[];
}

export interface ProviderRunner {
  readonly id: ProviderId;
  run(req: RunRequest): Promise<RunResult>;
}

export const RUN_FIRST_BYTE_TIMEOUT_MS = 120_000;
export const RUN_IDLE_TIMEOUT_MS = 60_000;
/** A local model loads into memory before its first token. */
export const OLLAMA_RUN_FIRST_BYTE_TIMEOUT_MS = 600_000;
export const OLLAMA_RUN_IDLE_TIMEOUT_MS = 180_000;

/** The arguments of a tool call as an object, or why they are not one. */
export function parseCallArguments(raw: unknown): { input: Record<string, unknown> } | { error: string; raw: string } {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return { input: raw as Record<string, unknown> };
  if (typeof raw !== 'string') return { error: 'the arguments were not an object', raw: JSON.stringify(raw ?? null).slice(0, 2000) };
  // No arguments at all is a call with none.
  if (raw.trim() === '') return { input: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return { input: parsed as Record<string, unknown> };
    return { error: 'the arguments were JSON, but not an object', raw: raw.slice(0, 2000) };
  } catch (error) {
    return { error: `the arguments were not valid JSON (${error instanceof Error ? error.message : String(error)})`, raw: raw.slice(0, 2000) };
  }
}
